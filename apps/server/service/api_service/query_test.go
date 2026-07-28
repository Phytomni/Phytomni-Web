package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

// TestSlugRoutingDecision pins the chat-vs-remote dispatch decision and the
// empty-tool default, which drive which Bot endpoint Query calls.
func TestSlugRoutingDecision(t *testing.T) {
	cases := []struct {
		tool     string
		wantSlug string
		isChat   bool
	}{
		{"", "chat", true},
		{"ChatAgent", "chat", true},
		{"KnowledgeAgent", "knowledge", true},
		{"ReviewAgent", "review", true},
		{"AnalystAgent", "analyst", false},
		{"DeepGenomeAgent", "deep_genome", false},
		{"BriefGeneAgent", "brief_gene", false},
	}
	for _, c := range cases {
		slug, ok := rxBot.SlugFor(c.tool)
		if !ok || slug != c.wantSlug {
			t.Errorf("SlugFor(%q) = %q,%v; want %q", c.tool, slug, ok, c.wantSlug)
		}
		if _, isChat := rxBot.ChatModelFor(slug); isChat != c.isChat {
			t.Errorf("ChatModelFor(%q) isChat = %v; want %v", slug, isChat, c.isChat)
		}
	}
	if _, ok := rxBot.SlugFor("NoSuchAgent"); ok {
		t.Error("SlugFor of unknown tool should not resolve")
	}
}

// TestToolNameMapCoversAgents ensures every renderable tool_name the Web app needs
// has a slug mapping, so persisted rows carry a tool_name the Web app can branch on.
func TestToolNameMapCoversAgents(t *testing.T) {
	want := []string{"ChatAgent", "KnowledgeAgent", "DataAgent", "AnalystAgent", "ReviewAgent", "DeepGenomeAgent", "BriefGeneAgent"}
	have := make(map[string]bool)
	for _, v := range slugToToolName {
		have[v] = true
	}
	for _, w := range want {
		if !have[w] {
			t.Errorf("slugToToolName missing tool_name %q the Web app renders by", w)
		}
	}
}

