package router

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
	"gorm.io/gorm"

	"github.com/glebarez/sqlite"
	rxBot "phytomni-server/external/bot"

	rxCache "phytomni-server/cache"
	"phytomni-server/db"
	"phytomni-server/middleware"
)

// buildChatGateEnv wires a real Api() router + miniredis + SQLite with the
// minimal users table columns CheckChatAllowed reads (code / chat_limit).
// Each test calls this independently to prevent state leakage.
func buildChatGateEnv(t *testing.T) (*gin.Engine, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	viper.Set("jwt.secret_key", "chat-gate-test-secret")
	t.Cleanup(func() { viper.Set("jwt.secret_key", "") })

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	viper.Set("redis.default", "web")
	viper.Set("redis.clients", map[string]interface{}{
		"web": map[string]interface{}{
			"type":  "single-node",
			"addrs": []string{mr.Addr()},
			"db":    0,
		},
	})
	t.Cleanup(func() {
		viper.Set("redis.clients", nil)
		viper.Set("redis.default", "")
	})
	if err := rxCache.InitFromViper(); err != nil {
		t.Fatalf("cache init: %v", err)
	}

	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if sqlDB, e := gdb.DB(); e == nil {
		sqlDB.SetMaxOpenConns(1)
	}

	// users: includes code / chat_limit (read by CheckChatAllowed) plus
	// first_login_status / password_change_at (needed by AuthMiddleware /
	// LoginStatusMiddleware).
	if err := gdb.Exec(`CREATE TABLE users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT,
		code TEXT DEFAULT 'user',
		chat_limit INTEGER DEFAULT 0,
		first_login_status TEXT DEFAULT '1',
		password_change_at DATETIME
	)`).Error; err != nil {
		t.Fatalf("create users: %v", err)
	}

	// user_operation_logs: OperationLog middleware writes an audit row after each successful response.
	if err := gdb.Exec(`CREATE TABLE user_operation_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER,
		user_email TEXT,
		method TEXT,
		path TEXT,
		query_params TEXT,
		body_params TEXT,
		client_ip TEXT,
		user_agent TEXT,
		status_code INTEGER,
		latency INTEGER,
		error_message TEXT,
		created_at DATETIME
	)`).Error; err != nil {
		t.Fatalf("create user_operation_logs: %v", err)
	}

	// question_agent_logs: A2uiAction verifies that the submitted run belongs
	// to the authenticated user before it reaches the Bot flag gate.
	if err := gdb.Exec(`CREATE TABLE question_agent_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		dialogue_id TEXT,
		f_id INTEGER DEFAULT 0,
		bot_run_id TEXT,
		user_name TEXT,
		delete_at DATETIME
	)`).Error; err != nil {
		t.Fatalf("create question_agent_logs: %v", err)
	}

	db.Set("phytomni-server", gdb)

	engine := gin.New()
	Api(engine.Group("/"))
	return engine, gdb
}

const a2uiActionRoutePath = "/api/v1/conversations/0/a2ui-actions"

func a2uiActionBodyOfSize(t *testing.T, size int64) []byte {
	t.Helper()
	const prefix = `{"surface_id":"surface-1","widget":"confirm","action_id":"submit","run_id":"run-1","payload":"`
	const suffix = `"}`
	padding := size - int64(len(prefix)) - int64(len(suffix))
	if padding < 0 {
		t.Fatalf("A2UI test body size %d is smaller than its envelope", size)
	}
	body := []byte(prefix + strings.Repeat("x", int(padding)) + suffix)
	if int64(len(body)) != size {
		t.Fatalf("A2UI body length = %d, want %d", len(body), size)
	}
	if !json.Valid(body) {
		t.Fatal("A2UI test body is not valid JSON")
	}
	return body
}

func seedA2uiActionOwner(t *testing.T, gdb *gorm.DB, email, firstLoginStatus string) string {
	t.Helper()
	if err := gdb.Exec(`INSERT INTO users (email, code, chat_limit, first_login_status) VALUES (?, 'user', 5, ?)`, email, firstLoginStatus).Error; err != nil {
		t.Fatalf("seed A2UI user: %v", err)
	}
	if err := gdb.Exec(`INSERT INTO question_agent_logs (dialogue_id, bot_run_id, user_name) VALUES ('0', 'run-1', ?)`, email).Error; err != nil {
		t.Fatalf("seed A2UI owner log: %v", err)
	}
	tok, err := middleware.GenerateToken(email)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}
	return tok
}

