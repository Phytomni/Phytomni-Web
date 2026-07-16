package api_service

import (
	"context"
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
	if err := gdb.Exec(`ALTER TABLE question_agent_logs ADD COLUMN bot_projection_json TEXT`).Error; err != nil {
		t.Fatalf("add bot projection column: %v", err)
	}
	if err := gdb.Exec(`ALTER TABLE question_agent_logs ADD COLUMN bot_report_revision INTEGER NOT NULL DEFAULT -1`).Error; err != nil {
		t.Fatalf("add bot revision column: %v", err)
	}
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
