package router

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"phytomni-server/db"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/middleware"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/spf13/viper"
	"gorm.io/gorm"
)

// These tests behaviorally lock the two open (no-JWT) wirings the contract test
// can only see by route name: the browser-facing relay download and the external
// server-task API. api_test.go asserts the routes are registered; here we drive a
// real request through the full middleware chain and prove AuthMiddleware is NOT
// in it (a no-JWT request reaches the handler instead of being rejected 401/403).

// TestRelayFileRouteSkipsJWTAuth: the relay download is the browser-direct face —
// window.open / <img src> / email links carry no Authorization header, so auth is
// the ?t= signed token, not a JWT. A valid-token request with no Authorization
// must reach the handler (which then fails at the unreachable Bot → 502), proving
// the route is not behind AuthMiddleware.
func TestRelayFileRouteSkipsJWTAuth(t *testing.T) {
	prevCfg := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{BaseURL: "http://127.0.0.1:9", UserAPIKey: "ptm_test", TimeoutSeconds: 1}
	t.Cleanup(func() { rxBot.BotConfig = prevCfg })

	prevSecret := viper.GetString("jwt.secret_key")
	viper.Set("jwt.secret_key", "wiring-test-secret")
	t.Cleanup(func() { viper.Set("jwt.secret_key", prevSecret) })

	tok, err := middleware.GenerateDownloadToken("agent_data/user_data/web/runs/r1/out.zip", middleware.DownloadTokenTTL)
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	Api(engine.Group("/"))

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/downloads/relay-file?t="+url.QueryEscape(tok), nil)
	engine.ServeHTTP(w, req)

	if w.Code == http.StatusUnauthorized || w.Code == http.StatusForbidden {
		t.Fatalf("relay-file rejected the no-JWT request with %d; it must NOT sit behind AuthMiddleware (got body=%s)", w.Code, w.Body.String())
	}
}

// TestLoginRouteSkipsJWTAuth: the login endpoint is open — you must be able to
// authenticate WITHOUT already holding a JWT. A no-Authorization POST must reach
// the Login handler (which, with an empty body, fails CheckEmailExists and returns
// 409 Conflict) rather than be rejected 401/403 by AuthMiddleware. This locks the
// "login is not behind AuthMiddleware" wiring invariant after the server-task
// probe was removed. ratelimit.enabled stays at its default (OFF) so the per-IP
// limiter does not turn this into a 429.
func TestLoginRouteSkipsJWTAuth(t *testing.T) {
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	// Login reads users; the OperationLog middleware post-writes user_operation_logs.
	// Hand-write the minimal columns (User carries MySQL type:enum tags that SQLite
	// AutoMigrate rejects); unlisted columns scan as zero values.
	ddl := []string{
		`CREATE TABLE users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT, password TEXT, code TEXT,
			first_login_status TEXT, login_failed_count INTEGER DEFAULT 0,
			locked_until DATETIME, last_login_at DATETIME, password_change_at DATETIME,
			created_at DATETIME, updated_at DATETIME
		)`,
		`CREATE TABLE user_operation_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER, client_ip TEXT, path TEXT, method TEXT,
			created_at DATETIME
		)`,
	}
	for _, stmt := range ddl {
		if err := gdb.Exec(stmt).Error; err != nil {
			t.Fatalf("create table: %v", err)
		}
	}
	db.Set("phytomni-server", gdb)

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	Api(engine.Group("/"))

	form := url.Values{"email": {""}, "password": {""}}
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/sessions", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	engine.ServeHTTP(w, req)

	if w.Code == http.StatusUnauthorized || w.Code == http.StatusForbidden {
		t.Fatalf("auth/sessions rejected the no-JWT request with %d; login must NOT sit behind AuthMiddleware (got body=%s)", w.Code, w.Body.String())
	}
}
