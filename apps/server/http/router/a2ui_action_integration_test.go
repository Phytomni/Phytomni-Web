package router

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"phytomni-server/db"
	"phytomni-server/external/bot"
	"phytomni-server/middleware"
)

const e2eA2uiSucceededBody = `{"status":"succeeded","run_id":"run-1","result":{"a2ui":{"catalog_version":"v1.0","surface_id":"surface-1","widget":"confirm","props":{"status":"submitted","accepted":true}}}}`

const e2eA2uiAuthoritativeRunBody = `{"run_id":"run-1","agent":"review","status":"succeeded","result":{"formatted":{"answer":"A2UI action completed","references":[]}}}`

const e2eA2uiInputRequiredBody = `{"status":"input_required","run_id":"run-1","interrupt":{"draft":{"a2ui":{"catalog_version":"v1.0","surface_id":"surface-2","widget":"choice","props":{"title":"Choose","options":[{"id":"a","label":"A"}],"multiple":false}}}}}`

const e2eA2uiConfirmBody = `{"surface_id":"surface-1","widget":"confirm","action_id":"submit","run_id":"run-1","payload":{"accepted":true}}`

func buildA2uiActionE2EEnv(t *testing.T) (*gin.Engine, *gorm.DB) {
	t.Helper()
	previous, hadPrevious := db.Get("phytomni-server")
	engine, gdb := buildChatGateEnv(t)
	t.Cleanup(func() {
		if hadPrevious {
			db.Set("phytomni-server", previous)
			return
		}
		db.Set("phytomni-server", nil)
	})
	return engine, gdb
}

func configureA2uiE2eBot(t *testing.T, baseURL string, timeoutSeconds int, _ bool) {
	t.Helper()
	previous := bot.BotConfig
	bot.BotConfig = &bot.Config{
		BaseURL:        baseURL,
		UserAPIKey:     "ptm-task34",
		ProxyEnabled:   true,
		TimeoutSeconds: timeoutSeconds,
	}
	t.Cleanup(func() { bot.BotConfig = previous })
}

func startA2uiFakeBot(t *testing.T, status int, contentType string, body []byte, delay time.Duration) (*httptest.Server, *atomic.Int64) {
	t.Helper()
	calls := new(atomic.Int64)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/v1/runs/run-1" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(e2eA2uiAuthoritativeRunBody))
			return
		}
		calls.Add(1)
		if r.URL.Path != "/v1/runs/run-1/a2ui-actions" {
			t.Errorf("Bot path = %q, want /v1/runs/run-1/a2ui-actions", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer ptm-task34" {
			t.Errorf("Bot Authorization = %q, want Bearer ptm-task34", got)
		}
		if delay > 0 {
			timer := time.NewTimer(delay)
			defer timer.Stop()
			select {
			case <-timer.C:
			case <-r.Context().Done():
				return
			}
		}
		if contentType != "" {
			w.Header().Set("Content-Type", contentType)
		}
		w.WriteHeader(status)
		_, _ = w.Write(body)
	}))
	t.Cleanup(server.Close)
	return server, calls
}

func seedA2uiUserToken(t *testing.T, gdb *gorm.DB, email, firstLoginStatus string) string {
	t.Helper()
	if err := gdb.Exec(`INSERT INTO users (email, code, chat_limit, first_login_status) VALUES (?, 'user', 5, ?)`, email, firstLoginStatus).Error; err != nil {
		t.Fatalf("seed A2UI user: %v", err)
	}
	token, err := middleware.GenerateToken(email)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}
	return token
}

func sendA2uiActionE2ERequestAt(engine *gin.Engine, route, token string, body []byte, contentType string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, route, bytes.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	return w
}

func e2eA2uiBodyWithRun(runID string) []byte {
	return []byte(strings.Replace(e2eA2uiConfirmBody, `"run-1"`, fmt.Sprintf("%q", runID), 1))
}

func e2eA2uiBodyOfSize(t *testing.T, size int64) []byte {
	t.Helper()
	base := []byte(e2eA2uiConfirmBody)
	if size < int64(len(base)) {
		t.Fatalf("A2UI body size %d is smaller than base envelope %d", size, len(base))
	}
	return append(append([]byte(nil), base...), bytes.Repeat([]byte(" "), int(size)-len(base))...)
}

func e2eA2uiResponseOfSize(t *testing.T, size int64) []byte {
	t.Helper()
	base := []byte(e2eA2uiSucceededBody)
	if size < int64(len(base)) {
		t.Fatalf("A2UI response size %d is smaller than base response %d", size, len(base))
	}
	return append(append([]byte(nil), base...), bytes.Repeat([]byte(" "), int(size)-len(base))...)
}

