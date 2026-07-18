package api_handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"phytomni-server/common/i18n"
	"phytomni-server/db"
	rxBot "phytomni-server/external/bot"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/spf13/viper"
	"gorm.io/gorm"
)

func setupRemoteProductHandlerDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if sqlDB, err := gdb.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	if err := gdb.Exec(`CREATE TABLE users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT,
		code TEXT,
		chat_limit INTEGER DEFAULT 0
	)`).Error; err != nil {
		t.Fatalf("create users: %v", err)
	}
	if err := gdb.Exec(`CREATE TABLE tool_names (
		id INTEGER PRIMARY KEY,
		tool_name TEXT NOT NULL
	)`).Error; err != nil {
		t.Fatalf("create tool_names: %v", err)
	}
	if err := gdb.Exec(`CREATE TABLE user_tool_names (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		code TEXT NOT NULL,
		tool_id TEXT NOT NULL
	)`).Error; err != nil {
		t.Fatalf("create user_tool_names: %v", err)
	}
	db.Set("phytomni-server", gdb)
	return gdb
}

func newRemoteProductHandlerRequest(t *testing.T, tool string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if err := mw.WriteField("query", "remote query"); err != nil {
		t.Fatalf("write query: %v", err)
	}
	if err := mw.WriteField("tool", tool); err != nil {
		t.Fatalf("write tool: %v", err)
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close form: %v", err)
	}
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/conversations/0/messages", &body)
	c.Request.Header.Set("Content-Type", mw.FormDataContentType())
	c.Params = gin.Params{{Key: "id", Value: "0"}}
	i18n.Localize()(c)
	return c, w
}

func TestQueryHandler_RemoteProductFlagOffReturns503BeforeBot(t *testing.T) {
	gdb := setupRemoteProductHandlerDB(t)
	if err := gdb.Exec(`INSERT INTO users (email, code, chat_limit) VALUES (?, ?, ?)`, "remote@example.com", "admin", 5).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	previousConfig := rxBot.BotConfig
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true}
	t.Cleanup(func() { rxBot.BotConfig = previousConfig })
	previousQuota := viper.Get("chatlimit.enforce")
	viper.Set("chatlimit.enforce", false)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", previousQuota) })

	c, w := newRemoteProductHandlerRequest(t, "InSilicoResearchAgent")
	c.Set("username", "remote@example.com")
	NewHandler().Query(c)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("flag-off status = %d, body = %s; want 503", w.Code, w.Body.String())
	}
	var response struct {
		Code int `json:"code"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode flag-off body %s: %v", w.Body.String(), err)
	}
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("flag-off body code = %d, want 503", response.Code)
	}
	if hits != 0 {
		t.Fatalf("flag-off request reached Bot %d time(s)", hits)
	}
}

func TestQueryHandler_RemoteProductPermissionDeniedReturns404BeforeBot(t *testing.T) {
	gdb := setupRemoteProductHandlerDB(t)
	if err := gdb.Exec(`INSERT INTO users (email, code, chat_limit) VALUES (?, ?, ?)`, "denied@example.com", "ordinary", 5).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	previousConfig := rxBot.BotConfig
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, ResearchEnabled: true}
	t.Cleanup(func() { rxBot.BotConfig = previousConfig })
	previousQuota := viper.Get("chatlimit.enforce")
	viper.Set("chatlimit.enforce", false)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", previousQuota) })

	c, w := newRemoteProductHandlerRequest(t, "InSilicoResearchAgent")
	c.Set("username", "denied@example.com")
	NewHandler().Query(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("permission-denied status = %d, body = %s; want 404", w.Code, w.Body.String())
	}
	var response struct {
		Code int `json:"code"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode permission-denied body %s: %v", w.Body.String(), err)
	}
	if response.Code != http.StatusNotFound {
		t.Fatalf("permission-denied body code = %d, want 404", response.Code)
	}
	if hits != 0 {
		t.Fatalf("permission-denied request reached Bot %d time(s)", hits)
	}
}
