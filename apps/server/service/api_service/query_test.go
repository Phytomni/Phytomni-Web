package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"gorm.io/gorm"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

func TestAllowsEmptyQueryWithAttachmentsOnlyForAnalysisTools(t *testing.T) {
	refs := []rxBot.AssetAttachmentRef{{AssetID: "file_counts"}}
	cases := []struct {
		name string
		in   QueryInput
		want bool
	}{
		{
			name: "analyst product",
			in: QueryInput{
				Tool: "AnalystAgent", Surface: QuerySurfaceAgentProduct,
				Attachments: refs,
			},
			want: true,
		},
		{
			name: "research expert",
			in: QueryInput{
				Tool: "InSilicoResearchAgent", Mode: "expert",
				Surface: QuerySurfaceChat, Attachments: refs,
			},
			want: true,
		},
		{
			name: "design product",
			in: QueryInput{
				Tool: "DigitalDesignAgent", Surface: QuerySurfaceAgentProduct,
				Attachments: refs,
			},
			want: false,
		},
		{
			name: "analysis without attachments",
			in: QueryInput{
				Tool: "AnalystAgent", Surface: QuerySurfaceAgentProduct,
			},
			want: false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := AllowsEmptyQueryWithAttachments(tc.in); got != tc.want {
				t.Fatalf("AllowsEmptyQueryWithAttachments() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestQueryPreservesAttachmentsAcrossBlockingAndStreamChat(t *testing.T) {
	for _, tc := range []struct {
		name   string
		stream bool
	}{
		{name: "blocking"},
		{name: "stream", stream: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setupExpertTestDB(t)
			var captured rxBot.ChatCompletionRequest
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
					t.Errorf("decode chat request: %v", err)
					return
				}
				if tc.stream {
					w.Header().Set("Content-Type", "text/event-stream")
					_, _ = w.Write([]byte("event: RunStarted\\ndata: {\\\"type\\\":\\\"RunStarted\\\",\\\"run_id\\\":\\\"run-dataset\\\"}\\n\\nevent: RunFinished\\ndata: {\\\"type\\\":\\\"RunFinished\\\",\\\"run_id\\\":\\\"run-dataset\\\"}\\n\\n"))
					return
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"id":"chat-dataset","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"ok"}}],"formatted":{"answer":"ok"}}`))
			}))
			t.Cleanup(srv.Close)
			previous := rxBot.BotConfig
			rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
			t.Cleanup(func() { rxBot.BotConfig = previous })

			refs := []rxBot.AssetAttachmentRef{{AssetID: "file_counts"}}
			in := QueryInput{Query: "Analyze counts", Mode: "instant", Attachments: refs}
			if tc.stream {
				_, err := streamCapableService().QueryStream(context.Background(), "alice@example.com", in, nil, nil)
				if err != nil {
					t.Fatalf("QueryStream: %v", err)
				}
			} else if _, err := NewService().Query(context.Background(), "alice", in); err != nil {
				t.Fatalf("Query: %v", err)
			}
			if captured.Messages[0].Content != "Analyze counts" {
				t.Fatalf("chat query changed: %#v", captured.Messages)
			}
			if !reflect.DeepEqual(captured.Attachments, refs) || captured.OwnerSubject == "" {
				t.Fatalf("chat attachments=%#v owner=%q, want %#v and authenticated owner", captured.Attachments, captured.OwnerSubject, refs)
			}
		})
	}
}

const (
	v1ConversationArtifactID   = "entity-artifact-1"
	v1ConversationOutputMarker = "answer-prose-marker|report-prose-marker|table-prose-marker|full-output-marker"
)

