package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
	"gorm.io/gorm"

	"github.com/glebarez/sqlite"

	rxCache "phytomni-server/cache"
	"phytomni-server/db"
	"phytomni-server/model"
)

// buildFloorApiEnv wires the REAL Api() router with a sqlite :memory: DB
// (no miniredis needed — the durable floor reads op-log rows, not Redis).
// Mirrors buildRealApiEnv but skips the Redis setup to keep it minimal.
func buildFloorApiEnv(t *testing.T) (*gin.Engine, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	viper.Set("jwt.secret_key", "integration-test-secret")
	t.Cleanup(func() { viper.Set("jwt.secret_key", "") })

	// CheckRegisterFloor reads from MySQL/SQLite, not Redis. We still need to
	// initialise the cache layer so Api() (which wires PerIPRateLimit) does not
	// panic on startup.  Use the noop path: set no clients so InitFromViper
	// produces an Available()==false client — fail-open for rate-limit middleware.
	viper.Set("redis.default", "")
	viper.Set("redis.clients", nil)
	t.Cleanup(func() {
		viper.Set("redis.clients", nil)
		viper.Set("redis.default", "")
	})
	_ = rxCache.InitFromViper() // fail-open on missing Redis config is fine here

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

// registerPost fires POST /api/v1/auth/registrations with RemoteAddr set so
// c.ClientIP() returns a predictable value.
func registerPost(engine *gin.Engine, remoteAddr string) *httptest.ResponseRecorder {
	body := strings.NewReader("email=newuser%40example.com&password=TestPass1%21")
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/registrations", body)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.RemoteAddr = remoteAddr
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	return w
}

// TestRegisterFloor_429AfterLimit machine-locks that UserRegister calls
// CheckRegisterFloor and returns 429 when the durable op-log floor is exceeded.
//
// Deterministic design: we pre-seed user_operation_logs with `limit` rows for
// the test IP (same value Gin's c.ClientIP() will produce for req.RemoteAddr =
// "1.2.3.4:9999"), then send ONE real registration request. CheckRegisterFloor
// reads those synchronously-seeded rows — no async accumulation, no flakiness.
//
// Mutation check: without the CheckRegisterFloor call in UserRegister the seeded
// rows are never consulted and the handler returns 200/409/4xx — never 429.
func TestRegisterFloor_429AfterLimit(t *testing.T) {
	// Viper: set durable floor limit to 3 so we can seed exactly 3 rows.
	viper.Set("register.durable_floor.limit", int64(3))
	viper.Set("register.durable_floor.window", time.Hour)
	t.Cleanup(func() {
		viper.Set("register.durable_floor.limit", nil)
		viper.Set("register.durable_floor.window", nil)
	})

	engine, gdb := buildFloorApiEnv(t)

	// The test request will have RemoteAddr = "1.2.3.4:9999".
	// Gin's c.ClientIP() strips the port → "1.2.3.4".
	const clientIP = "1.2.3.4"
	const remoteAddr = "1.2.3.4:9999"

	// Pre-seed 3 op-log rows (= limit) for this IP and the register path.
	// All rows are within the 1-hour window.
	now := time.Now()
	for i := 0; i < 3; i++ {
		if err := gdb.Exec(
			`INSERT INTO user_operation_logs (method, path, client_ip, status_code, created_at) VALUES (?, ?, ?, ?, ?)`,
			"POST", "/api/v1/auth/registrations", clientIP, 200, now.Add(-time.Duration(i)*time.Minute),
		).Error; err != nil {
			t.Fatalf("seed op-log row %d: %v", i, err)
		}
	}

	// One real registration request — CheckRegisterFloor sees count=3 >= limit=3 → 429.
	w := registerPost(engine, remoteAddr)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("want 429 after limit exceeded, got %d (body: %s)", w.Code, w.Body.String())
	}
	if w.Header().Get("Retry-After") == "" {
		t.Error("429 response must carry Retry-After header")
	}
	var body map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("response body not JSON: %v", err)
	}
	msg, _ := body["message"].(string)
	if msg == "" {
		t.Errorf("429 response must have non-empty message, got body: %s", w.Body.String())
	}
	// Assert the message is the actual localized rate-limit text, not a raw key fallback.
	// Default locale is en-US (no Accept-Language header) → "Too many registrations...".
	// Accept either locale substring so the test is robust across zh-CN/en-US.
	if !strings.Contains(msg, "registrations") && !strings.Contains(msg, "频繁") {
		t.Errorf("429 message must contain rate-limit text (got %q); raw i18n key fallback is not acceptable", msg)
	}
}

// TestRegisterFloor_CouplingOpLogWritten machine-locks that OperationLog
// middleware is still mounted on the registration route: after a successful
// registration request a user_operation_logs row with the register path must
// eventually appear (the middleware writes asynchronously via go func).
//
// The poll loop (up to ~1s) tolerates the async write delay without making the
// test flaky on fast paths.
func TestRegisterFloor_CouplingOpLogWritten(t *testing.T) {
	// Use a high limit so the floor never fires during this test.
	viper.Set("register.durable_floor.limit", int64(1000))
	viper.Set("register.durable_floor.window", time.Hour)
	t.Cleanup(func() {
		viper.Set("register.durable_floor.limit", nil)
		viper.Set("register.durable_floor.window", nil)
	})

	engine, gdb := buildFloorApiEnv(t)

	// Fire one registration request. The handler may return any non-429 status
	// (200 if user is new, 400 if email already exists, etc.) — we only care
	// that an op-log row is eventually written.
	w := registerPost(engine, "5.6.7.8:1234")
	if w.Code == http.StatusTooManyRequests {
		t.Fatalf("unexpected 429 with high limit: %s", w.Body.String())
	}

	// Poll for the op-log row (async write).
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		var count int64
		gdb.Model(&model.UserOperationLog{}).
			Where("path = ?", "/api/v1/auth/registrations").
			Count(&count)
		if count > 0 {
			return // op-log row found — coupling intact
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Error("OperationLog middleware must write a user_operation_logs row for /api/v1/auth/registrations within 1s (coupling test)")
}
