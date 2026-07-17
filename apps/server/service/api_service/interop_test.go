package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"phytomni-server/db"
	rxBot "phytomni-server/external/bot"
)

func setupInteropServiceDB(t *testing.T) *gorm.DB {
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

func configureInteropServiceBot(t *testing.T, baseURL string, enabled bool) {
	t.Helper()
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL:        baseURL,
		UserAPIKey:     "ptm-interop-test",
		TimeoutSeconds: 1,
		InteropEnabled: enabled,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })
}

func interopResponseServer(t *testing.T, status int, body string, hits *int64) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(hits, 1)
		if r.Method != http.MethodGet || r.URL.Path != "/v1/interop/capabilities" || r.URL.RawQuery != "" {
			t.Errorf("unexpected Bot request: %s %s?%s", r.Method, r.URL.Path, r.URL.RawQuery)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer ptm-interop-test" {
			t.Errorf("Bot authorization = %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
}

func seedInteropUser(t *testing.T, gdb *gorm.DB, email, code string) {
	t.Helper()
	if err := gdb.Exec(`INSERT INTO users (email, code) VALUES (?, ?)`, email, code).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
}

func grantInteropCapability(t *testing.T, gdb *gorm.DB, code, tool string, id int64) {
	t.Helper()
	if err := gdb.Exec(`INSERT INTO tool_names (id, tool_name) VALUES (?, ?)`, id, tool).Error; err != nil {
		t.Fatalf("seed tool: %v", err)
	}
	if err := gdb.Exec(`INSERT INTO user_tool_names (code, tool_id) VALUES (?, ?)`, code, id).Error; err != nil {
		t.Fatalf("seed grant: %v", err)
	}
}

func TestInteropCapabilitiesStripEndpointAndCredentialFields(t *testing.T) {
	gdb := setupInteropServiceDB(t)
	seedInteropUser(t, gdb, "admin@example.com", "admin")
	hits := int64(0)
	srv := interopResponseServer(t, http.StatusOK, `{"object":"list","data":[{"target_id":"mcp-peer","kind":"mcp","command":"/private/bin","card_base_url":"https://private.invalid","credential_ref":"operator-token","input_schema":{"secret":true}}],"errors":[{"target_id":"a2a-peer","kind":"a2a","code":"discovery_failed","exception":"private traceback"}]}`, &hits)
	t.Cleanup(srv.Close)
	configureInteropServiceBot(t, srv.URL, true)

	result, err := NewService().InteropCapabilities(context.Background(), "admin@example.com")
	if err != nil {
		t.Fatalf("InteropCapabilities error: %v", err)
	}
	if len(result.Targets) != 2 {
		t.Fatalf("targets = %#v, want two safe target records", result.Targets)
	}
	for _, target := range result.Targets {
		if target.TargetID == "" || target.Kind == "" {
			t.Fatalf("incomplete target=%#v", target)
		}
		if target.Status != "available" && target.Status != "failed" {
			t.Fatalf("unsafe status=%#v", target)
		}
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"private/bin", "private.invalid", "operator-token", "input_schema", "exception", "traceback"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("private field %q leaked: %s", forbidden, encoded)
		}
	}
	if got := atomic.LoadInt64(&hits); got != 1 {
		t.Fatalf("Bot calls = %d, want 1", got)
	}
}

func TestInteropCapabilitiesFlagOffReturnsBeforeBot(t *testing.T) {
	gdb := setupInteropServiceDB(t)
	seedInteropUser(t, gdb, "admin@example.com", "admin")
	hits := int64(0)
	srv := interopResponseServer(t, http.StatusOK, `{"object":"list","data":[],"errors":[]}`, &hits)
	t.Cleanup(srv.Close)
	configureInteropServiceBot(t, srv.URL, false)

	_, err := NewService().InteropCapabilities(context.Background(), "admin@example.com")
	if !errors.Is(err, ErrInteropDisabled) {
		t.Fatalf("flag-off error = %v, want ErrInteropDisabled", err)
	}
	if got := atomic.LoadInt64(&hits); got != 0 {
		t.Fatalf("flag-off Bot calls = %d, want 0", got)
	}
}