func seedV1ConversationRoot(t *testing.T, gdb *gorm.DB, username, dialogueID string) {
	t.Helper()
	stage := validContextStageMetadata()
	stage.TurnID = "1"
	stage.BaseBusinessContextVersion = 0
	stage.ProposedBusinessContextVersion = 1
	stage.LastAppliedLedgerCursor = 1
	private := persistedConversationContext{
		Stage:           stage,
		SettlementState: conversationSettlementAcked,
		ArtifactRefs: []rxBot.ArtifactRefV1{{
			ArtifactID:  v1ConversationArtifactID,
			DisplayName: "entity-results.csv",
		}},
	}
	raw, err := marshalPersistedProjectionWithContext(
		BotRunProjection{ReportRevision: -1},
		&private,
	)
	if err != nil {
		t.Fatalf("marshal V1 root context: %v", err)
	}
	if err := gdb.Create(&model.QuestionAgentLog{
		Id:                1,
		DialogueId:        dialogueID,
		UserName:          username,
		Query:             "Name the focus entity.",
		Answer:            "visible root answer",
		ToolName:          "ChatAgent",
		Status:            statusSucceeded,
		Mode:              "instant",
		BotProjectionJSON: raw,
		BotReportRevision: -1,
	}).Error; err != nil {
		t.Fatalf("persist V1 root context: %v", err)
	}
}

func assertV1ContextDoesNotReplayOutput(
	t *testing.T,
	username string,
	rowID int64,
	outputMarker string,
) {
	t.Helper()
	private, err := LoadBotConversationContext(context.Background(), username, rowID)
	if err != nil {
		t.Fatalf("load settled V1 context: %v", err)
	}
	if private.AssistantSummary != "" {
		t.Fatalf("V1 assistant summary contains display output: %q", private.AssistantSummary)
	}
	if private.Stage == nil || private.Stage.SelectedAgentID != "ChatAgent" {
		t.Fatalf("V1 staged metadata was not retained: %#v", private.Stage)
	}
	if len(private.ArtifactRefs) != 1 || private.ArtifactRefs[0].ArtifactID != v1ConversationArtifactID {
		t.Fatalf("V1 artifact metadata was not retained: %#v", private.ArtifactRefs)
	}
	var row model.QuestionAgentLog
	if err := model.DB(context.Background()).Where("id = ? AND user_name = ?", rowID, username).First(&row).Error; err != nil {
		t.Fatalf("load settled V1 row: %v", err)
	}
	ledger, err := BuildConversationLedger(context.Background(), username, row.DialogueId)
	if err != nil {
		t.Fatalf("build settled V1 ledger: %v", err)
	}
	for _, entry := range ledger.HistoryBefore(rowID + 1) {
		if entry.Role == "assistant" || strings.Contains(entry.Content, outputMarker) || strings.Contains(entry.Summary, outputMarker) {
			t.Fatalf("display output entered replay history: %#v", entry)
		}
	}
}

