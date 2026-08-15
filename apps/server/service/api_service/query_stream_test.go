package api_service

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"gorm.io/gorm"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
	"phytomni-server/utils"
)

// sseChatServer stubs the Bot with a fixed AG-UI SSE stream (RunStarted + two
// content deltas + RunFinished) on every request.
func sseChatServer(t *testing.T) {
	t.Helper()
	body := strings.Join([]string{
		"event: RunStarted\ndata: {\"type\":\"RunStarted\",\"run_id\":\"run_77\",\"dialogue_id\":\"d1\"}\n",
		"event: TextMessageContent\ndata: {\"type\":\"TextMessageContent\",\"delta\":\"hello \"}\n",
		"event: TextMessageContent\ndata: {\"type\":\"TextMessageContent\",\"delta\":\"world\"}\n",
		"event: RunFinished\ndata: {\"type\":\"RunFinished\",\"run_id\":\"run_77\"}\n",
	}, "\n")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, StreamEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })
}

func streamCapableService() *Service {
	return &Service{
		catalogReader: staticResearchCatalogReader{
			response: &rxBot.AgentsListResponse{
				Object: "list",
				Data: []rxBot.AgentDescriptor{
					{Slug: "chat", Tool: "ChatAgent", Capabilities: rxBot.AgentDescriptorCapabilities{Streaming: true}},
					{Slug: "knowledge", Tool: "KnowledgeAgent", Capabilities: rxBot.AgentDescriptorCapabilities{Streaming: true}},
					{Slug: "brief_gene", Tool: "BriefGeneAgent", Capabilities: rxBot.AgentDescriptorCapabilities{Streaming: true}},
				},
			},
		},
	}
}

// DB setup reuses setupExpertTestDB (query_expert_test.go, same package): its
// hand-written DDL INCLUDES the mode column. The older shared setupTestDB
// (agent_task_test.go) predates the column — using it would fail the INSERT
// with "no such column: mode" once QueryStream persists Mode.

// setupStreamTestDB extends the expert fixture with the additive Bot
// projection columns. Keeping the DDL hand-written avoids AutoMigrate on the
// enum-tagged model while making every column selected by QueryStream present.
func setupStreamTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb := setupExpertTestDB(t)
	return gdb
}

func v1ContextStream(stage rxBot.ContextStageMetadata, answer string) string {
	encoded, _ := json.Marshal(stage)
	return strings.Join([]string{
		`event: RunStarted` + "\n" +
			`data: {"type":"RunStarted","run_id":"run-context"}` + "\n",
		`event: TextMessageContent` + "\n" +
			`data: {"type":"TextMessageContent","delta":` +
			strconv.Quote(answer) + "}" + "\n",
		`event: Custom` + "\n" +
			`data: {"type":"Custom","name":"phyto.context_staged","value":` +
			string(encoded) + "}" + "\n",
		`event: RunFinished` + "\n" +
			`data: {"type":"RunFinished","run_id":"run-context"}` + "\n",
	}, "\n")
}

func assertValidAGUIReplay(t *testing.T, raw string) []string {
	t.Helper()
	scanner := bufio.NewScanner(strings.NewReader(raw))
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	scanner.Split(splitSSEFrames)
	var eventTypes []string
	for scanner.Scan() {
		event, ok := rxBot.ParseAGUIFrame(scanner.Bytes())
		if !ok {
			t.Fatalf("invalid replay frame: %q", scanner.Bytes())
		}
		eventTypes = append(eventTypes, event.Type)
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scan replay frames: %v", err)
	}
	return eventTypes
}

func contextStageForStream(request rxBot.ChatCompletionRequest) rxBot.ContextStageMetadata {
	envelope := request.Conversation
	return rxBot.ContextStageMetadata{
		SchemaVersion:                  1,
		TurnID:                         envelope.TurnID,
		SelectedAgentID:                "ChatAgent",
		RouteSource:                    "instant_lock",
		RouteReasonCode:                "INSTANT_LOCK",
		BaseBusinessContextVersion:     envelope.BaseBusinessContextVersion,
		ProposedBusinessContextVersion: envelope.BaseBusinessContextVersion + 1,
		LastAppliedLedgerCursor:        envelope.LedgerCursor,
	}
}

func TestQueryStreamContextSettlementPersistsBeforeAcknowledgment(t *testing.T) {
	gdb := setupStreamTestDB(t)
	var chatCalls, settleCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/chat/completions":
			chatCalls++
			var request rxBot.ChatCompletionRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Errorf("decode stream request: %v", err)
				return
			}
			if request.Conversation == nil {
				t.Error("missing V1 conversation envelope")
				return
			}
			if len(request.Messages) != 1 ||
				request.Messages[0].Content != "current stream question" {
				t.Errorf("stream messages = %#v, want current Go-owned message", request.Messages)
			}
			var status string
			if err := gdb.Raw(
				`SELECT COALESCE(status,'') FROM question_agent_logs WHERE id=?`,
				request.Conversation.TurnID,
			).Scan(&status).Error; err != nil {
				t.Errorf("read allocated row: %v", err)
			}
			if status != "SUBMITTING" {
				t.Errorf("row status before stream = %q, want SUBMITTING", status)
			}
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = w.Write([]byte(v1ContextStream(
				contextStageForStream(request),
				"settled stream answer",
			)))
		case "/v1/conversation-context/settle":
			settleCalls++
			var request rxBot.ContextSettlementRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Errorf("decode settlement: %v", err)
				return
			}
			var row model.QuestionAgentLog
			if err := gdb.First(&row, request.TurnID).Error; err != nil {
				t.Errorf("load row before acknowledgment: %v", err)
				return
			}
			if row.Status != "SUCCEEDED" ||
				row.Answer != "settled stream answer" {
				t.Errorf("visible row before acknowledgment = %#v", row)
			}
			private, err := LoadBotConversationContext(
				context.Background(),
				"stream-context@example.com",
				row.Id,
			)
			if err != nil {
				t.Errorf("load private context before acknowledgment: %v", err)
				return
			}
			if private.SettlementState != conversationSettlementAckPending ||
				private.SettlementLedgerHash != request.LedgerVersion {
				t.Errorf("private context before acknowledgment = %#v", private)
			}
			_ = json.NewEncoder(w).Encode(rxBot.ContextMutationResponse{
				SchemaVersion:  1,
				State:          "committed",
				ContextVersion: 1,
			})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true, StreamEnabled: true,
		MultiturnV1Enabled: true, TimeoutSeconds: 2,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })
	if err := gdb.Exec(
		`INSERT INTO users (email, code) VALUES (?, 'admin')`,
		"stream-context@example.com",
	).Error; err != nil {
		t.Fatal(err)
	}

	var forwarded strings.Builder
	out, err := streamCapableService().QueryStream(
		context.Background(),
		"stream-context@example.com",
		QueryInput{
			Query:        "current stream question",
			History:      `[{"role":"user","content":"browser poison"}]`,
			Mode:         "instant",
			ClientTurnID: "stream-context-1",
		},
		nil,
		func(frame []byte) error {
			_, _ = forwarded.Write(frame)
			return nil
		},
	)
	if err != nil {
		t.Fatalf("QueryStream: %v", err)
	}
	if out.Status != "SUCCEEDED" || out.Answer != "settled stream answer" {
		t.Fatalf("stream result = %#v", out)
	}
	if !strings.Contains(forwarded.String(), `"name":"phyto.context_staged"`) {
		t.Fatalf("typed context frame was not forwarded unchanged: %q", forwarded.String())
	}
	private, err := LoadBotConversationContext(
		context.Background(),
		"stream-context@example.com",
		out.Id,
	)
	if err != nil {
		t.Fatal(err)
	}
	if private.SettlementState != conversationSettlementAcked ||
		private.AssistantSummary != "" {
		t.Fatalf("settled private context = %#v", private)
	}
	if chatCalls != 1 || settleCalls != 1 {
		t.Fatalf("calls chat=%d settle=%d, want 1/1", chatCalls, settleCalls)
	}
}

func TestQueryStreamSettlementAckFailureLeavesVisibleSuccess(t *testing.T) {
	gdb := setupStreamTestDB(t)
	var settleCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/chat/completions":
			var request rxBot.ChatCompletionRequest
			_ = json.NewDecoder(r.Body).Decode(&request)
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = w.Write([]byte(v1ContextStream(
				contextStageForStream(request),
				"visible despite ack failure",
			)))
		case "/v1/conversation-context/settle":
			settleCalls++
			http.Error(w, `{"error":{"code":"temporary","message":"retry"}}`,
				http.StatusServiceUnavailable)
		}
	}))
	t.Cleanup(server.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true, StreamEnabled: true,
		MultiturnV1Enabled: true, TimeoutSeconds: 2,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })
	if err := gdb.Exec(
		`INSERT INTO users (email, code) VALUES (?, 'admin')`,
		"stream-ack@example.com",
	).Error; err != nil {
		t.Fatal(err)
	}

	out, err := streamCapableService().QueryStream(
		context.Background(),
		"stream-ack@example.com",
		QueryInput{
			Query: "ack failure", Mode: "instant",
			ClientTurnID: "stream-ack-1",
		},
		nil,
		nil,
	)
	if err != nil || out == nil || out.Status != "SUCCEEDED" {
		t.Fatalf("result=%#v err=%v", out, err)
	}
	status, answer := readStatusAnswer(t, gdb, out.Id)
	if status != "SUCCEEDED" || answer != "visible despite ack failure" {
		t.Fatalf("persisted visible row = %q/%q", status, answer)
	}
	private, err := LoadBotConversationContext(
		context.Background(),
		"stream-ack@example.com",
		out.Id,
	)
	if err != nil {
		t.Fatal(err)
	}
	if private.SettlementState != conversationSettlementAckPending ||
		settleCalls != 1 {
		t.Fatalf("private=%#v settleCalls=%d", private, settleCalls)
	}
}