func sendA2uiActionRequest(engine *gin.Engine, token string, body []byte, contentType string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, a2uiActionRoutePath, bytes.NewReader(body))
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

func operationLogCount(t *testing.T, gdb *gorm.DB, path string) int64 {
	t.Helper()
	var count int64
	if err := gdb.Table("user_operation_logs").Where("path = ?", path).Count(&count).Error; err != nil {
		t.Fatalf("count operation logs: %v", err)
	}
	return count
}

func waitForOperationLogCount(t *testing.T, gdb *gorm.DB, path string, want int64) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if got := operationLogCount(t, gdb, path); got == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("operation log count for %s did not become %d (got %d)", path, want, operationLogCount(t, gdb, path))
}

func assertNoOperationLog(t *testing.T, gdb *gorm.DB, path string) {
	t.Helper()
	deadline := time.Now().Add(200 * time.Millisecond)
	for time.Now().Before(deadline) {
		if got := operationLogCount(t, gdb, path); got != 0 {
			t.Fatalf("rejected request created %d operation log rows for %s", got, path)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func configureA2uiFlagOff(t *testing.T) {
	t.Helper()
	prev := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{ProxyEnabled: true, A2uiActionsEnabled: false, TimeoutSeconds: 1}
	t.Cleanup(func() { rxBot.BotConfig = prev })
}

func TestA2uiActionRouteUnauthenticatedRemains401(t *testing.T) {
	engine, _ := buildChatGateEnv(t)
	configureA2uiFlagOff(t)

	response := sendA2uiActionRequest(engine, "", bytes.Repeat([]byte("x"), int(middleware.A2uiActionMaxRequestBytes+1)), "application/json")
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated A2UI action: got %d, want 401", response.Code)
	}
}

func TestA2uiActionRouteFirstLoginGateRemainsActive(t *testing.T) {
	engine, gdb := buildChatGateEnv(t)
	configureA2uiFlagOff(t)
	tok := seedA2uiActionOwner(t, gdb, "first-login@x.com", "0")

	response := sendA2uiActionRequest(engine, tok, bytes.Repeat([]byte("x"), int(middleware.A2uiActionMaxRequestBytes+1)), "application/json")
	if response.Code != http.StatusForbidden {
		t.Fatalf("first-login A2UI action: got %d, want 403 before body guard", response.Code)
	}
}

func TestA2uiActionRouteAcceptsExactLimitAndReachesService(t *testing.T) {
	engine, gdb := buildChatGateEnv(t)
	configureA2uiFlagOff(t)
	tok := seedA2uiActionOwner(t, gdb, "a2ui-owner@x.com", "1")

	body := a2uiActionBodyOfSize(t, middleware.A2uiActionMaxRequestBytes)
	response := sendA2uiActionRequest(engine, tok, body, "application/json")
	if response.Code != http.StatusForbidden {
		t.Fatalf("exact-limit A2UI action: got %d, want flag-off service response 403", response.Code)
	}
	waitForOperationLogCount(t, gdb, a2uiActionRoutePath, 1)
}

func TestA2uiActionRouteAuditRedactsPayload(t *testing.T) {
	engine, gdb := buildChatGateEnv(t)
	configureA2uiFlagOff(t)
	tok := seedA2uiActionOwner(t, gdb, "a2ui-audit@x.com", "1")
	body := []byte(`{"surface_id":"sfc-1","widget":"form","action_id":"act-1","run_id":"run-1","payload":{"email":"researcher@example.com","biological_input":"BRCA1","nested":{"token":"secret-token"}},"extra":"drop-me"}`)

	response := sendA2uiActionRequest(engine, tok, body, "application/json")
	if response.Code != http.StatusForbidden {
		t.Fatalf("A2UI audit request: got %d, want flag-off service response 403", response.Code)
	}
	waitForOperationLogCount(t, gdb, a2uiActionRoutePath, 1)

	var bodyParams string
	if err := gdb.Table("user_operation_logs").Where("path = ?", a2uiActionRoutePath).Pluck("body_params", &bodyParams).Error; err != nil {
		t.Fatalf("read A2UI operation log: %v", err)
	}
	if bodyParams != `{"surface_id":"sfc-1","widget":"form","action_id":"act-1","run_id":"run-1","payload":"[REDACTED]"}` {
		t.Fatalf("A2UI operation-log body = %q, want IDs plus redacted payload", bodyParams)
	}
	if strings.Contains(bodyParams, "researcher@example.com") || strings.Contains(bodyParams, "BRCA1") || strings.Contains(bodyParams, "secret-token") {
		t.Fatalf("A2UI operation-log body leaked payload data: %s", bodyParams)
	}
}

func TestA2uiActionRouteRejectsOverflowBeforeOperationLog(t *testing.T) {
	engine, gdb := buildChatGateEnv(t)
	configureA2uiFlagOff(t)
	tok := seedA2uiActionOwner(t, gdb, "a2ui-overflow@x.com", "1")

	body := bytes.Repeat([]byte("x"), int(middleware.A2uiActionMaxRequestBytes+1))
	response := sendA2uiActionRequest(engine, tok, body, "application/json")
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("overflow A2UI action: got %d, want 413", response.Code)
	}
	assertNoOperationLog(t, gdb, a2uiActionRoutePath)
}

func TestA2uiJSONGuardDoesNotApplyToGenericApiV1Routes(t *testing.T) {
	engine, gdb := buildChatGateEnv(t)
	tok := seedA2uiActionOwner(t, gdb, "generic-route@x.com", "1")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me", strings.NewReader("not-json"))
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "text/plain")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	if w.Code == http.StatusUnsupportedMediaType {
		t.Fatalf("generic /api/v1 route unexpectedly received A2uiJSONGuard 415")
	}
}