func TestQueryContextPrebuildsForNonContiguousLedgerRow(t *testing.T) {
	useConversationV1(t)
	gdb := setupExpertTestDB(t)
	var (
		envelopes []rxBot.ConversationEnvelopeV1
		settles   int
	)
	v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/conversation-context/settle" {
			settles++
			_ = json.NewEncoder(w).Encode(rxBot.ContextMutationResponse{
				SchemaVersion: 1, State: "committed", ContextVersion: int64(settles),
			})
			return
		}
		var request rxBot.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode chat request: %v", err)
			return
		}
		if request.Conversation == nil {
			t.Error("missing V1 conversation envelope")
			return
		}
		envelopes = append(envelopes, *request.Conversation)
		stage := rxBot.ContextStageMetadata{
			SchemaVersion:                  1,
			TurnID:                         request.Conversation.TurnID,
			SelectedAgentID:                "ChatAgent",
			RouteSource:                    "instant_lock",
			RouteReasonCode:                "INSTANT_LOCK",
			BaseBusinessContextVersion:     request.Conversation.BaseBusinessContextVersion,
			ProposedBusinessContextVersion: request.Conversation.BaseBusinessContextVersion + 1,
			LastAppliedLedgerCursor:        request.Conversation.LedgerCursor,
			ContextRebuilt:                 request.Conversation.Operation == "rebuild",
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "gap-chat", "object": "chat.completion",
			"choices": []map[string]any{{"message": map[string]string{
				"role": "assistant", "content": "gap answer",
			}}},
			"formatted":            map[string]any{"answer": "gap answer"},
			"conversation_context": stage,
		})
	})

	service := NewService()
	root, err := service.Query(context.Background(), "alice", QueryInput{
		Query: "first", Mode: "instant", ClientTurnID: "gap-root-1",
	})
	if err != nil {
		t.Fatalf("root Query: %v", err)
	}
	if root.Id != 1 {
		t.Fatalf("root id = %d, want 1", root.Id)
	}
	if err := gdb.Create(&model.QuestionAgentLog{
		DialogueId: "unrelated-dialogue", UserName: "alice",
		Query: "unrelated", Answer: "unrelated", ToolName: "ChatAgent",
		Status: statusSucceeded, Mode: "instant", BotReportRevision: -1,
	}).Error; err != nil {
		t.Fatalf("insert unrelated row: %v", err)
	}

	follow, err := service.Query(context.Background(), "alice", QueryInput{
		Query: "follow", Id: root.Id, Mode: "instant", ClientTurnID: "gap-follow-2",
	})
	if err != nil {
		t.Fatalf("follow-up Query: %v", err)
	}
	if follow.Answer != "gap answer" || len(envelopes) != 2 {
		t.Fatalf("follow-up result=%#v envelopes=%d", follow, len(envelopes))
	}
	if envelopes[0].Operation != "append" || envelopes[0].LedgerCursor != 1 {
		t.Fatalf("root envelope=%#v", envelopes[0])
	}
	if envelopes[1].Operation != "rebuild" || envelopes[1].TurnID != "3" ||
		envelopes[1].LedgerCursor != 3 || envelopes[1].BaseBusinessContextVersion != 1 {
		t.Fatalf("non-contiguous follow-up envelope=%#v", envelopes[1])
	}
}

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
		{"BriefGeneAgent", "brief_gene", true},
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
	useConversationV1(t)
	gdb := setupExpertTestDB(t)
	var chatCalls, settleCalls int
	var stagedLedgerVersion string
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
			stagedLedgerVersion = request.Conversation.LedgerVersion
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
			if request.LedgerVersion != stagedLedgerVersion {
				t.Errorf("settlement ledger version = %q, want staged %q", request.LedgerVersion, stagedLedgerVersion)
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
		BaseURL: server.URL, ProxyEnabled: true,
		TimeoutSeconds: 2,
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
	if private.AssistantSummary != "" {
		t.Fatalf("V1 persisted display output as assistant summary: %q", private.AssistantSummary)
	}
}