func TestQueryStreamContextDegradedForcesRebuildWithoutAck(t *testing.T) {
	gdb := setupStreamTestDB(t)
	var settleCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/chat/completions":
			var request rxBot.ChatCompletionRequest
			_ = json.NewDecoder(r.Body).Decode(&request)
			stage := contextStageForStream(request)
			stage.ContextDegraded = true
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = w.Write([]byte(v1ContextStream(stage, "degraded stream answer")))
		case "/v1/conversation-context/settle":
			settleCalls++
			http.Error(w, "unexpected", http.StatusInternalServerError)
		}
	}))
	t.Cleanup(server.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true, StreamEnabled: true,
		MultiturnV1Enabled: true, TimeoutSeconds: 2,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })
	if err := gdb.Exec(
		`INSERT INTO users (email, code) VALUES (?, 'admin')`,
		"stream-degraded@example.com",
	).Error; err != nil {
		t.Fatal(err)
	}

	out, err := streamCapableService().QueryStream(
		context.Background(),
		"stream-degraded@example.com",
		QueryInput{
			Query: "degraded", Mode: "instant",
			ClientTurnID: "stream-degraded-1",
		},
		nil,
		nil,
	)
	if err != nil || out == nil || out.Answer != "degraded stream answer" {
		t.Fatalf("result=%#v err=%v", out, err)
	}
	private, err := LoadBotConversationContext(
		context.Background(),
		"stream-degraded@example.com",
		out.Id,
	)
	if err != nil {
		t.Fatal(err)
	}
	if settleCalls != 0 ||
		private.SettlementState != conversationSettlementRebuildRequired ||
		private.Stage == nil || !private.Stage.ContextDegraded {
		t.Fatalf("settles=%d private=%#v", settleCalls, private)
	}
}

func TestQueryStreamContextFailuresNeverCommitAssistantSummary(t *testing.T) {
	tests := []struct {
		name       string
		streamBody func(rxBot.ChatCompletionRequest) string
		wantErr    bool
		wantStatus string
	}{
		{
			name: "missing context event",
			streamBody: func(rxBot.ChatCompletionRequest) string {
				return strings.Join([]string{
					`event: RunStarted` + "\n" +
						`data: {"type":"RunStarted","run_id":"run-missing"}` + "\n",
					`event: TextMessageContent` + "\n" +
						`data: {"type":"TextMessageContent","delta":"must not commit"}` + "\n",
					`event: RunFinished` + "\n" +
						`data: {"type":"RunFinished","run_id":"run-missing"}` + "\n",
				}, "\n")
			},
			wantErr:    true,
			wantStatus: "FAILED",
		},
		{
			name: "RunError",
			streamBody: func(request rxBot.ChatCompletionRequest) string {
				return strings.Join([]string{
					`event: RunStarted` + "\n" +
						`data: {"type":"RunStarted","run_id":"run-error"}` + "\n",
					`event: TextMessageContent` + "\n" +
						`data: {"type":"TextMessageContent","delta":"partial"}` + "\n",
					`event: RunError` + "\n" +
						`data: {"type":"RunError","code":"failed","message":"nope"}` + "\n",
				}, "\n")
			},
			wantStatus: "FAILED",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gdb := setupStreamTestDB(t)
			email := "stream-failure-" + strings.ReplaceAll(test.name, " ", "-") +
				"@example.com"
			if err := gdb.Exec(
				`INSERT INTO users (email, code) VALUES (?, 'admin')`,
				email,
			).Error; err != nil {
				t.Fatal(err)
			}
			server := httptest.NewServer(http.HandlerFunc(
				func(w http.ResponseWriter, r *http.Request) {
					var request rxBot.ChatCompletionRequest
					_ = json.NewDecoder(r.Body).Decode(&request)
					w.Header().Set("Content-Type", "text/event-stream")
					_, _ = w.Write([]byte(test.streamBody(request)))
				},
			))
			t.Cleanup(server.Close)
			previous := rxBot.BotConfig
			rxBot.BotConfig = &rxBot.Config{
				BaseURL: server.URL, ProxyEnabled: true, StreamEnabled: true,
				MultiturnV1Enabled: true, TimeoutSeconds: 2,
			}
			t.Cleanup(func() { rxBot.BotConfig = previous })

			out, err := streamCapableService().QueryStream(
				context.Background(),
				email,
				QueryInput{
					Query: "failure", Mode: "instant",
					ClientTurnID: "stream-failure-" +
						strings.ReplaceAll(test.name, " ", "-"),
				},
				nil,
				nil,
			)
			if test.wantErr != (err != nil) {
				t.Fatalf("error=%v wantErr=%v", err, test.wantErr)
			}
			var row model.QuestionAgentLog
			if err := gdb.First(&row).Error; err != nil {
				t.Fatal(err)
			}
			if row.Status != test.wantStatus || row.Answer != "" {
				t.Fatalf("failed row status/answer = %q/%q", row.Status, row.Answer)
			}
			if out != nil && out.Answer != "" {
				t.Fatalf("failed output exposed committed answer: %#v", out)
			}
		})
	}
}

func TestQueryStreamContextCancellationRetainsSubmittingWithoutSummary(t *testing.T) {
	gdb := setupStreamTestDB(t)
	email := "stream-cancel-v1@example.com"
	if err := gdb.Exec(
		`INSERT INTO users (email, code) VALUES (?, 'admin')`,
		email,
	).Error; err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(
			`event: RunStarted` + "\n" +
				`data: {"type":"RunStarted","run_id":"run-cancel-v1"}` +
				"\n\n" +
				`event: TextMessageContent` + "\n" +
				`data: {"type":"TextMessageContent","delta":"partial secret"}` +
				"\n\n",
		))
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		<-r.Context().Done()
	}))
	t.Cleanup(server.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true, StreamEnabled: true,
		MultiturnV1Enabled: true, TimeoutSeconds: 2,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	out, err := streamCapableService().QueryStream(
		ctx,
		email,
		QueryInput{
			Query: "cancel", Mode: "instant",
			ClientTurnID: "stream-cancel-v1",
		},
		nil,
		func(frame []byte) error {
			if strings.Contains(string(frame), "TextMessageContent") {
				cancel()
				return context.Canceled
			}
			return nil
		},
	)
	if err == nil {
		t.Fatal("canceled V1 stream must return its transport error")
	}
	if out == nil || out.Status != "SUBMITTING" || out.Answer != "" {
		t.Fatalf("canceled result = %#v, want empty SUBMITTING row", out)
	}
	var row model.QuestionAgentLog
	if err := gdb.First(&row, out.Id).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != "SUBMITTING" || row.Answer != "" {
		t.Fatalf("canceled row status/answer = %q/%q", row.Status, row.Answer)
	}
	private, err := LoadBotConversationContext(context.Background(), email, out.Id)
	if err != nil {
		t.Fatal(err)
	}
	if private.AssistantSummary != "" || private.Stage != nil {
		t.Fatalf("canceled private context committed summary: %#v", private)
	}
}

func TestQueryStreamSubmittingPreFirstByteFailureCertainty(t *testing.T) {
	tests := []struct {
		name       string
		handler    http.HandlerFunc
		closeFirst bool
		wantStatus string
	}{
		{
			name: "definite rejection",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w,
					`{"error":{"code":"invalid_request","message":"bad stream"}}`,
					http.StatusBadRequest,
				)
			},
			wantStatus: "FAILED",
		},
		{
			name:       "uncertain transport",
			handler:    func(http.ResponseWriter, *http.Request) {},
			closeFirst: true,
			wantStatus: "SUBMITTING",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gdb := setupStreamTestDB(t)
			email := fmt.Sprintf("prefirst-%s@example.com",
				strings.ReplaceAll(test.name, " ", "-"))
			if err := gdb.Exec(
				`INSERT INTO users (email, code) VALUES (?, 'admin')`,
				email,
			).Error; err != nil {
				t.Fatal(err)
			}
			server := httptest.NewServer(test.handler)
			if test.closeFirst {
				server.Close()
			} else {
				t.Cleanup(server.Close)
			}
			previous := rxBot.BotConfig
			rxBot.BotConfig = &rxBot.Config{
				BaseURL: server.URL, ProxyEnabled: true, StreamEnabled: true,
				MultiturnV1Enabled: true, TimeoutSeconds: 2,
			}
			t.Cleanup(func() { rxBot.BotConfig = previous })

			_, err := streamCapableService().QueryStream(
				context.Background(),
				email,
				QueryInput{
					Query: "prefirst", Mode: "instant",
					ClientTurnID: "prefirst-" +
						strings.ReplaceAll(test.name, " ", "-"),
				},
				nil,
				nil,
			)
			if err == nil {
				t.Fatal("expected pre-first-byte failure")
			}
			var status string
			if err := gdb.Raw(
				`SELECT COALESCE(status,'') FROM question_agent_logs LIMIT 1`,
			).Scan(&status).Error; err != nil {
				t.Fatal(err)
			}
			if status != test.wantStatus {
				t.Fatalf("status=%q, want %q", status, test.wantStatus)
			}
		})
	}
}

func TestQueryStream_PersistsAndForwards(t *testing.T) {
	gdb := setupStreamTestDB(t)
	sseChatServer(t)
	svc := streamCapableService()

	var forwarded strings.Builder
	forward := func(frame []byte) error {
		forwarded.Write(frame)
		return nil
	}
	out, err := svc.QueryStream(context.Background(), "alice@example.com",
		QueryInput{Query: "hi", Id: 0, Tool: "", Mode: "instant"}, nil, forward)
	if err != nil {
		t.Fatalf("QueryStream error: %v", err)
	}
	// Tee: forwarded bytes include the content deltas.
	if !strings.Contains(forwarded.String(), "TextMessageContent") {
		t.Fatalf("forward did not receive content frames; got %q", forwarded.String())
	}
	// Accumulated answer persisted.
	status, answer := readStatusAnswer(t, gdb, out.Id)
	if answer != "hello world" {
		t.Fatalf("persisted answer = %q, want %q", answer, "hello world")
	}
	if status != "SUCCEEDED" {
		t.Fatalf("persisted status = %q, want SUCCEEDED", status)
	}
	// Persistence equivalence includes the mode column: the blocking path
	// writes Mode: in.Mode (query.go:271); a streamed row must not silently
	// fall to the DB default.
	var mode string
	if err := gdb.Raw(`SELECT COALESCE(mode,'') FROM question_agent_logs WHERE id=?`, out.Id).Scan(&mode).Error; err != nil {
		t.Fatalf("read mode: %v", err)
	}
	if mode != "instant" {
		t.Fatalf("persisted mode = %q, want instant", mode)
	}
	var count int64
	if err := gdb.Model(&model.QuestionAgentLog{}).Count(&count).Error; err != nil {
		t.Fatalf("count stream rows: %v", err)
	}
	if count != 1 {
		t.Fatalf("stream must finalize its RUNNING row in place; rows = %d, want 1", count)
	}
}

