package commands

import (
	"flag"
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/urfave/cli/v2"
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

func TestQuestionAgentLogUsesMediumTextForQueryAndAnswer(t *testing.T) {
	gdb := openMigrationSQLite(t, `CREATE TABLE question_agent_logs (id INTEGER PRIMARY KEY)`)
	stmt := &gorm.Statement{DB: gdb}
	if err := stmt.Parse(&model.QuestionAgentLog{}); err != nil {
		t.Fatalf("parse QuestionAgentLog schema: %v", err)
	}
	for _, name := range []string{"query", "answer"} {
		field, ok := stmt.Schema.FieldsByDBName[name]
		if !ok {
			t.Fatalf("QuestionAgentLog is missing %s", name)
		}
		if got := field.TagSettings["TYPE"]; got != "mediumtext" {
			t.Fatalf("%s type = %q, want mediumtext", name, got)
		}
	}
	if got := stmt.Schema.FieldsByDBName["title_query"].TagSettings["TYPE"]; got != "text" {
		t.Fatalf("title_query type = %q, want text", got)
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

func TestMigrateExposesOperatorControlledExecutionAdmissionCommand(t *testing.T) {
	command := Migrate()
	for _, subcommand := range command.Subcommands {
		if subcommand.Name != "add-execution-admissions" {
			continue
		}
		if !strings.Contains(subcommand.Description, "Idempotent") ||
			!strings.Contains(subcommand.Description, "operator-controlled") {
			t.Fatalf("migration description must promise idempotent operator control: %q", subcommand.Description)
		}
		if subcommand.Action == nil {
			t.Fatal("add-execution-admissions migration action is nil")
		}
		return
	}
	t.Fatal("migrate add-execution-admissions subcommand missing")
}

func TestConversationMessageV2SchemaCarriesOrderedStableIdentities(t *testing.T) {
	gdb := openMigrationSQLite(t, `CREATE TABLE migration_probe (id INTEGER PRIMARY KEY)`)
	stmt := &gorm.Statement{DB: gdb}
	if err := stmt.Parse(&model.ConversationMessageV2{}); err != nil {
		t.Fatalf("parse ConversationMessageV2 schema: %v", err)
	}
	for _, name := range []string{
		"message_id", "user_name", "dialogue_id", "message_index", "execution_id",
		"source_message_id", "parent_message_id", "message_type", "role", "visibility",
		"source_event_id", "tool_call_id", "content_revision", "content_offset",
		"content_length", "content_sha256", "content", "target_json", "status",
		"occurred_at", "created_at", "updated_at", "delete_at",
	} {
		if _, ok := stmt.Schema.FieldsByDBName[name]; !ok {
			t.Fatalf("ConversationMessageV2 is missing %s", name)
		}
	}
	if got := stmt.Schema.FieldsByDBName["message_id"].TagSettings["PRIMARYKEY"]; got == "" {
		t.Fatal("message_id must be the stable primary key")
	}
	if got := stmt.Schema.FieldsByDBName["content"].TagSettings["TYPE"]; got != "mediumtext" {
		t.Fatalf("content type=%q, want mediumtext", got)
	}
	indexes := map[string]bool{}
	for _, index := range stmt.Schema.ParseIndexes() {
		indexes[index.Name] = true
	}
	for _, name := range []string{
		"uniq_conversation_message_owner_index",
		"uniq_conversation_message_source_event",
		"idx_conversation_message_execution",
		"idx_conversation_message_dialogue",
		"idx_conversation_message_retention",
	} {
		if !indexes[name] {
			t.Fatalf("ConversationMessageV2 is missing ownership/retention index %s", name)
		}
	}
}

func TestExecutionRuntimeV2MigrationRestoresAdmissionIndexes(t *testing.T) {
	gdb := openMigrationSQLite(t, `CREATE TABLE migration_probe (id INTEGER PRIMARY KEY)`)
	if err := gdb.AutoMigrate(&model.QuestionAgentExecutionAdmission{}); err != nil {
		t.Fatalf("create admission schema: %v", err)
	}
	for _, index := range []string{
		"idx_execution_admission_turn",
		"idx_execution_projection_lease",
		"idx_execution_projection_due",
	} {
		if err := gdb.Migrator().DropIndex(&model.QuestionAgentExecutionAdmission{}, index); err != nil {
			t.Fatalf("drop %s: %v", index, err)
		}
	}

	var action *cli.Command
	for _, subcommand := range Migrate().Subcommands {
		if subcommand.Name == "add-execution-runtime-v2" {
			action = subcommand
			break
		}
	}
	if action == nil {
		t.Fatal("migrate add-execution-runtime-v2 subcommand missing")
	}
	ctx := cli.NewContext(nil, flag.NewFlagSet("migration-test", flag.ContinueOnError), nil)
	if err := action.Action(ctx); err != nil {
		t.Fatalf("run execution-runtime V2 migration: %v", err)
	}
	if err := validateExecutionRuntimeSchema(gdb); err != nil {
		t.Fatalf("migration left runtime schema incomplete: %v", err)
	}
}

func TestExecutionOutboxModelCarriesFiniteDispatchIntegrityFields(t *testing.T) {
	gdb := openMigrationSQLite(t, `CREATE TABLE migration_probe (id INTEGER PRIMARY KEY)`)
	stmt := &gorm.Statement{DB: gdb}
	if err := stmt.Parse(&model.QuestionAgentExecutionOutbox{}); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{
		"classification",
		"boundary_state",
		"first_error_code",
		"last_error_code",
		"next_reconcile_at",
	} {
		if stmt.Schema.FieldsByDBName[name] == nil {
			t.Fatalf("execution outbox missing dispatch-integrity column %s", name)
		}
	}
}

type legacyExecutionOutboxRollbackView struct {
	ID          int64  `gorm:"column:id;primaryKey"`
	UserName    string `gorm:"column:user_name"`
	ExecutionID string `gorm:"column:execution_id"`
	State       string `gorm:"column:state"`
	Attempts    int    `gorm:"column:attempts"`
	Revision    int64  `gorm:"column:revision"`
}

func (legacyExecutionOutboxRollbackView) TableName() string {
	return "question_agent_execution_outbox"
}

func TestExecutionOutboxAdditiveFieldsRemainReadableByRollbackModel(t *testing.T) {
	gdb := openMigrationSQLite(t, `CREATE TABLE migration_probe (id INTEGER PRIMARY KEY)`)
	if err := gdb.AutoMigrate(&model.QuestionAgentExecutionOutbox{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	row := model.QuestionAgentExecutionOutbox{
		UserName: "alice", ExecutionID: "turn-rollback", CommandJSON: `{}`,
		State: "reconcile", Attempts: 6, Revision: 8,
		NextAttemptAt: now, CreatedAt: now, UpdatedAt: now,
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	var legacy legacyExecutionOutboxRollbackView
	if err := gdb.Where("user_name = ? AND execution_id = ?", "alice", "turn-rollback").Take(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	if legacy.State != "reconcile" || legacy.Attempts != 6 || legacy.Revision != 8 {
		t.Fatalf("rollback model lost legacy fields: %#v", legacy)
	}
}
