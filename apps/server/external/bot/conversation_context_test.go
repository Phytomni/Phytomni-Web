package bot

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

const testConversationLedgerVersion = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func validConversationEnvelope() ConversationEnvelopeV1 {
	return ConversationEnvelopeV1{
		SchemaVersion:              1,
		ConversationKey:            "11111111-1111-4111-8111-111111111111",
		DialogueID:                 "22222222-2222-4222-8222-222222222222",
		TurnID:                     "7",
		RequestID:                  "request-7",
		Operation:                  "append",
		Mode:                       "expert",
		CurrentMessage:             CurrentMessageV1{Content: "next", Locale: "en-US"},
		RequestedAgentID:           stringPointer("DataAgent"),
		AllowedAgentIDs:            []string{"ChatAgent", "DataAgent"},
		LedgerCursor:               6,
		LedgerVersion:              testConversationLedgerVersion,
		BaseBusinessContextVersion: 2,
		HistoryDelta: []LedgerEntryV1{
			{TurnID: "5", Role: "user", Content: "prior"},
			{TurnID: "6", Role: "assistant", Summary: "summary"},
		},
		ArtifactRefs: []ArtifactRefV1{{ArtifactID: "artifact-1", DisplayName: "table.csv"}},
	}
}

func stringPointer(value string) *string {
	return &value
}

func TestConversationEnvelopeV1SerializesExactly(t *testing.T) {
	encoded, err := json.Marshal(validConversationEnvelope())
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	want := `{"schema_version":1,"conversation_key":"11111111-1111-4111-8111-111111111111","dialogue_id":"22222222-2222-4222-8222-222222222222","turn_id":"7","request_id":"request-7","operation":"append","mode":"expert","current_message":{"content":"next","locale":"en-US"},"requested_agent_id":"DataAgent","allowed_agent_ids":["ChatAgent","DataAgent"],"ledger_cursor":6,"ledger_version":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","base_business_context_version":2,"history_delta":[{"turn_id":"5","role":"user","content":"prior"},{"turn_id":"6","role":"assistant","summary":"summary"}],"artifact_refs":[{"artifact_id":"artifact-1","display_name":"table.csv"}]}`
	if string(encoded) != want {
		t.Fatalf("serialized envelope mismatch\nwant: %s\ngot:  %s", want, encoded)
	}
}

func TestLegacyRequestsOmitConversationEnvelope(t *testing.T) {
	for name, value := range map[string]any{
		"chat":  ChatCompletionRequest{Model: "phyto-chat", Messages: []ChatMessage{{Role: "user", Content: "hi"}}},
		"route": RouteQueryRequest{UserQuery: "hi", ForcedTool: nil},
	} {
		t.Run(name, func(t *testing.T) {
			encoded, err := json.Marshal(value)
			if err != nil {
				t.Fatalf("Marshal: %v", err)
			}
			if strings.Contains(string(encoded), `"conversation"`) {
				t.Fatalf("legacy payload unexpectedly contains conversation: %s", encoded)
			}
		})
	}
}

func TestConversationEnvelopeV1RejectsUnsafeValues(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*ConversationEnvelopeV1)
	}{
		{name: "unknown selected agent", mutate: func(value *ConversationEnvelopeV1) {
			value.RequestedAgentID = stringPointer("UnknownAgent")
		}},
		{name: "negative ledger cursor", mutate: func(value *ConversationEnvelopeV1) {
			value.LedgerCursor = -1
		}},
		{name: "invalid ledger version", mutate: func(value *ConversationEnvelopeV1) {
			value.LedgerVersion = "not-a-hash"
		}},
		{name: "oversized current message", mutate: func(value *ConversationEnvelopeV1) {
			value.CurrentMessage.Content = strings.Repeat("x", ConfiguredMaxUserQueryChars()+1)
		}},
		{name: "path-bearing artifact label", mutate: func(value *ConversationEnvelopeV1) {
			value.ArtifactRefs[0].DisplayName = "../private.csv"
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			value := validConversationEnvelope()
			tc.mutate(&value)
			if _, err := json.Marshal(value); err == nil {
				t.Fatal("unsafe envelope value was accepted")
			}
		})
	}
}