func TestInteropCapabilitiesUnauthorizedReturnsBeforeBot(t *testing.T) {
	gdb := setupInteropServiceDB(t)
	seedInteropUser(t, gdb, "user@example.com", "user")
	hits := int64(0)
	srv := interopResponseServer(t, http.StatusOK, `{"object":"list","data":[],"errors":[]}`, &hits)
	t.Cleanup(srv.Close)
	configureInteropServiceBot(t, srv.URL, true)

	_, err := NewService().InteropCapabilities(context.Background(), "user@example.com")
	if !errors.Is(err, ErrInteropForbidden) {
		t.Fatalf("unauthorized error = %v, want ErrInteropForbidden", err)
	}
	if got := atomic.LoadInt64(&hits); got != 0 {
		t.Fatalf("unauthorized Bot calls = %d, want 0", got)
	}
}

func TestInteropCapabilitiesGrantedAgentRoleCanDiscover(t *testing.T) {
	gdb := setupInteropServiceDB(t)
	seedInteropUser(t, gdb, "researcher@example.com", "researcher")
	grantInteropCapability(t, gdb, "researcher", "InSilicoResearchAgent", 1)
	hits := int64(0)
	srv := interopResponseServer(t, http.StatusOK, `{"object":"list","data":[{"target_id":"mcp-peer","kind":"mcp"}],"errors":[]}`, &hits)
	t.Cleanup(srv.Close)
	configureInteropServiceBot(t, srv.URL, true)

	result, err := NewService().InteropCapabilities(context.Background(), "researcher@example.com")
	if err != nil {
		t.Fatalf("granted role error = %v", err)
	}
	if len(result.Targets) != 1 || result.Targets[0].Status != "available" {
		t.Fatalf("granted role result = %#v", result)
	}
	if got := atomic.LoadInt64(&hits); got != 1 {
		t.Fatalf("granted role Bot calls = %d, want 1", got)
	}
}

func TestInteropCapabilitiesRegistryUnavailableReturnsSafeError(t *testing.T) {
	gdb := setupInteropServiceDB(t)
	seedInteropUser(t, gdb, "admin@example.com", "admin")
	hits := int64(0)
	srv := interopResponseServer(t, http.StatusServiceUnavailable, `{"error":{"message":"credential_ref=operator-token"}}`, &hits)
	t.Cleanup(srv.Close)
	configureInteropServiceBot(t, srv.URL, true)

	_, err := NewService().InteropCapabilities(context.Background(), "admin@example.com")
	if !errors.Is(err, ErrInteropUnavailable) {
		t.Fatalf("registry error = %v, want ErrInteropUnavailable", err)
	}
	if strings.Contains(err.Error(), "operator-token") {
		t.Fatalf("upstream credential leaked in service error: %v", err)
	}
}

func TestInteropCapabilitiesPartialFailureRetainsSuccessfulTargets(t *testing.T) {
	gdb := setupInteropServiceDB(t)
	seedInteropUser(t, gdb, "admin@example.com", "admin")
	hits := int64(0)
	srv := interopResponseServer(t, http.StatusOK, `{"object":"list","data":[{"target_id":"stdio-peer","kind":"mcp","remote_name":"lookup"}],"errors":[{"target_id":"a2a-peer","kind":"a2a","code":"discovery_failed"}]}`, &hits)
	t.Cleanup(srv.Close)
	configureInteropServiceBot(t, srv.URL, true)

	result, err := NewService().InteropCapabilities(context.Background(), "admin@example.com")
	if err != nil {
		t.Fatalf("partial discovery error: %v", err)
	}
	if len(result.Targets) != 2 {
		t.Fatalf("partial targets = %#v, want success and failure", result.Targets)
	}
	var foundSuccess, foundFailure bool
	for _, target := range result.Targets {
		switch target.TargetID {
		case "stdio-peer":
			foundSuccess = target.Status == "available" && target.Code == ""
		case "a2a-peer":
			foundFailure = target.Status == "failed" && target.Code == "discovery_failed"
		}
	}
	if !foundSuccess || !foundFailure {
		t.Fatalf("partial target statuses = %#v", result.Targets)
	}
}

func TestSanitizeInteropCapabilitiesDropsUnknownErrorCode(t *testing.T) {
	result := sanitizeInteropCapabilities(&rxBot.InteropCapabilitiesResponse{
		Object: "list",
		Data:   []rxBot.InteropCapabilityRecord{},
		Errors: []rxBot.InteropDiscoveryError{{TargetID: "mcp-peer", Kind: "mcp", Code: "credential_ref=operator-token"}},
	})
	if len(result.Targets) != 1 {
		t.Fatalf("sanitized targets = %#v, want one failure target", result.Targets)
	}
	if result.Targets[0].Code != "" {
		t.Fatalf("unsafe error code projected: %#v", result.Targets[0])
	}
}
