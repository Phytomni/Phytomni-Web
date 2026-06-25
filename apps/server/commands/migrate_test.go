package commands

import (
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"phytomni-server/db"
	"phytomni-server/model"
)

// TestAddBotRunID_Idempotent 钉死 add-bot-run-id 的幂等守卫:当 bot_run_id 列已存在时,
// HasColumn 返回 true,命令应短路、不再执行 ALTER。
//
// 直接测命令 Action 闭包不可达(未导出),因此复刻命令体内的同一守卫
// db.Migrator().HasColumn(&model.QuestionAgentLog{}, "bot_run_id"):该守卫为真即代表
// 命令会走 "skip" 分支。建表时即带 bot_run_id 列。
func TestAddBotRunID_Idempotent(t *testing.T) {
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := gdb.Exec(`CREATE TABLE question_agent_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		server_id TEXT,
		bot_run_id TEXT
	)`).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	db.Set("phytomni-server", gdb)

	if !model.Default().Migrator().HasColumn(&model.QuestionAgentLog{}, "bot_run_id") {
		t.Fatal("guard should report bot_run_id present; idempotent re-run would otherwise re-ALTER")
	}
}

// TestAddBotRunID_AddsWhenAbsent 钉死守卫的另一半:列不存在时 HasColumn 返回 false,
// 加列后再查应为 true。生产 DDL 带 `AFTER server_id`(MySQL 专有),SQLite 不支持该子句,
// 故此处用等价的无 AFTER 形式验证守卫语义,而非复刻生产 SQL 文本。
func TestAddBotRunID_AddsWhenAbsent(t *testing.T) {
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := gdb.Exec(`CREATE TABLE question_agent_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		server_id TEXT
	)`).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	db.Set("phytomni-server", gdb)

	m := model.Default().Migrator()
	if m.HasColumn(&model.QuestionAgentLog{}, "bot_run_id") {
		t.Fatal("bot_run_id should be absent before add")
	}
	if err := model.Default().Exec(
		"ALTER TABLE question_agent_logs ADD COLUMN bot_run_id VARCHAR(64)",
	).Error; err != nil {
		t.Fatalf("add column: %v", err)
	}
	if !m.HasColumn(&model.QuestionAgentLog{}, "bot_run_id") {
		t.Error("bot_run_id should be present after add")
	}
}

// TestAddColumnIfMissing_SkipsWhenPresent drives the shared idempotency guard
// directly (TW-002: the CLI Action closure is unexported). The ddl passed in
// would FAIL with "duplicate column" if it ran, so a nil return proves the
// HasColumn guard short-circuited — delete the guard and this test goes red.
func TestAddColumnIfMissing_SkipsWhenPresent(t *testing.T) {
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := gdb.Exec(`CREATE TABLE question_agent_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		download_path TEXT,
		image_paths TEXT
	)`).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	db.Set("phytomni-server", gdb)

	if err := addColumnIfMissing(model.Default(), &model.QuestionAgentLog{}, "image_paths",
		"ALTER TABLE question_agent_logs ADD COLUMN image_paths TEXT"); err != nil {
		t.Fatalf("present-column path must no-op, got %v", err)
	}
}

// TestAddColumnIfMissing_AddsWhenAbsent drives the other half: absent column →
// the ALTER runs and the column exists afterward. SQLite-compatible DDL (no
// AFTER/COMMENT, which SQLite rejects); the production MySQL text lives in the
// add-image-paths subcommand.
func TestAddColumnIfMissing_AddsWhenAbsent(t *testing.T) {
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := gdb.Exec(`CREATE TABLE question_agent_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		download_path TEXT
	)`).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	db.Set("phytomni-server", gdb)

	m := model.Default().Migrator()
	if m.HasColumn(&model.QuestionAgentLog{}, "image_paths") {
		t.Fatal("image_paths should be absent before add")
	}
	if err := addColumnIfMissing(model.Default(), &model.QuestionAgentLog{}, "image_paths",
		"ALTER TABLE question_agent_logs ADD COLUMN image_paths TEXT"); err != nil {
		t.Fatalf("add column: %v", err)
	}
	if !m.HasColumn(&model.QuestionAgentLog{}, "image_paths") {
		t.Error("image_paths should be present after add")
	}
}

// TestAddUniqueIndexIfMissing_Idempotent pins the HasIndex-guarded idempotency
// of addUniqueIndexIfMissing: first call creates the index, second call is a
// no-op (no "index already exists" DDL error). After creation, inserting a
// duplicate email must violate the constraint — proving the index is active.
func TestAddUniqueIndexIfMissing_Idempotent(t *testing.T) {
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	// Table name matches User.TableName() == "users"; minimal columns only.
	if err := gdb.Exec(`CREATE TABLE users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT
	)`).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	db.Set("phytomni-server", gdb)

	const ddl = "CREATE UNIQUE INDEX uniq_users_email ON users(email)"

	// First call: index is absent → must be created.
	if err := addUniqueIndexIfMissing(model.Default(), &model.User{}, "uniq_users_email", ddl); err != nil {
		t.Fatalf("first call (create): %v", err)
	}
	// Second call: index already present → HasIndex guard must short-circuit, no DDL error.
	if err := addUniqueIndexIfMissing(model.Default(), &model.User{}, "uniq_users_email", ddl); err != nil {
		t.Fatalf("second call (no-op): %v", err)
	}

	// The index is active: a duplicate email insert must error.
	if err := gdb.Exec(`INSERT INTO users (email) VALUES ('a@x.com')`).Error; err != nil {
		t.Fatalf("first insert: %v", err)
	}
	if err := gdb.Exec(`INSERT INTO users (email) VALUES ('a@x.com')`).Error; err == nil {
		t.Error("duplicate email insert must fail when unique index is present")
	}
}

