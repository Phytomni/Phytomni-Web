package api_service

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"phytomni-server/db"
	rxBot "phytomni-server/external/bot"

	"github.com/glebarez/sqlite"
	"github.com/spf13/viper"
	"gorm.io/gorm"
)

// setupChatGateDB opens an in-memory SQLite with a minimal users table for
// testing CheckChatAllowed boundaries. Only the columns read/written by that
// path (email/code/chat_limit) are included.
func setupChatGateDB(t *testing.T) *gorm.DB {
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
		t.Fatalf("ddl users: %v", err)
	}
	if err := gdb.Exec(`CREATE TABLE tool_names (
		id INTEGER PRIMARY KEY,
		tool_name TEXT NOT NULL
	)`).Error; err != nil {
		t.Fatalf("ddl tool_names: %v", err)
	}
	if err := gdb.Exec(`CREATE TABLE user_tool_names (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		code TEXT NOT NULL,
		tool_id TEXT NOT NULL
	)`).Error; err != nil {
		t.Fatalf("ddl user_tool_names: %v", err)
	}
	db.Set("phytomni-server", gdb)
	return gdb
}

// seedChatGateUser inserts a user row into the test DB.
func seedChatGateUser(t *testing.T, gdb *gorm.DB, email, code string, chatLimit int) {
	t.Helper()
	if err := gdb.Exec(
		`INSERT INTO users (email, code, chat_limit) VALUES (?, ?, ?)`,
		email, code, chatLimit,
	).Error; err != nil {
		t.Fatalf("seed user %s: %v", email, err)
	}
}

func seedRemoteProductPermission(t *testing.T, gdb *gorm.DB, code, tool string, id int) {
	t.Helper()
	if err := gdb.Exec(`INSERT INTO tool_names (id, tool_name) VALUES (?, ?)`, id, tool).Error; err != nil {
		t.Fatalf("seed tool %s: %v", tool, err)
	}
	if err := gdb.Exec(`INSERT INTO user_tool_names (code, tool_id) VALUES (?, ?)`, code, id).Error; err != nil {
		t.Fatalf("seed user tool %s/%s: %v", code, tool, err)
	}
}

// TestCheckChatAllowed_EnforceOff verifies the dark-launch switch: when
// enforce=false (default), all users (including chat_limit=0) are allowed,
// matching today's behavior.
// mutation guard: remove the enforce short-circuit → chat_limit=0 user is rejected → RED.
func TestCheckChatAllowed_EnforceOff(t *testing.T) {
	gdb := setupChatGateDB(t)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", nil) })

	viper.Set("chatlimit.enforce", false)
	seedChatGateUser(t, gdb, "zero@example.com", "user", 0)

	ps := NewService()
	if err := ps.CheckChatAllowed(context.Background(), "zero@example.com"); err != nil {
		t.Errorf("enforce=false: chat_limit=0 user must be allowed, got %v", err)
	}
}

// TestCheckChatAllowed_EnforceOn_UserZero verifies that enforce=ON with
// code='user' + chat_limit=0 returns ErrChatQuotaExhausted.
func TestCheckChatAllowed_EnforceOn_UserZero(t *testing.T) {
	gdb := setupChatGateDB(t)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", nil) })

	viper.Set("chatlimit.enforce", true)
	seedChatGateUser(t, gdb, "zero@example.com", "user", 0)

	ps := NewService()
	err := ps.CheckChatAllowed(context.Background(), "zero@example.com")
	if !errors.Is(err, ErrChatQuotaExhausted) {
		t.Errorf("enforce=ON user/0: expected ErrChatQuotaExhausted, got %v", err)
	}
}

// TestCheckChatAllowed_EnforceOn_UserNonZero verifies that enforce=ON with
// code='user' + chat_limit=5 allows the request (quota available).
func TestCheckChatAllowed_EnforceOn_UserNonZero(t *testing.T) {
	gdb := setupChatGateDB(t)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", nil) })

	viper.Set("chatlimit.enforce", true)
	seedChatGateUser(t, gdb, "funded@example.com", "user", 5)

	ps := NewService()
	if err := ps.CheckChatAllowed(context.Background(), "funded@example.com"); err != nil {
		t.Errorf("enforce=ON user/5: expected nil, got %v", err)
	}
}

