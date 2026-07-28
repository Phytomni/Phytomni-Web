package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

func v1SubmissionServer(
	t *testing.T,
	handler func(http.ResponseWriter, *http.Request),
) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(handler))
	t.Cleanup(server.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true, ExpertEnabled: true,
		StreamEnabled: true, MultiturnV1Enabled: true, TimeoutSeconds: 2,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })
	return server
}

func TestQuerySubmissionPersistsBeforeBotAndUsesStableTurnIdentity(t *testing.T) {
	gdb := setupExpertTestDB(t)
	var (
		mu       sync.Mutex
		calls    int
		captured rxBot.ChatCompletionRequest
	)
	v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		calls++
		var count int64
		if err := gdb.Model(&model.QuestionAgentLog{}).
			Where("status = ?", "SUBMITTING").
			Count(&count).Error; err != nil {
			t.Errorf("count submitting rows: %v", err)
		}
		if count != 1 {
			t.Errorf("submitting rows before Bot = %d, want 1", count)
		}
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Errorf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chat-1","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"ok"}}],"formatted":{"answer":"ok"}}`))
	})

	input := QueryInput{
		Query: "hello", Mode: "instant", Tool: "DataAgent",
		ClientTurnID: "stable-turn-1",
	}
	first, err := NewService().Query(context.Background(), "alice", input)
	if err != nil {
		t.Fatalf("first Query: %v", err)
	}
	second, err := NewService().Query(context.Background(), "alice", input)
	if err != nil {
		t.Fatalf("retry Query: %v", err)
	}
	if first.Id != second.Id || first.DialogueId != second.DialogueId {
		t.Fatalf("retry identity changed: first=%+v second=%+v", first, second)
	}
	if calls != 1 {
		t.Fatalf("Bot calls = %d, want 1", calls)
	}
	if captured.Conversation == nil {
		t.Fatal("missing V1 conversation envelope")
	}
	if captured.Conversation.TurnID != "1" || captured.Conversation.LedgerCursor != 1 {
		t.Fatalf("turn identity = %q/%d, want 1/1",
			captured.Conversation.TurnID,
			captured.Conversation.LedgerCursor,
		)
	}
	if captured.Conversation.Mode != "instant" ||
		captured.Conversation.RequestedAgentID == nil ||
		*captured.Conversation.RequestedAgentID != "ChatAgent" {
		t.Fatalf("instant routing was not locked: %#v", captured.Conversation)
	}
	var row model.QuestionAgentLog
	if err := gdb.First(&row, first.Id).Error; err != nil {
		t.Fatal(err)
	}
	private, err := LoadBotConversationContext(context.Background(), "alice", row.Id)
	if err != nil {
		t.Fatal(err)
	}
	if private.ClientTurnID != input.ClientTurnID {
		t.Fatalf("stored client turn = %q, want %q", private.ClientTurnID, input.ClientTurnID)
	}
}

func TestQuerySubmissionDuplicateConflictFailsClosed(t *testing.T) {
	setupExpertTestDB(t)
	var calls int
	v1SubmissionServer(t, func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chat-1","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"ok"}}],"formatted":{"answer":"ok"}}`))
	})
	service := NewService()
	if _, err := service.Query(context.Background(), "alice", QueryInput{
		Query: "first", Mode: "instant", ClientTurnID: "duplicate-turn-1",
	}); err != nil {
		t.Fatal(err)
	}
	_, err := service.Query(context.Background(), "alice", QueryInput{
		Query: "changed", Mode: "instant", ClientTurnID: "duplicate-turn-1",
	})
	if !errors.Is(err, ErrDuplicateClientTurn) {
		t.Fatalf("duplicate mismatch error = %v", err)
	}
	if calls != 1 {
		t.Fatalf("Bot calls = %d, want 1", calls)
	}
}

