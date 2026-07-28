package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	rxBot "phytomni-server/external/bot"
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