// TestCheckChatAllowed_EnforceOn_AdminBypass verifies that enforce=ON with
// code='admin' + chat_limit=0 is allowed (role bypass).
// mutation guard: remove admin from chatGateBypassCodes → RED.
func TestCheckChatAllowed_EnforceOn_AdminBypass(t *testing.T) {
	gdb := setupChatGateDB(t)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", nil) })

	viper.Set("chatlimit.enforce", true)
	seedChatGateUser(t, gdb, "admin@example.com", "admin", 0)

	ps := NewService()
	if err := ps.CheckChatAllowed(context.Background(), "admin@example.com"); err != nil {
		t.Errorf("enforce=ON admin/0: expected nil (bypass), got %v", err)
	}
}

// TestCheckChatAllowed_EnforceOn_SuperAdminBypass verifies that enforce=ON with
// code='super_admin' + chat_limit=0 is allowed (role bypass).
func TestCheckChatAllowed_EnforceOn_SuperAdminBypass(t *testing.T) {
	gdb := setupChatGateDB(t)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", nil) })

	viper.Set("chatlimit.enforce", true)
	seedChatGateUser(t, gdb, "superadmin@example.com", "super_admin", 0)

	ps := NewService()
	if err := ps.CheckChatAllowed(context.Background(), "superadmin@example.com"); err != nil {
		t.Errorf("enforce=ON super_admin/0: expected nil (bypass), got %v", err)
	}
}

// TestCheckChatAllowed_EnforceOn_VipUserBypass verifies that enforce=ON with
// code='vip_user' + chat_limit=0 is allowed (role bypass; no quota limit yet).
// mutation guard: remove vip_user from chatGateBypassCodes → RED.
func TestCheckChatAllowed_EnforceOn_VipUserBypass(t *testing.T) {
	gdb := setupChatGateDB(t)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", nil) })

	viper.Set("chatlimit.enforce", true)
	seedChatGateUser(t, gdb, "vip@example.com", "vip_user", 0)

	ps := NewService()
	if err := ps.CheckChatAllowed(context.Background(), "vip@example.com"); err != nil {
		t.Errorf("enforce=ON vip_user/0: expected nil (bypass), got %v", err)
	}
}

// TestCheckChatAllowed_EnforceOn_GuestBlocked verifies that enforce=ON with
// code='guest' + chat_limit=0 returns ErrChatQuotaExhausted (guest takes the
// normal gate and is not bypassed).
func TestCheckChatAllowed_EnforceOn_GuestBlocked(t *testing.T) {
	gdb := setupChatGateDB(t)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", nil) })

	viper.Set("chatlimit.enforce", true)
	seedChatGateUser(t, gdb, "guest@example.com", "guest", 0)

	ps := NewService()
	err := ps.CheckChatAllowed(context.Background(), "guest@example.com")
	if !errors.Is(err, ErrChatQuotaExhausted) {
		t.Errorf("enforce=ON guest/0: expected ErrChatQuotaExhausted, got %v", err)
	}
}

// TestCheckChatAllowed_FailOpen verifies fail-open when enforce=ON but the user
// is not in the DB: returns nil instead of rejecting, to avoid spurious
// rejections during DB turbulence.
// mutation guard: change the err branch to return ErrChatQuotaExhausted → RED.
func TestCheckChatAllowed_FailOpen(t *testing.T) {
	setupChatGateDB(t)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", nil) })

	viper.Set("chatlimit.enforce", true)

	ps := NewService()
	// Non-existent email → DB returns ErrRecordNotFound → must fail-open (nil).
	if err := ps.CheckChatAllowed(context.Background(), "nobody@example.com"); err != nil {
		t.Errorf("fail-open: missing user must allow, got %v", err)
	}
}

// TestCheckChatAllowed_FailOpen_EmptyEmail verifies that an empty email also
// triggers fail-open (same rationale as the missing-user case).
func TestCheckChatAllowed_FailOpen_EmptyEmail(t *testing.T) {
	setupChatGateDB(t)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", nil) })

	viper.Set("chatlimit.enforce", true)

	ps := NewService()
	if err := ps.CheckChatAllowed(context.Background(), ""); err != nil {
		t.Errorf("fail-open: empty email must allow, got %v", err)
	}
}

