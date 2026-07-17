package api_handler

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"phytomni-server/common/i18n"
	"phytomni-server/db"
	rxBot "phytomni-server/external/bot"
)

func setupInteropHandlerDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if sqlDB, err := gdb.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	for _, ddl := range []string{
		`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, code TEXT, chat_limit INTEGER DEFAULT 0)`,
		`CREATE TABLE tool_names (id INTEGER PRIMARY KEY, tool_name TEXT NOT NULL)`,
		`CREATE TABLE user_tool_names (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, tool_id TEXT NOT NULL)`,
	} {
		if err := gdb.Exec(ddl).Error; err != nil {
			t.Fatalf("create interop table: %v", err)
		}
	}
	previous, hadPrevious := db.Get("phytomni-server")
	db.Set("phytomni-server", gdb)
	t.Cleanup(func() {
		if hadPrevious {
			db.Set("phytomni-server", previous)
		} else {
			db.Set("phytomni-server", nil)
		}
	})
	return gdb
}

func interopHandlerContext(t *testing.T, username string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/bot/interop/capabilities", nil)
	i18n.Localize()(c)
	if username != "" {
		c.Set("username", username)
	}
	return c, w
}

func configureInteropHandlerBot(t *testing.T, baseURL string, enabled bool) {
	t.Helper()
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{BaseURL: baseURL, UserAPIKey: "ptm-handler", TimeoutSeconds: 1, InteropEnabled: enabled}
	t.Cleanup(func() { rxBot.BotConfig = previous })
}

func TestInteropHandlerFlagOffReturns404BeforeBot(t *testing.T) {
	gdb := setupInteropHandlerDB(t)
	if err := gdb.Exec(`INSERT INTO users (email, code) VALUES ('admin@example.com', 'admin')`).Error; err != nil {
		t.Fatal(err)
	}
	var hits int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&hits, 1)
	}))
	t.Cleanup(srv.Close)
	configureInteropHandlerBot(t, srv.URL, false)

	c, w := interopHandlerContext(t, "admin@example.com")
	NewHandler().InteropCapabilities(c)
	if w.Code != http.StatusNotFound {
		t.Fatalf("flag-off status = %d, body=%s; want 404", w.Code, w.Body.String())
	}
	if got := atomic.LoadInt64(&hits); got != 0 {
		t.Fatalf("flag-off Bot calls = %d, want 0", got)
	}
}

func TestInteropHandlerUnauthorizedReturns404BeforeBot(t *testing.T) {
	gdb := setupInteropHandlerDB(t)
	if err := gdb.Exec(`INSERT INTO users (email, code) VALUES ('user@example.com', 'user')`).Error; err != nil {
		t.Fatal(err)
	}
	var hits int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&hits, 1)
	}))
	t.Cleanup(srv.Close)
	configureInteropHandlerBot(t, srv.URL, true)

	c, w := interopHandlerContext(t, "user@example.com")
	NewHandler().InteropCapabilities(c)
	if w.Code != http.StatusNotFound {
		t.Fatalf("unauthorized status = %d, body=%s; want 404", w.Code, w.Body.String())
	}
	if got := atomic.LoadInt64(&hits); got != 0 {
		t.Fatalf("unauthorized Bot calls = %d, want 0", got)
	}
}

func TestInteropHandlerBotUnavailableReturns503(t *testing.T) {
	gdb := setupInteropHandlerDB(t)
	if err := gdb.Exec(`INSERT INTO users (email, code) VALUES ('admin@example.com', 'admin')`).Error; err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":{"message":"secret registry details"}}`))
	}))
	t.Cleanup(srv.Close)
	configureInteropHandlerBot(t, srv.URL, true)

	c, w := interopHandlerContext(t, "admin@example.com")
	NewHandler().InteropCapabilities(c)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("Bot unavailable status = %d, body=%s; want 503", w.Code, w.Body.String())
	}
	if w.Body.String() == "" || containsInteropHandler(w.Body.String(), "secret registry") {
		t.Fatalf("unsafe unavailable body = %s", w.Body.String())
	}
}

func TestInteropHandlerRequiresAuthenticatedIdentity(t *testing.T) {
	configureInteropHandlerBot(t, "http://127.0.0.1:1", true)
	c, w := interopHandlerContext(t, "")
	NewHandler().InteropCapabilities(c)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("missing identity status = %d, want 401", w.Code)
	}
}

func containsInteropHandler(value, substring string) bool {
	for i := 0; i+len(substring) <= len(value); i++ {
		if value[i:i+len(substring)] == substring {
			return true
		}
	}
	return false
}
