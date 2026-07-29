package api_service

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	rxBot "phytomni-server/external/bot"
)

type conversationContextFixture struct {
	ProtocolAdvertisement json.RawMessage               `json:"protocol_advertisement"`
	RedactionContract     conversationRedactionContract `json:"redaction_contract"`
	Requests              conversationFixtureRequests   `json:"requests"`
	Responses             conversationFixtureResponses  `json:"responses"`
}

type conversationRedactionContract struct {
	BoundedContextFields []string `json:"bounded_context_fields"`
	ExcludedOutputKinds  []string `json:"excluded_output_kinds"`
}

type conversationFixtureRequests struct {
	InstantEnvelope        json.RawMessage `json:"instant_envelope"`
	ExpertUnforcedEnvelope json.RawMessage `json:"expert_unforced_envelope"`
	ExpertExplicitEnvelope json.RawMessage `json:"expert_explicit_envelope"`
	SettlementRequest      json.RawMessage `json:"settlement_request"`
	TombstoneRequest       json.RawMessage `json:"tombstone_request"`
}

type conversationFixtureResponses struct {
	StagedMetadataResponse json.RawMessage `json:"staged_metadata_response"`
	SettlementResponse     json.RawMessage `json:"settlement_response"`
	TombstoneResponse      json.RawMessage `json:"tombstone_response"`
	DegradedContextSuccess json.RawMessage `json:"degraded_context_success"`
}

func readConversationContextFixture(t *testing.T) conversationContextFixture {
	t.Helper()
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	path := filepath.Join(filepath.Dir(sourceFile), "..", "..", "external", "bot", "testdata", "head", "conversation_context_v1.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read conversation context fixture: %v", err)
	}
	var fixture conversationContextFixture
	decodeConversationJSON(t, raw, &fixture)
	return fixture
}

func decodeConversationJSON(t *testing.T, raw []byte, out interface{}) {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		t.Fatalf("decode fixture contract: %v", err)
	}
	var trailing interface{}
	if err := decoder.Decode(&trailing); err != io.EOF {
		t.Fatalf("fixture contract has trailing JSON: %v", err)
	}
}

func assertConversationJSONEqual(t *testing.T, want []byte, got interface{}) {
	t.Helper()
	encoded, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal contract value: %v", err)
	}
	var wantValue, gotValue interface{}
	if err := json.Unmarshal(want, &wantValue); err != nil {
		t.Fatalf("decode expected contract: %v", err)
	}
	if err := json.Unmarshal(encoded, &gotValue); err != nil {
		t.Fatalf("decode emitted contract: %v", err)
	}
	if !reflect.DeepEqual(gotValue, wantValue) {
		t.Fatalf("emitted contract differs\nwant: %s\ngot:  %s", want, encoded)
	}
}