func TestCheckRemoteProductAllowed_FlagOff(t *testing.T) {
	gdb := setupChatGateDB(t)
	seedChatGateUser(t, gdb, "network@example.com", "network-role", 5)
	seedRemoteProductPermission(t, gdb, "network-role", "GeneNetworkAgent", 1)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	err := NewService().CheckRemoteProductAllowed(context.Background(), "network@example.com", "GeneNetworkAgent")
	if !errors.Is(err, ErrRemoteProductDisabled) {
		t.Fatalf("flag-off remote product error = %v, want ErrRemoteProductDisabled", err)
	}
}

func TestCheckRemoteProductAllowed_RequiresRolePermission(t *testing.T) {
	gdb := setupChatGateDB(t)
	seedChatGateUser(t, gdb, "network@example.com", "network-role", 5)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{NetworkEnabled: true}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	err := NewService().CheckRemoteProductAllowed(context.Background(), "network@example.com", "GeneNetworkAgent")
	if !errors.Is(err, ErrRemoteProductForbidden) {
		t.Fatalf("missing remote role error = %v, want ErrRemoteProductForbidden", err)
	}
}

func TestCheckRemoteProductAllowed_GrantedRole(t *testing.T) {
	gdb := setupChatGateDB(t)
	seedChatGateUser(t, gdb, "network@example.com", "network-role", 5)
	seedRemoteProductPermission(t, gdb, "network-role", "GeneNetworkAgent", 1)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{NetworkEnabled: true}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	if err := NewService().CheckRemoteProductAllowed(context.Background(), "network@example.com", "GeneNetworkAgent"); err != nil {
		t.Fatalf("granted remote role must pass: %v", err)
	}
}

func TestCheckRemoteProductAllowed_UnknownToolFailsClosed(t *testing.T) {
	setupChatGateDB(t)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{NetworkEnabled: true}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	err := NewService().CheckRemoteProductAllowed(context.Background(), "network@example.com", "UnknownAgent")
	if !errors.Is(err, ErrRemoteProductForbidden) {
		t.Fatalf("unknown remote product error = %v, want ErrRemoteProductForbidden", err)
	}
}

func TestIsDedicatedAgentProductTool(t *testing.T) {
	for _, tool := range []string{"InSilicoResearchAgent", "DigitalDesignAgent", "GeneNetworkAgent"} {
		if !IsDedicatedAgentProductTool(tool) {
			t.Fatalf("%s must have a dedicated product route", tool)
		}
	}
	for _, tool := range []string{"ChatAgent", "research", "UnknownAgent", ""} {
		if IsDedicatedAgentProductTool(tool) {
			t.Fatalf("%q must not have a dedicated product route", tool)
		}
	}
}

func TestCheckExpertRemoteProductsAllowedRequiresEveryProductFlag(t *testing.T) {
	gdb := setupChatGateDB(t)
	seedChatGateUser(t, gdb, "expert@example.com", "admin", 5)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		ResearchEnabled: true,
		DesignEnabled:   true,
		NetworkEnabled:  false,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	err := NewService().CheckExpertRemoteProductsAllowed(context.Background(), "expert@example.com")
	if !errors.Is(err, ErrRemoteProductDisabled) {
		t.Fatalf("Expert with one product flag off = %v, want ErrRemoteProductDisabled", err)
	}
}

func TestCheckExpertRemoteProductsAllowedRequiresEveryGrant(t *testing.T) {
	gdb := setupChatGateDB(t)
	seedChatGateUser(t, gdb, "expert@example.com", "expert-role", 5)
	seedRemoteProductPermission(t, gdb, "expert-role", "InSilicoResearchAgent", 1)
	seedRemoteProductPermission(t, gdb, "expert-role", "DigitalDesignAgent", 2)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		ResearchEnabled: true,
		DesignEnabled:   true,
		NetworkEnabled:  true,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	err := NewService().CheckExpertRemoteProductsAllowed(context.Background(), "expert@example.com")
	if !errors.Is(err, ErrRemoteProductForbidden) {
		t.Fatalf("Expert with one product grant missing = %v, want ErrRemoteProductForbidden", err)
	}
}

func TestQueryRemoteProductFlagOffStopsBeforeBot(t *testing.T) {
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{ProxyEnabled: true, BaseURL: "http://127.0.0.1:1"}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	_, err := NewService().Query(context.Background(), "network@example.com", QueryInput{
		Query: "network",
		Tool:  "GeneNetworkAgent",
		Mode:  "instant",
	})
	if !errors.Is(err, ErrRemoteProductDisabled) {
		t.Fatalf("flag-off Query error = %v, want ErrRemoteProductDisabled", err)
	}
}