func TestQueryBlockingContextSettlementPersistsBeforeAcknowledgment(t *testing.T) {
	gdb := setupExpertTestDB(t)
	var chatCalls, settleCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/chat/completions":
			chatCalls++
			var request rxBot.ChatCompletionRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Errorf("decode chat request: %v", err)
				return
			}
			if request.Conversation == nil {
				t.Error("missing V1 conversation envelope")
				return
			}
			if len(request.Messages) != 1 || request.Messages[0].Content != "current question" {
				t.Errorf("messages = %#v, want current Go-authoritative message only", request.Messages)
			}
			stage := rxBot.ContextStageMetadata{
				SchemaVersion:                  1,
				TurnID:                         request.Conversation.TurnID,
				SelectedAgentID:                "ChatAgent",
				RouteSource:                    "instant_lock",
				RouteReasonCode:                "INSTANT_LOCK",
				BaseBusinessContextVersion:     request.Conversation.BaseBusinessContextVersion,
				ProposedBusinessContextVersion: request.Conversation.BaseBusinessContextVersion + 1,
				LastAppliedLedgerCursor:        request.Conversation.LedgerCursor,
			}
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"id":      "chat-context-1",
				"object":  "chat.completion",
				"choices": []map[string]interface{}{{"index": 0, "message": map[string]string{"role": "assistant", "content": "settled answer"}}},
				"formatted": map[string]interface{}{
					"answer": "settled answer",
				},
				"conversation_context": stage,
			})
		case "/v1/conversation-context/settle":
			settleCalls++
			var request rxBot.ContextSettlementRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Errorf("decode settlement request: %v", err)
				return
			}
			var row model.QuestionAgentLog
			if err := gdb.First(&row, request.TurnID).Error; err != nil {
				t.Errorf("load row before acknowledgment: %v", err)
				return
			}
			if row.Status != "SUCCEEDED" || row.Answer != "settled answer" {
				t.Errorf("visible row before acknowledgment = %#v", row)
			}
			private, err := LoadBotConversationContext(context.Background(), "alice", row.Id)
			if err != nil {
				t.Errorf("load private context before acknowledgment: %v", err)
				return
			}
			if private.SettlementState != "ACK_PENDING" || private.SettlementLedgerHash != request.LedgerVersion {
				t.Errorf("private context before acknowledgment = %#v", private)
			}
			_ = json.NewEncoder(w).Encode(rxBot.ContextMutationResponse{
				SchemaVersion: 1, State: "committed", ContextVersion: 1,
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true, ExpertEnabled: true,
		MultiturnV1Enabled: true, TimeoutSeconds: 2,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	input := QueryInput{
		Query: "current question", History: `[{"role":"user","content":"browser poison"}]`,
		Mode: "instant", ClientTurnID: "blocking-context-1",
	}
	first, err := NewService().Query(context.Background(), "alice", input)
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	if first.Status != "SUCCEEDED" || first.Answer != "settled answer" {
		t.Fatalf("result = %#v", first)
	}
	private, err := LoadBotConversationContext(context.Background(), "alice", first.Id)
	if err != nil {
		t.Fatal(err)
	}
	if private.SettlementState != "ACKED" || private.Stage == nil {
		t.Fatalf("settled private context = %#v", private)
	}
	second, err := NewService().Query(context.Background(), "alice", input)
	if err != nil {
		t.Fatalf("duplicate Query: %v", err)
	}
	if second.Id != first.Id || chatCalls != 1 || settleCalls != 1 {
		t.Fatalf("duplicate result=%#v calls chat=%d settle=%d", second, chatCalls, settleCalls)
	}
	if strings.Contains(private.AssistantSummary, "browser poison") {
		t.Fatalf("browser history entered private summary: %q", private.AssistantSummary)
	}
}

func TestQueryBlockingContextRejectsInvalidMetadata(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*rxBot.ContextStageMetadata)
	}{
		{name: "outside allowlist", mutate: func(stage *rxBot.ContextStageMetadata) {
			stage.SelectedAgentID = "DataAgent"
		}},
		{name: "wrong route source", mutate: func(stage *rxBot.ContextStageMetadata) {
			stage.RouteSource = "router"
		}},
		{name: "mismatched turn", mutate: func(stage *rxBot.ContextStageMetadata) {
			stage.TurnID = "999"
		}},
		{name: "stale proposed version", mutate: func(stage *rxBot.ContextStageMetadata) {
			stage.ProposedBusinessContextVersion++
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/v1/chat/completions" {
					t.Errorf("unexpected path %s", r.URL.Path)
					return
				}
				var request rxBot.ChatCompletionRequest
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Errorf("decode request: %v", err)
					return
				}
				stage := rxBot.ContextStageMetadata{
					SchemaVersion: 1, TurnID: request.Conversation.TurnID,
					SelectedAgentID: "ChatAgent", RouteSource: "instant_lock",
					RouteReasonCode:                "INSTANT_LOCK",
					BaseBusinessContextVersion:     request.Conversation.BaseBusinessContextVersion,
					ProposedBusinessContextVersion: request.Conversation.BaseBusinessContextVersion + 1,
					LastAppliedLedgerCursor:        request.Conversation.LedgerCursor,
				}
				test.mutate(&stage)
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]interface{}{
					"id": "bad-stage", "object": "chat.completion",
					"choices":              []map[string]interface{}{{"message": map[string]string{"role": "assistant", "content": "must not persist"}}},
					"conversation_context": stage,
				})
			}))
			defer server.Close()
			previous := rxBot.BotConfig
			rxBot.BotConfig = &rxBot.Config{
				BaseURL: server.URL, ProxyEnabled: true, MultiturnV1Enabled: true,
				TimeoutSeconds: 2,
			}
			t.Cleanup(func() { rxBot.BotConfig = previous })

			_, err := NewService().Query(context.Background(), "alice", QueryInput{
				Query: "invalid stage", Mode: "instant",
				ClientTurnID: "invalid-" + strings.ReplaceAll(test.name, " ", "-"),
			})
			if err == nil {
				t.Fatal("invalid metadata was accepted")
			}
			if test.name != "mismatched turn" && !errors.Is(err, ErrInvalidConversationStage) {
				t.Fatalf("error = %v, want ErrInvalidConversationStage", err)
			}
			var row model.QuestionAgentLog
			if err := gdb.First(&row).Error; err != nil {
				t.Fatal(err)
			}
			if row.Status != "FAILED" || row.Answer != "" {
				t.Fatalf("invalid stage row = %#v", row)
			}
		})
	}
}

