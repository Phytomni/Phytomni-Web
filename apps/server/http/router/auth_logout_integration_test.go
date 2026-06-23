package router

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/golang-jwt/jwt"
	"github.com/spf13/viper"
	"gorm.io/gorm"

	rxCache "phytomni-server/cache"
	"phytomni-server/db"
	"phytomni-server/middleware"
)

// buildRealApiEnv wires the REAL Api() router (not a minimal reconstruction) with
// miniredis + a sqlite :memory: DB that holds just the tables touched by the
// auth-lifecycle paths. Each test gets a fresh call so state never bleeds.
func buildRealApiEnv(t *testing.T) (*gin.Engine, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	// jwt secret
	viper.Set("jwt.secret_key", "integration-test-secret")
	t.Cleanup(func() { viper.Set("jwt.secret_key", "") })

	// miniredis
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

	// sqlite in-memory DB; MaxOpenConns(1) keeps each :memory: connection to one
	// handle so concurrent-ish reads/writes don't open separate in-memory databases.
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if sqlDB, e := gdb.DB(); e == nil {
		sqlDB.SetMaxOpenConns(1)
	}

	// users: columns read by AuthMiddleware (password_change_at floor) and
	// LoginStatusMiddleware (first_login_status).
	if err := gdb.Exec(`CREATE TABLE users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT,
		first_login_status TEXT DEFAULT '0',
		password_change_at DATETIME
	)`).Error; err != nil {
		t.Fatalf("create users: %v", err)
	}

	// user_operation_logs: the OperationLog middleware fires on 200 responses and
	// writes an audit row; without this table the INSERT would log an error on every
	// successful response, making test output noisy.
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

	// Build the REAL router — the group placement (authLifecycleRouter has
	// AuthMiddleware but NOT LoginStatusMiddleware) is what we are machine-locking.
	engine := gin.New()
	Api(engine.Group("/"))

	return engine, gdb
}

