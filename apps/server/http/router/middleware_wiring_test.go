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

// TestServerTaskRouteSkipsJWTAuth: the external server-task API is open (clients
// call it without a JWT). A no-Authorization POST must reach ServerCreateTask
// (which inserts a row → success) rather than be rejected by AuthMiddleware.
func TestServerTaskRouteSkipsJWTAuth(t *testing.T) {
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := gdb.Exec(`CREATE TABLE server_tool_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		server_id TEXT, tool_result TEXT, tool_name TEXT, server_file_path TEXT,
		server_status TEXT, sync_status INTEGER,
		created_at DATETIME, updated_at DATETIME, delete_at DATETIME
	)`).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	db.Set("phytomni-server", gdb)

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	Api(engine.Group("/"))

	form := url.Values{"server_id": {"srv-wiring-1"}, "server_status": {"running"}, "tool_name": {"demo"}}
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/server/tasks", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	engine.ServeHTTP(w, req)

	if w.Code == http.StatusUnauthorized || w.Code == http.StatusForbidden {
		t.Fatalf("server/tasks rejected the no-JWT request with %d; it must NOT sit behind AuthMiddleware (got body=%s)", w.Code, w.Body.String())
	}
}