// queryRequest sends an authenticated multipart POST to
// /api/v1/conversations/0/messages with a minimal valid body (non-empty query
// field) and returns the HTTP status code.
func queryRequest(engine *gin.Engine, token string) int {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("query", "test query")
	mw.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/conversations/0/messages", &buf)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	return w.Code
}

// TestE2E_ChatGate_EnforceOn_ZeroLimit pins gate wiring: enforce=ON, code='user',
// chat_limit=0 → /query returns 403 (quota exhausted).
// Mutation guard: removing the CheckChatAllowed call in Query eliminates the 403 → red.
func TestE2E_ChatGate_EnforceOn_ZeroLimit(t *testing.T) {
	engine, gdb := buildChatGateEnv(t)

	viper.Set("chatlimit.enforce", true)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", nil) })

	// regular user with chat_limit=0 (first_login_status='1' passes LoginStatusMiddleware)
	gdb.Exec(`INSERT INTO users (email, code, chat_limit, first_login_status) VALUES ('inert@x.com', 'user', 0, '1')`)

	tok, err := middleware.GenerateToken("inert@x.com")
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	code := queryRequest(engine, tok)
	if code != http.StatusForbidden {
		t.Fatalf("enforce=ON user/chat_limit=0: want 403, got %d", code)
	}
}

// TestE2E_ChatGate_EnforceOn_FundedUser pins that a chat_limit=5 user is not
// blocked by the gate: response is not 403 — request proceeds (may fail with
// another status if Bot is not running, but not a gate rejection).
// Mutation guard: if the gate incorrectly rejects chat_limit>0 users → red.
func TestE2E_ChatGate_EnforceOn_FundedUser(t *testing.T) {
	engine, gdb := buildChatGateEnv(t)

	viper.Set("chatlimit.enforce", true)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", nil) })

	gdb.Exec(`INSERT INTO users (email, code, chat_limit, first_login_status) VALUES ('funded@x.com', 'user', 5, '1')`)

	tok, err := middleware.GenerateToken("funded@x.com")
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	code := queryRequest(engine, tok)
	if code == http.StatusForbidden {
		t.Fatalf("enforce=ON user/chat_limit=5: gate must not reject, got 403")
	}
}

// TestE2E_ChatGate_EnforceOff_ZeroLimit pins the dark-launch default: when
// enforce=OFF, a chat_limit=0 user must not get a 403 from the gate (zero regression).
// Mutation guard: if the enforce short-circuit is removed → red.
func TestE2E_ChatGate_EnforceOff_ZeroLimit(t *testing.T) {
	engine, gdb := buildChatGateEnv(t)

	viper.Set("chatlimit.enforce", false)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", nil) })

	gdb.Exec(`INSERT INTO users (email, code, chat_limit, first_login_status) VALUES ('zero@x.com', 'user', 0, '1')`)

	tok, err := middleware.GenerateToken("zero@x.com")
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	code := queryRequest(engine, tok)
	if code == http.StatusForbidden {
		t.Fatalf("enforce=OFF user/chat_limit=0: gate must not fire (zero regression), got 403")
	}
}