func TestConversationContextIntegration(t *testing.T) {
	fixture := readConversationContextFixture(t)
	if !reflect.DeepEqual(fixture.RedactionContract.BoundedContextFields, []string{
		"active_entities",
		"artifact_index",
		"per_agent_memory",
		"recent_turns",
		"task_summary",
	}) || !reflect.DeepEqual(fixture.RedactionContract.ExcludedOutputKinds, []string{
		"answer",
		"report",
		"table",
		"tabular",
	}) {
		t.Fatalf("fixture redaction contract = %#v", fixture.RedactionContract)
	}

	t.Run("V1 advertisement", func(t *testing.T) {
		var advertisement rxBot.AgentsListResponse
		decodeConversationJSON(t, fixture.ProtocolAdvertisement, &advertisement)
		if !rxBot.SupportsProtocol(&advertisement, "conversation_context", 1) {
			t.Fatal("Bot advertisement does not support conversation_context v1")
		}
		emitted, err := json.Marshal(advertisement)
		if err != nil {
			t.Fatalf("marshal V1 advertisement: %v", err)
		}
		var emittedAdvertisement rxBot.AgentsListResponse
		decodeConversationJSON(t, emitted, &emittedAdvertisement)
		if emittedAdvertisement.Object != advertisement.Object || !reflect.DeepEqual(emittedAdvertisement.Protocols, advertisement.Protocols) {
			t.Fatalf("emitted V1 advertisement = %#v", emittedAdvertisement)
		}
	})

	t.Run("request envelopes", func(t *testing.T) {
		tests := []struct {
			name string
			raw  json.RawMessage
		}{
			{name: "Instant", raw: fixture.Requests.InstantEnvelope},
			{name: "unforced Expert", raw: fixture.Requests.ExpertUnforcedEnvelope},
			{name: "explicit Expert", raw: fixture.Requests.ExpertExplicitEnvelope},
		}
		for _, test := range tests {
			t.Run(test.name, func(t *testing.T) {
				var envelope rxBot.ConversationEnvelopeV1
				decodeConversationJSON(t, test.raw, &envelope)
				assertConversationJSONEqual(t, test.raw, envelope)

				chatRequest := rxBot.ChatCompletionRequest{
					Model:        "phyto-chat",
					Messages:     []rxBot.ChatMessage{{Role: "user", Content: envelope.CurrentMessage.Content}},
					DialogueID:   envelope.DialogueID,
					Conversation: &envelope,
				}
				var emittedChat rxBot.ChatCompletionRequest
				chatBytes, err := json.Marshal(chatRequest)
				if err != nil {
					t.Fatalf("marshal chat request: %v", err)
				}
				decodeConversationJSON(t, chatBytes, &emittedChat)
				if emittedChat.Conversation == nil {
					t.Fatal("chat request omitted conversation envelope")
				}
				assertConversationJSONEqual(t, test.raw, emittedChat.Conversation)

				routeRequest := rxBot.RouteQueryRequest{
					UserQuery:    envelope.CurrentMessage.Content,
					DialogueID:   envelope.DialogueID,
					AllowedTools: append([]string(nil), envelope.AllowedAgentIDs...),
					ForcedTool:   envelope.RequestedAgentID,
					Conversation: &envelope,
				}
				var emittedRoute rxBot.RouteQueryRequest
				routeBytes, err := json.Marshal(routeRequest)
				if err != nil {
					t.Fatalf("marshal route request: %v", err)
				}
				decodeConversationJSON(t, routeBytes, &emittedRoute)
				if emittedRoute.Conversation == nil {
					t.Fatal("route request omitted conversation envelope")
				}
				assertConversationJSONEqual(t, test.raw, emittedRoute.Conversation)

				if envelope.Mode == "instant" {
					if envelope.RequestedAgentID != nil || !reflect.DeepEqual(envelope.AllowedAgentIDs, []string{"ChatAgent"}) {
						t.Fatalf("Instant routing contract = %#v", envelope)
					}
				}
				if test.name == "unforced Expert" {
					if envelope.RequestedAgentID != nil || len(envelope.AllowedAgentIDs) != len(rxBot.CanonicalAgentTool) {
						t.Fatalf("unforced Expert allowlist = %#v", envelope.AllowedAgentIDs)
					}
					for _, agentID := range envelope.AllowedAgentIDs {
						found := false
						for _, canonicalID := range rxBot.CanonicalAgentTool {
							if agentID == canonicalID {
								found = true
								break
							}
						}
						if !found {
							t.Fatalf("unforced Expert contains non-canonical agent %q", agentID)
						}
					}
				}
			})
		}
	})

	t.Run("settlement and tombstone requests", func(t *testing.T) {
		var settlement rxBot.ContextSettlementRequest
		decodeConversationJSON(t, fixture.Requests.SettlementRequest, &settlement)
		if err := settlement.Validate(); err != nil {
			t.Fatalf("settlement request validation: %v", err)
		}
		assertConversationJSONEqual(t, fixture.Requests.SettlementRequest, settlement)

		var tombstone rxBot.ContextTombstoneRequest
		decodeConversationJSON(t, fixture.Requests.TombstoneRequest, &tombstone)
		if err := tombstone.Validate(); err != nil {
			t.Fatalf("tombstone request validation: %v", err)
		}
		assertConversationJSONEqual(t, fixture.Requests.TombstoneRequest, tombstone)
	})

	t.Run("staged and degraded responses", func(t *testing.T) {
		var staged rxBot.ContextStageMetadata
		decodeConversationJSON(t, fixture.Responses.StagedMetadataResponse, &staged)
		if err := staged.ValidateForTurn("3"); err != nil {
			t.Fatalf("staged metadata validation: %v", err)
		}
		assertConversationJSONEqual(t, fixture.Responses.StagedMetadataResponse, staged)

		var stagedResponse rxBot.ChatCompletionResponse
		stagedResponse.ConversationContext = &staged
		var emittedStaged rxBot.ChatCompletionResponse
		stagedBytes, err := json.Marshal(stagedResponse)
		if err != nil {
			t.Fatalf("marshal staged response: %v", err)
		}
		decodeConversationJSON(t, stagedBytes, &emittedStaged)
		if emittedStaged.ConversationContext == nil {
			t.Fatal("staged response omitted context metadata")
		}
		assertConversationJSONEqual(t, fixture.Responses.StagedMetadataResponse, emittedStaged.ConversationContext)

		var degraded rxBot.ContextStageMetadata
		decodeConversationJSON(t, fixture.Responses.DegradedContextSuccess, &degraded)
		if err := degraded.ValidateForTurn("4"); err != nil {
			t.Fatalf("degraded metadata validation: %v", err)
		}
		if !degraded.ContextDegraded {
			t.Fatal("degraded success did not preserve context_degraded")
		}
		assertConversationJSONEqual(t, fixture.Responses.DegradedContextSuccess, degraded)

		var degradedResponse rxBot.AgentRunResponse
		degradedResponse.ConversationContext = &degraded
		var emittedDegraded rxBot.AgentRunResponse
		degradedBytes, err := json.Marshal(degradedResponse)
		if err != nil {
			t.Fatalf("marshal degraded response: %v", err)
		}
		decodeConversationJSON(t, degradedBytes, &emittedDegraded)
		if emittedDegraded.ConversationContext == nil || !emittedDegraded.ConversationContext.ContextDegraded {
			t.Fatal("degraded response omitted context_degraded")
		}
		assertConversationJSONEqual(t, fixture.Responses.DegradedContextSuccess, emittedDegraded.ConversationContext)

		assertPersistedContextMetadata(t, staged, conversationSettlementAckPending)
		assertPersistedContextMetadata(t, degraded, conversationSettlementRebuildRequired)
	})

	t.Run("mutation responses", func(t *testing.T) {
		for _, test := range []struct {
			name string
			raw  json.RawMessage
		}{
			{name: "settlement", raw: fixture.Responses.SettlementResponse},
			{name: "tombstone", raw: fixture.Responses.TombstoneResponse},
		} {
			t.Run(test.name, func(t *testing.T) {
				var response rxBot.ContextMutationResponse
				decodeConversationJSON(t, test.raw, &response)
				if err := response.Validate(); err != nil {
					t.Fatalf("mutation response validation: %v", err)
				}
				assertConversationJSONEqual(t, test.raw, response)
			})
		}
	})

	t.Run("fixture redaction", func(t *testing.T) {
		assertConversationFixtureRedacted(t, fixture)
	})
}

