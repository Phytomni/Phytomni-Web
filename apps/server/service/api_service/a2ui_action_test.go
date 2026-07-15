package api_service

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	rxBot "phytomni-server/external/bot"
)

const validA2uiActionBody = `{"surface_id":"surface-1","widget":"confirm","action_id":"submit","run_id":"run-1","payload":{"approved":true}}`

func TestA2uiAction_EnvelopeStrictDecode(t *testing.T) {
	validID := strings.Repeat("界", a2uiIdentifierMaxChars)
	validBoundaryBody := `{"surface_id":"` + validID + `","widget":"confirm","action_id":"submit","run_id":"run-1","payload":{}}`

	tests := []struct {
		name string
		body string
		want bool
	}{
		{name: "confirm", body: validA2uiActionBody, want: true},
		{name: "form", body: `{"surface_id":"s1","widget":"form","action_id":"submit","run_id":"run-1","payload":{"fields":{}}}`, want: true},
		{name: "choice", body: `{"surface_id":"s1","widget":"choice","action_id":"submit","run_id":"run-1","payload":{"selected":"a"}}`, want: true},
		{name: "identifier upper boundary", body: validBoundaryBody, want: true},
		{name: "missing surface id", body: `{"widget":"confirm","action_id":"submit","run_id":"run-1","payload":{}}`, want: false},
		{name: "missing payload", body: `{"surface_id":"s1","widget":"confirm","action_id":"submit","run_id":"run-1"}`, want: false},
		{name: "unknown top level field", body: `{"surface_id":"s1","widget":"confirm","action_id":"submit","run_id":"run-1","payload":{},"extra":1}`, want: false},
		{name: "duplicate top level field", body: `{"surface_id":"s1","widget":"confirm","action_id":"submit","run_id":"run-1","run_id":"run-1","payload":{}}`, want: false},
		{name: "concatenated values", body: validA2uiActionBody + `{}`, want: false},
		{name: "trailing non-whitespace", body: validA2uiActionBody + ` trailing`, want: false},
		{name: "trimmed surface id required", body: `{"surface_id":" s1","widget":"confirm","action_id":"submit","run_id":"run-1","payload":{}}`, want: false},
		{name: "trimmed action id required", body: `{"surface_id":"s1","widget":"confirm","action_id":"submit ","run_id":"run-1","payload":{}}`, want: false},
		{name: "trimmed run id required", body: `{"surface_id":"s1","widget":"confirm","action_id":"submit","run_id":"\trun-1","payload":{}}`, want: false},
		{name: "empty identifier", body: `{"surface_id":"","widget":"confirm","action_id":"submit","run_id":"run-1","payload":{}}`, want: false},
		{name: "overlong identifier", body: `{"surface_id":"` + strings.Repeat("界", a2uiIdentifierMaxChars+1) + `","widget":"confirm","action_id":"submit","run_id":"run-1","payload":{}}`, want: false},
		{name: "unknown widget", body: `{"surface_id":"s1","widget":"button","action_id":"submit","run_id":"run-1","payload":{}}`, want: false},
		{name: "null payload", body: `{"surface_id":"s1","widget":"confirm","action_id":"submit","run_id":"run-1","payload":null}`, want: false},
		{name: "array payload", body: `{"surface_id":"s1","widget":"confirm","action_id":"submit","run_id":"run-1","payload":[]}`, want: false},
		{name: "scalar payload", body: `{"surface_id":"s1","widget":"confirm","action_id":"submit","run_id":"run-1","payload":true}`, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := decodeA2uiActionEnvelope([]byte(tt.body))
			if tt.want {
				if err != nil {
					t.Fatalf("decodeA2uiActionEnvelope: %v", err)
				}
				if got.SurfaceID == "" || got.Widget == "" || got.ActionID == "" || got.RunID == "" || len(got.Payload) == 0 {
					t.Fatalf("decoded envelope is incomplete: %+v", got)
				}
				return
			}
			if err == nil {
				t.Fatalf("decodeA2uiActionEnvelope(%q) succeeded: %+v", tt.body, got)
			}
		})
	}
}

func setupA2uiActionTest(t *testing.T) {
	t.Helper()
	gdb := setupTestDB(t)
	if err := gdb.Exec(`
		INSERT INTO question_agent_logs
			(dialogue_id, user_name, bot_run_id, query, answer, tool_name, status, created_at)
		VALUES
			('dlg-1', 'alice@x.com', 'run-1', 'q', 'a', 'chat', 'SUCCEEDED', datetime('now'))
	`).Error; err != nil {
		t.Fatalf("seed question_agent_logs: %v", err)
	}
	t.Cleanup(func() { rxBot.BotConfig = nil })
}