func TestE2E_A2uiActionValidResponses(t *testing.T) {
	tests := []struct {
		name            string
		status          int
		body            string
		wantContentType string
	}{
		{name: "terminal", status: http.StatusOK, body: e2eA2uiSucceededBody, wantContentType: "application/json"},
		{name: "input required", status: http.StatusAccepted, body: e2eA2uiInputRequiredBody, wantContentType: "application/json"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			engine, gdb := buildA2uiActionE2EEnv(t)
			token := seedA2uiActionOwner(t, gdb, "task34-"+tt.name+"@x.com", "1")
			fakeBot, calls := startA2uiFakeBot(t, tt.status, tt.wantContentType, []byte(tt.body), 0)
			configureA2uiE2eBot(t, fakeBot.URL, 5, true)

			response := sendA2uiActionRequest(engine, token, []byte(e2eA2uiConfirmBody), "application/json")
			if response.Code != tt.status {
				t.Fatalf("A2UI response status = %d, want %d; body=%s", response.Code, tt.status, response.Body.String())
			}
			if response.Body.String() != tt.body {
				t.Fatalf("A2UI response body = %q, want %q", response.Body.String(), tt.body)
			}
			if got := response.Header().Get("Content-Type"); got != tt.wantContentType {
				t.Fatalf("A2UI response Content-Type = %q, want %q", got, tt.wantContentType)
			}
			if got := calls.Load(); got != 1 {
				t.Fatalf("Bot calls = %d, want 1", got)
			}
			waitForOperationLogCount(t, gdb, a2uiActionRoutePath, 1)
		})
	}
}