func TestQueryRemoteProductRoleDeniedStopsBeforeBot(t *testing.T) {
	gdb := setupChatGateDB(t)
	seedChatGateUser(t, gdb, "network@example.com", "network-role", 5)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{ProxyEnabled: true, NetworkEnabled: true, BaseURL: "http://127.0.0.1:1"}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	_, err := NewService().Query(context.Background(), "network@example.com", QueryInput{
		Query: "network",
		Tool:  "GeneNetworkAgent",
		Mode:  "instant",
	})
	if !errors.Is(err, ErrRemoteProductForbidden) {
		t.Fatalf("role-denied Query error = %v, want ErrRemoteProductForbidden", err)
	}
}

func TestQueryRemoteProductEmptyModeStillChecksPermission(t *testing.T) {
	gdb := setupChatGateDB(t)
	seedChatGateUser(t, gdb, "network@example.com", "network-role", 5)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		ProxyEnabled:   true,
		NetworkEnabled: true,
		BaseURL:        "http://127.0.0.1:1",
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	_, err := NewService().Query(context.Background(), "network@example.com", QueryInput{
		Query: "network",
		Tool:  "GeneNetworkAgent",
		// Mode intentionally omitted: direct service calls must still enforce
		// the explicit remote tool boundary.
	})
	if !errors.Is(err, ErrRemoteProductForbidden) {
		t.Fatalf("empty-mode role-denied Query error = %v, want ErrRemoteProductForbidden", err)
	}
}

func TestQueryRemoteProductRejectsNoncanonicalSurfaceBeforeBot(t *testing.T) {
	previous := rxBot.BotConfig
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		hits++
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{
		ProxyEnabled:    true,
		ResearchEnabled: true,
		BaseURL:         srv.URL,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	for _, tc := range []struct {
		name    string
		surface QuerySurface
		tool    string
	}{
		{name: "agent surface rejects legacy alias", surface: QuerySurfaceAgentProduct, tool: "research"},
		{name: "unknown surface rejects canonical tool", surface: QuerySurface(99), tool: "InSilicoResearchAgent"},
		{name: "agent surface rejects chat tool", surface: QuerySurfaceAgentProduct, tool: "ChatAgent"},
		{name: "unknown surface rejects chat tool", surface: QuerySurface(99), tool: "ChatAgent"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := NewService().Query(context.Background(), "remote@example.com", QueryInput{
				Query:   "remote",
				Tool:    tc.tool,
				Mode:    "instant",
				Surface: tc.surface,
			})
			if !errors.Is(err, ErrRemoteProductForbidden) {
				t.Fatalf("Query error = %v, want ErrRemoteProductForbidden", err)
			}
		})
	}
	if hits != 0 {
		t.Fatalf("noncanonical remote input reached Bot %d time(s)", hits)
	}
}

// TestQueryLegacyRemoteProductCompatibilityBeforeStrictChatCutover proves that
// the pre-cutover Chat Instant contract still reaches the existing query
// service. The controlled upstream failure is intentional: this locks the
// authorization and dispatch compatibility boundary without inventing Bot
// success that only a deployed integration can establish.
func TestQueryLegacyRemoteProductCompatibilityBeforeStrictChatCutover(t *testing.T) {
	setupExpertTestDB(t)
	var hit string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hit = r.URL.Path
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	t.Cleanup(srv.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL:         srv.URL,
		ProxyEnabled:    true,
		ResearchEnabled: true,
		DesignEnabled:   true,
		NetworkEnabled:  true,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	legacy := QueryInput{
		Query:   "legacy product request",
		Tool:    "InSilicoResearchAgent",
		Mode:    "instant",
		Surface: QuerySurfaceChat,
	}
	_, err := NewService().Query(context.Background(), "alice", legacy)
	var upstream *rxBot.APIError
	if !errors.As(err, &upstream) || upstream.Status != http.StatusServiceUnavailable {
		t.Fatalf("Query error = %v; want the controlled upstream 503 after compatibility dispatch", err)
	}
	if hit != "/v1/agents/research/runs" {
		t.Fatalf("legacy Chat request reached %q; want the research run endpoint", hit)
	}
}