func TestQueryBlockingContextRejectsInvalidMetadata(t *testing.T) {
	useConversationV1(t)
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
				BaseURL: server.URL, ProxyEnabled: true,
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
	useConversationV1(t)
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
				if len(request.Conversation.HistoryDelta) != 1 ||
					request.Conversation.HistoryDelta[0].Role != "user" ||
					request.Conversation.HistoryDelta[0].Content != "first" {
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
		BaseURL: server.URL, ProxyEnabled: true,
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
	useConversationV1(t)
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
		BaseURL: server.URL, ProxyEnabled: true,
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
	useConversationV1(t)
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
					len(request.Conversation.HistoryDelta) != 1 ||
					request.Conversation.HistoryDelta[0].Role != "user" ||
					request.Conversation.HistoryDelta[0].Content != "recover context" {
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
			BaseURL: server.URL, ProxyEnabled: true,
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
			private.RebuildLedgerCursor != 1 {
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
			BaseURL: server.URL, ProxyEnabled: true,
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
	useConversationV1(t)
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
		BaseURL: server.URL, ProxyEnabled: true,
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
	useConversationV1(t)
	gdb := setupExpertTestDB(t)
	dialogueID := "33333333-3333-4333-8333-333333333333"
	oldInput := QueryInput{
		Query: "old question", Mode: "instant",
		ClientTurnID: "old-turn", Surface: QuerySurfaceChat,
	}
	oldTarget := v1SubmissionTarget{
		dialogueID: dialogueID, mode: "instant", operation: "append",
	}
	oldStage := validContextStageMetadata()
	oldStage.TurnID = "10"
	oldStage.BaseBusinessContextVersion = 0
	oldStage.ProposedBusinessContextVersion = 1
	oldStage.LastAppliedLedgerCursor = 10
	oldPrivate := persistedConversationContext{
		ClientTurnID:       oldInput.ClientTurnID,
		RequestFingerprint: submissionRequestFingerprint(oldInput, oldTarget, true),
		Stage:              oldStage,
		SettlementState:    conversationSettlementAcked,
		AssistantSummary:   "old summary",
	}
	oldRaw, err := marshalPersistedProjectionWithContext(
		BotRunProjection{ReportRevision: -1}, &oldPrivate,
	)
	if err != nil {
		t.Fatal(err)
	}
	root := model.QuestionAgentLog{
		Id: 10, DialogueId: dialogueID, UserName: "alice",
		Query: oldInput.Query, Answer: "old answer", ToolName: "ChatAgent",
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
				request.Conversation.BaseBusinessContextVersion != 1 {
				t.Errorf("refresh rebuild envelope = %#v", request.Conversation)
			}
			stage := rxBot.ContextStageMetadata{
				SchemaVersion: 1, TurnID: "10",
				SelectedAgentID: "ChatAgent", RouteSource: "instant_lock",
				RouteReasonCode:                "INSTANT_LOCK",
				BaseBusinessContextVersion:     1,
				ProposedBusinessContextVersion: 2,
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
		BaseURL: server.URL, ProxyEnabled: true,
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
	acceptedInput := QueryInput{
		Query: "accepted question", Mode: "instant",
		ClientTurnID: "accepted-turn", Surface: QuerySurfaceChat,
		Attachments: []rxBot.AssetAttachmentRef{{AssetID: "file_accepted"}},
	}
	acceptedTarget := v1SubmissionTarget{
		dialogueID: dialogueID, mode: "instant", operation: "append",
	}
	oldStage := validContextStageMetadata()
	oldStage.TurnID = "20"
	oldStage.BaseBusinessContextVersion = 0
	oldStage.ProposedBusinessContextVersion = 1
	oldStage.LastAppliedLedgerCursor = 20
	oldPrivate := persistedConversationContext{
		ClientTurnID:       acceptedInput.ClientTurnID,
		RequestFingerprint: submissionRequestFingerprint(acceptedInput, acceptedTarget, true),
		Stage:              oldStage,
		SettlementState:    conversationSettlementAcked,
		AssistantSummary:   "accepted summary",
		InputAttachments:   append([]rxBot.AssetAttachmentRef(nil), acceptedInput.Attachments...),
	}
	raw, err := marshalPersistedProjectionWithContext(
		BotRunProjection{ReportRevision: -1}, &oldPrivate,
	)
	if err != nil {
		t.Fatal(err)
	}
	row := model.QuestionAgentLog{
		Id: 20, DialogueId: dialogueID, UserName: "alice",
		Query: acceptedInput.Query, Answer: "accepted answer",
		ToolName: "ChatAgent", Status: statusSucceeded, Mode: "instant",
		BotProjectionJSON: raw, BotReportRevision: -1,
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	var captured rxBot.ChatCompletionRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Errorf("decode failed refresh request: %v", err)
		}
		http.Error(
			w,
			`{"error":{"code":"invalid_request","message":"rejected","retryable":false}}`,
			http.StatusBadRequest,
		)
	}))
	defer server.Close()
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true,
		TimeoutSeconds: 2,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	newRefs := []rxBot.AssetAttachmentRef{{AssetID: "file_replacement"}}
	_, err = NewService().Query(context.Background(), "alice", QueryInput{
		Query: "replacement fails", RefreshId: 20, Mode: "instant",
		ClientTurnID: "refresh-failure-20",
		Attachments:  newRefs,
	})
	if err == nil {
		t.Fatal("refresh failure was accepted")
	}
	if !reflect.DeepEqual(captured.Attachments, newRefs) || captured.OwnerSubject != "alice" {
		t.Fatalf("failed refresh sent attachments=%#v owner=%q, want %#v/alice", captured.Attachments, captured.OwnerSubject, newRefs)
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
		stored.Status != statusSucceeded || private.Replacement == nil ||
		private.Replacement.TerminalResult == nil ||
		private.Replacement.TerminalResult.Status != "FAILED" ||
		private.SettlementState != conversationSettlementAcked ||
		private.Stage == nil || len(private.InputAttachments) != 1 || private.InputAttachments[0].AssetID != "file_accepted" ||
		private.Stage.ProposedBusinessContextVersion != 1 {
		t.Fatalf("failed refresh changed accepted state: row=%#v private=%#v", stored, private)
	}
}

func TestV1AllocationReplaceAcceptsFailedRow(t *testing.T) {
	gdb := setupExpertTestDB(t)
	dialogueID := "55555555-5555-4555-8555-555555555555"
	service := NewService()
	appendSubmission, err := service.allocateV1Submission(
		context.Background(),
		"alice",
		QueryInput{
			Query: "failed answer", Mode: "instant", ClientTurnID: "failed-append-1",
		},
		v1SubmissionTarget{
			dialogueID: dialogueID,
			mode:       "instant",
			operation:  "append",
		},
		AgentPermissionResolution{AllowedTools: []string{"ChatAgent"}},
		false,
	)
	if err != nil {
		t.Fatalf("allocate append: %v", err)
	}
	if err := gdb.Model(&model.QuestionAgentLog{}).
		Where("id = ?", appendSubmission.row.Id).
		Update("status", "FAILED").Error; err != nil {
		t.Fatalf("mark append FAILED: %v", err)
	}

	replaceSubmission, err := service.allocateV1Submission(
		context.Background(),
		"alice",
		QueryInput{
			Query: "retry failed answer", Mode: "instant",
			ClientTurnID: "failed-replace-1",
			RefreshId:    appendSubmission.row.Id,
		},
		v1SubmissionTarget{
			dialogueID: dialogueID,
			mode:       "instant",
			operation:  "replace",
		},
		AgentPermissionResolution{AllowedTools: []string{"ChatAgent"}},
		false,
	)
	if err != nil {
		t.Fatalf("allocate replacement on FAILED row: %v", err)
	}
	if replaceSubmission.row.Id != appendSubmission.row.Id {
		t.Fatalf("replacement id = %d, want %d", replaceSubmission.row.Id, appendSubmission.row.Id)
	}
}

func TestQueryReplacementPostDispatchDefiniteFailureIsIdempotent(t *testing.T) {
	for _, tc := range []struct {
		name       string
		statusCode int
		body       string
	}{
		{
			name:       "Bot 4xx",
			statusCode: http.StatusBadRequest,
			body:       `{"error":{"code":"invalid_request","message":"private upstream detail","retryable":false}}`,
		},
		{
			name:       "malformed 2xx",
			statusCode: http.StatusOK,
			body:       `{"id":"run-malformed-replacement","agent":`,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			seed := seedResearchReplacementTarget(t, gdb)
			botCalls := 0
			v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/v1/agents/research/runs" {
					http.NotFound(w, r)
					return
				}
				botCalls++
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.statusCode)
				_, _ = w.Write([]byte(tc.body))
			})
			service := &Service{catalogReader: staticResearchCatalogReader{response: validResearchCapabilityCatalog()}}
			input := QueryInput{
				Query: "replacement with deterministic dispatch failure", Mode: "expert",
				Tool:         "InSilicoResearchAgent",
				ClientTurnID: "deterministic-replacement-" + strings.ReplaceAll(tc.name, " ", "-"),
				RefreshId:    seed.Id, Surface: QuerySurfaceChat,
			}

			if out, err := service.Query(context.Background(), "alice", input); out != nil || err == nil {
				t.Fatalf("first deterministic failure=%+v error=%v", out, err)
			}
			var stored model.QuestionAgentLog
			if err := gdb.First(&stored, seed.Id).Error; err != nil {
				t.Fatal(err)
			}
			private, err := LoadBotConversationContext(context.Background(), "alice", seed.Id)
			if err != nil {
				t.Fatal(err)
			}
			if stored.Query != seed.Query || stored.Answer != seed.Answer || stored.Status != seed.Status ||
				stored.BotRunId != seed.BotRunId || private.Replacement == nil ||
				private.Replacement.ClientTurnID != input.ClientTurnID ||
				private.Replacement.TerminalResult == nil ||
				private.Replacement.TerminalResult.Status != "FAILED" ||
				private.Replacement.TerminalResult.Answer != "" {
				t.Fatalf("deterministic failure lost idempotency or changed public state: public=%+v private=%+v", stored, private)
			}
			retry, err := service.Query(context.Background(), "alice", input)
			if err != nil || retry == nil || retry.Id != seed.Id || retry.Status != "FAILED" {
				t.Fatalf("deterministic failure retry=%+v error=%v", retry, err)
			}
			if botCalls != 1 {
				t.Fatalf("Bot calls=%d, want one", botCalls)
			}
		})
	}
}

