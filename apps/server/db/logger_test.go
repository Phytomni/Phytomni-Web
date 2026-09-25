package db

import (
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// openLoggedTestDB replicates the logger assembly from mysql.go: wraps
// NewSqlLogger around the base logger with ParameterizedQueries enabled, then
// registers the DB in the global registry.
// Uses in-memory SQLite (glebarez, pure-Go no CGO); its Dialector.Explain
// preserves ? placeholders when vars is empty, faithfully reproducing
// production parameterization behavior.
func openLoggedTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	base := logger.New(testWriter{t}, logger.Config{
		LogLevel:             logger.Info, // Info level is required for Trace to call fc()
		ParameterizedQueries: true,
	})

	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: NewSqlLogger(base),
	})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	// Each :memory: SQLite connection is its own independent database.
	// Pin to one connection so async logger goroutine writes and poll reads
	// both hit the same in-memory DB (without this, Trace's async write lands
	// on a different, empty connection).
	sqlDB, derr := gdb.DB()
	if derr != nil {
		t.Fatalf("get sql.DB: %v", derr)
	}
	sqlDB.SetMaxOpenConns(1)

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

	if err := gdb.Exec(`CREATE TABLE s_probe_users (id INTEGER PRIMARY KEY, email TEXT)`).Error; err != nil {
		t.Fatalf("create s_probe_users: %v", err)
	}

	Set("phytomni-server", gdb) // async writer resolves the connection via Get("phytomni-server")
	return gdb
}

// testWriter routes base logger output to t.Log to avoid polluting test output.
type testWriter struct{ t *testing.T }

func (w testWriter) Printf(format string, args ...interface{}) {
	w.t.Logf(format, args...)
}

// fetchLatestSQLContent polls until the async logger goroutine has flushed,
// then returns the most recent sql_content row matching the LIKE pattern.
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

// TestSqlLogger_ParameterizedQueries pins AF-003: after a query with sensitive
// literal values is recorded, sql_content must be parameterized (contain ?)
// and must not contain the plaintext email.
func TestSqlLogger_ParameterizedQueries(t *testing.T) {
	gdb := openLoggedTestDB(t)

	const secretEmail = "victim@example.com"

	// Trigger a query with a literal value; using s_probe_users makes the
	// resulting audit row identifiable by table name.
	var dummy []map[string]interface{}
	if err := gdb.Table("s_probe_users").Where("email = ?", secretEmail).Find(&dummy).Error; err != nil {
		t.Fatalf("probe query: %v", err)
	}

	// Match with SELECT prefix to target the probe query row specifically,
	// excluding the CREATE TABLE audit row that also mentions s_probe_users
	// (avoids flaky races where the DDL row wins the ORDER BY id DESC race).
	got := fetchLatestSQLContent(t, gdb, "SELECT%s_probe_users%")

	if strings.Contains(got, secretEmail) {
		t.Errorf("sql_content leaked literal email %q: %s", secretEmail, got)
	}
	if !strings.Contains(got, "?") {
		t.Errorf("sql_content not parameterized (no ? placeholder): %s", got)
	}
}

// TestLongResearchSqlLoggerParameterized catches parameter interpolation that
// would copy a paper-length Research query into sql_operation_logs.
func TestLongResearchSqlLoggerParameterized(t *testing.T) {
	gdb := openLoggedTestDB(t)
	const (
		maxCodePoints = 131_072
		paperMarker   = "Synthetic paper abstract: rice root development evidence."
		pathMarker    = "scrubbed-bucket/synthetic-study/late/reads.fastq.gz"
	)
	prefix := paperMarker + "\n"
	suffix := "\n" + pathMarker
	fillerCount := maxCodePoints - utf8.RuneCountInString(prefix) - utf8.RuneCountInString(suffix)
	query := prefix + strings.Repeat("\u7A3B", fillerCount) + suffix
	if got := utf8.RuneCountInString(query); got != maxCodePoints {
		t.Fatalf("synthetic query code points = %d, want %d", got, maxCodePoints)
	}

	var rows []map[string]interface{}
	if err := gdb.Table("s_probe_users").Where("email = ?", query).Find(&rows).Error; err != nil {
		t.Fatalf("long Research probe query failed: %v", err)
	}
	logged := fetchLatestSQLContent(t, gdb, "SELECT%s_probe_users%")
	if strings.Contains(logged, paperMarker) || strings.Contains(logged, pathMarker) {
		t.Fatal("sql_content retained a synthetic Research marker")
	}
	if !strings.Contains(logged, "?") {
		t.Fatal("sql_content omitted its bind placeholder")
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

// TestWriteSQLAuditLog_SurfacesInsertError pins AF-004: when the audit table is
// absent, the insert error must be returned, not silently dropped.
// Remove the Create(...).Error return → this test turns red.
func TestWriteSQLAuditLog_SurfacesInsertError(t *testing.T) {
	// sql_operation_logs intentionally not created.
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	Set("phytomni-server", gdb)

	if err := writeSQLAuditLog(auditRow()); err == nil {
		t.Fatal("missing sql_operation_logs must surface an insert error, not drop it silently")
	}
}

// TestWriteSQLAuditLog_OKWhenTablePresent pins the happy path: when the audit
// table exists, the insert succeeds and returns nil.
func TestWriteSQLAuditLog_OKWhenTablePresent(t *testing.T) {
	openLoggedTestDB(t) // registers a connection with sql_operation_logs in the registry
	if err := writeSQLAuditLog(auditRow()); err != nil {
		t.Fatalf("insert into present audit table should succeed: %v", err)
	}
}
