package bot

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// newTestClient points a Client at an httptest server.
func newTestClient(url string) *Client {
	return &Client{http: http.DefaultClient, baseURL: url, userKey: "ptm_test"}
}

func TestListRunsSendsDialogueFilter(t *testing.T) {
	var gotQuery, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.Query().Get("dialogue_id")
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"object":"list","data":[{"run_id":"r1","answer":"hi","query":"q","tool_name":"chat"}]}`))
	}))
	defer srv.Close()

	resp, err := newTestClient(srv.URL).ListRuns(context.Background(), "dlg-9")
	if err != nil {
		t.Fatalf("ListRuns error: %v", err)
	}
	if gotQuery != "dlg-9" {
		t.Errorf("dialogue_id filter = %q, want dlg-9", gotQuery)
	}
	if gotAuth != "Bearer ptm_test" {
		t.Errorf("Authorization = %q, want Bearer ptm_test", gotAuth)
	}
	if len(resp.Data) != 1 || resp.Data[0].Answer != "hi" {
		t.Errorf("unexpected runs payload: %+v", resp.Data)
	}
}

func TestDoJSONDecodesErrorEnvelope(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"type":"bad_request","code":400,"message":"streaming unsupported","request_id":"req-7"}}`))
	}))
	defer srv.Close()

	_, err := newTestClient(srv.URL).GetAgents(context.Background())
	if err == nil {
		t.Fatal("expected error for 400 response")
	}
	if want := "streaming unsupported"; !contains(err.Error(), want) {
		t.Errorf("error %q does not surface envelope message %q", err.Error(), want)
	}
	if !contains(err.Error(), "req-7") {
		t.Errorf("error %q does not surface request id", err.Error())
	}
}

