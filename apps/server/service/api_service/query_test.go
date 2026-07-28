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

func TestQueryContextRebuildRetriesExactlyOnceWithDurableTurn(t *testing.T) {
	t.Run("rebuild succeeds", func(t *testing.T) {
		setupExpertTestDB(t)
		var calls int
		var firstTurnID string
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			switch r.URL.Path {
			case "/v1/chat/completions":
				calls++
				var request rxBot.ChatCompletionRequest
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Errorf("decode chat request: %v", err)
					return
				}
				if calls == 1 {
					firstTurnID = request.Conversation.TurnID
					http.Error(
						w,
						`{"error":{"code":"conversation_context_rebuild_required","message":"missing","retryable":true}}`,
						http.StatusConflict,
					)
					return
				}
				if calls != 2 || request.Conversation.TurnID != firstTurnID ||
					request.Conversation.Operation != "rebuild" ||
					request.Conversation.BaseBusinessContextVersion != 0 ||
					len(request.Conversation.HistoryDelta) != 0 {
					t.Errorf("rebuild envelope = %#v", request.Conversation)
				}
				stage := rxBot.ContextStageMetadata{
					SchemaVersion: 1, TurnID: request.Conversation.TurnID,
					SelectedAgentID: "ChatAgent", RouteSource: "instant_lock",
					RouteReasonCode:                "INSTANT_LOCK",
					BaseBusinessContextVersion:     0,
					ProposedBusinessContextVersion: 1,
					LastAppliedLedgerCursor:        request.Conversation.LedgerCursor,
					ContextRebuilt:                 true,
				}
				_ = json.NewEncoder(w).Encode(map[string]interface{}{
					"id": "rebuilt", "object": "chat.completion",
					"choices": []map[string]interface{}{{
						"message": map[string]string{"role": "assistant", "content": "rebuilt answer"},
					}},
					"conversation_context": stage,
				})
			case "/v1/conversation-context/settle":
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
			BaseURL: server.URL, ProxyEnabled: true, MultiturnV1Enabled: true,
			TimeoutSeconds: 2,
		}
		t.Cleanup(func() { rxBot.BotConfig = previous })

		out, err := NewService().Query(context.Background(), "alice", QueryInput{
			Query: "recover context", Mode: "instant", ClientTurnID: "rebuild-once-1",
		})
		if err != nil || out.Answer != "rebuilt answer" || calls != 2 {
			t.Fatalf("result=%#v error=%v calls=%d", out, err, calls)
		}
		private, err := LoadBotConversationContext(context.Background(), "alice", out.Id)
		if err != nil {
			t.Fatal(err)
		}
		if private.SettlementState != conversationSettlementAcked ||
			private.RebuildLedgerVersion == "" ||
			private.RebuildLedgerCursor != 0 {
			t.Fatalf("rebuilt private context = %#v", private)
		}
	})

	t.Run("second rebuild request does not loop", func(t *testing.T) {
		gdb := setupExpertTestDB(t)
		var calls int
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/v1/chat/completions" {
				http.NotFound(w, r)
				return
			}
			calls++
			http.Error(
				w,
				`{"error":{"code":"conversation_context_rebuild_required","message":"still missing","retryable":true}}`,
				http.StatusConflict,
			)
		}))
		defer server.Close()
		previous := rxBot.BotConfig
		rxBot.BotConfig = &rxBot.Config{
			BaseURL: server.URL, ProxyEnabled: true, MultiturnV1Enabled: true,
			TimeoutSeconds: 2,
		}
		t.Cleanup(func() { rxBot.BotConfig = previous })

		_, err := NewService().Query(context.Background(), "alice", QueryInput{
			Query: "still stale", Mode: "instant", ClientTurnID: "rebuild-once-2",
		})
		if !rxBot.IsConversationContextRebuildRequired(err) || calls != 2 {
			t.Fatalf("error=%v calls=%d", err, calls)
		}
		var row model.QuestionAgentLog
		if err := gdb.First(&row).Error; err != nil {
			t.Fatal(err)
		}
		if row.Status != "FAILED" {
			t.Fatalf("second rebuild failure row = %#v", row)
		}
	})
}

