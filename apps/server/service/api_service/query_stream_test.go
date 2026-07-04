package api_service

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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

func TestQueryStream_PersistsAndForwards(t *testing.T) {
	gdb := setupExpertTestDB(t)
	sseChatServer(t)
	svc := &Service{}

	var forwarded strings.Builder
	forward := func(frame []byte) error {
		forwarded.Write(frame)
		return nil
	}
	out, err := svc.QueryStream(context.Background(), "alice@example.com",
		QueryInput{Query: "hi", Id: 0, Tool: "", Mode: "instant"}, forward)
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
}

func TestQueryStream_ForwardErrorStillPersists(t *testing.T) {
	gdb := setupExpertTestDB(t)
	sseChatServer(t)
	svc := &Service{}
	forward := func(frame []byte) error { return http.ErrBodyNotAllowed } // simulate browser disconnect
	out, err := svc.QueryStream(context.Background(), "bob@example.com",
		QueryInput{Query: "hi", Id: 0, Tool: "", Mode: "instant"}, forward)
	if err != nil {
		t.Fatalf("forward error must not fail the call (persist still happens): %v", err)
	}
	_, answer := readStatusAnswer(t, gdb, out.Id)
	if answer == "" {
		t.Fatalf("accumulated answer must persist even when forward fails")
	}
}

func TestQueryStream_ExpertRefused(t *testing.T) {
	setupExpertTestDB(t)
	botHits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		botHits++
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, StreamEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })
	svc := &Service{}
	_, err := svc.QueryStream(context.Background(), "eve@example.com",
		QueryInput{Query: "hi", Id: 0, Tool: "", Mode: "expert"}, nil)
	if !errors.Is(err, ErrStreamUnsupported) {
		t.Fatalf("err = %v, want ErrStreamUnsupported (expert must never stream)", err)
	}
	if botHits != 0 {
		t.Fatalf("expert must not touch the Bot streaming endpoint (hits=%d)", botHits)
	}
}

func TestQueryStream_PersistsBotRunID(t *testing.T) {
	gdb := setupExpertTestDB(t)
	sseChatServer(t) // fixture RunStarted carries run_id "run_77"
	svc := &Service{}
	out, err := svc.QueryStream(context.Background(), "carol@example.com",
		QueryInput{Query: "hi", Id: 0, Tool: "", Mode: "instant"}, nil)
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
	gdb := setupExpertTestDB(t)
	sseChatServer(t)
	svc := &Service{}
	seed := model.QuestionAgentLog{
		DialogueId: "d1", UserName: "dan@example.com", Query: "old",
		ServerId: "srv-1", TaskId: "task-1", LogStatus: "RUNNING",
		ServerFilePath: "obs://old/path", Status: "RUNNING", Mode: "instant",
	}
	if err := gdb.Create(&seed).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	out, err := svc.QueryStream(context.Background(), "dan@example.com",
		QueryInput{Query: "hi", Id: 0, RefreshId: seed.Id, Tool: "", Mode: "instant"}, nil)
	if err != nil {
		t.Fatalf("QueryStream refresh error: %v", err)
	}
	if out.Id != seed.Id {
		t.Fatalf("refresh must update in place: out.Id=%d, want %d", out.Id, seed.Id)
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
	gdb := setupExpertTestDB(t)
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
		QueryInput{Query: "hi", Id: 0, Tool: "", Mode: "instant"}, nil)
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