func TestE2E_A2uiActionBotErrorsPassThrough(t *testing.T) {
	tests := []struct {
		name        string
		status      int
		contentType string
		body        string
	}{
		{name: "bad request", status: http.StatusBadRequest, contentType: "application/json", body: `{"error":{"code":"invalid_action","message":"payload rejected"}}`},
		{name: "not found", status: http.StatusNotFound, contentType: "application/problem+json", body: `{"error":{"code":"run_not_found","request_id":"bot-404"}}`},
		{name: "conflict", status: http.StatusConflict, contentType: "application/json", body: `{"error":{"code":"stale_surface","message":"surface changed"}}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			engine, gdb := buildA2uiActionE2EEnv(t)
			token := seedA2uiActionOwner(t, gdb, "task34-pass-through-"+tt.name+"@x.com", "1")
			fakeBot, calls := startA2uiFakeBot(t, tt.status, tt.contentType, []byte(tt.body), 0)
			configureA2uiE2eBot(t, fakeBot.URL, 5, true)

			response := sendA2uiActionRequest(engine, token, []byte(e2eA2uiConfirmBody), "application/json")
			if response.Code != tt.status {
				t.Fatalf("Bot error status = %d, want %d; body=%s", response.Code, tt.status, response.Body.String())
			}
			if response.Body.String() != tt.body {
				t.Fatalf("Bot error body = %q, want %q", response.Body.String(), tt.body)
			}
			if got := response.Header().Get("Content-Type"); got != tt.contentType {
				t.Fatalf("Bot error Content-Type = %q, want %q", got, tt.contentType)
			}
			if got := calls.Load(); got != 1 {
				t.Fatalf("Bot calls = %d, want 1", got)
			}
			waitForOperationLogCount(t, gdb, a2uiActionRoutePath, 1)
		})
	}
}

func TestE2E_A2uiActionAuthorizationAndOwnership(t *testing.T) {
	t.Run("unauthenticated", func(t *testing.T) {
		engine, gdb := buildA2uiActionE2EEnv(t)
		fakeBot, calls := startA2uiFakeBot(t, http.StatusOK, "application/json", []byte(e2eA2uiSucceededBody), 0)
		configureA2uiE2eBot(t, fakeBot.URL, 5, true)

		response := sendA2uiActionRequest(engine, "", []byte(e2eA2uiConfirmBody), "application/json")
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("unauthenticated action status = %d, want 401", response.Code)
		}
		if got := calls.Load(); got != 0 {
			t.Fatalf("unauthenticated Bot calls = %d, want 0", got)
		}
		assertNoOperationLog(t, gdb, a2uiActionRoutePath)
	})

	t.Run("first login", func(t *testing.T) {
		engine, gdb := buildA2uiActionE2EEnv(t)
		token := seedA2uiActionOwner(t, gdb, "task34-first-login@x.com", "0")
		fakeBot, calls := startA2uiFakeBot(t, http.StatusOK, "application/json", []byte(e2eA2uiSucceededBody), 0)
		configureA2uiE2eBot(t, fakeBot.URL, 5, true)

		response := sendA2uiActionRequest(engine, token, bytes.Repeat([]byte("x"), int(middleware.A2uiActionMaxRequestBytes+1)), "application/json")
		if response.Code != http.StatusForbidden {
			t.Fatalf("first-login action status = %d, want 403 before body guard", response.Code)
		}
		if got := calls.Load(); got != 0 {
			t.Fatalf("first-login Bot calls = %d, want 0", got)
		}
		assertNoOperationLog(t, gdb, a2uiActionRoutePath)
	})

	t.Run("wrong owner", func(t *testing.T) {
		engine, gdb := buildA2uiActionE2EEnv(t)
		seedA2uiActionOwner(t, gdb, "task34-real-owner@x.com", "1")
		wrongOwnerToken := seedA2uiUserToken(t, gdb, "task34-wrong-owner@x.com", "1")
		fakeBot, calls := startA2uiFakeBot(t, http.StatusOK, "application/json", []byte(e2eA2uiSucceededBody), 0)
		configureA2uiE2eBot(t, fakeBot.URL, 5, true)

		response := sendA2uiActionRequest(engine, wrongOwnerToken, []byte(e2eA2uiConfirmBody), "application/json")
		if response.Code != http.StatusNotFound {
			t.Fatalf("wrong-owner action status = %d, want 404", response.Code)
		}
		if got := calls.Load(); got != 0 {
			t.Fatalf("wrong-owner Bot calls = %d, want 0", got)
		}
		waitForOperationLogCount(t, gdb, a2uiActionRoutePath, 1)
	})

	t.Run("wrong dialogue", func(t *testing.T) {
		engine, gdb := buildA2uiActionE2EEnv(t)
		token := seedA2uiActionOwner(t, gdb, "task34-wrong-dialogue@x.com", "1")
		fakeBot, calls := startA2uiFakeBot(t, http.StatusOK, "application/json", []byte(e2eA2uiSucceededBody), 0)
		configureA2uiE2eBot(t, fakeBot.URL, 5, true)

		response := sendA2uiActionE2ERequestAt(engine, "/api/v1/conversations/not-owned/a2ui-actions", token, []byte(e2eA2uiConfirmBody), "application/json")
		if response.Code != http.StatusNotFound {
			t.Fatalf("wrong-dialogue action status = %d, want 404", response.Code)
		}
		if got := calls.Load(); got != 0 {
			t.Fatalf("wrong-dialogue Bot calls = %d, want 0", got)
		}
		waitForOperationLogCount(t, gdb, "/api/v1/conversations/not-owned/a2ui-actions", 1)
	})

	t.Run("wrong run", func(t *testing.T) {
		engine, gdb := buildA2uiActionE2EEnv(t)
		token := seedA2uiActionOwner(t, gdb, "task34-wrong-run@x.com", "1")
		fakeBot, calls := startA2uiFakeBot(t, http.StatusOK, "application/json", []byte(e2eA2uiSucceededBody), 0)
		configureA2uiE2eBot(t, fakeBot.URL, 5, true)

		response := sendA2uiActionRequest(engine, token, e2eA2uiBodyWithRun("run-2"), "application/json")
		if response.Code != http.StatusNotFound {
			t.Fatalf("wrong-run action status = %d, want 404", response.Code)
		}
		if got := calls.Load(); got != 0 {
			t.Fatalf("wrong-run Bot calls = %d, want 0", got)
		}
		waitForOperationLogCount(t, gdb, a2uiActionRoutePath, 1)
	})
}

func TestE2E_A2uiActionValidationRejectsBeforeBot(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{name: "confirm payload", body: `{"surface_id":"surface-1","widget":"confirm","action_id":"submit","run_id":"run-1","payload":{}}`},
		{name: "form payload", body: `{"surface_id":"surface-1","widget":"form","action_id":"submit","run_id":"run-1","payload":{"fields":{"email":true}}}`},
		{name: "choice payload", body: `{"surface_id":"surface-1","widget":"choice","action_id":"submit","run_id":"run-1","payload":{"selected":[]}}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			engine, gdb := buildA2uiActionE2EEnv(t)
			token := seedA2uiActionOwner(t, gdb, "task34-invalid-"+tt.name+"@x.com", "1")
			fakeBot, calls := startA2uiFakeBot(t, http.StatusOK, "application/json", []byte(e2eA2uiSucceededBody), 0)
			configureA2uiE2eBot(t, fakeBot.URL, 5, true)

			response := sendA2uiActionRequest(engine, token, []byte(tt.body), "application/json")
			if response.Code != http.StatusUnprocessableEntity {
				t.Fatalf("invalid action status = %d, want 422; body=%s", response.Code, response.Body.String())
			}
			assertA2uiGatewayError(t, response, "a2ui_invalid_action", false, false)
			if got := calls.Load(); got != 0 {
				t.Fatalf("invalid action Bot calls = %d, want 0", got)
			}
			waitForOperationLogCount(t, gdb, a2uiActionRoutePath, 1)
		})
	}
}

