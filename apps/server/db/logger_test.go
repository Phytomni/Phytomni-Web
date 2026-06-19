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
	ddl := `CREATE TABLE sql_operation_logs (
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
		t.Fatalf("create sql_operation_logs: %v", err)
	}

	// 被审计的业务表。
	if err := gdb.Exec(`CREATE TABLE s_probe_users (id INTEGER PRIMARY KEY, email TEXT)`).Error; err != nil {
		t.Fatalf("create s_probe_users: %v", err)
	}

	Set("phytomni-server", gdb) // 异步写库经 Get("phytomni-server") 取连接
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
			Table("sql_operation_logs").
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

// auditRow is a minimal valid audit log entry for the seam tests.
func auditRow() map[string]interface{} {
	return map[string]interface{}{
		"user_id":        int64(1),
		"user_email":     "x@y.com",
		"operation_type": "SELECT",
		"table_name":     "s_probe_users",
		"sql_content":    "SELECT 1",
		"duration":       int64(1),
		"status":         "Success",
		"error_message":  "",
		"created_at":     time.Now(),
	}
}

// TestWriteSQLAuditLog_SurfacesInsertError 验证 AF-004:审计表缺失时,插入错误
// 必须被返回(而非静默丢弃)。删掉 Create(...).Error 的返回 → 此测试转红。
func TestWriteSQLAuditLog_SurfacesInsertError(t *testing.T) {
	// sql_operation_logs 故意不建表。
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	Set("phytomni-server", gdb)

	if err := writeSQLAuditLog(auditRow()); err == nil {
		t.Fatal("missing sql_operation_logs must surface an insert error, not drop it silently")
	}
}

// TestWriteSQLAuditLog_OKWhenTablePresent 验证正常路径:表存在时插入成功、返回 nil。
func TestWriteSQLAuditLog_OKWhenTablePresent(t *testing.T) {
	openLoggedTestDB(t) // 注册带 sql_operation_logs 的连接到 registry
	if err := writeSQLAuditLog(auditRow()); err != nil {
		t.Fatalf("insert into present audit table should succeed: %v", err)
	}
}
