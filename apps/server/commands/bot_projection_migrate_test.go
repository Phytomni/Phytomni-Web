package commands

import (
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"phytomni-server/db"
	"phytomni-server/model"
)

func openMigrationSQLite(t *testing.T, ddl string) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if sqlDB, err := gdb.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	if err := gdb.Exec(ddl).Error; err != nil {
		t.Fatalf("create migration table: %v", err)
	}
	db.Set("phytomni-server", gdb)
	return gdb
}

func TestAddBotProjectionColumnsIsIdempotent(t *testing.T) {
	gdb := openMigrationSQLite(t, `CREATE TABLE question_agent_logs (
		id INTEGER PRIMARY KEY,
		bot_run_id TEXT
	)`)

	if err := addColumnIfMissing(gdb, &model.QuestionAgentLog{}, "bot_projection_json",
		"ALTER TABLE question_agent_logs ADD COLUMN bot_projection_json TEXT"); err != nil {
		t.Fatal(err)
	}
	if err := addColumnIfMissing(gdb, &model.QuestionAgentLog{}, "bot_report_revision",
		"ALTER TABLE question_agent_logs ADD COLUMN bot_report_revision INTEGER NOT NULL DEFAULT -1"); err != nil {
		t.Fatal(err)
	}
	if err := addColumnIfMissing(gdb, &model.QuestionAgentLog{}, "bot_projection_json",
		"ALTER TABLE question_agent_logs ADD COLUMN bot_projection_json TEXT"); err != nil {
		t.Fatal(err)
	}

	if !gdb.Migrator().HasColumn(&model.QuestionAgentLog{}, "bot_projection_json") ||
		!gdb.Migrator().HasColumn(&model.QuestionAgentLog{}, "bot_report_revision") {
		t.Fatal("projection columns missing")
	}
	if err := gdb.Exec("INSERT INTO question_agent_logs (id, bot_run_id) VALUES (1, 'run-1')").Error; err != nil {
		t.Fatalf("insert legacy row: %v", err)
	}
	var revision int64
	if err := gdb.Raw("SELECT bot_report_revision FROM question_agent_logs WHERE id = 1").Scan(&revision).Error; err != nil {
		t.Fatalf("read revision sentinel: %v", err)
	}
	if revision != -1 {
		t.Fatalf("fresh projection row revision = %d, want -1", revision)
	}
}

func TestAddBotProjectionIndexIsIdempotent(t *testing.T) {
	gdb := openMigrationSQLite(t, `CREATE TABLE question_agent_logs (
		id INTEGER PRIMARY KEY,
		bot_report_revision INTEGER NOT NULL DEFAULT -1
	)`)
	const ddl = "CREATE INDEX idx_question_agent_logs_bot_report_revision ON question_agent_logs(bot_report_revision)"
	if err := addIndexIfMissing(gdb, &model.QuestionAgentLog{}, "idx_question_agent_logs_bot_report_revision", ddl); err != nil {
		t.Fatalf("first index add: %v", err)
	}
	if err := addIndexIfMissing(gdb, &model.QuestionAgentLog{}, "idx_question_agent_logs_bot_report_revision", ddl); err != nil {
		t.Fatalf("second index add should no-op: %v", err)
	}
	if !gdb.Migrator().HasIndex(&model.QuestionAgentLog{}, "idx_question_agent_logs_bot_report_revision") {
		t.Fatal("projection revision index missing")
	}
}

func TestQuestionAgentLogProjectionFieldsArePrivateAndRevisionTagged(t *testing.T) {
	gdb := openMigrationSQLite(t, `CREATE TABLE question_agent_logs (id INTEGER PRIMARY KEY)`)
	stmt := &gorm.Statement{DB: gdb}
	if err := stmt.Parse(&model.QuestionAgentLog{}); err != nil {
		t.Fatalf("parse QuestionAgentLog schema: %v", err)
	}
	projection, ok := stmt.Schema.FieldsByDBName["bot_projection_json"]
	if !ok {
		t.Fatal("QuestionAgentLog is missing bot_projection_json")
	}
	if got := projection.TagSettings["TYPE"]; got != "longtext" {
		t.Fatalf("projection type = %q, want longtext", got)
	}
	if got := projection.Tag.Get("json"); got != "-" {
		t.Fatalf("projection JSON tag = %q, want -", got)
	}
	revision, ok := stmt.Schema.FieldsByDBName["bot_report_revision"]
	if !ok {
		t.Fatal("QuestionAgentLog is missing bot_report_revision")
	}
	if got := revision.TagSettings["TYPE"]; got != "bigint" {
		t.Fatalf("revision type = %q, want bigint", got)
	}
	if got := revision.TagSettings["DEFAULT"]; got != "-1" {
		t.Fatalf("revision default = %q, want -1", got)
	}
	if got := revision.Tag.Get("json"); got != "-" {
		t.Fatalf("revision JSON tag = %q, want -", got)
	}
}

func TestMigrateExposesOperatorControlledBotProjectionCommand(t *testing.T) {
	command := Migrate()
	for _, subcommand := range command.Subcommands {
		if subcommand.Name != "add-bot-projection" {
			continue
		}
		if !strings.Contains(subcommand.Description, "operator-controlled") {
			t.Fatalf("migration description must state operator-controlled production execution: %q", subcommand.Description)
		}
		if subcommand.Action == nil {
			t.Fatal("add-bot-projection migration action is nil")
		}
		return
	}
	t.Fatal("migrate add-bot-projection subcommand missing")
}
