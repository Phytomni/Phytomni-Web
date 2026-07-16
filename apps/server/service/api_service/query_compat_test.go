package api_service

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	rxBot "phytomni-server/external/bot"
)

// compatChatServer serves one synthetic ChatCompletion response so identity
// shaping can be tested independently of Bot's OpenAI-compatible completion id.
func compatChatServer(t *testing.T, chatBody string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/v1/chat/completions" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_, _ = w.Write([]byte(chatBody))
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, ExpertEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })
}

func TestQueryUsesRunIDNotOpenAICompletionID(t *testing.T) {
	setupExpertTestDB(t)
	compatChatServer(t, `{"id":"chatcmpl-7","run_id":"run-7","report_revision":7,"choices":[{"message":{"content":"answer"}}]}`)

	out, err := NewService().Query(context.WithValue(context.Background(), "x-request-id", "web-req-7"), "alice", QueryInput{Query: "q"})
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	if out.BotRunID != "run-7" {
		t.Fatalf("bot_run_id=%q", out.BotRunID)
	}
	if out.BotRunID == "chatcmpl-7" {
		t.Fatal("OpenAI completion id used as Bot run id")
	}
	if out.ReportRevision != 7 || out.RequestID != "web-req-7" {
		t.Fatalf("metadata revision=%d request_id=%q", out.ReportRevision, out.RequestID)
	}
}

func TestQueryReturnsDegradedTrackingWithoutSyntheticRunID(t *testing.T) {
	setupExpertTestDB(t)
	compatChatServer(t, `{"id":"chatcmpl-8","run_id":null,"degraded_tracking":true,"choices":[{"message":{"content":"answer"}}]}`)

	out, err := NewService().Query(context.Background(), "alice", QueryInput{Query: "q"})
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	if out.BotRunID != "" || !out.TrackingDegraded {
		t.Fatalf("out=%#v", out)
	}
}

func TestQueryRemoteMissingRunIDDoesNotPersistPollableRow(t *testing.T) {
	gdb := setupExpertTestDB(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/query/route" {
			_, _ = w.Write([]byte(`{"id":"legacy-completion","run_id":null,"status":"running","task_ids":["task-remote"],"degraded_tracking":false,"agent":"analyst","result":{}}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, ExpertEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	_, err := NewService().Query(context.Background(), "alice", QueryInput{Query: "q", Mode: "expert"})
	if !errors.Is(err, ErrMissingBotRunID) {
		t.Fatalf("missing umbrella run id error=%v, want ErrMissingBotRunID", err)
	}
	var rows int64
	if err := gdb.Model(&struct{}{}).Table("question_agent_logs").Count(&rows).Error; err != nil {
		t.Fatalf("count rows: %v", err)
	}
	if rows != 0 {
		t.Fatalf("unpollable running response persisted %d row(s)", rows)
	}
}