func TestQueryAckPendingFinalizesBeforeNextEnvelope(t *testing.T) {
	setupExpertTestDB(t)
	var chatCalls, settleCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/chat/completions":
			chatCalls++
			var request rxBot.ChatCompletionRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Errorf("decode chat request: %v", err)
				return
			}
			if chatCalls == 2 {
				if settleCalls != 2 {
					t.Errorf("second envelope built before pending ACK: settle calls=%d", settleCalls)
				}
				if request.Conversation.BaseBusinessContextVersion != 1 {
					t.Errorf("second base context version=%d, want 1", request.Conversation.BaseBusinessContextVersion)
				}
				if len(request.Conversation.HistoryDelta) != 2 ||
					request.Conversation.HistoryDelta[1].Summary != "first answer" {
					t.Errorf("second history=%#v", request.Conversation.HistoryDelta)
				}
			}
			answer := "first answer"
			if chatCalls == 2 {
				answer = "second answer"
			}
			stage := rxBot.ContextStageMetadata{
				SchemaVersion: 1, TurnID: request.Conversation.TurnID,
				SelectedAgentID: "ChatAgent", RouteSource: "instant_lock",
				RouteReasonCode:                "INSTANT_LOCK",
				BaseBusinessContextVersion:     request.Conversation.BaseBusinessContextVersion,
				ProposedBusinessContextVersion: request.Conversation.BaseBusinessContextVersion + 1,
				LastAppliedLedgerCursor:        request.Conversation.LedgerCursor,
			}
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"id": "chat-ack", "object": "chat.completion",
				"choices":              []map[string]interface{}{{"message": map[string]string{"role": "assistant", "content": answer}}},
				"conversation_context": stage,
			})
		case "/v1/conversation-context/settle":
			settleCalls++
			var request rxBot.ContextSettlementRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Errorf("decode settlement: %v", err)
				return
			}
			if settleCalls == 1 {
				http.Error(w, `{"error":{"code":"temporary","message":"retry"}}`, http.StatusServiceUnavailable)
				return
			}
			version := int64(1)
			state := "already_applied"
			if request.TurnID == "2" {
				version = 2
				state = "committed"
			}
			_ = json.NewEncoder(w).Encode(rxBot.ContextMutationResponse{
				SchemaVersion: 1, State: state, ContextVersion: version,
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true, MultiturnV1Enabled: true,
		TimeoutSeconds: 2,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	first, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "first", Mode: "instant", ClientTurnID: "ack-pending-1",
	})
	if err != nil || first.Status != "SUCCEEDED" {
		t.Fatalf("first result=%#v error=%v", first, err)
	}
	private, err := LoadBotConversationContext(context.Background(), "alice", first.Id)
	if err != nil {
		t.Fatal(err)
	}
	if private.SettlementState != conversationSettlementAckPending {
		t.Fatalf("first private state=%q", private.SettlementState)
	}
	second, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "second", Id: first.Id, Mode: "instant", ClientTurnID: "ack-pending-2",
		History: `[{"role":"assistant","content":"browser poison"}]`,
	})
	if err != nil || second.Status != "SUCCEEDED" {
		t.Fatalf("second result=%#v error=%v", second, err)
	}
	if chatCalls != 2 || settleCalls != 3 {
		t.Fatalf("calls chat=%d settle=%d", chatCalls, settleCalls)
	}
}

func TestQueryBlockingContextDegradedPreservesAnswerAndForcesRebuild(t *testing.T) {
	setupExpertTestDB(t)
	var settleCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/chat/completions":
			var request rxBot.ChatCompletionRequest
			_ = json.NewDecoder(r.Body).Decode(&request)
			stage := rxBot.ContextStageMetadata{
				SchemaVersion: 1, TurnID: request.Conversation.TurnID,
				SelectedAgentID: "ChatAgent", RouteSource: "instant_lock",
				RouteReasonCode:                "INSTANT_LOCK",
				BaseBusinessContextVersion:     request.Conversation.BaseBusinessContextVersion,
				ProposedBusinessContextVersion: request.Conversation.BaseBusinessContextVersion + 1,
				LastAppliedLedgerCursor:        request.Conversation.LedgerCursor,
				ContextDegraded:                true,
			}
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"id": "degraded", "object": "chat.completion",
				"choices":              []map[string]interface{}{{"message": map[string]string{"role": "assistant", "content": "visible degraded answer"}}},
				"conversation_context": stage,
			})
		case "/v1/conversation-context/settle":
			settleCalls++
			http.Error(w, "unexpected", http.StatusInternalServerError)
		}
	}))
	defer server.Close()
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true, MultiturnV1Enabled: true,
		TimeoutSeconds: 2,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	out, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "degraded", Mode: "instant", ClientTurnID: "degraded-1",
	})
	if err != nil || out.Answer != "visible degraded answer" || out.Status != "SUCCEEDED" {
		t.Fatalf("result=%#v error=%v", out, err)
	}
	private, err := LoadBotConversationContext(context.Background(), "alice", out.Id)
	if err != nil {
		t.Fatal(err)
	}
	if settleCalls != 0 || private.SettlementState != conversationSettlementRebuildRequired ||
		private.Stage == nil || !private.Stage.ContextDegraded {
		t.Fatalf("settles=%d private=%#v", settleCalls, private)
	}
}
