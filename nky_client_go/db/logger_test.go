package db

import (
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// openLoggedTestDB 复刻 mysql.go 的 logger 装配：把 NewSqlLogger 包在底层
// logger 外，并开启 ParameterizedQueries，再注册到全局 registry。
// 用 in-memory SQLite（glebarez，纯 Go 无 CGO），其 Dialector.Explain 在 vars
// 为空时保留 ? 占位符，可如实复现生产参数化行为。
func openLoggedTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	base := logger.New(testWriter{t}, logger.Config{
		LogLevel:             logger.Info, // Info 级才会让 Trace 走 fc()
		ParameterizedQueries: true,
	})

	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: NewSqlLogger(base),
	})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	// :memory: SQLite 每条连接是独立库;限制单连接,确保异步 logger goroutine
	// 的写入与轮询读取命中同一个内存库(否则 Trace 的异步写会落到另一条空连接)。
	sqlDB, derr := gdb.DB()
	if derr != nil {
		t.Fatalf("get sql.DB: %v", derr)
	}
	sqlDB.SetMaxOpenConns(1)

	// 审计日志落盘表（Trace 异步写这张表）。
	ddl := `CREATE TABLE s_sql_operation_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER,
		user_email TEXT,
		operation_type TEXT,
		table_name TEXT,
		sql_content TEXT,
		duration INTEGER,
		status TEXT,
		error_message TEXT,
		created_at DATETIME
	)`
	if err := gdb.Exec(ddl).Error; err != nil {
		t.Fatalf("create s_sql_operation_logs: %v", err)
	}

	// 被审计的业务表。
	if err := gdb.Exec(`CREATE TABLE s_probe_users (id INTEGER PRIMARY KEY, email TEXT)`).Error; err != nil {
		t.Fatalf("create s_probe_users: %v", err)
	}

	Set("nky_client_go", gdb) // 异步写库经 Get("nky_client_go") 取连接
	return gdb
}

// testWriter 把底层 logger 的输出导向 t.Log，避免污染测试输出。
type testWriter struct{ t *testing.T }

func (w testWriter) Printf(format string, args ...interface{}) {
	w.t.Logf(format, args...)
}

// fetchLatestSQLContent 轮询等待异步 logger goroutine 落盘后取最新一行 sql_content。
func fetchLatestSQLContent(t *testing.T, gdb *gorm.DB, like string) string {
	t.Helper()
	for i := 0; i < 50; i++ {
		var content string
		err := gdb.Session(&gorm.Session{Logger: logger.Discard, NewDB: true}).
			Table("s_sql_operation_logs").
			Where("sql_content LIKE ?", like).
			Order("id DESC").
			Limit(1).
			Pluck("sql_content", &content).Error
		if err == nil && content != "" {
			return content
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for async sql log matching %q", like)
	return ""
}

// TestSqlLogger_ParameterizedQueries 验证 AF-003：带敏感字面值的查询
// 落审计表后，sql_content 必须是占位符形态（含 ?），且不含明文邮箱。
func TestSqlLogger_ParameterizedQueries(t *testing.T) {
	gdb := openLoggedTestDB(t)

	const secretEmail = "victim@example.com"

	// 触发一次带字面值的查询；查 s_probe_users 让落盘行的 sql_content 可定位。
	var dummy []map[string]interface{}
	if err := gdb.Table("s_probe_users").Where("email = ?", secretEmail).Find(&dummy).Error; err != nil {
		t.Fatalf("probe query: %v", err)
	}

	// 用 SELECT 前缀精确匹配探针查询行,排除同样含 "s_probe_users" 的
	// CREATE TABLE 审计行(避免竞争到 DDL 行导致偶发失败)。
	got := fetchLatestSQLContent(t, gdb, "SELECT%s_probe_users%")

	if strings.Contains(got, secretEmail) {
		t.Errorf("sql_content leaked literal email %q: %s", secretEmail, got)
	}
	if !strings.Contains(got, "?") {
		t.Errorf("sql_content not parameterized (no ? placeholder): %s", got)
	}
}