func TestQueryStream_SettledKeyedV0RetryReplaysTerminalSnapshot(t *testing.T) {
	setupStreamTestDB(t)
	const streamBody = "event: RunStarted\ndata: {\"type\":\"RunStarted\",\"run_id\":\"run-keyed-replay\"}\n\n" +
		"event: TextMessageContent\ndata: {\"type\":\"TextMessageContent\",\"delta\":\"settled answer\"}\n\n" +
		"event: Custom\ndata: {\"type\":\"Custom\",\"name\":\"phyto.follow_up\",\"value\":[\"next question\"]}\n\n" +
		"event: RunFinished\ndata: {\"type\":\"RunFinished\",\"run_id\":\"run-keyed-replay\"}\n\n"
	var botCalls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		botCalls.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(streamBody))
	}))
	t.Cleanup(server.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true, StreamEnabled: true,
		MultiturnV1Enabled: false, TimeoutSeconds: 2,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })
	input := QueryInput{
		Query: "keyed stream replay", Mode: "instant",
		ClientTurnID: "keyed-stream-replay", Surface: QuerySurfaceChat,
	}
	service := streamCapableService()
	first, err := service.QueryStream(context.Background(), "alice", input, nil, nil)
	if err != nil {
		t.Fatalf("initial QueryStream: %v", err)
	}
	var identity StreamIdentity
	var forwarded strings.Builder
	retry, err := service.QueryStream(
		context.Background(),
		"alice",
		input,
		func(value StreamIdentity) { identity = value },
		func(frame []byte) error {
			_, _ = forwarded.Write(frame)
			return nil
		},
	)
	if err != nil {
		t.Fatalf("settled retry: %v", err)
	}
	if retry == nil || retry.Id != first.Id || identity.MessageID != first.Id || identity.DialogueID != first.DialogueId {
		t.Fatalf("settled retry=%+v identity=%+v, want row %d/%s", retry, identity, first.Id, first.DialogueId)
	}
	frames := forwarded.String()
	eventTypes := assertValidAGUIReplay(t, frames)
	for _, required := range []string{"event: RunStarted", "event: TextMessageContent", `"settled answer"`, `"phyto.follow_up"`, "event: RunFinished"} {
		if !strings.Contains(frames, required) {
			t.Fatalf("replayed frames %q do not contain %q", frames, required)
		}
	}
	if len(eventTypes) == 0 || eventTypes[len(eventTypes)-1] != "RunFinished" {
		t.Fatalf("replayed event types=%v, want terminal RunFinished", eventTypes)
	}
	if botCalls.Load() != 1 {
		t.Fatalf("Bot calls=%d, want 1", botCalls.Load())
	}
}

func TestQueryStream_SettledRetryReplaysLargeStructuredAnswerByteExactly(t *testing.T) {
	gdb := setupStreamTestDB(t)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		ProxyEnabled: true, StreamEnabled: true,
		MultiturnV1Enabled: false, TimeoutSeconds: 2,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })
	answer := `{"payload":"` + strings.Repeat("界", 100000) + `","kind":"structured"}`
	input := QueryInput{
		Query: "large settled replay", Mode: "instant",
		ClientTurnID: "large-settled-replay", Surface: QuerySurfaceChat,
	}
	target := v1SubmissionTarget{
		dialogueID: "64646464-6464-4646-8646-646464646464",
		mode:       "instant",
		operation:  "append",
	}
	raw, err := marshalPersistedProjectionWithContext(
		BotRunProjection{
			RunID: "run-large-settled-replay", Status: statusSucceeded,
			ReportRevision: -1,
		},
		&persistedConversationContext{
			ClientTurnID:       input.ClientTurnID,
			RequestFingerprint: submissionRequestFingerprint(input, target, false),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	row := model.QuestionAgentLog{
		DialogueId: target.dialogueID, UserName: "alice",
		Query: input.Query, Answer: answer, ToolName: "ChatAgent", Mode: "instant",
		Status: statusSucceeded, BotRunId: "run-large-settled-replay",
		BotProjectionJSON: raw, BotReportRevision: -1,
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	var forwarded strings.Builder
	out, err := streamCapableService().QueryStream(
		context.Background(), "alice", input, nil,
		func(frame []byte) error {
			_, _ = forwarded.Write(frame)
			return nil
		},
	)
	if err != nil || out == nil || out.Id != row.Id {
		t.Fatalf("large settled retry=%+v error=%v", out, err)
	}
	scanner := bufio.NewScanner(strings.NewReader(forwarded.String()))
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	scanner.Split(splitSSEFrames)
	acc := rxBot.NewAGUIAccumulator("")
	contentFrames := 0
	var eventTypes []string
	for scanner.Scan() {
		event, ok := rxBot.ParseAGUIFrame(scanner.Bytes())
		if !ok {
			t.Fatalf("invalid large replay frame: %q", scanner.Bytes())
		}
		if event.Type == "TextMessageContent" {
			contentFrames++
		}
		eventTypes = append(eventTypes, event.Type)
		acc.Observe(event)
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scan large replay: %v", err)
	}
	if contentFrames < 2 {
		t.Fatalf("large replay content frames=%d, want bounded multi-frame replay", contentFrames)
	}
	if acc.AnswerText() != answer {
		t.Fatalf("large replay bytes=%d, want exact %d-byte structured answer", len(acc.AnswerText()), len(answer))
	}
	if len(eventTypes) == 0 || eventTypes[len(eventTypes)-1] != "RunFinished" {
		t.Fatalf("large replay event sequence=%v, want terminal RunFinished", eventTypes)
	}
}

func TestQueryStream_NonterminalKeyedV0RetryIsPendingBeforeReady(t *testing.T) {
	gdb := setupStreamTestDB(t)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: "http://127.0.0.1:1", ProxyEnabled: true, StreamEnabled: true,
		MultiturnV1Enabled: false, TimeoutSeconds: 1,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })
	private := persistedConversationContext{ClientTurnID: "keyed-stream-pending"}
	raw, err := marshalPersistedProjectionWithContext(BotRunProjection{ReportRevision: -1}, &private)
	if err != nil {
		t.Fatal(err)
	}
	row := model.QuestionAgentLog{
		DialogueId: "78787878-7878-4787-8787-787878787878", UserName: "alice",
		Query: "pending stream", ToolName: "ChatAgent", Mode: "instant",
		Status: "RUNNING", BotProjectionJSON: raw, BotReportRevision: -1,
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	ready := false
	forwarded := false
	out, err := streamCapableService().QueryStream(
		context.Background(),
		"alice",
		QueryInput{
			Query: "pending stream", Mode: "instant",
			ClientTurnID: "keyed-stream-pending", Surface: QuerySurfaceChat,
		},
		func(StreamIdentity) { ready = true },
		func([]byte) error { forwarded = true; return nil },
	)
	if out != nil || !errors.Is(err, ErrClientTurnSubmissionPending) {
		t.Fatalf("pending retry=%+v error=%v, want ErrClientTurnSubmissionPending", out, err)
	}
	if ready || forwarded {
		t.Fatalf("pending retry opened stream: ready=%v forwarded=%v", ready, forwarded)
	}
}

func TestQueryStream_SubmittingKeyedV0RetryPublishesDurableIdentityBeforePending(t *testing.T) {
	gdb := setupStreamTestDB(t)
	var botCalls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		botCalls.Add(1)
	}))
	t.Cleanup(server.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true, StreamEnabled: true,
		MultiturnV1Enabled: false, TimeoutSeconds: 1,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })
	private := persistedConversationContext{ClientTurnID: "keyed-stream-submitting"}
	raw, err := marshalPersistedProjectionWithContext(BotRunProjection{ReportRevision: -1}, &private)
	if err != nil {
		t.Fatal(err)
	}
	row := model.QuestionAgentLog{
		DialogueId: "71717171-7171-4717-8717-717171717171", UserName: "alice",
		Query: "submitting stream", ToolName: "ChatAgent", Mode: "instant",
		Status: "SUBMITTING", BotProjectionJSON: raw, BotReportRevision: -1,
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	var ready StreamIdentity
	forwarded := false
	out, err := streamCapableService().QueryStream(
		context.Background(),
		"alice",
		QueryInput{
			Query: "submitting stream", Mode: "instant",
			ClientTurnID: "keyed-stream-submitting", Surface: QuerySurfaceChat,
		},
		func(identity StreamIdentity) { ready = identity },
		func([]byte) error { forwarded = true; return nil },
	)
	if !errors.Is(err, ErrClientTurnSubmissionPending) || out == nil ||
		out.Id != row.Id || out.DialogueId != row.DialogueId || out.Status != "SUBMITTING" {
		t.Fatalf("submitting retry=%+v error=%v, want pending durable row", out, err)
	}
	if ready.MessageID != row.Id || ready.DialogueID != row.DialogueId {
		t.Fatalf("ready identity=%+v, want row %d/%q", ready, row.Id, row.DialogueId)
	}
	if forwarded || botCalls.Load() != 0 {
		t.Fatalf("submitting retry forwarded=%v Bot calls=%d, want false/0", forwarded, botCalls.Load())
	}
}

func TestQueryStream_FailedKeyedV0RetryReplaysRunError(t *testing.T) {
	gdb := setupStreamTestDB(t)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		ProxyEnabled: true, StreamEnabled: true,
		MultiturnV1Enabled: false, TimeoutSeconds: 1,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })
	private := persistedConversationContext{ClientTurnID: "keyed-stream-failed"}
	raw, err := marshalPersistedProjectionWithContext(
		BotRunProjection{RunID: "run-keyed-failed", Status: "FAILED", ReportRevision: -1},
		&private,
	)
	if err != nil {
		t.Fatal(err)
	}
	row := model.QuestionAgentLog{
		DialogueId: "79797979-7979-4797-8797-797979797979", UserName: "alice",
		Query: "failed stream", Answer: "partial safe answer", ToolName: "ChatAgent",
		Mode: "instant", Status: "FAILED", BotRunId: "run-keyed-failed",
		BotProjectionJSON: raw, BotReportRevision: -1,
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	var forwarded strings.Builder
	out, err := streamCapableService().QueryStream(
		context.Background(),
		"alice",
		QueryInput{
			Query: "failed stream", Mode: "instant",
			ClientTurnID: "keyed-stream-failed", Surface: QuerySurfaceChat,
		},
		nil,
		func(frame []byte) error {
			_, _ = forwarded.Write(frame)
			return nil
		},
	)
	if err != nil || out == nil || out.Id != row.Id || out.Status != "FAILED" {
		t.Fatalf("failed retry=%+v error=%v", out, err)
	}
	frames := forwarded.String()
	eventTypes := assertValidAGUIReplay(t, frames)
	if !strings.Contains(frames, "event: RunError") || strings.Contains(frames, "event: RunFinished") {
		t.Fatalf("failed retry terminal frames=%q", frames)
	}
	if len(eventTypes) == 0 || eventTypes[len(eventTypes)-1] != "RunError" {
		t.Fatalf("failed replay event types=%v, want terminal RunError", eventTypes)
	}
}

