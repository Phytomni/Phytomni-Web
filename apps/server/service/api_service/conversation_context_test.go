package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

func validPersistedConversationContext() persistedConversationContext {
	return persistedConversationContext{
		ClientTurnID:         "turn-1",
		Stage:                validContextStageMetadata(),
		SettlementState:      "ACK_PENDING",
		SettlementLedgerHash: strings.Repeat("a", 64),
		AssistantSummary:     "The selected agent returned a bounded answer.",
		ArtifactRefs: []rxBot.ArtifactRefV1{{
			ArtifactID:  "artifact-1",
			DisplayName: "results.csv",
		}},
	}
}

func validContextStageMetadata() *rxBot.ContextStageMetadata {
	return &rxBot.ContextStageMetadata{
		SchemaVersion:                  1,
		TurnID:                         "1",
		SelectedAgentID:                "ChatAgent",
		RouteSource:                    "instant_lock",
		RouteReasonCode:                "INSTANT_LOCK",
		BaseBusinessContextVersion:     3,
		ProposedBusinessContextVersion: 4,
		LastAppliedLedgerCursor:        7,
	}
}

func TestApplyConversationRebuildEnvelopeRetainsPriorUserHistory(t *testing.T) {
	// Rebuild history includes a trailing current-user slot for Bot projection.
	gdb := setupExpertTestDB(t)
	dialogueID := "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	root := model.QuestionAgentLog{
		Id: 1, DialogueId: dialogueID, UserName: "alice",
		Query: "Remember marker REBUILD-1.", Status: statusSucceeded,
		Mode: "instant", ToolName: "ChatAgent", BotReportRevision: -1,
		BotProjectionJSON: `{"report_revision":-1}`,
	}
	current := model.QuestionAgentLog{
		Id: 2, DialogueId: dialogueID, FId: 1, UserName: "alice",
		Query: "What marker did I ask you to remember?", Status: "SUBMITTING",
		Mode: "instant", ToolName: "ChatAgent", BotReportRevision: -1,
	}
	if err := gdb.Create(&root).Error; err != nil {
		t.Fatalf("persist root: %v", err)
	}
	if err := gdb.Create(&current).Error; err != nil {
		t.Fatalf("persist current row: %v", err)
	}

	requestedAgent := "ChatAgent"
	submission := &v1Submission{
		row: current,
		envelope: &rxBot.ConversationEnvelopeV1{
			SchemaVersion:   1,
			ConversationKey: dialogueID,
			DialogueID:      dialogueID,
			TurnID:          "2",
			RequestID:       "rebuild-request-2",
			Operation:       "append",
			Mode:            "instant",
			CurrentMessage: rxBot.CurrentMessageV1{
				Content: current.Query, Locale: "en-US",
			},
			RequestedAgentID:           &requestedAgent,
			AllowedAgentIDs:            []string{"ChatAgent"},
			LedgerCursor:               2,
			LedgerVersion:              strings.Repeat("a", 64),
			BaseBusinessContextVersion: 0,
		},
	}
	target := v1SubmissionTarget{
		dialogueID: dialogueID,
		parentID:   1,
		mode:       "instant",
		operation:  "append",
	}

	if err := applyConversationRebuildEnvelope(
		context.Background(), "alice", submission, target,
	); err != nil {
		t.Fatalf("apply rebuild envelope: %v", err)
	}

	if submission.envelope.Operation != "rebuild" {
		t.Fatalf("operation = %q, want rebuild", submission.envelope.Operation)
	}
	if got := submission.envelope.HistoryDelta; len(got) != 2 ||
		got[0].TurnID != "1" || got[0].Content != root.Query ||
		got[1].TurnID != "2" || got[1].Content != current.Query {
		t.Fatalf("rebuild history = %#v", got)
	}
}

