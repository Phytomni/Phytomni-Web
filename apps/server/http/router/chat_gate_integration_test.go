package router

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
	"gorm.io/gorm"

	"github.com/glebarez/sqlite"

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

	db.Set("phytomni-server", gdb)

	engine := gin.New()
	Api(engine.Group("/"))
	return engine, gdb
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