func TestQueryStream_KeyedReplacementStagesUntilRunFinished(t *testing.T) {
	for _, tc := range []struct {
		name               string
		terminalEvent      string
		wantStatus         string
		wantPublicPromoted bool
	}{
		{
			name:               "RunFinished promotes candidate",
			terminalEvent:      "event: RunFinished\ndata: {\"type\":\"RunFinished\",\"run_id\":\"run-stream-replacement\"}\n\n",
			wantStatus:         statusSucceeded,
			wantPublicPromoted: true,
		},
		{
			name:          "RunError keeps accepted public result",
			terminalEvent: "event: RunError\ndata: {\"type\":\"RunError\",\"code\":\"replacement_failed\",\"message\":\"safe failure\"}\n\n",
			wantStatus:    "FAILED",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupStreamTestDB(t)
			seed := seedResearchReplacementTarget(t, gdb)
			const replacementAnswer = "streamed replacement answer"
			body := "event: RunStarted\ndata: {\"type\":\"RunStarted\",\"run_id\":\"run-stream-replacement\",\"dialogue_id\":\"" + seed.DialogueId + "\"}\n\n" +
				"event: TextMessageContent\ndata: {\"type\":\"TextMessageContent\",\"delta\":\"" + replacementAnswer + "\"}\n\n" +
				tc.terminalEvent
			var botCalls atomic.Int64
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				botCalls.Add(1)
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = w.Write([]byte(body))
			}))
			t.Cleanup(server.Close)
			previous := rxBot.BotConfig
			rxBot.BotConfig = &rxBot.Config{
				BaseURL: server.URL, ProxyEnabled: true, StreamEnabled: true,
				MultiturnV1Enabled: false, TimeoutSeconds: 2,
			}
			t.Cleanup(func() { rxBot.BotConfig = previous })

			input := QueryInput{
				Query: "replace accepted result through SSE", Mode: "instant",
				ClientTurnID: "keyed-stream-replacement-" + strings.ReplaceAll(tc.name, " ", "-"),
				RefreshId:    seed.Id, Surface: QuerySurfaceChat,
			}
			var (
				identity            StreamIdentity
				firstFramePublic    model.QuestionAgentLog
				firstFramePrivate   *persistedConversationContext
				firstFrameReadError error
			)
			out, err := streamCapableService().QueryStream(
				context.Background(),
				"alice",
				input,
				func(value StreamIdentity) { identity = value },
				func(frame []byte) error {
					if !strings.Contains(string(frame), "event: RunStarted") || firstFramePrivate != nil || firstFrameReadError != nil {
						return nil
					}
					firstFrameReadError = gdb.First(&firstFramePublic, seed.Id).Error
					if firstFrameReadError == nil {
						var private persistedConversationContext
						private, firstFrameReadError = LoadBotConversationContext(
							context.Background(), "alice", seed.Id,
						)
						firstFramePrivate = &private
					}
					return nil
				},
			)
			if err != nil {
				t.Fatalf("keyed replacement QueryStream: %v", err)
			}
			if out == nil || out.Id != seed.Id || out.Status != tc.wantStatus ||
				identity.MessageID != seed.Id || identity.DialogueID != seed.DialogueId {
				t.Fatalf("replacement result=%+v identity=%+v, want row %d status %s", out, identity, seed.Id, tc.wantStatus)
			}
			if firstFrameReadError != nil {
				t.Fatalf("read first-frame replacement state: %v", firstFrameReadError)
			}
			if firstFramePrivate == nil || firstFramePrivate.Replacement == nil ||
				firstFramePrivate.Replacement.ClientTurnID != input.ClientTurnID ||
				firstFramePrivate.Replacement.ActiveStatus != "RUNNING" ||
				firstFramePrivate.Replacement.ActiveBotRunID != "run-stream-replacement" {
				t.Fatalf("first-frame private replacement=%+v, want active RUNNING candidate", firstFramePrivate)
			}
			if firstFramePublic.Query != seed.Query || firstFramePublic.Answer != seed.Answer ||
				firstFramePublic.ToolName != seed.ToolName || firstFramePublic.Status != seed.Status ||
				firstFramePublic.BotRunId != seed.BotRunId {
				t.Fatalf("first frame changed accepted public result: before=%+v after=%+v", seed, firstFramePublic)
			}

			var stored model.QuestionAgentLog
			if err := gdb.First(&stored, seed.Id).Error; err != nil {
				t.Fatalf("read terminal replacement row: %v", err)
			}
			private, err := LoadBotConversationContext(context.Background(), "alice", seed.Id)
			if err != nil {
				t.Fatalf("load terminal replacement context: %v", err)
			}
			if tc.wantPublicPromoted {
				if stored.Query != input.Query || stored.Answer != replacementAnswer ||
					stored.ToolName != "ChatAgent" || stored.Status != statusSucceeded ||
					stored.BotRunId != "run-stream-replacement" || private.Replacement != nil ||
					private.ClientTurnID != input.ClientTurnID || len(private.RetiredIdentities) != 1 {
					t.Fatalf("successful replacement was not atomically promoted: public=%+v private=%+v", stored, private)
				}
			} else {
				if stored.Query != seed.Query || stored.Answer != seed.Answer ||
					stored.ToolName != seed.ToolName || stored.Status != seed.Status ||
					stored.BotRunId != seed.BotRunId || private.Replacement == nil ||
					private.Replacement.TerminalResult == nil ||
					private.Replacement.TerminalResult.Status != "FAILED" {
					t.Fatalf("failed replacement changed public or lost terminal candidate: public=%+v private=%+v", stored, private)
				}
			}

			var replay strings.Builder
			retry, err := streamCapableService().QueryStream(
				context.Background(), "alice", input, nil,
				func(frame []byte) error {
					_, _ = replay.Write(frame)
					return nil
				},
			)
			if err != nil || retry == nil || retry.Id != seed.Id || retry.Status != tc.wantStatus {
				t.Fatalf("terminal replacement replay=%+v error=%v", retry, err)
			}
			events := assertValidAGUIReplay(t, replay.String())
			wantTerminal := "RunError"
			if tc.wantPublicPromoted {
				wantTerminal = "RunFinished"
			}
			if len(events) == 0 || events[len(events)-1] != wantTerminal {
				t.Fatalf("replacement replay events=%v, want terminal %s", events, wantTerminal)
			}
			if botCalls.Load() != 1 {
				t.Fatalf("replacement Bot calls=%d, want one", botCalls.Load())
			}
		})
	}
}

func TestQueryAndQueryStreamShareClientTurnReservationWithoutConversationV1(t *testing.T) {
	const streamBody = "event: RunStarted\ndata: {\"type\":\"RunStarted\",\"run_id\":\"run-shared-key-stream\"}\n\n" +
		"event: TextMessageContent\ndata: {\"type\":\"TextMessageContent\",\"delta\":\"ok\"}\n\n" +
		"event: RunFinished\ndata: {\"type\":\"RunFinished\",\"run_id\":\"run-shared-key-stream\"}\n\n"
	for _, tc := range []struct {
		name          string
		streamFirst   bool
		clientTurnID  string
		wantStreamHit int
		wantRunHit    int
	}{
		{
			name:         "blocking Research reserves before SSE Instant",
			clientTurnID: "shared-key-research-before-stream",
			wantRunHit:   1,
		},
		{
			name:          "SSE Instant reserves before blocking Research",
			streamFirst:   true,
			clientTurnID:  "shared-key-stream-before-research",
			wantStreamHit: 1,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupStreamTestDB(t)
			streamHits := 0
			runHits := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/v1/chat/completions":
					streamHits++
					w.Header().Set("Content-Type", "text/event-stream")
					_, _ = w.Write([]byte(streamBody))
				case "/v1/agents/research/runs":
					runHits++
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusAccepted)
					_, _ = w.Write([]byte(`{"id":"run-shared-key-research","object":"agent.run","agent":"research","status":"running","task_ids":[],"result":{}}`))
				default:
					http.NotFound(w, r)
				}
			}))
			t.Cleanup(server.Close)
			previous := rxBot.BotConfig
			rxBot.BotConfig = &rxBot.Config{
				BaseURL: server.URL, ProxyEnabled: true, ExpertEnabled: true,
				ResearchEnabled: true, StreamEnabled: true,
				MultiturnV1Enabled: false, TimeoutSeconds: 2,
			}
			t.Cleanup(func() { rxBot.BotConfig = previous })
			service := &Service{
				catalogReader: staticResearchCatalogReader{response: validResearchCapabilityCatalog()},
			}
			streamInput := QueryInput{
				Query: "stream with an owner key", Mode: "instant",
				ClientTurnID: tc.clientTurnID, Surface: QuerySurfaceChat,
			}
			researchInput := QueryInput{
				Query: "Research with the same owner key", Mode: "expert",
				Tool: "InSilicoResearchAgent", ClientTurnID: tc.clientTurnID,
				Surface: QuerySurfaceChat,
			}

			if tc.streamFirst {
				if _, err := service.QueryStream(
					context.Background(), "alice@example.com", streamInput, nil, nil,
				); err != nil {
					t.Fatalf("first QueryStream: %v", err)
				}
				if out, err := service.Query(context.Background(), "alice@example.com", researchInput); out != nil || !errors.Is(err, ErrDuplicateClientTurn) {
					t.Fatalf("Research reuse result=%+v error=%v, want ErrDuplicateClientTurn", out, err)
				}
			} else {
				if _, err := service.Query(context.Background(), "alice@example.com", researchInput); err != nil {
					t.Fatalf("first Research Query: %v", err)
				}
				if out, err := service.QueryStream(
					context.Background(), "alice@example.com", streamInput, nil, nil,
				); out != nil || !errors.Is(err, ErrDuplicateClientTurn) {
					t.Fatalf("stream reuse result=%+v error=%v, want ErrDuplicateClientTurn", out, err)
				}
			}
			if streamHits != tc.wantStreamHit || runHits != tc.wantRunHit {
				t.Fatalf("Bot stream/run hits=%d/%d, want %d/%d",
					streamHits, runHits, tc.wantStreamHit, tc.wantRunHit)
			}
			var rows int64
			if err := gdb.Model(&model.QuestionAgentLog{}).Count(&rows).Error; err != nil {
				t.Fatalf("count shared-key rows: %v", err)
			}
			if rows != 1 {
				t.Fatalf("shared-key rows=%d, want 1", rows)
			}
		})
	}
}

