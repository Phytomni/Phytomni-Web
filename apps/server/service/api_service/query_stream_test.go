package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gorm.io/gorm"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
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

func TestQueryStream_PersistsAndForwards(t *testing.T) {
	gdb := setupStreamTestDB(t)
	sseChatServer(t)
	svc := &Service{}

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

func TestQueryStream_ReadyRowAndRunIDPrecedeFrames(t *testing.T) {
	gdb := setupStreamTestDB(t)
	sseChatServer(t)
	svc := &Service{}

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
	_, err := (&Service{}).QueryStream(context.Background(), "broken@example.com",
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
	out, err := (&Service{}).QueryStream(ctx, "cancel@example.com",
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

	svc := &Service{}
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
	svc := &Service{}
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

func TestQueryStream_ExpertRefused(t *testing.T) {
	setupStreamTestDB(t)
	botHits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		botHits++
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, StreamEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })
	svc := &Service{}
	_, err := svc.QueryStream(context.Background(), "eve@example.com",
		QueryInput{Query: "hi", Id: 0, Tool: "", Mode: "expert"}, nil, nil)
	if !errors.Is(err, ErrStreamUnsupported) {
		t.Fatalf("err = %v, want ErrStreamUnsupported (expert must never stream)", err)
	}
	if botHits != 0 {
		t.Fatalf("expert must not touch the Bot streaming endpoint (hits=%d)", botHits)
	}
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
	svc := &Service{}
	// AnalystAgent -> "analyst", a remote-agent slug with no chat model, so it
	// has no Bot streaming primitive and must be refused before any Bot call.
	_, err := svc.QueryStream(context.Background(), "eve@example.com",
		QueryInput{Query: "hi", Id: 0, Tool: "AnalystAgent", Mode: "instant"}, nil, nil)
	if !errors.Is(err, ErrStreamUnsupported) {
		t.Fatalf("err = %v, want ErrStreamUnsupported (non-chat slug cannot stream)", err)
	}
	if botHits != 0 {
		t.Fatalf("a non-chat slug must not touch the Bot streaming endpoint (hits=%d)", botHits)
	}
}

func TestQueryStream_PersistsBotRunID(t *testing.T) {
	gdb := setupStreamTestDB(t)
	sseChatServer(t) // fixture RunStarted carries run_id "run_77"
	svc := &Service{}
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
		{name: "knowledge", tool: "KnowledgeAgent", model: "phyto-knowledge"},
		{name: "brief gene", tool: "BriefGeneAgent", model: "phyto-brief-gene"},
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
			out, err := (&Service{}).QueryStream(context.Background(), "compat@example.com",
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
		{name: "chat", tool: "ChatAgent", model: "phyto-chat"},
		{name: "knowledge", tool: "KnowledgeAgent", model: "phyto-knowledge"},
		{name: "brief gene", tool: "BriefGeneAgent", model: "phyto-brief-gene"},
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
			out, err := (&Service{}).QueryStream(context.Background(), "task27-stream@example.com",
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
	out, err := (&Service{}).QueryStream(context.Background(), "task27-error@example.com",
		QueryInput{Query: "synthetic", Tool: "ChatAgent", Mode: "instant"}, nil,
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

// TestCompatibilityFixture_ExpertResearchProjectionIdentity covers the
// blocking Expert route used by the resolved research slug. The Web request
// id, umbrella Bot run id, and child task id remain separate and the accepted
// projection is persisted owner-scoped for history reads.
func TestCompatibilityFixture_ExpertResearchProjectionIdentity(t *testing.T) {
	gdb := setupExpertTestDB(t)
	requestCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/query/route" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		requestCount++
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Request-Id", "bot-request-task27")
		_, _ = w.Write([]byte(`{"id":"submission-task27","run_id":"run-research-task27","object":"agent.run","agent":"research","status":"running","task_ids":["child-task27"],"result":{}}`))
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, ExpertEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	ctx := context.WithValue(context.Background(), "x-request-id", "web-request-task27")
	out, err := (&Service{}).Query(ctx, "task27-expert@example.com", QueryInput{
		Query: "synthetic", Tool: "StaleAgent", Mode: "expert",
	})
	if err != nil {
		t.Fatalf("Expert Query error: %v", err)
	}
	if requestCount != 1 {
		t.Fatalf("route request count = %d, want one", requestCount)
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
		QueryInput{Query: "hi", Tool: "KnowledgeAgent", Mode: "instant"}, nil, nil)
	if !errors.Is(err, ErrStreamUnsupported) {
		t.Fatalf("err = %v, want ErrStreamUnsupported while stream gate is off", err)
	}
	if botHits != 0 {
		t.Fatalf("stream gate off must not touch Bot (hits=%d)", botHits)
	}
}

func TestQueryStream_RefreshClearsTaskColumns(t *testing.T) {
	gdb := setupStreamTestDB(t)
	sseChatServer(t)
	svc := &Service{}
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
	svc := &Service{}
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