func assertPersistedContextMetadata(t *testing.T, stage rxBot.ContextStageMetadata, settlementState string) {
	t.Helper()
	persisted := persistedConversationContext{
		Stage:            &stage,
		SettlementState:  settlementState,
		AssistantSummary: "bounded response summary",
		ArtifactRefs: []rxBot.ArtifactRefV1{{
			ArtifactID:  "artifact-opaque-1",
			DisplayName: "bounded artifact label",
		}},
	}
	encoded, err := json.Marshal(persisted)
	if err != nil {
		t.Fatalf("marshal Web context projection: %v", err)
	}
	serialized := strings.ToLower(string(encoded))
	for _, forbidden := range []string{"full answer", "full report", "full table", "obs://", "http://", "https://"} {
		if strings.Contains(serialized, forbidden) {
			t.Fatalf("Web context projection contains forbidden content marker %q", forbidden)
		}
	}
	var decoded persistedConversationContext
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("decode Web context projection: %v", err)
	}
	if decoded.Stage == nil || decoded.Stage.TurnID != stage.TurnID || decoded.SettlementState != settlementState || decoded.AssistantSummary != "bounded response summary" {
		t.Fatalf("Web context projection = %#v", decoded)
	}
}

func assertConversationFixtureRedacted(t *testing.T, fixture conversationContextFixture) {
	t.Helper()
	requestBytes, err := json.Marshal(fixture.Requests)
	if err != nil {
		t.Fatal(err)
	}
	responseBytes, err := json.Marshal(fixture.Responses)
	if err != nil {
		t.Fatal(err)
	}
	serialized := strings.ToLower(string(append(requestBytes, responseBytes...)))
	for _, forbidden := range []string{"http://", "https://", "@", "password", "username", "signed", "token", "full answer", "full report", "full table", "assistant_summary"} {
		if strings.Contains(serialized, forbidden) {
			t.Fatalf("fixture contains forbidden content marker %q", forbidden)
		}
	}
	if strings.Contains(serialized, "/") || strings.Contains(serialized, `\`) {
		t.Fatal("fixture contains a raw path marker")
	}

	for _, envelope := range []rxBot.ConversationEnvelopeV1{
		decodeFixtureEnvelope(t, fixture.Requests.InstantEnvelope),
		decodeFixtureEnvelope(t, fixture.Requests.ExpertUnforcedEnvelope),
		decodeFixtureEnvelope(t, fixture.Requests.ExpertExplicitEnvelope),
	} {
		for _, entry := range envelope.HistoryDelta {
			if entry.Role == "assistant" && entry.Content != "" {
				t.Fatal("fixture history_delta contains full assistant content")
			}
		}
		for _, ref := range envelope.ArtifactRefs {
			if strings.ContainsAny(ref.DisplayName, `/\\`) {
				t.Fatal("fixture artifact_refs contains a raw path")
			}
		}
	}
}

func decodeFixtureEnvelope(t *testing.T, raw json.RawMessage) rxBot.ConversationEnvelopeV1 {
	t.Helper()
	var envelope rxBot.ConversationEnvelopeV1
	decodeConversationJSON(t, raw, &envelope)
	return envelope
}