func TestPersistedConversationContextEnforcesBounds(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*persistedConversationContext)
	}{
		{name: "client turn id must be printable ascii", mutate: func(value *persistedConversationContext) {
			value.ClientTurnID = "é"
		}},
		{name: "client turn id is bounded", mutate: func(value *persistedConversationContext) {
			value.ClientTurnID = strings.Repeat("a", maxPersistedClientTurnIDBytes+1)
		}},
		{name: "summary is bounded", mutate: func(value *persistedConversationContext) {
			value.AssistantSummary = strings.Repeat("a", maxPersistedAssistantSummaryBytes+1)
		}},
		{name: "artifact refs are bounded", mutate: func(value *persistedConversationContext) {
			value.ArtifactRefs = make([]rxBot.ArtifactRefV1, maxPersistedArtifactRefs+1)
			for index := range value.ArtifactRefs {
				value.ArtifactRefs[index] = rxBot.ArtifactRefV1{ArtifactID: "artifact-1", DisplayName: "result.csv"}
			}
		}},
		{name: "artifact display metadata is bounded", mutate: func(value *persistedConversationContext) {
			value.ArtifactRefs[0].DisplayName = strings.Repeat("a", maxPersistedArtifactFieldBytes+1)
		}},
		{name: "artifact paths are rejected", mutate: func(value *persistedConversationContext) {
			value.ArtifactRefs[0].DisplayName = "obs://bucket/result.csv"
		}},
		{name: "stage is validated", mutate: func(value *persistedConversationContext) {
			value.Stage.SelectedAgentID = "UnknownAgent"
		}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			value := validPersistedConversationContext()
			test.mutate(&value)
			_, err := json.Marshal(value)
			if !errors.Is(err, ErrInvalidBotConversationContext) {
				t.Fatalf("json.Marshal error=%v, want ErrInvalidBotConversationContext", err)
			}
		})
	}
}

func TestPersistedConversationContextRoundTripsBoundedMetadata(t *testing.T) {
	want := validPersistedConversationContext()
	encoded, err := json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	if len(encoded) > maxPersistedConversationBytes {
		t.Fatalf("serialized context size=%d, want <= %d", len(encoded), maxPersistedConversationBytes)
	}

	var got persistedConversationContext
	if err := json.Unmarshal(encoded, &got); err != nil {
		t.Fatal(err)
	}
	if got.ClientTurnID != want.ClientTurnID || got.SettlementState != want.SettlementState || got.SettlementLedgerHash != want.SettlementLedgerHash || got.AssistantSummary != want.AssistantSummary {
		t.Fatalf("round-tripped context=%#v, want %#v", got, want)
	}
	if got.Stage == nil || got.Stage.ProposedBusinessContextVersion != want.Stage.ProposedBusinessContextVersion || len(got.ArtifactRefs) != 1 || got.ArtifactRefs[0].ArtifactID != "artifact-1" {
		t.Fatalf("round-tripped nested context=%#v", got)
	}
}

func TestPersistedConversationContextRejectsUnknownFields(t *testing.T) {
	var got persistedConversationContext
	err := json.Unmarshal([]byte(`{"client_turn_id":"turn-1","unknown":"value"}`), &got)
	if !errors.Is(err, ErrInvalidBotConversationContext) {
		t.Fatalf("json.Unmarshal error=%v, want ErrInvalidBotConversationContext", err)
	}
}

func TestSaveAndLoadBotConversationContextIsOwnerScoped(t *testing.T) {
	gdb := setupTestDB(t)
	if err := setupProjectionRow(31, "alice@example.com", 5, `{"run_id":"run-31","status":"SUCCEEDED"}`); err != nil {
		t.Fatal(err)
	}
	want := validPersistedConversationContext()
	if err := SaveBotConversationContext(context.Background(), "alice@example.com", 31, want); err != nil {
		t.Fatal(err)
	}

	got, err := LoadBotConversationContext(context.Background(), "alice@example.com", 31)
	if err != nil {
		t.Fatal(err)
	}
	if got.ClientTurnID != want.ClientTurnID || got.AssistantSummary != want.AssistantSummary || got.Stage == nil || len(got.ArtifactRefs) != 1 {
		t.Fatalf("loaded context=%#v, want %#v", got, want)
	}

	projection, err := LoadBotRunProjection(context.Background(), "alice@example.com", 31)
	if err != nil {
		t.Fatal(err)
	}
	if projection.RunID != "run-31" || projection.Status != "SUCCEEDED" || projection.ReportRevision != 5 {
		t.Fatalf("public projection changed=%#v", projection)
	}
	var raw string
	if err := gdb.Raw("SELECT bot_projection_json FROM question_agent_logs WHERE id = ?", 31).Scan(&raw).Error; err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(raw, `"conversation_context"`) || strings.Contains(raw, "obs://") {
		t.Fatalf("private projection encoding=%s", raw)
	}

	if _, err := LoadBotConversationContext(context.Background(), "bob@example.com", 31); !errors.Is(err, ErrBotProjectionNotFound) {
		t.Fatalf("cross-owner load error=%v", err)
	}
	if err := SaveBotConversationContext(context.Background(), "bob@example.com", 31, want); !errors.Is(err, ErrBotProjectionNotFound) {
		t.Fatalf("cross-owner save error=%v", err)
	}
}