func TestQueryStream_ReadyRowAndRunIDPrecedeFrames(t *testing.T) {
	gdb := setupStreamTestDB(t)
	sseChatServer(t)
	svc := streamCapableService()

	ready := false
	identity := StreamIdentity{}
	onReady := func(got StreamIdentity) {
		identity = got
		var status, dialogueID string
		if err := gdb.Raw(
			`SELECT COALESCE(status,''), COALESCE(dialogue_id,'') FROM question_agent_logs WHERE id=?`,
			got.MessageID,
		).Row().Scan(&status, &dialogueID); err != nil {
			t.Fatalf("read ready row: %v", err)
		}
		if status != "RUNNING" {
			t.Fatalf("ready row status = %q, want RUNNING", status)
		}
		if dialogueID == "" || dialogueID != got.DialogueID {
			t.Fatalf("ready dialogue = %q, identity = %q", dialogueID, got.DialogueID)
		}
		ready = true
	}
	frames := 0
	forward := func(frame []byte) error {
		frames++
		if !ready {
			t.Fatal("frame forwarded before RUNNING row became ready")
		}
		if strings.Contains(string(frame), "RunStarted") {
			var runID string
			if err := gdb.Raw(
				`SELECT COALESCE(bot_run_id,'') FROM question_agent_logs WHERE id=?`,
				identity.MessageID,
			).Scan(&runID).Error; err != nil {
				t.Fatalf("read run id before forward: %v", err)
			}
			if runID != "run_77" {
				t.Fatalf("RunStarted forwarded before bot_run_id was durable: got %q", runID)
			}
		}
		return nil
	}

	out, err := svc.QueryStream(context.Background(), "ready@example.com",
		QueryInput{Query: "hi", Tool: "", Mode: "instant"}, onReady, forward)
	if err != nil {
		t.Fatalf("QueryStream error: %v", err)
	}
	if !ready || frames == 0 {
		t.Fatalf("ready=%v frames=%d, want ready and forwarded frames", ready, frames)
	}
	if out.Id != identity.MessageID || out.DialogueId != identity.DialogueID {
		t.Fatalf("output identity = (%d,%q), ready identity = (%d,%q)",
			out.Id, out.DialogueId, identity.MessageID, identity.DialogueID)
	}
}

func TestQueryStream_InitialPersistenceFailureForwardsNothing(t *testing.T) {
	gdb := setupStreamTestDB(t)
	sseChatServer(t)
	if err := gdb.Exec(`DROP TABLE question_agent_logs`).Error; err != nil {
		t.Fatalf("drop stream table: %v", err)
	}

	ready := false
	forwarded := false
	_, err := streamCapableService().QueryStream(context.Background(), "broken@example.com",
		QueryInput{Query: "hi", Tool: "", Mode: "instant"},
		func(StreamIdentity) { ready = true },
		func([]byte) error { forwarded = true; return nil },
	)
	if err == nil {
		t.Fatal("missing stream table must fail initial persistence")
	}
	if ready || forwarded {
		t.Fatalf("failed initial persistence leaked stream state: ready=%v forwarded=%v", ready, forwarded)
	}
}

func TestQueryStream_CancelFinalizesReadyRow(t *testing.T) {
	gdb := setupStreamTestDB(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("event: RunStarted\ndata: {\"type\":\"RunStarted\",\"run_id\":\"run_cancel\"}\n\n"))
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		<-r.Context().Done()
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, StreamEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	identity := StreamIdentity{}
	out, err := streamCapableService().QueryStream(ctx, "cancel@example.com",
		QueryInput{Query: "hi", Tool: "", Mode: "instant"},
		func(got StreamIdentity) { identity = got },
		func([]byte) error { cancel(); return context.Canceled },
	)
	if err == nil {
		t.Fatal("canceled upstream stream must report its read error")
	}
	if out == nil || identity.MessageID == 0 {
		t.Fatalf("cancel must retain the ready identity: out=%+v identity=%+v", out, identity)
	}
	var status, runID string
	if err := gdb.Raw(
		`SELECT COALESCE(status,''), COALESCE(bot_run_id,'') FROM question_agent_logs WHERE id=?`,
		identity.MessageID,
	).Row().Scan(&status, &runID); err != nil {
		t.Fatalf("read canceled stream row: %v", err)
	}
	if status != "FAILED" || runID != "run_cancel" {
		t.Fatalf("canceled row status/run = %q/%q, want FAILED/run_cancel", status, runID)
	}
}

func TestQueryStream_A2uiAuthorizedBeforeInteractiveFrame(t *testing.T) {
	setupStreamTestDB(t)
	body := strings.Join([]string{
		"event: RunStarted\ndata: {\"type\":\"RunStarted\",\"run_id\":\"run_action\"}\n",
		"event: Custom\ndata: {\"type\":\"Custom\",\"name\":\"phyto.a2ui\",\"value\":{\"surface_id\":\"s1\"}}\n",
		"event: RunFinished\ndata: {\"type\":\"RunFinished\",\"run_id\":\"run_action\"}\n",
	}, "\n")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, StreamEnabled: true,
		A2uiActionsEnabled: false, TimeoutSeconds: 5,
	}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	svc := streamCapableService()
	identity := StreamIdentity{}
	authorizedAtFrame := false
	_, err := svc.QueryStream(context.Background(), "action@example.com",
		QueryInput{Query: "hi", Tool: "", Mode: "instant"},
		func(got StreamIdentity) { identity = got },
		func(frame []byte) error {
			if !strings.Contains(string(frame), "phyto.a2ui") {
				return nil
			}
			outcome, actionErr := svc.A2uiAction(
				context.Background(),
				"action@example.com",
				identity.DialogueID,
				[]byte(`{"surface_id":"s1","widget":"confirm","action_id":"submit","run_id":"run_action","payload":{"accepted":true}}`),
			)
			if !errors.Is(actionErr, ErrGatewayDisabled) {
				t.Fatalf("A2UI action gateway result = %v, want ErrGatewayDisabled", actionErr)
			}
			// Flag-off now fails before dispatch with the same typed disabled error
			// as proxy-disabled mode; reaching this branch still proves the
			// ownership tuple was present before the flag gate.
			if outcome != nil {
				t.Fatalf("flag-off outcome = %+v, want nil", outcome)
			}
			authorizedAtFrame = true
			return nil
		},
	)
	if err != nil {
		t.Fatalf("QueryStream error: %v", err)
	}
	if !authorizedAtFrame {
		t.Fatal("interactive frame did not exercise the live A2UI authorization tuple")
	}
}

func TestQueryStream_ForwardErrorStillPersists(t *testing.T) {
	gdb := setupStreamTestDB(t)
	sseChatServer(t)
	svc := streamCapableService()
	forward := func(frame []byte) error { return http.ErrBodyNotAllowed } // simulate browser disconnect
	out, err := svc.QueryStream(context.Background(), "bob@example.com",
		QueryInput{Query: "hi", Id: 0, Tool: "", Mode: "instant"}, nil, forward)
	if err != nil {
		t.Fatalf("forward error must not fail the call (persist still happens): %v", err)
	}
	_, answer := readStatusAnswer(t, gdb, out.Id)
	if answer == "" {
		t.Fatalf("accumulated answer must persist even when forward fails")
	}
}

func TestQueryStream_AutonomousExpertRefused(t *testing.T) {
	setupStreamTestDB(t)
	botHits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		botHits++
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, StreamEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })
	svc := streamCapableService()
	_, err := svc.QueryStream(context.Background(), "eve@example.com",
		QueryInput{Query: "hi", Id: 0, Tool: "", Mode: "expert"}, nil, nil)
	if !errors.Is(err, ErrStreamUnsupported) {
		t.Fatalf("err = %v, want ErrStreamUnsupported (expert must never stream)", err)
	}
	if botHits != 0 {
		t.Fatalf("expert must not touch the Bot streaming endpoint (hits=%d)", botHits)
	}
}

func TestQueryStream_ChatFamilyForwardsCanonicalStreamRequest(t *testing.T) {
	tests := []struct {
		name          string
		tool          string
		mode          string
		model         string
		resolveGeneID bool
	}{
		{name: "instant chat", mode: "instant", model: "phyto-chat"},
		{name: "expert knowledge", tool: "KnowledgeAgent", mode: "expert", model: "phyto-knowledge"},
		{name: "expert brief gene", tool: "BriefGeneAgent", mode: "expert", model: "phyto-brief-gene", resolveGeneID: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gdb := setupStreamTestDB(t)
			var captured rxBot.ChatCompletionRequest
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/v1/chat/completions" {
					t.Fatalf("path = %q, want /v1/chat/completions", r.URL.Path)
				}
				if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
					t.Fatalf("decode request: %v", err)
				}
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = w.Write([]byte(strings.Join([]string{
					`event: RunStarted` + "\n" + `data: {"type":"RunStarted","run_id":"run-expert-stream"}` + "\n",
					`event: TextMessageContent` + "\n" + `data: {"type":"TextMessageContent","delta":"# report"}` + "\n",
					`event: RunFinished` + "\n" + `data: {"type":"RunFinished","run_id":"run-expert-stream"}` + "\n",
				}, "\n")))
			}))
			t.Cleanup(srv.Close)
			previous := rxBot.BotConfig
			rxBot.BotConfig = &rxBot.Config{
				BaseURL: srv.URL, ProxyEnabled: true, ExpertEnabled: true,
				StreamEnabled: true, TimeoutSeconds: 5,
			}
			t.Cleanup(func() { rxBot.BotConfig = previous })

			out, err := streamCapableService().QueryStream(
				context.Background(),
				"eve@example.com",
				QueryInput{
					Query:        "forced report",
					Tool:         tt.tool,
					Mode:         tt.mode,
					ClientTurnID: "stream-" + strings.ReplaceAll(tt.name, " ", "-"),
				},
				nil,
				nil,
			)
			if err != nil {
				t.Fatalf("QueryStream error: %v", err)
			}
			if captured.Model != tt.model {
				t.Fatalf("model = %q, want %q", captured.Model, tt.model)
			}
			if captured.ResolveGeneID != tt.resolveGeneID {
				t.Fatalf("resolve_gene_id = %v, want %v", captured.ResolveGeneID, tt.resolveGeneID)
			}
			expectedTool := tt.tool
			if expectedTool == "" {
				expectedTool = "ChatAgent"
			}
			if out.ToolName != expectedTool || out.Status != "SUCCEEDED" {
				t.Fatalf("stream result = %#v", out)
			}
			var row model.QuestionAgentLog
			if err := gdb.First(&row, out.Id).Error; err != nil {
				t.Fatalf("load persisted row: %v", err)
			}
			if row.ToolName != expectedTool || row.Mode != tt.mode ||
				!strings.Contains(row.Answer, "# report") {
				t.Fatalf("persisted row = %#v", row)
			}
		})
	}
}