func TestQuerySubmissionConcurrentDuplicateAllocatesOneRow(t *testing.T) {
	gdb := setupExpertTestDB(t)
	v1SubmissionServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chat-1","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"ok"}}],"formatted":{"answer":"ok"}}`))
	})

	const workers = 2
	ids := make(chan int64, workers)
	errs := make(chan error, workers)
	start := make(chan struct{})
	for range workers {
		go func() {
			<-start
			out, err := NewService().Query(context.Background(), "alice", QueryInput{
				Query: "same", Mode: "instant", ClientTurnID: "concurrent-turn-1",
			})
			if err == nil {
				ids <- out.Id
			}
			errs <- err
		}()
	}
	close(start)
	var firstID int64
	for range workers {
		if err := <-errs; err != nil {
			t.Fatalf("concurrent Query: %v", err)
		}
		id := <-ids
		if firstID == 0 {
			firstID = id
		} else if id != firstID {
			t.Fatalf("concurrent row ids = %d and %d", firstID, id)
		}
	}
	var count int64
	if err := gdb.Model(&model.QuestionAgentLog{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("row count = %d, want 1", count)
	}
}

func TestQuerySubmissionUploadFailureSettlesFailed(t *testing.T) {
	gdb := setupExpertTestDB(t)
	v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/files" {
			t.Errorf("unexpected Bot path %s", r.URL.Path)
		}
		http.Error(w, `{"error":{"message":"upload rejected"}}`, http.StatusBadRequest)
	})

	_, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "with file", Mode: "instant", ClientTurnID: "upload-turn-1",
		Files: []QueryFile{{Filename: "input.csv", Data: []byte("a,b\n1,2\n")}},
	})
	if err == nil {
		t.Fatal("expected upload error")
	}
	var row model.QuestionAgentLog
	if err := gdb.First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != "FAILED" {
		t.Fatalf("status = %q, want FAILED", row.Status)
	}
}

func TestQuerySubmissionDefiniteBotFailuresSettleFailed(t *testing.T) {
	tests := []struct {
		name     string
		mode     string
		path     string
		status   int
		response string
		wantErr  error
	}{
		{
			name:     "chat API rejection",
			mode:     "instant",
			path:     "/v1/chat/completions",
			status:   http.StatusBadRequest,
			response: `{"error":{"code":"invalid_request","message":"bad request"}}`,
		},
		{
			name:     "chat malformed response",
			mode:     "instant",
			path:     "/v1/chat/completions",
			status:   http.StatusOK,
			response: `{"id":`,
		},
		{
			name:     "expert malformed response",
			mode:     "expert",
			path:     "/v1/query/route",
			status:   http.StatusOK,
			response: `{"id":"run-bad","agent":`,
			wantErr:  ErrExpertRouteContract,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != tc.path {
					t.Errorf("Bot path = %s, want %s", r.URL.Path, tc.path)
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.response))
			})

			_, err := NewService().Query(context.Background(), "alice", QueryInput{
				Query:        "definite failure",
				Mode:         tc.mode,
				ClientTurnID: "definite-" + strings.ReplaceAll(tc.name, " ", "-"),
			})
			if err == nil {
				t.Fatal("expected Bot failure")
			}
			if tc.wantErr != nil && !errors.Is(err, tc.wantErr) {
				t.Fatalf("error = %v, want %v", err, tc.wantErr)
			}
			var row model.QuestionAgentLog
			if err := gdb.First(&row).Error; err != nil {
				t.Fatal(err)
			}
			if row.Status != "FAILED" {
				t.Fatalf("status = %q, want FAILED", row.Status)
			}
		})
	}
}

func TestMySQLTurnWaitSecondsUsesBoundedAllocationBudget(t *testing.T) {
	tests := []struct {
		timeout time.Duration
		want    int
	}{
		{timeout: 0, want: 1},
		{timeout: 500 * time.Millisecond, want: 1},
		{timeout: time.Second, want: 1},
		{timeout: 31 * time.Second, want: maxMySQLTurnWaitSeconds},
	}
	for _, tc := range tests {
		if got := mysqlTurnWaitSeconds(tc.timeout); got != tc.want {
			t.Fatalf("mysqlTurnWaitSeconds(%s) = %d, want %d", tc.timeout, got, tc.want)
		}
	}
}

func TestQuerySubmissionUncertainTransportRetainsSubmitting(t *testing.T) {
	gdb := setupExpertTestDB(t)
	server := v1SubmissionServer(t, func(http.ResponseWriter, *http.Request) {})
	server.Close()

	_, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "retry me", Mode: "instant", ClientTurnID: "transport-turn-1",
	})
	if err == nil {
		t.Fatal("expected transport error")
	}
	var row model.QuestionAgentLog
	if err := gdb.First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != "SUBMITTING" {
		t.Fatalf("status = %q, want SUBMITTING", row.Status)
	}
}

func TestQuerySubmissionRejectsUnsafeFileBeforeAllocation(t *testing.T) {
	gdb := setupExpertTestDB(t)
	v1SubmissionServer(t, func(http.ResponseWriter, *http.Request) {
		t.Fatal("Bot must not be called")
	})

	for index, file := range []QueryFile{
		{Filename: "../secret.csv", Data: []byte("x")},
		{Filename: "payload.exe", Data: []byte("x")},
		{Filename: "empty.csv", Data: nil},
	} {
		_, err := NewService().Query(context.Background(), "alice", QueryInput{
			Query: "unsafe", Mode: "instant", ClientTurnID: "unsafe-file-" + strconv.Itoa(index),
			Files: []QueryFile{file},
		})
		if !errors.Is(err, ErrInvalidQueryFile) {
			t.Fatalf("file %q error = %v, want invalid file", file.Filename, err)
		}
	}
	var count int64
	if err := gdb.Model(&model.QuestionAgentLog{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("allocated rows = %d, want 0", count)
	}
}

func TestQuerySubmissionAsyncReconcilerRemainsRunningOnly(t *testing.T) {
	source, err := os.ReadFile("../../cron/task_reconciler.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	if !strings.Contains(text, `Where("status = ?", "RUNNING")`) {
		t.Fatal("async reconciler no longer has an explicit RUNNING-only predicate")
	}
	if strings.Contains(text, `"SUBMITTING"`) {
		t.Fatal("async reconciler must not select SUBMITTING rows")
	}
}