// authRequest fires METHOD path with an Authorization: Bearer header and returns
// the HTTP status code.
func authRequest(engine *gin.Engine, method, path, token string) int {
	req := httptest.NewRequest(method, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	return w.Code
}

// TestE2E_FirstLoginUserCanLogout verifies that the logout group does NOT carry
// LoginStatusMiddleware: a first-login user (first_login_status='0') must reach
// the Logout handler and get 200.
//
// If LoginStatusMiddleware ever creeps onto the authLifecycleRouter group this
// test fails with 403 — exactly the lock we want.
func TestE2E_FirstLoginUserCanLogout(t *testing.T) {
	engine, gdb := buildRealApiEnv(t)
	gdb.Exec(`INSERT INTO users (id, email, first_login_status) VALUES (1, 'alice@x.com', '0')`)

	tok, err := middleware.GenerateToken("alice@x.com")
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	code := authRequest(engine, http.MethodPost, "/api/v1/auth/logout", tok)
	if code != http.StatusOK {
		t.Fatalf("first-login user must be able to log out (LoginStatusMiddleware must be absent on the logout group): want 200, got %d", code)
	}
}

// TestE2E_FirstLoginUserBlockedOnV1 contrasts TestE2E_FirstLoginUserCanLogout: the
// same first-login user IS blocked (403) on /api/v1/users/me because that group
// carries LoginStatusMiddleware. This proves the gate is genuinely active on apiV1Router,
// so test 1's 200 means LoginStatusMiddleware is truly absent on authLifecycleRouter —
// not globally disabled.
func TestE2E_FirstLoginUserBlockedOnV1(t *testing.T) {
	engine, gdb := buildRealApiEnv(t)
	gdb.Exec(`INSERT INTO users (id, email, first_login_status) VALUES (1, 'alice@x.com', '0')`)

	tok, err := middleware.GenerateToken("alice@x.com")
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	code := authRequest(engine, http.MethodGet, "/api/v1/users/me", tok)
	if code != http.StatusForbidden {
		t.Fatalf("first-login user must be blocked on /api/v1/users/me (LoginStatusMiddleware must be active there): want 403, got %d", code)
	}
}

// TestE2E_LogoutRevokesToken proves the writer→checker contract for single-token
// revocation: POST /api/v1/auth/logout blocklists the token in Redis, and a
// subsequent request with the same token is rejected 401 by AuthMiddleware.
func TestE2E_LogoutRevokesToken(t *testing.T) {
	engine, gdb := buildRealApiEnv(t)
	// Non-first-login user so LoginStatusMiddleware passes on both calls.
	gdb.Exec(`INSERT INTO users (id, email, first_login_status) VALUES (1, 'bob@x.com', '1')`)

	tok, err := middleware.GenerateToken("bob@x.com")
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	// First logout succeeds and blocklists the token.
	if code := authRequest(engine, http.MethodPost, "/api/v1/auth/logout", tok); code != http.StatusOK {
		t.Fatalf("logout: want 200, got %d", code)
	}

	// Second request with the SAME token must be rejected by AuthMiddleware (blocklist hit).
	if code := authRequest(engine, http.MethodPost, "/api/v1/auth/logout", tok); code != http.StatusUnauthorized {
		t.Fatalf("after logout, same token must be rejected 401 (blocklist): want 401, got %d", code)
	}
}

// TestE2E_LogoutAllRevokesOtherDevice proves the writer→checker contract for the
// per-user epoch: POST /api/v1/auth/logout-all with tok1 bumps the epoch to now,
// and tok2 — which represents an "other device" that logged in 2 minutes earlier —
// is rejected 401 on the next request.
//
// tok2 is hand-signed with IssuedAt = now-2min so its iat is clearly in the past
// relative to the epoch written by logout-all (epoch = now). With the correct
// comparison `iat < epoch-skew` (= now-60s) this holds: now-120s < now-60s → revoked.
// Using GenerateToken for tok2 would produce iat=now-60s, landing exactly on the
// boundary (== not <) and NOT being revoked in the same integer-second — a
// same-second timing ambiguity, not a real-world scenario.
func TestE2E_LogoutAllRevokesOtherDevice(t *testing.T) {
	engine, gdb := buildRealApiEnv(t)
	gdb.Exec(`INSERT INTO users (id, email, first_login_status) VALUES (1, 'bob@x.com', '1')`)

	// tok1: current device — uses GenerateToken so it passes AuthMiddleware on the
	// logout-all call (iat = now-60s, well within the still-valid window).
	tok1, err := middleware.GenerateToken("bob@x.com")
	if err != nil {
		t.Fatalf("GenerateToken tok1: %v", err)
	}

	// tok2: other device logged in 2 minutes ago — hand-signed with a clearly past iat
	// to avoid same-second boundary ambiguity with the epoch written by logout-all.
	// After logout-all (epoch = now): iat=now-120s < epoch-60s=now-60s → revoked.
	tok2Claims := &middleware.Claims{
		Username: "bob@x.com",
	}
	tok2Claims.IssuedAt = time.Now().Add(-2 * time.Minute).Unix()
	tok2Claims.ExpiresAt = time.Now().Add(time.Hour).Unix()
	tok2Signed := jwt.NewWithClaims(jwt.SigningMethodHS256, tok2Claims)
	tok2, err2 := tok2Signed.SignedString([]byte("integration-test-secret"))
	if err2 != nil {
		t.Fatalf("hand-sign tok2: %v", err2)
	}

	// Device 1 calls logout-all → per-user epoch = now.
	if code := authRequest(engine, http.MethodPost, "/api/v1/auth/logout-all", tok1); code != http.StatusOK {
		t.Fatalf("logout-all: want 200, got %d", code)
	}

	// Device 2's token has iat = now-2min < epoch-60s = now-60s → AuthMiddleware rejects.
	// Use /logout as the probe: simple handler, no extra DB deps.
	if code := authRequest(engine, http.MethodPost, "/api/v1/auth/logout", tok2); code != http.StatusUnauthorized {
		t.Fatalf("other device token must be rejected 401 after logout-all (epoch revocation): want 401, got %d", code)
	}
}
