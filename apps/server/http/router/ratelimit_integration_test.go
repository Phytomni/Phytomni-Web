package router

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"

	rxCache "phytomni-server/cache"
	"phytomni-server/db"
	"phytomni-server/middleware"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// buildRLApiEnv wires the REAL Api() router with a fresh miniredis + sqlite DB,
// using the same pattern as buildRealApiEnv in auth_logout_integration_test.go.
// It accepts a pre-configured miniredis instance (mr) so that callers can close
// it before firing requests (Redis-down scenario).
//
// Precondition: viper ratelimit.* MUST be set before calling this function,
// because rateLimitConfig is read eagerly during Api() construction.
func buildRLApiEnv(t *testing.T, mr *miniredis.Miniredis) (*gin.Engine, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	viper.Set("jwt.secret_key", "integration-test-secret")
	t.Cleanup(func() { viper.Set("jwt.secret_key", "") })

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
	if err := gdb.Exec(`CREATE TABLE users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT,
		first_login_status TEXT DEFAULT '0',
		password_change_at DATETIME
	)`).Error; err != nil {
		t.Fatalf("create users: %v", err)
	}
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

// setRLViper sets ratelimit viper keys and registers cleanup.
func setRLViper(t *testing.T, name string, enabled bool, limit int64, window time.Duration) {
	t.Helper()
	viper.Set("ratelimit.enabled", enabled)
	viper.Set("ratelimit."+name+".limit", limit)
	viper.Set("ratelimit."+name+".window", window)
	t.Cleanup(func() {
		viper.Set("ratelimit.enabled", false)
		viper.Set("ratelimit."+name+".limit", 0)
		viper.Set("ratelimit."+name+".window", 0)
	})
}

// loginPost fires POST /api/v1/auth/sessions with a fixed RemoteAddr so all
// calls from the same test fall into the same IP bucket.
func loginPost(engine *gin.Engine, remoteAddr string) *httptest.ResponseRecorder {
	body := strings.NewReader("email=test%40example.com&password=test123")
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/sessions", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.RemoteAddr = remoteAddr
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	return w
}

// TestRateLimit_LoginPerIP_429AfterLimit machine-locks that PerIPRateLimit is
// mounted on POST /api/v1/auth/sessions: the first 3 requests from one IP are
// allowed, the 4th is 429 with Retry-After. The limiter fires before the
// handler, so a non-existent user still triggers the count.
func TestRateLimit_LoginPerIP_429AfterLimit(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)

	// Set ratelimit viper BEFORE buildRLApiEnv (Api() reads config eagerly).
	setRLViper(t, "login", true, 3, time.Minute)

	engine, _ := buildRLApiEnv(t, mr)

	const remoteAddr = "5.6.7.8:1234"
	for i := 1; i <= 3; i++ {
		w := loginPost(engine, remoteAddr)
		if w.Code == http.StatusTooManyRequests {
			t.Fatalf("request %d (within limit=3) must not 429, got 429", i)
		}
	}
	// 4th: over limit → must 429 + Retry-After
	w := loginPost(engine, remoteAddr)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("4th request (over limit=3) must be 429, got %d", w.Code)
	}
	if w.Header().Get("Retry-After") == "" {
		t.Error("429 response must carry Retry-After header")
	}
}

// TestRateLimit_DisabledDefault machine-locks the dark-launch default OFF:
// when ratelimit.enabled=false, no request is ever 429 regardless of count.
func TestRateLimit_DisabledDefault(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)

	setRLViper(t, "login", false, 1, time.Minute) // limit=1 but disabled

	engine, _ := buildRLApiEnv(t, mr)

	const remoteAddr = "6.7.8.9:1234"
	for i := 0; i < 5; i++ {
		w := loginPost(engine, remoteAddr)
		if w.Code == http.StatusTooManyRequests {
			t.Fatalf("disabled limiter: request %d must never 429, got 429", i+1)
		}
	}
}

// TestRateLimit_RedisDown_FailOpen machine-locks the fail-open contract:
// when Redis is down, the limiter never 429s — auth stays available.
// Encoding the rejected Option-C trap: delete the fail-open return in
// cache.Allow and this test goes RED.
func TestRateLimit_RedisDown_FailOpen(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	closed := false
	t.Cleanup(func() {
		if !closed {
			mr.Close()
		}
	})

	setRLViper(t, "login", true, 1, time.Minute) // limit=1, but Redis will be down

	engine, _ := buildRLApiEnv(t, mr)

	// Kill Redis before firing requests.
	mr.Close()
	closed = true

	const remoteAddr = "7.8.9.0:1234"
	beforeFO := rxCache.FailOpenCount()
	for i := 0; i < 5; i++ {
		w := loginPost(engine, remoteAddr)
		if w.Code == http.StatusTooManyRequests {
			t.Fatalf("Redis-down request %d must fail-open (not 429), got 429", i+1)
		}
	}
	if rxCache.FailOpenCount() <= beforeFO {
		t.Error("Redis-down requests must increment FailOpenCount")
	}
}

// TestRateLimit_QueryPerUser_429AfterLimit machine-locks that PerUserRateLimit
// is mounted on POST /api/v1/conversations/:id/messages, after AuthMiddleware
// injects the username. A real JWT is used; the handler may return 503 because
// Bot is disabled — that is irrelevant, the limiter fires before the handler.
// The 3rd request must be 429, proving the per-user bucket is active.
func TestRateLimit_QueryPerUser_429AfterLimit(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)

	setRLViper(t, "query", true, 2, time.Minute)

	engine, gdb := buildRLApiEnv(t, mr)

	// Seed a non-first-login user so LoginStatusMiddleware passes.
	gdb.Exec(`INSERT INTO users (id, email, first_login_status) VALUES (10, 'ratelimit@x.com', '1')`)

	tok, err := middleware.GenerateToken("ratelimit@x.com")
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	queryPost := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/conversations/0/messages", nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		req.RemoteAddr = "1.2.3.4:9999"
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, req)
		return w
	}

	// First 2 requests: limiter allows (handler may 503 — irrelevant).
	for i := 1; i <= 2; i++ {
		w := queryPost()
		if w.Code == http.StatusTooManyRequests {
			t.Fatalf("query request %d (within limit=2) must not 429, got 429", i)
		}
	}
	// 3rd request: over limit → must 429 + Retry-After.
	w := queryPost()
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("3rd query request (over limit=2) must be 429, got %d", w.Code)
	}
	if w.Header().Get("Retry-After") == "" {
		t.Error("429 response must carry Retry-After header")
	}
}
