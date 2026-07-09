package commands

import (
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"phytomni-server/db"
	"phytomni-server/model"
)

// TestAddBotRunID_Idempotent pins the idempotency guard for add-bot-run-id: when
// bot_run_id already exists, HasColumn returns true and the command must
// short-circuit without executing ALTER.
//
// The command's Action closure is unexported and unreachable from tests, so this
// replicates the same guard (db.Migrator().HasColumn(&model.QuestionAgentLog{},
// "bot_run_id")): a true result proves the command would take the "skip" branch.
// The table is created with bot_run_id already present.
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

// TestAddBotRunID_AddsWhenAbsent pins the other half of the guard: when the column
// is absent, HasColumn returns false, and after the ADD it must return true. The
// production DDL uses `AFTER server_id` (MySQL-only syntax that SQLite rejects),
// so an equivalent DDL without AFTER is used to verify the guard semantics without
// replicating the exact production SQL.
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

// TestAddColumnIfMissing_ModeAddsWhenAbsent pins the add-mode DDL path: absent
// mode → ALTER runs → column present. SQLite-compatible DDL (no AFTER clause);
// the production MySQL text lives in the add-mode subcommand.
func TestAddColumnIfMissing_ModeAddsWhenAbsent(t *testing.T) {
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := gdb.Exec(`CREATE TABLE question_agent_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		tool_name TEXT
	)`).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	db.Set("phytomni-server", gdb)

	m := model.Default().Migrator()
	if m.HasColumn(&model.QuestionAgentLog{}, "mode") {
		t.Fatal("mode should be absent before add")
	}
	if err := addColumnIfMissing(model.Default(), &model.QuestionAgentLog{}, "mode",
		"ALTER TABLE question_agent_logs ADD COLUMN mode VARCHAR(20) NOT NULL DEFAULT 'instant'"); err != nil {
		t.Fatalf("add column: %v", err)
	}
	if !m.HasColumn(&model.QuestionAgentLog{}, "mode") {
		t.Error("mode should be present after add")
	}
}

// TestAddColumnIfMissing_ModeSkipsWhenPresent pins the add-mode no-op path so
// re-running migrate add-mode against a schema that already has mode is safe.
func TestAddColumnIfMissing_ModeSkipsWhenPresent(t *testing.T) {
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := gdb.Exec(`CREATE TABLE question_agent_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		tool_name TEXT,
		mode TEXT NOT NULL DEFAULT 'instant'
	)`).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	db.Set("phytomni-server", gdb)

	if err := addColumnIfMissing(model.Default(), &model.QuestionAgentLog{}, "mode",
		"ALTER TABLE question_agent_logs ADD COLUMN mode VARCHAR(20) NOT NULL DEFAULT 'instant'"); err != nil {
		t.Fatalf("present-column path must no-op, got %v", err)
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

// TestReportDuplicateEmails pins two key contracts of reportDuplicateEmails:
// (1) exactly the duplicate email is returned; unique emails are not included.
// (2) the row count is unchanged after the call — report-only, no deletes.
// The "report-only" assertion is a core invariant: dropping the row-count check
// would still leave the test green, but the contract would be violated.
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

// chatLimitBackfillSQLSQLite is the SQLite-portable equivalent of
// chatLimitBackfillSQL. The production SQL is identical in WHERE/SET shape
// (both use only integer comparison and a string inequality), so no dialect
// substitution is actually needed here — the constant is kept separate solely
// to make the seam explicit and to mirror the firstLoginBackfillSQL /
// sqliteBackfillSQL test pattern.
const chatLimitBackfillSQLSQLite = `
	UPDATE users
	SET chat_limit = 1073741824
	WHERE chat_limit = 0
	  AND code <> 'guest'`

// TestBackfillChatLimit pins three contracts of backfillChatLimitWith:
//
//  1. A non-guest user whose chat_limit is 0 is set to the sentinel (2^30).
//  2. A guest user whose chat_limit is 0 is left untouched.
//  3. A non-guest user whose chat_limit is already non-zero is left untouched.
//  4. rows_affected == 1 (exactly the first row changed).
//
// Mutation coverage:
//   - Drop `code <> 'guest'` → guest row changes → RED on assertion (2).
//   - Drop `chat_limit = 0`  → already-5 row changes → RED on assertion (3).
func TestBackfillChatLimit(t *testing.T) {
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	// Table name must match User.TableName() == "users"; minimal columns only.
	if err := gdb.Exec(`CREATE TABLE users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		code TEXT,
		chat_limit INTEGER
	)`).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	if err := gdb.Exec(`INSERT INTO users (code, chat_limit) VALUES
		('user',  0),
		('guest', 0),
		('user',  5)`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	rows, err := backfillChatLimitWith(gdb, chatLimitBackfillSQLSQLite)
	if err != nil {
		t.Fatalf("backfillChatLimitWith: %v", err)
	}
	if rows != 1 {
		t.Fatalf("expected rows_affected == 1 (only the chat_limit=0 non-guest row), got %d", rows)
	}

	type row struct {
		Code      string
		ChatLimit int
	}
	var results []row
	if err := gdb.Raw(`SELECT code, chat_limit FROM users ORDER BY id`).Scan(&results).Error; err != nil {
		t.Fatalf("scan: %v", err)
	}
	if len(results) != 3 {
		t.Fatalf("expected 3 rows, got %d", len(results))
	}

	const sentinel = 1073741824 // 2^30

	// Row 1: non-guest, was 0 → must become sentinel.
	if results[0].ChatLimit != sentinel {
		t.Errorf("row1 (user, was 0): want chat_limit=%d, got %d", sentinel, results[0].ChatLimit)
	}
	// Row 2: guest, was 0 → must remain 0 (untouched by code <> 'guest' guard).
	if results[1].ChatLimit != 0 {
		t.Errorf("row2 (guest, was 0): want chat_limit=0, got %d", results[1].ChatLimit)
	}
	// Row 3: non-guest, was 5 → must remain 5 (untouched by chat_limit = 0 guard).
	if results[2].ChatLimit != 5 {
		t.Errorf("row3 (user, was 5): want chat_limit=5, got %d", results[2].ChatLimit)
	}
}

func TestRenameAgentToolNames(t *testing.T) {
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := gdb.Exec(`CREATE TABLE tool_names (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		tool_name TEXT,
		description TEXT
	)`).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	if err := gdb.Exec(`INSERT INTO tool_names (tool_name) VALUES
		('ChatAgents'),
		('DatabaseAgents'),
		('BriefReviewAgent'),
		('ReviewAgent')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	n, err := renameAgentToolNames(gdb, "tool_names", "tool_name")
	if err != nil {
		t.Fatal(err)
	}
	if n != 3 {
		t.Errorf("rows affected = %d; want 3", n)
	}

	var names []string
	if err := gdb.Raw(`SELECT tool_name FROM tool_names ORDER BY id`).Scan(&names).Error; err != nil {
		t.Fatalf("scan names: %v", err)
	}
	want := []string{"ChatAgent", "DataAgent", "BriefGeneAgent", "ReviewAgent"}
	for i := range want {
		if names[i] != want[i] {
			t.Errorf("row %d = %q; want %q", i, names[i], want[i])
		}
	}

	n2, err2 := renameAgentToolNames(gdb, "tool_names", "tool_name")
	if err2 != nil {
		t.Fatalf("second run error: %v", err2)
	}
	if n2 != 0 {
		t.Errorf("second run affected %d rows; want 0", n2)
	}
}