func TestQueryContextRebuildRecoversPendingAcknowledgment(t *testing.T) {
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
			if chatCalls == 2 && (request.Conversation.Operation != "rebuild" ||
				request.Conversation.BaseBusinessContextVersion != 0) {
				t.Errorf("second envelope = %#v", request.Conversation)
			}
			stage := rxBot.ContextStageMetadata{
				SchemaVersion: 1, TurnID: request.Conversation.TurnID,
				SelectedAgentID: "ChatAgent", RouteSource: "instant_lock",
				RouteReasonCode:                "INSTANT_LOCK",
				BaseBusinessContextVersion:     request.Conversation.BaseBusinessContextVersion,
				ProposedBusinessContextVersion: request.Conversation.BaseBusinessContextVersion + 1,
				LastAppliedLedgerCursor:        request.Conversation.LedgerCursor,
				ContextRebuilt:                 request.Conversation.Operation == "rebuild",
			}
			answer := "first answer"
			if chatCalls == 2 {
				answer = "second answer"
			}
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"id": "ack-rebuild", "object": "chat.completion",
				"choices": []map[string]interface{}{{
					"message": map[string]string{"role": "assistant", "content": answer},
				}},
				"conversation_context": stage,
			})
		case "/v1/conversation-context/settle":
			settleCalls++
			if settleCalls <= 2 {
				http.Error(
					w,
					`{"error":{"code":"conversation_context_rebuild_required","message":"lost context","retryable":true}}`,
					http.StatusConflict,
				)
				return
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
		BaseURL: server.URL, ProxyEnabled: true, MultiturnV1Enabled: true,
		TimeoutSeconds: 2,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	first, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "first", Mode: "instant", ClientTurnID: "pending-rebuild-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "second", Id: first.Id, Mode: "instant",
		ClientTurnID: "pending-rebuild-2",
	})
	if err != nil || second.Answer != "second answer" ||
		chatCalls != 2 || settleCalls != 3 {
		t.Fatalf(
			"first=%#v second=%#v error=%v chat=%d settle=%d",
			first, second, err, chatCalls, settleCalls,
		)
	}
	firstPrivate, err := LoadBotConversationContext(context.Background(), "alice", first.Id)
	if err != nil {
		t.Fatal(err)
	}
	if firstPrivate.SettlementState != conversationSettlementRebuildRequired {
		t.Fatalf("first private context = %#v", firstPrivate)
	}
}

func TestQueryRefreshReplaceStagesUntilTerminalSuccess(t *testing.T) {
	gdb := setupExpertTestDB(t)
	dialogueID := "33333333-3333-4333-8333-333333333333"
	oldStage := validContextStageMetadata()
	oldStage.TurnID = "10"
	oldStage.BaseBusinessContextVersion = 0
	oldStage.ProposedBusinessContextVersion = 1
	oldStage.LastAppliedLedgerCursor = 10
	oldPrivate := persistedConversationContext{
		ClientTurnID: "old-turn", Stage: oldStage,
		SettlementState:  conversationSettlementAcked,
		AssistantSummary: "old summary",
	}
	oldRaw, err := marshalPersistedProjectionWithContext(
		BotRunProjection{ReportRevision: -1}, &oldPrivate,
	)
	if err != nil {
		t.Fatal(err)
	}
	root := model.QuestionAgentLog{
		Id: 10, DialogueId: dialogueID, UserName: "alice",
		Query: "old question", Answer: "old answer", ToolName: "ChatAgent",
		Status: statusSucceeded, Mode: "instant", BotProjectionJSON: oldRaw,
		BotReportRevision: -1,
	}
	if err := gdb.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	laterStage := *oldStage
	laterStage.TurnID = "11"
	laterStage.BaseBusinessContextVersion = 1
	laterStage.ProposedBusinessContextVersion = 2
	laterStage.LastAppliedLedgerCursor = 11
	laterPrivate := persistedConversationContext{
		ClientTurnID: "later-turn", Stage: &laterStage,
		SettlementState:  conversationSettlementAcked,
		AssistantSummary: "later summary",
	}
	laterRaw, err := marshalPersistedProjectionWithContext(
		BotRunProjection{ReportRevision: -1}, &laterPrivate,
	)
	if err != nil {
		t.Fatal(err)
	}
	later := model.QuestionAgentLog{
		Id: 11, DialogueId: dialogueID, FId: 10, UserName: "alice",
		Query: "later question", Answer: "later answer", ToolName: "ChatAgent",
		Status: statusSucceeded, Mode: "instant", BotProjectionJSON: laterRaw,
		BotReportRevision: -1,
	}
	if err := gdb.Create(&later).Error; err != nil {
		t.Fatal(err)
	}
	before, err := BuildConversationLedger(context.Background(), "alice", dialogueID)
	if err != nil {
		t.Fatal(err)
	}

	var chatCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/chat/completions":
			chatCalls++
			var request rxBot.ChatCompletionRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Errorf("decode refresh request: %v", err)
				return
			}
			var visible model.QuestionAgentLog
			if err := gdb.First(&visible, 10).Error; err != nil {
				t.Errorf("load visible refresh row: %v", err)
				return
			}
			if visible.Answer != "old answer" || visible.Status != statusSucceeded {
				t.Errorf("old answer was hidden during refresh: %#v", visible)
			}
			if chatCalls == 1 {
				if request.Conversation.Operation != "replace" {
					t.Errorf("first refresh operation=%q", request.Conversation.Operation)
				}
				http.Error(
					w,
					`{"error":{"code":"conversation_context_rebuild_required","message":"replace needs rebuild","retryable":true}}`,
					http.StatusConflict,
				)
				return
			}
			if request.Conversation.Operation != "rebuild" ||
				request.Conversation.TurnID != "10" ||
				request.Conversation.BaseBusinessContextVersion != 0 {
				t.Errorf("refresh rebuild envelope = %#v", request.Conversation)
			}
			stage := rxBot.ContextStageMetadata{
				SchemaVersion: 1, TurnID: "10",
				SelectedAgentID: "ChatAgent", RouteSource: "instant_lock",
				RouteReasonCode:                "INSTANT_LOCK",
				BaseBusinessContextVersion:     0,
				ProposedBusinessContextVersion: 1,
				LastAppliedLedgerCursor:        request.Conversation.LedgerCursor,
				ContextRebuilt:                 true,
			}
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"id": "refresh-rebuilt", "object": "chat.completion",
				"choices": []map[string]interface{}{{
					"message": map[string]string{"role": "assistant", "content": "new answer"},
				}},
				"conversation_context": stage,
			})
		case "/v1/conversation-context/settle":
			var request rxBot.ContextSettlementRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Errorf("decode refresh settlement: %v", err)
				return
			}
			var visible model.QuestionAgentLog
			if err := gdb.First(&visible, 10).Error; err != nil {
				t.Errorf("load settled refresh row: %v", err)
				return
			}
			if visible.Answer != "new answer" || visible.Query != "new question" ||
				request.LedgerVersion == before.Version {
				t.Errorf("refresh was not durable before ACK: row=%#v request=%#v", visible, request)
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
		BaseURL: server.URL, ProxyEnabled: true, MultiturnV1Enabled: true,
		TimeoutSeconds: 2,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	input := QueryInput{
		Query: "new question", RefreshId: 10, Mode: "instant",
		ClientTurnID: "refresh-turn-10",
	}
	out, err := NewService().Query(context.Background(), "alice", input)
	if err != nil || out.Answer != "new answer" || out.Id != 10 {
		t.Fatalf("refresh result=%#v error=%v", out, err)
	}
	duplicate, err := NewService().Query(context.Background(), "alice", input)
	if err != nil || duplicate.Answer != "new answer" || chatCalls != 2 {
		t.Fatalf("duplicate=%#v error=%v chat calls=%d", duplicate, err, chatCalls)
	}
	laterContext, err := LoadBotConversationContext(context.Background(), "alice", 11)
	if err != nil {
		t.Fatal(err)
	}
	if laterContext.SettlementState != conversationSettlementRebuildRequired ||
		laterContext.AssistantSummary != "" || laterContext.Stage != nil {
		t.Fatalf("later semantic context was not invalidated: %#v", laterContext)
	}
}