func TestQueryDirectAgentResponseRejectsMissingOrMismatchedAgent(t *testing.T) {
	for _, tc := range []struct {
		name   string
		agent  string
		status string
	}{
		{name: "running mismatch", agent: "analyst", status: "running"},
		{name: "succeeded mismatch", agent: "analyst", status: "succeeded"},
		{name: "missing agent", agent: "", status: "running"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			seed := seedResearchReplacementTarget(t, gdb)
			botCalls := 0
			v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/v1/agents/research/runs" {
					http.NotFound(w, r)
					return
				}
				botCalls++
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(
					`{"id":"run-direct-agent-identity","object":"agent.run","agent":"` + tc.agent +
						`","status":"` + tc.status +
						`","task_ids":[],"result":{"formatted":{"answer":"must not persist"}}}`,
				))
			})
			service := &Service{catalogReader: staticResearchCatalogReader{response: validResearchCapabilityCatalog()}}
			input := QueryInput{
				Query: "strict direct agent identity", Mode: "expert",
				Tool:         "InSilicoResearchAgent",
				ClientTurnID: "direct-agent-" + strings.ReplaceAll(tc.name, " ", "-"),
				RefreshId:    seed.Id, Surface: QuerySurfaceChat,
			}

			if out, err := service.Query(context.Background(), "alice", input); out != nil || err == nil {
				t.Fatalf("direct identity mismatch=%+v error=%v", out, err)
			}
			var stored model.QuestionAgentLog
			if err := gdb.First(&stored, seed.Id).Error; err != nil {
				t.Fatal(err)
			}
			private, err := LoadBotConversationContext(context.Background(), "alice", seed.Id)
			if err != nil {
				t.Fatal(err)
			}
			if stored.Query != seed.Query || stored.Answer != seed.Answer ||
				stored.Status != seed.Status || stored.BotRunId != seed.BotRunId ||
				private.Replacement == nil || private.Replacement.TerminalResult == nil ||
				private.Replacement.TerminalResult.Status != "FAILED" ||
				private.Replacement.TerminalResult.Answer != "" {
				t.Fatalf("direct identity failure changed public or lost terminal key: row=%+v private=%+v", stored, private)
			}
			retry, err := service.Query(context.Background(), "alice", input)
			if err != nil || retry == nil || retry.Status != "FAILED" ||
				retry.ToolName != "InSilicoResearchAgent" || botCalls != 1 {
				t.Fatalf("direct identity retry=%+v error=%v calls=%d", retry, err, botCalls)
			}
		})
	}
}