func TestA2uiAction_OwnershipMiss404(t *testing.T) {
	tests := []struct {
		name     string
		username string
		body     string
	}{
		{name: "wrong owner", username: "bob@x.com", body: validA2uiActionBody},
		{
			name:     "wrong run",
			username: "alice@x.com",
			body:     `{"surface_id":"surface-1","widget":"confirm","action_id":"submit","run_id":"run-2","payload":{}}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setupA2uiActionTest(t)
			rxBot.BotConfig = &rxBot.Config{ProxyEnabled: true, A2uiActionsEnabled: true}

			outcome, err := (&Service{}).A2uiAction(
				context.Background(), tt.username, "dlg-1", []byte(tt.body),
			)

			if outcome != nil {
				t.Fatalf("outcome = %#v, want nil", outcome)
			}
			if !errors.Is(err, ErrA2uiActionNotFound) {
				t.Fatalf("error = %v, want ErrA2uiActionNotFound", err)
			}
		})
	}
}

func TestA2uiAction_RunMismatchDoesNotCallBot(t *testing.T) {
	setupA2uiActionTest(t)
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{
		ProxyEnabled:       true,
		A2uiActionsEnabled: true,
		BaseURL:            srv.URL,
		UserAPIKey:         "test-user-key",
		TimeoutSeconds:     5,
	}

	outcome, err := (&Service{}).A2uiAction(
		context.Background(), "alice@x.com", "dlg-1",
		[]byte(`{"surface_id":"surface-1","widget":"confirm","action_id":"submit","run_id":"run-mismatch","payload":{}}`),
	)

	if outcome != nil {
		t.Fatalf("outcome = %#v, want nil", outcome)
	}
	if !errors.Is(err, ErrA2uiActionNotFound) {
		t.Fatalf("error = %v, want ErrA2uiActionNotFound", err)
	}
	if got := hits.Load(); got != 0 {
		t.Fatalf("Bot hits = %d, want 0", got)
	}
}

func TestA2uiAction_FlagOffStub403(t *testing.T) {
	setupA2uiActionTest(t)
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{
		ProxyEnabled:       true,
		A2uiActionsEnabled: false,
		BaseURL:            srv.URL,
		UserAPIKey:         "test-user-key",
		TimeoutSeconds:     5,
	}

	outcome, err := (&Service{}).A2uiAction(
		context.Background(), "alice@x.com", "dlg-1", []byte(validA2uiActionBody),
	)

	if err != nil {
		t.Fatalf("A2uiAction: %v", err)
	}
	if outcome.Status != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", outcome.Status)
	}
	const wantBody = `{"status":403,"error":{"type":"forbidden","code":403,"message":"a2ui disabled"}}`
	if string(outcome.Body) != wantBody {
		t.Fatalf("body = %q, want %q", outcome.Body, wantBody)
	}
	if outcome.ContentType != "application/json" {
		t.Fatalf("content type = %q, want application/json", outcome.ContentType)
	}
	if got := hits.Load(); got != 0 {
		t.Fatalf("Bot hits = %d, want 0", got)
	}
}

func TestA2uiAction_ProxyDisabled503(t *testing.T) {
	setupA2uiActionTest(t)
	rxBot.BotConfig = &rxBot.Config{
		ProxyEnabled:       false,
		A2uiActionsEnabled: true,
	}

	outcome, err := (&Service{}).A2uiAction(
		context.Background(), "alice@x.com", "dlg-1", []byte(validA2uiActionBody),
	)

	if outcome != nil {
		t.Fatalf("outcome = %#v, want nil", outcome)
	}
	if !errors.Is(err, ErrGatewayDisabled) {
		t.Fatalf("error = %v, want ErrGatewayDisabled", err)
	}
}

func TestA2uiAction_FlagOnPassthrough(t *testing.T) {
	setupA2uiActionTest(t)
	var receivedPath string
	var receivedBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedPath = r.URL.Path
		raw, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read request body: %v", err)
		}
		receivedBody = string(raw)
		w.Header().Set("Content-Type", "application/problem+json")
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"error":"surface expired"}`))
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{
		ProxyEnabled:       true,
		A2uiActionsEnabled: true,
		BaseURL:            srv.URL,
		UserAPIKey:         "test-user-key",
		TimeoutSeconds:     5,
	}

	outcome, err := (&Service{}).A2uiAction(
		context.Background(), "alice@x.com", "dlg-1", []byte(validA2uiActionBody),
	)

	if err != nil {
		t.Fatalf("A2uiAction: %v", err)
	}
	if outcome.Status != http.StatusConflict {
		t.Fatalf("status = %d, want 409", outcome.Status)
	}
	if string(outcome.Body) != `{"error":"surface expired"}` {
		t.Fatalf("body = %q", outcome.Body)
	}
	if outcome.ContentType != "application/problem+json" {
		t.Fatalf("content type = %q", outcome.ContentType)
	}
	if !strings.HasSuffix(receivedPath, "/a2ui-actions") {
		t.Fatalf("path = %q, want suffix /a2ui-actions", receivedPath)
	}
	if receivedPath != "/v1/runs/run-1/a2ui-actions" {
		t.Fatalf("path = %q, want /v1/runs/run-1/a2ui-actions", receivedPath)
	}
	if receivedBody != validA2uiActionBody {
		t.Fatalf("forwarded body = %q, want raw body %q", receivedBody, validA2uiActionBody)
	}
}

func TestA2uiAction_BadEnvelope(t *testing.T) {
	setupA2uiActionTest(t)
	rxBot.BotConfig = &rxBot.Config{ProxyEnabled: true, A2uiActionsEnabled: true}

	outcome, err := (&Service{}).A2uiAction(
		context.Background(),
		"alice@x.com",
		"dlg-1",
		[]byte(`{"surface_id":"surface-1","widget":"confirm","action_id":"submit","payload":{}}`),
	)

	if outcome != nil {
		t.Fatalf("outcome = %#v, want nil", outcome)
	}
	if !errors.Is(err, ErrA2uiActionBadRequest) {
		t.Fatalf("error = %v, want ErrA2uiActionBadRequest", err)
	}
}