func TestQueryStream_RequiresAdvertisedStreamingCapability(t *testing.T) {
	tests := []struct {
		name          string
		catalogStatus int
		catalogBody   string
		wantSuccess   bool
	}{
		{
			name:          "exact true",
			catalogStatus: http.StatusOK,
			catalogBody:   `{"object":"list","data":[{"slug":"chat","tool":"ChatAgent","capabilities":{"streaming":true}}]}`,
			wantSuccess:   true,
		},
		{
			name:          "descriptor missing",
			catalogStatus: http.StatusOK,
			catalogBody:   `{"object":"list","data":[]}`,
		},
		{
			name:          "catalog request fails",
			catalogStatus: http.StatusServiceUnavailable,
			catalogBody:   `{}`,
		},
		{
			name:          "streaming missing",
			catalogStatus: http.StatusOK,
			catalogBody:   `{"object":"list","data":[{"slug":"chat","tool":"ChatAgent","capabilities":{}}]}`,
		},
		{
			name:          "streaming false",
			catalogStatus: http.StatusOK,
			catalogBody:   `{"object":"list","data":[{"slug":"chat","tool":"ChatAgent","capabilities":{"streaming":false}}]}`,
		},
		{
			name:          "streaming wrong type",
			catalogStatus: http.StatusOK,
			catalogBody:   `{"object":"list","data":[{"slug":"chat","tool":"ChatAgent","capabilities":{"streaming":"true"}}]}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gdb := setupStreamTestDB(t)
			catalogHits := 0
			chatHits := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/v1/agents":
					catalogHits++
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(tt.catalogStatus)
					_, _ = w.Write([]byte(tt.catalogBody))
				case "/v1/chat/completions":
					chatHits++
					w.Header().Set("Content-Type", "text/event-stream")
					_, _ = w.Write([]byte(strings.Join([]string{
						`event: RunStarted` + "\n" + `data: {"type":"RunStarted","run_id":"run-admission"}` + "\n",
						`event: RunFinished` + "\n" + `data: {"type":"RunFinished","run_id":"run-admission"}` + "\n",
					}, "\n")))
				default:
					http.NotFound(w, r)
				}
			}))
			t.Cleanup(server.Close)
			previous := rxBot.BotConfig
			rxBot.BotConfig = &rxBot.Config{
				BaseURL: server.URL, ProxyEnabled: true, StreamEnabled: true, TimeoutSeconds: 5,
			}
			t.Cleanup(func() { rxBot.BotConfig = previous })

			out, err := NewService().QueryStream(
				context.Background(),
				"alice@example.com",
				QueryInput{Query: "admission", Mode: "instant"},
				nil,
				nil,
			)
			if tt.wantSuccess {
				if err != nil || out == nil {
					t.Fatalf("exact capability should stream: out=%#v err=%v", out, err)
				}
				if catalogHits != 1 || chatHits != 1 {
					t.Fatalf("success hits catalog=%d chat=%d, want 1/1", catalogHits, chatHits)
				}
				return
			}

			if !errors.Is(err, ErrStreamUnsupported) {
				t.Fatalf("error = %v, want ErrStreamUnsupported", err)
			}
			if catalogHits != 1 || chatHits != 0 {
				t.Fatalf("rejected hits catalog=%d chat=%d, want 1/0", catalogHits, chatHits)
			}
			var rows int64
			if err := gdb.Model(&model.QuestionAgentLog{}).Count(&rows).Error; err != nil {
				t.Fatalf("count rows: %v", err)
			}
			if rows != 0 {
				t.Fatalf("rejected stream persisted %d rows, want zero", rows)
			}
		})
	}
}

func TestQueryStream_ForcedExpertKeepsServerSideGates(t *testing.T) {
	t.Run("expert gate off", func(t *testing.T) {
		setupStreamTestDB(t)
		previous := rxBot.BotConfig
		rxBot.BotConfig = &rxBot.Config{
			ProxyEnabled: true, StreamEnabled: true, ExpertEnabled: false,
		}
		t.Cleanup(func() { rxBot.BotConfig = previous })

		_, err := (&Service{}).QueryStream(
			context.Background(),
			"eve@example.com",
			QueryInput{Query: "forced report", Tool: "KnowledgeAgent", Mode: "expert"},
			nil,
			nil,
		)
		if !errors.Is(err, ErrExpertDisabled) {
			t.Fatalf("error = %v, want ErrExpertDisabled", err)
		}
	})

	t.Run("selected tool permission missing", func(t *testing.T) {
		gdb := setupStreamTestDB(t)
		seedExpertPermissionUser(t, gdb, "stream-no-knowledge@example.com", "stream-no-knowledge")
		seedExpertPermissionTool(t, gdb, "stream-no-knowledge", "DataAgent", 1)
		previous := rxBot.BotConfig
		rxBot.BotConfig = &rxBot.Config{
			ProxyEnabled: true, StreamEnabled: true, ExpertEnabled: true,
		}
		t.Cleanup(func() { rxBot.BotConfig = previous })

		_, err := (&Service{}).QueryStream(
			context.Background(),
			"stream-no-knowledge@example.com",
			QueryInput{Query: "forced report", Tool: "KnowledgeAgent", Mode: "expert"},
			nil,
			nil,
		)
		if !errors.Is(err, ErrAgentToolForbidden) {
			t.Fatalf("error = %v, want ErrAgentToolForbidden", err)
		}
		var rows int64
		if err := gdb.Model(&model.QuestionAgentLog{}).Count(&rows).Error; err != nil {
			t.Fatalf("count rows: %v", err)
		}
		if rows != 0 {
			t.Fatalf("permission failure persisted %d rows, want zero", rows)
		}
	})
}

func TestQueryStream_NonChatSlugRefused(t *testing.T) {
	setupStreamTestDB(t)
	botHits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		botHits++
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, StreamEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })
	svc := streamCapableService()
	// Instant Chat streaming has no caller-selected agent. A non-ChatAgent tool
	// is invalid before any Bot call, regardless of its stream capability.
	_, err := svc.QueryStream(context.Background(), "eve@example.com",
		QueryInput{Query: "hi", Id: 0, Tool: "AnalystAgent", Mode: "instant"}, nil, nil)
	if !errors.Is(err, ErrInvalidChatRouting) {
		t.Fatalf("err = %v, want ErrInvalidChatRouting (non-chat tool cannot stream)", err)
	}
	if botHits != 0 {
		t.Fatalf("a non-chat slug must not touch the Bot streaming endpoint (hits=%d)", botHits)
	}
}

func TestQueryStream_PersistsBotRunID(t *testing.T) {
	gdb := setupStreamTestDB(t)
	sseChatServer(t) // fixture RunStarted carries run_id "run_77"
	svc := streamCapableService()
	out, err := svc.QueryStream(context.Background(), "carol@example.com",
		QueryInput{Query: "hi", Id: 0, Tool: "", Mode: "instant"}, nil, nil)
	if err != nil {
		t.Fatalf("QueryStream error: %v", err)
	}
	var botRunID string
	if err := gdb.Raw(`SELECT COALESCE(bot_run_id,'') FROM question_agent_logs WHERE id=?`, out.Id).Scan(&botRunID).Error; err != nil {
		t.Fatalf("read bot_run_id: %v", err)
	}
	if botRunID != "run_77" {
		t.Fatalf("persisted bot_run_id = %q, want run_77", botRunID)
	}
}

func TestQueryStream_CompatibilityModelsPreserveAGUIBytes(t *testing.T) {
	const fixture = "event: RunStarted\ndata: {\"type\":\"RunStarted\",\"run_id\":\"run-k\"}\n\n" +
		"event: StepStarted\ndata: {\"type\":\"StepStarted\",\"step_name\":\"retrieve\"}\n\n" +
		"event: TextMessageContent\ndata: {\"type\":\"TextMessageContent\",\"delta\":\"answer\"}\n\n" +
		"event: RunFinished\ndata: {\"type\":\"RunFinished\",\"run_id\":\"run-k\"}\n\n" +
		"data: [DONE]\n\n"

	for _, tc := range []struct {
		name  string
		tool  string
		model string
	}{
		{name: "chat", tool: "", model: "phyto-chat"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupStreamTestDB(t)
			var gotModel string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var req rxBot.ChatCompletionRequest
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					t.Fatalf("decode stream request: %v", err)
				}
				gotModel = req.Model
				if !req.Stream {
					t.Error("stream request must set stream=true")
				}
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = w.Write([]byte(fixture))
			}))
			t.Cleanup(srv.Close)
			rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, StreamEnabled: true, TimeoutSeconds: 5}
			t.Cleanup(func() { rxBot.BotConfig = nil })

			var forwarded strings.Builder
			out, err := streamCapableService().QueryStream(context.Background(), "compat@example.com",
				QueryInput{Query: "compat", Tool: tc.tool, Mode: "instant"}, nil,
				func(frame []byte) error {
					_, _ = forwarded.Write(frame)
					return nil
				})
			if err != nil {
				t.Fatalf("QueryStream error: %v", err)
			}
			if gotModel != tc.model {
				t.Fatalf("stream model = %q, want %q", gotModel, tc.model)
			}
			if forwarded.String() != fixture {
				t.Fatalf("forwarded AG-UI bytes changed:\n got %q\nwant %q", forwarded.String(), fixture)
			}
			var runID string
			if err := gdb.Raw(`SELECT COALESCE(bot_run_id,'') FROM question_agent_logs WHERE id=?`, out.Id).Scan(&runID).Error; err != nil {
				t.Fatalf("read persisted run id: %v", err)
			}
			if runID != "run-k" {
				t.Fatalf("persisted run id = %q, want run-k", runID)
			}
		})
	}
}

// TestQueryStream_CombinedAGUICompatibilityFixture exercises the complete
// inactive stream boundary for each canonical chat-family mapping. The fake
// Bot response is deliberately mixed LF/CRLF and contains an unknown event and
// [DONE]; QueryStream must forward those bytes exactly while persisting one
// bounded umbrella run identity.
func TestQueryStream_CombinedAGUICompatibilityFixture(t *testing.T) {
	const fixture = "event: RunStarted\r\ndata: {\"type\":\"RunStarted\",\"run_id\":\"run-task27\"}\r\n\r\n" +
		"event: FutureEvent\r\ndata: {\"type\":\"FutureEvent\",\"value\":\"ignored\"}\r\n\r\n" +
		"event: TextMessageContent\ndata: {\"type\":\"TextMessageContent\",\"delta\":\"synthetic\"}\n\n" +
		"event: RunFinished\ndata: {\"type\":\"RunFinished\",\"run_id\":\"run-task27\"}\n\n" +
		"data: [DONE]\n\n"

	for _, tc := range []struct {
		name  string
		tool  string
		model string
	}{
		{name: "chat", tool: "", model: "phyto-chat"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupStreamTestDB(t)
			var gotModel, gotDialogue string
			requestCount := 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requestCount++
				var req rxBot.ChatCompletionRequest
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					t.Fatalf("decode stream request: %v", err)
				}
				gotModel, gotDialogue = req.Model, req.DialogueID
				if !req.Stream {
					t.Error("stream request must set stream=true")
				}
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = w.Write([]byte(fixture))
			}))
			t.Cleanup(srv.Close)
			rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, StreamEnabled: true, TimeoutSeconds: 5}
			t.Cleanup(func() { rxBot.BotConfig = nil })

			var forwarded strings.Builder
			out, err := streamCapableService().QueryStream(context.Background(), "task27-stream@example.com",
				QueryInput{Query: "synthetic", Tool: tc.tool, Mode: "instant"}, nil,
				func(frame []byte) error {
					_, _ = forwarded.Write(frame)
					return nil
				})
			if err != nil {
				t.Fatalf("QueryStream error: %v", err)
			}
			if requestCount != 1 || gotDialogue == "" {
				t.Fatalf("request correlation count/dialogue = %d/%q, want one bounded request", requestCount, gotDialogue)
			}
			if gotModel != tc.model {
				t.Fatalf("stream model = %q, want %q", gotModel, tc.model)
			}
			if forwarded.String() != fixture {
				t.Fatalf("forwarded AG-UI bytes changed:\n got %q\nwant %q", forwarded.String(), fixture)
			}
			if strings.Count(forwarded.String(), "event: RunStarted") != 1 {
				t.Fatalf("run-started event count = %d, want one", strings.Count(forwarded.String(), "event: RunStarted"))
			}
			if out.Status != "SUCCEEDED" {
				t.Fatalf("stream status = %q, want SUCCEEDED", out.Status)
			}
			var persistedRunID string
			if err := gdb.Raw(`SELECT COALESCE(bot_run_id,'') FROM question_agent_logs WHERE id=?`, out.Id).Scan(&persistedRunID).Error; err != nil {
				t.Fatalf("read persisted run id: %v", err)
			}
			if persistedRunID != "run-task27" {
				t.Fatalf("persisted run id = %q, want run-task27", persistedRunID)
			}
		})
	}
}

// TestQueryStream_CombinedRunErrorFixture keeps a Bot terminal error terminal
// even when the legacy [DONE] marker follows it. The raw error event is
// forwarded once and no child/task identity is fabricated.
func TestQueryStream_CombinedRunErrorFixture(t *testing.T) {
	const fixture = "event: RunStarted\r\ndata: {\"type\":\"RunStarted\",\"run_id\":\"run-task27-error\"}\r\n\r\n" +
		"event: TextMessageContent\r\ndata: {\"type\":\"TextMessageContent\",\"delta\":\"partial\"}\r\n\r\n" +
		"event: RunError\ndata: {\"type\":\"RunError\",\"code\":\"fixture_failure\",\"message\":\"synthetic failure\"}\n\n" +
		"data: [DONE]\n\n"
	gdb := setupStreamTestDB(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(fixture))
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, StreamEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	var forwarded strings.Builder
	out, err := streamCapableService().QueryStream(context.Background(), "task27-error@example.com",
		QueryInput{Query: "synthetic", Tool: "", Mode: "instant"}, nil,
		func(frame []byte) error {
			_, _ = forwarded.Write(frame)
			return nil
		})
	if err != nil {
		t.Fatalf("terminal RunError must not synthesize a second transport error: %v", err)
	}
	if forwarded.String() != fixture {
		t.Fatalf("forwarded terminal fixture changed:\n got %q\nwant %q", forwarded.String(), fixture)
	}
	if strings.Count(forwarded.String(), "event: RunError") != 1 {
		t.Fatalf("RunError event count = %d, want one", strings.Count(forwarded.String(), "event: RunError"))
	}
	if out == nil || out.Status != "FAILED" {
		t.Fatalf("terminal output = %+v, want FAILED", out)
	}
	status, _ := readStatusAnswer(t, gdb, out.Id)
	var persistedRunID string
	if err := gdb.Raw(`SELECT COALESCE(bot_run_id,'') FROM question_agent_logs WHERE id=?`, out.Id).Scan(&persistedRunID).Error; err != nil {
		t.Fatalf("read persisted terminal run id: %v", err)
	}
	if status != "FAILED" || persistedRunID != "run-task27-error" {
		t.Fatalf("persisted terminal status/run = %q/%q, want FAILED/run-task27-error", status, persistedRunID)
	}
}

// TestCompatibilityFixture_ExpertResearchProjectionIdentity covers the blocking
// direct-dispatch path used by a forced research selection: it is invoked on
// /v1/agents/research/runs (not the LLM router). The Web request id, umbrella Bot
// run id, and child task id remain separate and the accepted projection is
// persisted owner-scoped for history reads.
func TestCompatibilityFixture_ExpertResearchProjectionIdentity(t *testing.T) {
	gdb := setupExpertTestDB(t)
	requestCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/agents/research/runs" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		requestCount++
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Request-Id", "bot-request-task27")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"id":"run-research-task27","object":"agent.run","agent":"research","status":"running","task_ids":["child-task27"],"result":{}}`))
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, ExpertEnabled: true, TimeoutSeconds: 5,
		ResearchEnabled: true, DesignEnabled: true, NetworkEnabled: true,
	}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	ctx := utils.WithRequestID(context.Background(), "web-request-task27")
	out, err := serviceWithValidResearchCatalog().Query(ctx, "task27-expert@example.com", QueryInput{
		Query: "synthetic", Tool: "InSilicoResearchAgent", Mode: "expert",
		ClientTurnID: "compat-expert-research-turn",
	})
	if err != nil {
		t.Fatalf("Expert Query error: %v", err)
	}
	if requestCount != 1 {
		t.Fatalf("agent-run request count = %d, want one", requestCount)
	}
	if out.ToolName != "InSilicoResearchAgent" || out.RequestID != "web-request-task27" {
		t.Fatalf("resolved tool/request = %q/%q", out.ToolName, out.RequestID)
	}
	if out.BotRunID != "run-research-task27" || out.TaskId != "child-task27" || out.BotRunID == out.TaskId {
		t.Fatalf("run/task identity = %q/%q, want distinct umbrella/child ids", out.BotRunID, out.TaskId)
	}
	projection, err := LoadBotRunProjection(context.Background(), "task27-expert@example.com", out.Id)
	if err != nil {
		t.Fatalf("LoadBotRunProjection: %v", err)
	}
	if projection.Agent != "research" || projection.RunID != out.BotRunID || projection.Status != "RUNNING" {
		t.Fatalf("projection identity = %+v", projection)
	}
	var storedOwner, storedRunID, storedTaskID string
	if err := gdb.Raw(`SELECT user_name, bot_run_id, task_id FROM question_agent_logs WHERE id=?`, out.Id).
		Row().Scan(&storedOwner, &storedRunID, &storedTaskID); err != nil {
		t.Fatalf("read persisted Expert identity: %v", err)
	}
	if storedOwner != "task27-expert@example.com" || storedRunID != out.BotRunID || storedTaskID != out.TaskId {
		t.Fatalf("stored identity = %q/%q/%q", storedOwner, storedRunID, storedTaskID)
	}
}