func TestInvokeAgentDedupHit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"id":null,"object":"agent.run","agent":"analyst","status":"running","task_ids":[],"result":{"dedup_hit":true,"task_id":"task-prior"}}`))
	}))
	defer srv.Close()

	resp, err := newTestClient(srv.URL).InvokeAgent(context.Background(), "analyst", AgentRunRequest{Arguments: map[string]interface{}{"user_query": "x"}})
	if err != nil {
		t.Fatalf("InvokeAgent error: %v", err)
	}
	if resp.ID != nil {
		t.Errorf("dedup hit id = %v, want nil", *resp.ID)
	}
	if !resp.Result.DedupHit || resp.Result.TaskID != "task-prior" {
		t.Errorf("dedup hit not surfaced: %+v", resp.Result)
	}
}

func TestInvokeAgentRejectsDuplicateRunIdentityKeys(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"run-first","id":"run-last","object":"agent.run","agent":"analyst","status":"running","task_ids":["task-1"],"result":{}}`))
	}))
	defer srv.Close()

	response, err := newTestClient(srv.URL).InvokeAgent(
		context.Background(),
		"analyst",
		AgentRunRequest{Arguments: map[string]interface{}{"user_query": "x"}},
	)
	if err == nil {
		t.Fatalf("InvokeAgent accepted duplicate identity keys: %#v", response)
	}
	if !errors.Is(err, errDuplicateJSONKey) {
		t.Fatalf("InvokeAgent error = %T %v, want errDuplicateJSONKey", err, err)
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

func TestSurfaceableMessage(t *testing.T) {
	// 4xx (except auth) with a message → surface it.
	if msg, ok := SurfaceableMessage(&APIError{Status: 400, Message: "cannot parse gene"}); !ok || msg != "cannot parse gene" {
		t.Errorf("400 should surface: ok=%v msg=%q", ok, msg)
	}
	if _, ok := SurfaceableMessage(&APIError{Status: 413, Message: "too big"}); !ok {
		t.Error("413 should surface")
	}
	// auth + server errors → not surfaced (avoid bouncing the user to login / leaking internals).
	if _, ok := SurfaceableMessage(&APIError{Status: 401, Message: "unauthorized"}); ok {
		t.Error("401 must NOT surface")
	}
	if _, ok := SurfaceableMessage(&APIError{Status: 403, Message: "forbidden"}); ok {
		t.Error("403 must NOT surface")
	}
	if _, ok := SurfaceableMessage(&APIError{Status: 500, Message: "boom"}); ok {
		t.Error("500 must NOT surface")
	}
	// no envelope message, or a non-APIError → not surfaced.
	if _, ok := SurfaceableMessage(&APIError{Status: 400, Message: ""}); ok {
		t.Error("empty message must NOT surface")
	}
	if _, ok := SurfaceableMessage(errors.New("plain")); ok {
		t.Error("non-APIError must NOT surface")
	}
}

func TestAPIErrorTruncatesRawBody(t *testing.T) {
	// No envelope message → Error() falls back to the raw body branch, which
	// reaches the logs. An oversized body must be truncated, not echoed whole.
	big := strings.Repeat("x", 1000)
	got := (&APIError{Method: "GET", Path: "/v1/runs", Status: 500, body: big}).Error()
	if contains(got, big) {
		t.Fatalf("full 1000-char raw body leaked into error string: %q", got)
	}
	if !contains(got, "(truncated)") {
		t.Fatalf("oversized body should be marked truncated: %q", got)
	}
	// A short body is diagnostic and stays intact.
	short := (&APIError{Method: "GET", Path: "/v1/runs", Status: 500, body: "oops"}).Error()
	if !contains(short, "oops") {
		t.Fatalf("short body should be preserved for diagnostics: %q", short)
	}
	if contains(short, "(truncated)") {
		t.Fatalf("short body should not be marked truncated: %q", short)
	}
}

func TestBotErrorIsTyped(t *testing.T) {
	err := botError("POST", "/v1/agents/deep_genome/runs", 400,
		[]byte(`{"error":{"type":"invalid","code":400,"message":"cannot parse gene","request_id":"r1"}}`))
	var ae *APIError
	if !errors.As(err, &ae) {
		t.Fatalf("botError should return *APIError, got %T", err)
	}
	if ae.Status != 400 || ae.Message != "cannot parse gene" || ae.RequestID != "r1" {
		t.Errorf("APIError fields wrong: %+v", ae)
	}
}

func TestDoJSON_WrapsTimeoutAsErrBotTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond) // longer than the client timeout, to force a real client-timeout error
	}))
	defer srv.Close()
	c := &Client{
		http:    &http.Client{Timeout: 20 * time.Millisecond},
		baseURL: srv.URL,
		userKey: "ptm_test",
	}
	err := c.doJSON(context.Background(), http.MethodGet, "/v1/agents", nil, nil)
	if !errors.Is(err, ErrBotTimeout) {
		t.Fatalf("err = %v, want wrapped ErrBotTimeout", err)
	}
}

func TestChatCompletionWrapperPreservesTimeoutContract(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
	}))
	defer srv.Close()

	c := newTestClient(srv.URL)
	c.http = &http.Client{Timeout: 20 * time.Millisecond}
	response, err := c.ChatCompletion(context.Background(), ChatCompletionRequest{})
	if response != nil {
		t.Fatalf("response=%#v, want nil on timeout", response)
	}
	if err == nil || !errors.Is(err, ErrBotTimeout) {
		t.Fatalf("err=%v, want wrapped ErrBotTimeout", err)
	}
}

func TestNewClientWithTimeoutUsesExplicitDuration(t *testing.T) {
	previous := BotConfig
	BotConfig = &Config{
		BaseURL:        "http://bot.test",
		UserAPIKey:     "ptm_test",
		TimeoutSeconds: 17,
	}
	t.Cleanup(func() { BotConfig = previous })

	client := NewClientWithTimeout(125 * time.Millisecond)
	if got := client.http.Timeout; got != 125*time.Millisecond {
		t.Fatalf("explicit timeout=%s, want 125ms", got)
	}
}

func TestNewClientUsesGlobalTimeout(t *testing.T) {
	previous := BotConfig
	BotConfig = &Config{
		BaseURL:        "http://bot.test",
		UserAPIKey:     "ptm_test",
		TimeoutSeconds: 17,
	}
	t.Cleanup(func() { BotConfig = previous })

	client := NewClient()
	if got := client.http.Timeout; got != 17*time.Second {
		t.Fatalf("global timeout=%s, want 17s", got)
	}
}
