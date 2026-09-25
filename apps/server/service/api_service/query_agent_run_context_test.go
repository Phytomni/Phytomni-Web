package api_service

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"testing"

	rxBot "phytomni-server/external/bot"
)

func TestQueryV1ForcedDataAgentForwardsAndSettlesConversation(t *testing.T) {
	useConversationV1(t)
	gdb := setupExpertTestDB(t)
	var (
		mu       sync.Mutex
		captured rxBot.AgentRunRequest
	)
	settleCalls := 0

	v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/agents/data/runs":
			mu.Lock()
			err := json.NewDecoder(r.Body).Decode(&captured)
			mu.Unlock()
			if err != nil {
				t.Errorf("decode agent request: %v", err)
			}
			_, _ = w.Write([]byte(`{
				"id":"run-data","object":"agent.run","agent":"data","status":"succeeded","task_ids":[],
				"result":{"formatted":{"answer":"data answer"}},
				"conversation_context":{
					"schema_version":1,"turn_id":"1","selected_agent_id":"DataAgent",
					"route_source":"explicit_selection","route_reason_code":"EXPLICIT_SELECTION",
					"base_business_context_version":0,"proposed_business_context_version":1,
					"last_applied_ledger_cursor":1,"context_truncated":false,
					"context_rebuilt":false,"context_degraded":false
				}
			}`))
		case "/v1/conversation-context/settle":
			settleCalls++
			var request rxBot.ContextSettlementRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Errorf("decode settlement request: %v", err)
			}
			if request.TurnID != "1" || request.LedgerVersion == "" {
				t.Errorf("settlement request=%#v", request)
			}
			_, _ = w.Write([]byte(`{"schema_version":1,"state":"committed","context_version":1}`))
		default:
			t.Errorf("unexpected Bot path %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	})

	out, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query:        "show me the table",
		Mode:         "expert",
		Tool:         "DataAgent",
		ClientTurnID: "native-data-turn-1",
		Surface:      QuerySurfaceChat,
	})
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	if out.Id <= 0 || (out.Status != "RUNNING" && out.Status != statusSucceeded) {
		t.Fatalf("result=%#v", out)
	}
	row := waitForQuestionRowTerminal(t, gdb, out.Id)
	if row.Status != statusSucceeded || row.Answer != `{"headers":[],"rows":[]}` {
		t.Fatalf("settled row=%#v", row)
	}
	mu.Lock()
	got := captured
	mu.Unlock()
	if got.Conversation == nil || got.Conversation.TurnID != "1" {
		t.Fatalf("conversation envelope=%#v", got.Conversation)
	}
	if got.Conversation.RequestedAgentID == nil || *got.Conversation.RequestedAgentID != "DataAgent" {
		t.Fatalf("requested agent=%#v", got.Conversation.RequestedAgentID)
	}
	if settleCalls != 1 {
		t.Fatalf("settlement calls=%d, want 1", settleCalls)
	}
	private, err := LoadBotConversationContext(context.Background(), "alice", row.Id)
	if err != nil {
		t.Fatal(err)
	}
	if private.SettlementState != conversationSettlementAcked || private.Stage == nil ||
		private.Stage.SelectedAgentID != "DataAgent" {
		t.Fatalf("settled context=%#v", private)
	}
}