func TestQueryRefreshReplaceFailurePreservesAcceptedAnswer(t *testing.T) {
	gdb := setupExpertTestDB(t)
	dialogueID := "44444444-4444-4444-8444-444444444444"
	oldStage := validContextStageMetadata()
	oldStage.TurnID = "20"
	oldStage.BaseBusinessContextVersion = 0
	oldStage.ProposedBusinessContextVersion = 1
	oldStage.LastAppliedLedgerCursor = 20
	oldPrivate := persistedConversationContext{
		ClientTurnID: "accepted-turn", Stage: oldStage,
		SettlementState:  conversationSettlementAcked,
		AssistantSummary: "accepted summary",
	}
	raw, err := marshalPersistedProjectionWithContext(
		BotRunProjection{ReportRevision: -1}, &oldPrivate,
	)
	if err != nil {
		t.Fatal(err)
	}
	row := model.QuestionAgentLog{
		Id: 20, DialogueId: dialogueID, UserName: "alice",
		Query: "accepted question", Answer: "accepted answer",
		ToolName: "ChatAgent", Status: statusSucceeded, Mode: "instant",
		BotProjectionJSON: raw, BotReportRevision: -1,
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(
			w,
			`{"error":{"code":"invalid_request","message":"rejected","retryable":false}}`,
			http.StatusBadRequest,
		)
	}))
	defer server.Close()
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true, MultiturnV1Enabled: true,
		TimeoutSeconds: 2,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	_, err = NewService().Query(context.Background(), "alice", QueryInput{
		Query: "replacement fails", RefreshId: 20, Mode: "instant",
		ClientTurnID: "refresh-failure-20",
	})
	if err == nil {
		t.Fatal("refresh failure was accepted")
	}
	var stored model.QuestionAgentLog
	if err := gdb.First(&stored, 20).Error; err != nil {
		t.Fatal(err)
	}
	private, err := LoadBotConversationContext(context.Background(), "alice", 20)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Answer != "accepted answer" || stored.Query != "accepted question" ||
		stored.Status != statusSucceeded || private.Replacement != nil ||
		private.SettlementState != conversationSettlementAcked ||
		private.Stage == nil ||
		private.Stage.ProposedBusinessContextVersion != 1 {
		t.Fatalf("failed refresh changed accepted state: row=%#v private=%#v", stored, private)
	}
}