func TestQueryDirectAgentResponseAcceptsCanonicalAgent(t *testing.T) {
	gdb := setupExpertTestDB(t)
	seed := seedResearchReplacementTarget(t, gdb)
	botCalls := 0
	v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/agents/research/runs" {
			http.NotFound(w, r)
			return
		}
		botCalls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"run-direct-agent-match","object":"agent.run","agent":"research","status":"running","task_ids":[],"result":{}}`))
	})
	service := &Service{catalogReader: staticResearchCatalogReader{response: validResearchCapabilityCatalog()}}
	input := QueryInput{
		Query: "matching direct Research response", Mode: "expert",
		Tool: "InSilicoResearchAgent", ClientTurnID: "direct-agent-match",
		RefreshId: seed.Id, Surface: QuerySurfaceChat,
	}

	out, err := service.Query(context.Background(), "alice", input)
	if err != nil || out == nil || out.Status != "RUNNING" ||
		out.ToolName != "InSilicoResearchAgent" || out.BotRunID != "run-direct-agent-match" ||
		botCalls != 1 {
		t.Fatalf("matching direct response=%+v error=%v calls=%d", out, err, botCalls)
	}
}

func TestConversationContextIntegrationBlockingSettlementRedactsOutput(t *testing.T) {
	useConversationV1(t)
	gdb := setupExpertTestDB(t)
	username := "alice"
	dialogueID := "55555555-5555-4555-8555-555555555555"
	seedV1ConversationRoot(t, gdb, username, dialogueID)
	var chatCalls, settleCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/chat/completions":
			chatCalls++
			var request rxBot.ChatCompletionRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Errorf("decode blocking V1 request: %v", err)
				return
			}
			if request.Conversation == nil || len(request.Conversation.ArtifactRefs) != 1 ||
				request.Conversation.ArtifactRefs[0].ArtifactID != v1ConversationArtifactID {
				t.Errorf("blocking V1 request lost artifact metadata: %#v", request.Conversation)
				return
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
				"id":     "blocking-redaction",
				"object": "chat.completion",
				"status": "succeeded",
				"choices": []map[string]interface{}{{
					"message": map[string]string{
						"role":    "assistant",
						"content": v1ConversationOutputMarker,
					},
				}},
				"formatted": map[string]interface{}{
					"answer": v1ConversationOutputMarker,
					"tabular": map[string]interface{}{
						"headers": []string{"value"},
						"rows":    [][]string{{v1ConversationOutputMarker}},
					},
				},
				"conversation_context": stage,
			})
		case "/v1/conversation-context/settle":
			settleCalls++
			var request rxBot.ContextSettlementRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Errorf("decode blocking V1 settlement: %v", err)
				return
			}
			var row model.QuestionAgentLog
			if err := gdb.Where("id = ?", request.TurnID).First(&row).Error; err != nil {
				t.Errorf("load blocking row before acknowledgment: %v", err)
				return
			}
			private, err := LoadBotConversationContext(context.Background(), username, row.Id)
			if err != nil {
				t.Errorf("load blocking context before acknowledgment: %v", err)
				return
			}
			if row.Answer != v1ConversationOutputMarker || private.AssistantSummary != "" ||
				private.Stage == nil || len(private.ArtifactRefs) != 1 {
				t.Errorf("blocking settlement retained unsafe context: row=%#v private=%#v", row, private)
			}
			_ = json.NewEncoder(w).Encode(rxBot.ContextMutationResponse{
				SchemaVersion: 1, State: "committed", ContextVersion: 2,
			})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true, TimeoutSeconds: 2,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	out, err := NewService().Query(context.Background(), username, QueryInput{
		Query:        "Continue with the focus entity.",
		Id:           1,
		Mode:         "instant",
		ClientTurnID: "blocking-redaction-2",
		ArtifactIDs:  []string{v1ConversationArtifactID},
	})
	if err != nil || out == nil || out.Status != statusSucceeded || out.Answer != v1ConversationOutputMarker {
		t.Fatalf("blocking V1 result=%#v error=%v", out, err)
	}
	if chatCalls != 1 || settleCalls != 1 {
		t.Fatalf("blocking V1 calls chat=%d settle=%d, want 1/1", chatCalls, settleCalls)
	}
	assertV1ContextDoesNotReplayOutput(t, username, out.Id, v1ConversationOutputMarker)
}
