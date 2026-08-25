package commands

import (
	"errors"
	"strings"
	"testing"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

func TestExecutionWorkersRequireSharedServiceToken(t *testing.T) {
	t.Setenv("PHYTOMNI_BOT_SERVICE_TOKEN", "")
	t.Setenv("PHYTOMNI_API_SERVICE_TOKEN", "")

	if err := validateExecutionWorkerConfiguration(); !errors.Is(err, rxBot.ErrExecutionServiceTokenMissing) {
		t.Fatalf("missing service token err=%v", err)
	}

	t.Setenv("PHYTOMNI_BOT_SERVICE_TOKEN", "shared-service-token")
	if err := validateExecutionWorkerConfiguration(); err != nil {
		t.Fatalf("configured service token err=%v", err)
	}
}

func TestExecutionRuntimeSchemaMustExistBeforeServingTraffic(t *testing.T) {
	gdb := openMigrationSQLite(t, `CREATE TABLE migration_probe (id INTEGER PRIMARY KEY)`)

	err := validateExecutionRuntimeSchema(gdb)
	if err == nil {
		t.Fatal("missing execution-runtime schema should fail startup validation")
	}
	if !strings.Contains(err.Error(), "conversation_messages_v2") ||
		!strings.Contains(err.Error(), "migrate add-execution-runtime-v2") {
		t.Fatalf("startup validation error must name the missing schema and repair command: %v", err)
	}

	if err := gdb.AutoMigrate(
		&model.QuestionAgentExecutionAdmission{},
		&model.ConversationTurnV2{},
		&model.ConversationTurnSequenceV2{},
		&model.ConversationMessageV2{},
		&model.QuestionAgentExecutionOutbox{},
		&model.QuestionAgentExecutionEventV2{},
	); err != nil {
		t.Fatalf("create execution-runtime schema: %v", err)
	}
	if err := validateExecutionRuntimeSchema(gdb); err != nil {
		t.Fatalf("complete execution-runtime schema rejected: %v", err)
	}
}