func TestConversationEnvelopeAllowsExtendedCurrentButBoundsHistory(t *testing.T) {
	envelope := validConversationEnvelope()
	envelope.CurrentMessage.Content = strings.Repeat("\u7A3B", 131_072)
	if err := envelope.Validate(); err != nil {
		t.Fatalf("current rejected: %v", err)
	}
	envelope.HistoryDelta[0].Content = strings.Repeat("\u7A3B", 32_769)
	if err := envelope.Validate(); err == nil {
		t.Fatal("oversized history accepted")
	}
}

func TestContextStageMetadataRejectsUnsafeValues(t *testing.T) {
	valid := `{"schema_version":1,"turn_id":"7","selected_agent_id":"DataAgent","route_source":"router","route_reason_code":"ROUTED","base_business_context_version":2,"proposed_business_context_version":3,"last_applied_ledger_cursor":6,"context_truncated":false,"context_rebuilt":false,"context_degraded":false}`
	tests := []string{
		strings.Replace(valid, `"selected_agent_id":"DataAgent"`, `"selected_agent_id":"UnknownAgent"`, 1),
		strings.Replace(valid, `"route_source":"router"`, `"route_source":"invalid"`, 1),
		strings.Replace(valid, `"base_business_context_version":2`, `"base_business_context_version":-1`, 1),
		strings.Replace(valid, `"route_reason_code":"ROUTED"`, `"route_reason_code":"`+strings.Repeat("x", maxContextRouteReasonCodeChars+1)+`"`, 1),
	}
	for _, payload := range tests {
		var metadata ContextStageMetadata
		if err := json.Unmarshal([]byte(payload), &metadata); err == nil {
			t.Fatalf("unsafe context metadata was accepted: %s", payload)
		}
	}
}

func TestContextStageMetadataRejectsMismatchedTurn(t *testing.T) {
	metadata := ContextStageMetadata{
		SchemaVersion:                  1,
		TurnID:                         "7",
		SelectedAgentID:                "DataAgent",
		RouteSource:                    "router",
		RouteReasonCode:                "ROUTED",
		BaseBusinessContextVersion:     2,
		ProposedBusinessContextVersion: 3,
		LastAppliedLedgerCursor:        6,
	}
	if err := metadata.ValidateForTurn("8"); err == nil {
		t.Fatal("mismatched context turn was accepted")
	}
}

func TestConversationContextMutationMethods(t *testing.T) {
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		if r.Header.Get("Authorization") != "Bearer ptm_test" {
			t.Errorf("Authorization = %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/conversation-context/settle" {
			_, _ = w.Write([]byte(`{"schema_version":1,"state":"committed","context_version":3}`))
			return
		}
		_, _ = w.Write([]byte(`{"schema_version":1,"state":"tombstoned","context_version":4}`))
	}))
	defer srv.Close()

	client := newTestClient(srv.URL)
	settled, err := client.SettleConversationContext(context.Background(), ContextSettlementRequest{
		SchemaVersion: 1, ConversationKey: "11111111-1111-4111-8111-111111111111", TurnID: "7", LedgerVersion: testConversationLedgerVersion,
	})
	if err != nil || settled.State != "committed" || settled.ContextVersion != 3 {
		t.Fatalf("settlement = %#v, err=%v", settled, err)
	}
	tombstoned, err := client.TombstoneConversationContext(context.Background(), ContextTombstoneRequest{
		SchemaVersion: 1, ConversationKey: "11111111-1111-4111-8111-111111111111",
	})
	if err != nil || tombstoned.State != "tombstoned" || tombstoned.ContextVersion != 4 {
		t.Fatalf("tombstone = %#v, err=%v", tombstoned, err)
	}
	if !reflect.DeepEqual(paths, []string{"/v1/conversation-context/settle", "/v1/conversation-context/tombstone"}) {
		t.Fatalf("mutation paths = %v", paths)
	}
}

func TestConversationContextRebuildErrorIsTyped(t *testing.T) {
	err := botError("POST", "/v1/query/route", http.StatusConflict, []byte(`{"error":{"code":"conversation_context_rebuild_required","message":"conversation context rebuild required","request_id":"req-7","stage":"context","retryable":true}}`))
	if !IsConversationContextRebuildRequired(err) || !errors.Is(err, ErrConversationContextRebuildRequired) {
		t.Fatalf("error was not recognized as rebuild-required: %T %v", err, err)
	}
}