func TestSaveBotConversationContextIsIdempotent(t *testing.T) {
	setupTestDB(t)
	if err := setupProjectionRow(33, "alice@example.com", 5, `{"run_id":"run-33","status":"SUCCEEDED"}`); err != nil {
		t.Fatal(err)
	}
	want := validPersistedConversationContext()
	if err := SaveBotConversationContext(context.Background(), "alice@example.com", 33, want); err != nil {
		t.Fatal(err)
	}
	if err := SaveBotConversationContext(context.Background(), "alice@example.com", 33, want); err != nil {
		t.Fatalf("identical context save error=%v", err)
	}

	got, err := LoadBotConversationContext(context.Background(), "alice@example.com", 33)
	if err != nil {
		t.Fatal(err)
	}
	if got.ClientTurnID != want.ClientTurnID || got.SettlementState != want.SettlementState || len(got.ArtifactRefs) != 1 {
		t.Fatalf("idempotent save changed context=%#v, want %#v", got, want)
	}
}

func TestLoadBotConversationContextReturnsZeroForLegacyProjection(t *testing.T) {
	setupTestDB(t)
	if err := setupProjectionRow(32, "alice@example.com", 2, `{"run_id":"run-32"}`); err != nil {
		t.Fatal(err)
	}
	got, err := LoadBotConversationContext(context.Background(), "alice@example.com", 32)
	if err != nil {
		t.Fatal(err)
	}
	if got.ClientTurnID != "" || got.Stage != nil || len(got.ArtifactRefs) != 0 {
		t.Fatalf("legacy context=%#v, want zero", got)
	}
}