// sqliteBackfillSQL mirrors firstLoginBackfillSQL's row-selection semantics
// (flip first_login_status '1'→'0' when password_change_at and created_at are
// within 5 seconds) using SQLite-portable julianday arithmetic instead of
// MySQL's TIMESTAMPDIFF. The WHERE/SET shape is identical so this exercises the
// same idempotency + selection contract the production statement relies on.
const sqliteBackfillSQL = `
	UPDATE users
	SET first_login_status = '0'
	WHERE first_login_status = '1'
	  AND password_change_at IS NOT NULL
	  AND created_at IS NOT NULL
	  AND ABS((julianday(password_change_at) - julianday(created_at)) * 86400) < 5`

func newBackfillTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	// Table name must match User.TableName() == "users".
	if err := gdb.Exec(`CREATE TABLE users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		first_login_status TEXT,
		password_change_at TEXT,
		created_at TEXT
	)`).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	return gdb
}

// TestBackfillFirstLoginStatus_SelectsOnlyWithinWindow pins the row-selection
// contract: only a status='1' row whose two timestamps are within 5s is
// flipped. A status='1' row an hour apart, and an already-'0' row, are left
// untouched. Delete the WHERE window and the hour-apart row would also flip,
// turning this test red.
func TestBackfillFirstLoginStatus_SelectsOnlyWithinWindow(t *testing.T) {
	gdb := newBackfillTestDB(t)
	if err := gdb.Exec(`INSERT INTO users (first_login_status, password_change_at, created_at) VALUES
		('1', '2026-01-01 10:00:02', '2026-01-01 10:00:00'),
		('1', '2026-01-01 11:00:00', '2026-01-01 10:00:00'),
		('0', '2026-01-01 10:00:00', '2026-01-01 10:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	rows, err := backfillFirstLoginStatusWith(gdb, sqliteBackfillSQL)
	if err != nil {
		t.Fatalf("backfill: %v", err)
	}
	if rows != 1 {
		t.Fatalf("expected exactly 1 row flipped (within-window only), got %d", rows)
	}

	var stillFlagged int64
	if err := gdb.Raw(`SELECT COUNT(*) FROM users WHERE first_login_status = '1'`).Scan(&stillFlagged).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if stillFlagged != 1 {
		t.Errorf("the hour-apart row must remain first_login_status='1'; got %d still flagged", stillFlagged)
	}
}

// TestBackfillFirstLoginStatus_Idempotent pins the idempotency contract: a
// second run matches zero rows because the first run already cleared every
// within-window '1'. If the SET/WHERE ever stopped narrowing on
// first_login_status='1', the second run would re-touch rows and this goes red.
func TestBackfillFirstLoginStatus_Idempotent(t *testing.T) {
	gdb := newBackfillTestDB(t)
	if err := gdb.Exec(`INSERT INTO users (first_login_status, password_change_at, created_at) VALUES
		('1', '2026-01-01 10:00:01', '2026-01-01 10:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	first, err := backfillFirstLoginStatusWith(gdb, sqliteBackfillSQL)
	if err != nil {
		t.Fatalf("first backfill: %v", err)
	}
	if first != 1 {
		t.Fatalf("first run should flip 1 row, got %d", first)
	}

	second, err := backfillFirstLoginStatusWith(gdb, sqliteBackfillSQL)
	if err != nil {
		t.Fatalf("second backfill: %v", err)
	}
	if second != 0 {
		t.Errorf("second run must be a no-op (idempotent), got %d rows affected", second)
	}
}

// TestReportDuplicateEmails 钉死 reportDuplicateEmails 的两个关键契约:
// (1) 恰好返回有重复的那个 email,独立 email 不在结果中;
// (2) 调用后行数不变(仅报告,绝不删行)。
// 此 "report-only" 断言是核心不变量:删掉行数检查本测试仍绿,但契约就失守了。
func TestReportDuplicateEmails(t *testing.T) {
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	// Table name must match User.TableName() == "users".
	if err := gdb.Exec(`CREATE TABLE users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT,
		created_at TEXT
	)`).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	// Two rows share the same email; one row has a unique email.
	if err := gdb.Exec(`INSERT INTO users (email, created_at) VALUES
		('dup@example.com', '2026-01-01 10:00:00'),
		('dup@example.com', '2026-01-02 10:00:00'),
		('unique@example.com', '2026-01-03 10:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	db.Set("phytomni-server", gdb)

	dups, err := reportDuplicateEmails(model.Default())
	if err != nil {
		t.Fatalf("reportDuplicateEmails: %v", err)
	}

	// Contract (1): exactly the duplicate email is returned, length == 1.
	if len(dups) != 1 {
		t.Fatalf("expected 1 duplicate email, got %d: %v", len(dups), dups)
	}
	if dups[0] != "dup@example.com" {
		t.Errorf("expected 'dup@example.com', got %q", dups[0])
	}

	// Contract (2): row count is unchanged — report-only, no deletes.
	var total int64
	if err := gdb.Raw("SELECT COUNT(*) FROM users").Scan(&total).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if total != 3 {
		t.Errorf("report-only invariant violated: expected 3 rows, got %d", total)
	}
}

// TestBackfillFirstLoginStatus_SurfacesError pins that a failing statement
// propagates rather than being swallowed: the production seam returns the error
// so `migrate up` exits non-zero instead of reporting a phantom success.
func TestBackfillFirstLoginStatus_SurfacesError(t *testing.T) {
	gdb := newBackfillTestDB(t)
	if _, err := backfillFirstLoginStatusWith(gdb, `UPDATE no_such_table SET x = 1`); err == nil {
		t.Fatal("expected an error from a statement against a missing table, got nil")
	}
}