// TestCompatibilityFixture_HistoryProjectionFallbackOwnerScope exercises the
// projection-first history boundary and its safe legacy fallbacks without
// putting query/answer/upstream text into bounded observations.
func TestCompatibilityFixture_HistoryProjectionFallbackOwnerScope(t *testing.T) {
	t.Run("projection and owner filter", func(t *testing.T) {
		gdb := setupTestDB(t)
		rxBot.BotConfig = nil
		t.Cleanup(func() { rxBot.BotConfig = nil })
		ResetHistoryReadObservations()
		projection := BotRunProjection{RunID: "run-history-task27", Agent: "research", Status: "SUCCEEDED", ReportRevision: 2, FinalReport: "synthetic report"}
		encoded, err := marshalPersistedProjection(projection)
		if err != nil {
			t.Fatalf("marshal projection: %v", err)
		}
		if err := gdb.Exec(`INSERT INTO question_agent_logs
			(id, dialogue_id, f_id, user_name, query, answer, tool_name, bot_run_id, bot_projection_json, bot_report_revision, status, reaction_type, upload_path, created_at) VALUES
			(120, 'dlg-history-task27', 0, 'task27-owner', 'synthetic-q', 'legacy-parent', 'InSilicoResearchAgent', 'run-history-task27', ?, 2, 'RUNNING', '2', '/upload/task27', '2026-01-01 00:00:00'),
			(121, 'dlg-history-task27', 120, 'task27-owner', 'legacy-q', 'legacy-child', 'ChatAgent', '', '', -1, 'SUCCEEDED', '1', '/upload/child', '2026-01-01 00:01:00'),
			(122, 'dlg-history-task27', 120, 'foreign-owner', 'foreign-q', 'foreign-answer', 'ChatAgent', 'run-history-task27', ?, 2, 'SUCCEEDED', '0', '/upload/foreign', '2026-01-01 00:02:00')`, encoded, encoded).Error; err != nil {
			t.Fatalf("seed history fixture: %v", err)
		}

		result, err := (&Service{}).AnswerCheckWithMode(context.Background(), "task27-owner", "dlg-history-task27", HistoryReadModeDual)
		if err != nil {
			t.Fatalf("dual history read: %v", err)
		}
		if len(result.Rows) != 2 || result.Sources[0] != historySourceProjection || result.Sources[1] != historySourceLegacy {
			t.Fatalf("history source/owner result = %#v / %v", result.Rows, result.Sources)
		}
		if !strings.Contains(result.Rows[0].Answer, "synthetic report") || result.Rows[0].ReactionType != "2" || result.Rows[0].UploadPath != "/upload/task27" {
			t.Fatalf("projection/Web fields not preserved: %+v", result.Rows[0])
		}
		if result.Rows[1].Answer != "legacy-child" || result.Rows[1].ReactionType != "1" {
			t.Fatalf("legacy child changed: %+v", result.Rows[1])
		}
		for _, row := range result.Rows {
			if row.UserName != "task27-owner" || row.Id == 122 {
				t.Fatalf("foreign row leaked: %+v", row)
			}
		}
		observations, err := json.Marshal(HistoryReadObservations())
		if err != nil {
			t.Fatalf("marshal history observations: %v", err)
		}
		for _, forbidden := range []string{"synthetic-q", "legacy-parent", "task27-owner", "run-history-task27"} {
			if strings.Contains(string(observations), forbidden) {
				t.Fatalf("observation contains forbidden raw content %q", forbidden)
			}
		}
		_ = gdb
	})

	for _, tc := range []struct {
		name       string
		projection string
		runID      string
	}{
		{name: "missing projection", projection: "", runID: "run-history-missing"},
		{name: "malformed projection", projection: "{not-json", runID: "run-history-malformed"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupTestDB(t)
			rxBot.BotConfig = nil
			t.Cleanup(func() { rxBot.BotConfig = nil })
			ResetHistoryReadObservations()
			dialogueID := "dlg-history-task27-" + tc.name
			if err := gdb.Exec(`INSERT INTO question_agent_logs
				(id, dialogue_id, f_id, user_name, answer, tool_name, bot_run_id, bot_projection_json, bot_report_revision, status, created_at) VALUES
				(123, ?, 0, 'task27-owner', 'legacy-fallback', 'ChatAgent', ?, ?, -1, 'RUNNING', '2026-01-01 00:00:00')`, dialogueID, tc.runID, tc.projection).Error; err != nil {
				t.Fatalf("seed fallback fixture: %v", err)
			}
			result, err := (&Service{}).AnswerCheckWithMode(context.Background(), "task27-owner", dialogueID, HistoryReadModeDual)
			if err != nil || result.Source != historySourceLegacy || result.FallbackReason == "" || result.Rows[0].Answer != "legacy-fallback" {
				t.Fatalf("fallback result = %#v err=%v", result, err)
			}
			if got := historyObservationCount(t, historyObservationLegacyFallback); got != 1 {
				t.Fatalf("legacy fallback observation = %d, want one", got)
			}
			_ = gdb
		})
	}

	t.Run("Bot read unavailable", func(t *testing.T) {
		gdb := setupTestDB(t)
		ResetHistoryReadObservations()
		if err := gdb.Exec(`INSERT INTO question_agent_logs
			(id, dialogue_id, f_id, user_name, answer, tool_name, bot_run_id, status, created_at) VALUES
			(124, 'dlg-history-task27-bot', 0, 'task27-owner', 'legacy-bot', 'ChatAgent', 'run-history-bot', 'RUNNING', '2026-01-01 00:00:00')`).Error; err != nil {
			t.Fatalf("seed Bot fallback fixture: %v", err)
		}
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		t.Cleanup(srv.Close)
		rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
		t.Cleanup(func() { rxBot.BotConfig = nil })
		result, err := (&Service{}).AnswerCheckWithMode(context.Background(), "task27-owner", "dlg-history-task27-bot", HistoryReadModeDual)
		if err != nil || result.Source != historySourceLegacy || result.FallbackReason != historyFallbackBotUnavailable || result.Rows[0].Answer != "legacy-bot" {
			t.Fatalf("Bot fallback result = %#v err=%v", result, err)
		}
		if got := historyObservationCount(t, historyObservationBotUnavailable); got != 1 {
			t.Fatalf("Bot unavailable observation = %d, want one", got)
		}
		_ = gdb
	})
}