func TestE2E_A2uiActionExactRequestLimitReachesBot(t *testing.T) {
	engine, gdb := buildA2uiActionE2EEnv(t)
	token := seedA2uiActionOwner(t, gdb, "task34-request-limit@x.com", "1")
	fakeBot, calls := startA2uiFakeBot(t, http.StatusOK, "application/json", []byte(e2eA2uiSucceededBody), 0)
	configureA2uiE2eBot(t, fakeBot.URL, 5, true)

	body := e2eA2uiBodyOfSize(t, middleware.A2uiActionMaxRequestBytes)
	response := sendA2uiActionRequest(engine, token, body, "application/json")
	if response.Code != http.StatusOK {
		t.Fatalf("exact-limit action status = %d, want 200; body=%s", response.Code, response.Body.String())
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("exact-limit Bot calls = %d, want 1", got)
	}
	waitForOperationLogCount(t, gdb, a2uiActionRoutePath, 1)
}

func TestE2E_A2uiActionOverflowStopsBeforeAuditAndBot(t *testing.T) {
	engine, gdb := buildA2uiActionE2EEnv(t)
	token := seedA2uiActionOwner(t, gdb, "task34-request-overflow@x.com", "1")
	fakeBot, calls := startA2uiFakeBot(t, http.StatusOK, "application/json", []byte(e2eA2uiSucceededBody), 0)
	configureA2uiE2eBot(t, fakeBot.URL, 5, true)

	response := sendA2uiActionRequest(engine, token, e2eA2uiBodyOfSize(t, middleware.A2uiActionMaxRequestBytes+1), "application/json")
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("overflow action status = %d, want 413; body=%s", response.Code, response.Body.String())
	}
	assertA2uiGatewayError(t, response, "a2ui_request_too_large", false, false)
	if got := calls.Load(); got != 0 {
		t.Fatalf("overflow Bot calls = %d, want 0", got)
	}
	assertNoOperationLog(t, gdb, a2uiActionRoutePath)
}

func TestE2E_A2uiActionAuditMasksPayloadAndPreservesIdentifiers(t *testing.T) {
	engine, gdb := buildA2uiActionE2EEnv(t)
	token := seedA2uiActionOwner(t, gdb, "task34-audit@x.com", "1")
	configureA2uiE2eBot(t, "http://127.0.0.1:1", 1, true)
	body := []byte(`{"surface_id":"surface-sensitive","widget":"form","action_id":"submit-sensitive","run_id":"run-1","payload":{"fields":{"email":"researcher@example.com","biological_input":"BRCA1","token":"secret-token"}}}`)

	response := sendA2uiActionRequest(engine, token, body, "application/json")
	if response.Code == http.StatusUnauthorized || response.Code == http.StatusForbidden {
		t.Fatalf("audit action status = %d, want a post-auth response; body=%s", response.Code, response.Body.String())
	}
	waitForOperationLogCount(t, gdb, a2uiActionRoutePath, 1)

	var bodyParams string
	if err := gdb.Table("user_operation_logs").Where("path = ?", a2uiActionRoutePath).Pluck("body_params", &bodyParams).Error; err != nil {
		t.Fatalf("read A2UI operation log: %v", err)
	}
	want := `{"surface_id":"surface-sensitive","widget":"form","action_id":"submit-sensitive","run_id":"run-1","payload":"[REDACTED]"}`
	if bodyParams != want {
		t.Fatalf("A2UI operation-log body = %q, want %q", bodyParams, want)
	}
	if strings.Contains(bodyParams, "researcher@example.com") || strings.Contains(bodyParams, "BRCA1") || strings.Contains(bodyParams, "secret-token") {
		t.Fatalf("A2UI operation-log body leaked payload data: %s", bodyParams)
	}
}