func TestConversationSettlementStateIsIdempotentWithoutLedgerMutation(t *testing.T) {
	gdb := setupExpertTestDB(t)
	stagedLedgerVersion := "staged-ledger-version"
	raw, err := marshalPersistedProjectionWithContext(
		BotRunProjection{ReportRevision: -1},
		&persistedConversationContext{
			ClientTurnID: "context-state-1", SettlementState: "submission_append",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	row := model.QuestionAgentLog{
		DialogueId: "11111111-1111-4111-8111-111111111111",
		UserName:   "alice", Query: "question", ToolName: "ChatAgent",
		Status: "SUBMITTING", Mode: "instant", BotProjectionJSON: raw,
		BotReportRevision: -1,
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	stage := validContextStageMetadata()
	stage.TurnID = fmt.Sprint(row.Id)
	stage.BaseBusinessContextVersion = 0
	stage.ProposedBusinessContextVersion = 1
	stage.LastAppliedLedgerCursor = row.Id
	version, err := settleBlockingConversationContext(
		context.Background(),
		"alice",
		row.DialogueId,
		row.Id,
		&QueryData{
			Id: row.Id, DialogueId: row.DialogueId, ToolName: "ChatAgent",
			Answer: "answer", Status: "SUCCEEDED",
		},
		"instant",
		nil,
		persistedConversationContext{
			ClientTurnID: "context-state-1", Stage: stage,
			SettlementState:      conversationSettlementAckPending,
			AssistantSummary:     "answer",
			SettlementLedgerHash: stagedLedgerVersion,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := updateConversationSettlementState(
		context.Background(), "alice", row.Id, version,
		conversationSettlementAckPending, conversationSettlementAcked,
	); err != nil {
		t.Fatal(err)
	}
	if err := updateConversationSettlementState(
		context.Background(), "alice", row.Id, version,
		conversationSettlementAckPending, conversationSettlementAcked,
	); err != nil {
		t.Fatalf("repeated ACK update: %v", err)
	}
	if version != stagedLedgerVersion {
		t.Fatalf("settlement version = %s, want staged %s", version, stagedLedgerVersion)
	}
}

func TestPersistedConversationContextBoundsRebuildAndReplacementState(t *testing.T) {
	value := validPersistedConversationContext()
	value.RebuildLedgerVersion = strings.Repeat("b", 64)
	value.RebuildLedgerCursor = 17
	value.Replacement = &persistedConversationReplacement{
		ClientTurnID: "refresh-turn-1",
		Query:        "replace the prior answer",
		ToolName:     "ChatAgent",
		Mode:         "instant",
		FileName:     "notes.txt",
		UploadPath:   "private-upload-reference",
	}

	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var decoded persistedConversationContext
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.RebuildLedgerVersion != value.RebuildLedgerVersion ||
		decoded.RebuildLedgerCursor != 17 ||
		decoded.Replacement == nil ||
		decoded.Replacement.ClientTurnID != "refresh-turn-1" ||
		decoded.Replacement.Query != "replace the prior answer" {
		t.Fatalf("decoded context = %#v", decoded)
	}

	value.Replacement.Query = strings.Repeat("x", maxPersistedReplacementQueryBytes+1)
	if _, err := json.Marshal(value); !errors.Is(err, ErrInvalidBotConversationContext) {
		t.Fatalf("oversized replacement query error = %v", err)
	}
}

func TestPersistedReplacementAllowsExtendedQueryAndRejectsHardByteOverflow(t *testing.T) {
	value := validPersistedConversationContext()
	value.Replacement = &persistedConversationReplacement{
		ClientTurnID: "refresh-turn-extended",
		Query:        strings.Repeat("🧬", 131_072),
		ToolName:     "ChatAgent",
		Mode:         "instant",
	}
	if _, err := json.Marshal(value); err != nil {
		t.Fatalf("extended replacement rejected: %v", err)
	}

	value.Replacement.Query = strings.Repeat("x", rxBot.HardMaxUserQueryChars*utf8.UTFMax+1)
	if _, err := json.Marshal(value); !errors.Is(err, ErrInvalidBotConversationContext) {
		t.Fatalf("over-hard replacement query error = %v", err)
	}
}

func TestPersistedReplacementAcceptsWorstCaseJSONEscapingAtHardLimit(t *testing.T) {
	query := strings.Repeat("<", rxBot.HardMaxUserQueryChars)
	value := validPersistedConversationContext()
	value.Replacement = &persistedConversationReplacement{
		ClientTurnID: "refresh-turn-json-escape",
		Query:        query,
		ToolName:     "ChatAgent",
		Mode:         "instant",
	}

	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("hard-limit JSON-escaped replacement rejected: %v", err)
	}
	var decoded persistedConversationContext
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("decode hard-limit JSON-escaped replacement: %v", err)
	}
	if decoded.Replacement == nil || decoded.Replacement.Query != query {
		t.Fatal("hard-limit JSON-escaped replacement did not round-trip exactly")
	}
}

func TestPersistedReplacementRejectsSemanticHardLimitOverflow(t *testing.T) {
	value := validPersistedConversationContext()
	value.Replacement = &persistedConversationReplacement{
		ClientTurnID: "refresh-turn-semantic-overflow",
		Query:        strings.Repeat("x", rxBot.HardMaxUserQueryChars+1),
		ToolName:     "ChatAgent",
		Mode:         "instant",
	}

	if _, err := json.Marshal(value); !errors.Is(err, ErrInvalidBotConversationContext) {
		t.Fatalf("semantic replacement overflow error = %v", err)
	}
}