func TestQueryStream_StreamGateOffRefusesWithoutBotCall(t *testing.T) {
	setupStreamTestDB(t)
	botHits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		botHits++
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, StreamEnabled: false, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	_, err := (&Service{}).QueryStream(context.Background(), "gate@example.com",
		QueryInput{Query: "hi", Tool: "", Mode: "instant"}, nil, nil)
	if !errors.Is(err, ErrStreamUnsupported) {
		t.Fatalf("err = %v, want ErrStreamUnsupported while stream gate is off", err)
	}
	if botHits != 0 {
		t.Fatalf("stream gate off must not touch Bot (hits=%d)", botHits)
	}
}

func TestQueryStream_NonChatRoutingRejectedBeforeAnyBotRequest(t *testing.T) {
	setupStreamTestDB(t)
	botHits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		botHits++
	}))
	t.Cleanup(srv.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, StreamEnabled: true, TimeoutSeconds: 5,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	_, err := (&Service{}).QueryStream(context.Background(), "network@example.com",
		QueryInput{Query: "network", Tool: "GeneNetworkAgent", Mode: "instant"}, nil, nil)
	if !errors.Is(err, ErrInvalidChatRouting) {
		t.Fatalf("non-ChatAgent stream routing error = %v, want ErrInvalidChatRouting", err)
	}
	if botHits != 0 {
		t.Fatalf("non-ChatAgent stream routing must reject before any Bot request (hits=%d)", botHits)
	}
}

func TestQueryStream_RefreshClearsTaskColumns(t *testing.T) {
	gdb := setupStreamTestDB(t)
	sseChatServer(t)
	svc := streamCapableService()
	seed := model.QuestionAgentLog{
		DialogueId: "d1", UserName: "dan@example.com", Query: "old",
		ServerId: "srv-1", BotRunId: "run-old", TaskId: "task-1", LogStatus: "RUNNING",
		Answer:         "old answer",
		ServerFilePath: "obs://old/path", Status: "RUNNING", Mode: "instant",
	}
	if err := gdb.Create(&seed).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	readyChecked := false
	onReady := func(identity StreamIdentity) {
		if identity.MessageID != seed.Id || identity.DialogueID != seed.DialogueId {
			t.Fatalf("refresh ready identity = %+v, want existing row %d/%s", identity, seed.Id, seed.DialogueId)
		}
		var status, runID, answer string
		if err := gdb.Raw(
			`SELECT COALESCE(status,''), COALESCE(bot_run_id,''), COALESCE(answer,'') FROM question_agent_logs WHERE id=?`,
			seed.Id,
		).Row().Scan(&status, &runID, &answer); err != nil {
			t.Fatalf("read refresh ready row: %v", err)
		}
		if status != "RUNNING" || runID != "" || answer != "" {
			t.Fatalf("refresh ready row status/run/answer = %q/%q/%q", status, runID, answer)
		}
		readyChecked = true
	}
	out, err := svc.QueryStream(context.Background(), "dan@example.com",
		QueryInput{Query: "hi", Id: 0, RefreshId: seed.Id, Tool: "", Mode: "instant"}, onReady, nil)
	if err != nil {
		t.Fatalf("QueryStream refresh error: %v", err)
	}
	if out.Id != seed.Id {
		t.Fatalf("refresh must update in place: out.Id=%d, want %d", out.Id, seed.Id)
	}
	if !readyChecked {
		t.Fatal("refresh did not publish its durable RUNNING identity")
	}
	var serverID, taskID, logStatus, serverFilePath string
	row := gdb.Raw(`SELECT COALESCE(server_id,''), COALESCE(task_id,''), COALESCE(log_status,''), COALESCE(server_file_path,'') FROM question_agent_logs WHERE id=?`, seed.Id)
	if err := row.Row().Scan(&serverID, &taskID, &logStatus, &serverFilePath); err != nil {
		t.Fatalf("read task columns: %v", err)
	}
	if serverID != "" || taskID != "" || logStatus != "" || serverFilePath != "" {
		t.Fatalf("stale task columns not cleared: server_id=%q task_id=%q log_status=%q server_file_path=%q",
			serverID, taskID, logStatus, serverFilePath)
	}
}

func TestQueryStream_RunErrorPersistsFailed(t *testing.T) {
	gdb := setupStreamTestDB(t)
	// Bot stream that starts then emits a RunError instead of RunFinished.
	body := strings.Join([]string{
		"event: RunStarted\ndata: {\"type\":\"RunStarted\",\"run_id\":\"run_err\"}\n",
		"event: TextMessageContent\ndata: {\"type\":\"TextMessageContent\",\"delta\":\"partial\"}\n",
		"event: RunError\ndata: {\"type\":\"RunError\",\"code\":\"bot_failure\",\"message\":\"boom\"}\n",
	}, "\n")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, StreamEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })
	svc := streamCapableService()
	out, err := svc.QueryStream(context.Background(), "erin@example.com",
		QueryInput{Query: "hi", Id: 0, Tool: "", Mode: "instant"}, nil, nil)
	if err != nil {
		t.Fatalf("QueryStream error: %v", err)
	}
	// A RunError mid-stream must persist a terminal non-RUNNING status, not the
	// hardcoded SUCCEEDED — otherwise a failed run masquerades as a good one.
	status, _ := readStatusAnswer(t, gdb, out.Id)
	if status != "FAILED" {
		t.Fatalf("persisted status = %q, want FAILED (RunError must not persist SUCCEEDED)", status)
	}
}

func TestConversationContextIntegrationStreamingSettlementRedactsOutput(t *testing.T) {
	gdb := setupStreamTestDB(t)
	username := "alice"
	dialogueID := "66666666-6666-4666-8666-666666666666"
	seedV1ConversationRoot(t, gdb, username, dialogueID)
	var chatCalls, settleCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/chat/completions":
			chatCalls++
			var request rxBot.ChatCompletionRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Errorf("decode streaming V1 request: %v", err)
				return
			}
			if request.Conversation == nil || len(request.Conversation.ArtifactRefs) != 1 ||
				request.Conversation.ArtifactRefs[0].ArtifactID != v1ConversationArtifactID {
				t.Errorf("streaming V1 request lost artifact metadata: %#v", request.Conversation)
				return
			}
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = w.Write([]byte(v1ContextStream(
				contextStageForStream(request),
				v1ConversationOutputMarker,
			)))
		case "/v1/conversation-context/settle":
			settleCalls++
			var request rxBot.ContextSettlementRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Errorf("decode streaming V1 settlement: %v", err)
				return
			}
			var row model.QuestionAgentLog
			if err := gdb.Where("id = ?", request.TurnID).First(&row).Error; err != nil {
				t.Errorf("load streaming row before acknowledgment: %v", err)
				return
			}
			private, err := LoadBotConversationContext(context.Background(), username, row.Id)
			if err != nil {
				t.Errorf("load streaming context before acknowledgment: %v", err)
				return
			}
			if row.Answer != v1ConversationOutputMarker || private.AssistantSummary != "" ||
				private.Stage == nil || len(private.ArtifactRefs) != 1 {
				t.Errorf("streaming settlement retained unsafe context: row=%#v private=%#v", row, private)
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
		BaseURL: server.URL, ProxyEnabled: true, StreamEnabled: true,
		MultiturnV1Enabled: true, TimeoutSeconds: 2,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	out, err := streamCapableService().QueryStream(context.Background(), username, QueryInput{
		Query:        "Continue the focus entity stream.",
		Id:           1,
		Mode:         "instant",
		ClientTurnID: "stream-redaction-2",
		ArtifactIDs:  []string{v1ConversationArtifactID},
	}, nil, nil)
	if err != nil || out == nil || out.Status != statusSucceeded || out.Answer != v1ConversationOutputMarker {
		t.Fatalf("streaming V1 result=%#v error=%v", out, err)
	}
	if chatCalls != 1 || settleCalls != 1 {
		t.Fatalf("streaming V1 calls chat=%d settle=%d, want 1/1", chatCalls, settleCalls)
	}
	assertV1ContextDoesNotReplayOutput(t, username, out.Id, v1ConversationOutputMarker)
}