func TestE2E_A2uiActionResponseLimit(t *testing.T) {
	tests := []struct {
		name         string
		responseSize int64
		wantStatus   int
		wantCode     string
	}{
		{name: "exact limit", responseSize: bot.A2uiActionMaxResponseBytes, wantStatus: http.StatusOK},
		{name: "one byte over", responseSize: bot.A2uiActionMaxResponseBytes + 1, wantStatus: http.StatusBadGateway, wantCode: "a2ui_upstream_too_large"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			engine, gdb := buildA2uiActionE2EEnv(t)
			token := seedA2uiActionOwner(t, gdb, "task34-response-"+strings.ReplaceAll(tt.name, " ", "-")+"@x.com", "1")
			body := e2eA2uiResponseOfSize(t, tt.responseSize)
			fakeBot, calls := startA2uiFakeBot(t, http.StatusOK, "application/json", body, 0)
			configureA2uiE2eBot(t, fakeBot.URL, 5, true)

			response := sendA2uiActionRequest(engine, token, []byte(e2eA2uiConfirmBody), "application/json")
			if response.Code != tt.wantStatus {
				t.Fatalf("response-limit status = %d, want %d; body=%s", response.Code, tt.wantStatus, response.Body.String())
			}
			if tt.wantCode == "" {
				if response.Body.String() != string(body) {
					t.Fatalf("exact-limit response body length = %d, want %d", response.Body.Len(), len(body))
				}
			} else {
				assertA2uiGatewayError(t, response, tt.wantCode, true, false)
				if strings.Contains(response.Body.String(), "surface-1") {
					t.Fatal("oversize response leaked upstream body")
				}
			}
			if got := calls.Load(); got != 1 {
				t.Fatalf("response-limit Bot calls = %d, want 1", got)
			}
			waitForOperationLogCount(t, gdb, a2uiActionRoutePath, 1)
		})
	}
}

func TestE2E_A2uiActionUpstreamFailuresHaveStableMappings(t *testing.T) {
	tests := []struct {
		name        string
		contentType string
		body        string
	}{
		{name: "invalid content type", contentType: "text/plain", body: e2eA2uiSucceededBody},
		{name: "malformed json", contentType: "application/json", body: `{"status":"succeeded"`},
		{name: "empty body", contentType: "application/json", body: ""},
		{name: "invalid success envelope", contentType: "application/json", body: `{"status":"queued"}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			engine, gdb := buildA2uiActionE2EEnv(t)
			token := seedA2uiActionOwner(t, gdb, "task34-invalid-upstream-"+strings.ReplaceAll(tt.name, " ", "-")+"@x.com", "1")
			fakeBot, calls := startA2uiFakeBot(t, http.StatusOK, tt.contentType, []byte(tt.body), 0)
			configureA2uiE2eBot(t, fakeBot.URL, 5, true)

			response := sendA2uiActionRequest(engine, token, []byte(e2eA2uiConfirmBody), "application/json")
			if response.Code != http.StatusBadGateway {
				t.Fatalf("invalid-upstream status = %d, want 502; body=%s", response.Code, response.Body.String())
			}
			assertA2uiGatewayError(t, response, "a2ui_upstream_invalid", true, false)
			if strings.Contains(response.Body.String(), "queued") || strings.Contains(response.Body.String(), "surface-1") {
				t.Fatal("invalid-upstream response leaked raw Bot body")
			}
			if got := calls.Load(); got != 1 {
				t.Fatalf("invalid-upstream Bot calls = %d, want 1", got)
			}
			waitForOperationLogCount(t, gdb, a2uiActionRoutePath, 1)
		})
	}

	t.Run("timeout", func(t *testing.T) {
		engine, gdb := buildA2uiActionE2EEnv(t)
		token := seedA2uiActionOwner(t, gdb, "task34-timeout@x.com", "1")
		fakeBot, calls := startA2uiFakeBot(t, http.StatusOK, "application/json", []byte(e2eA2uiSucceededBody), 1500*time.Millisecond)
		configureA2uiE2eBot(t, fakeBot.URL, 1, true)

		response := sendA2uiActionRequest(engine, token, []byte(e2eA2uiConfirmBody), "application/json")
		if response.Code != http.StatusGatewayTimeout {
			t.Fatalf("timeout status = %d, want 504; body=%s", response.Code, response.Body.String())
		}
		assertA2uiGatewayError(t, response, "a2ui_upstream_timeout", true, false)
		if got := calls.Load(); got != 1 {
			t.Fatalf("timeout Bot calls = %d, want 1", got)
		}
		waitForOperationLogCount(t, gdb, a2uiActionRoutePath, 1)
	})
}
