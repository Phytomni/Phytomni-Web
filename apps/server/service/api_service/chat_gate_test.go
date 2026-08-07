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

func TestResolveAgentPermissions_DisabledAnalystIsNotGenericAllowed(t *testing.T) {
	gdb := setupChatGateDB(t)
	seedChatGateUser(t, gdb, "analyst@example.com", "analyst-role", 5)
	seedRemoteProductPermission(t, gdb, "analyst-role", "AnalystAgent", 1)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	resolution, err := NewService().ResolveAgentPermissions(context.Background(), "analyst@example.com")
	if err != nil {
		t.Fatalf("resolve permissions: %v", err)
	}
	if !containsAgentTool(resolution.GrantedTools, "AnalystAgent") {
		t.Fatalf("granted tools = %#v, want AnalystAgent retained", resolution.GrantedTools)
	}
	if containsAgentTool(resolution.AllowedTools, "AnalystAgent") {
		t.Fatalf("disabled Analyst remained generic-allowed: %#v", resolution.AllowedTools)
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

func researchCatalogServer(t *testing.T, response string, calls *int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		(*calls)++
		if r.Method != http.MethodGet || r.URL.Path != "/v1/agents" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(response))
	}))
}

type staticResearchCatalogReader struct {
	response *rxBot.AgentsListResponse
}

func (reader staticResearchCatalogReader) GetAgents(context.Context) (*rxBot.AgentsListResponse, error) {
	return reader.response, nil
}

func serviceWithValidResearchCatalog() *Service {
	return &Service{
		catalogReader: staticResearchCatalogReader{response: validResearchCapabilityCatalog()},
	}
}

func TestCheckRemoteProductAllowedAuthorizedResearchRequiresResearchContract(t *testing.T) {
	gdb := setupChatGateDB(t)
	seedChatGateUser(t, gdb, "research@example.com", "research-role", 5)
	seedRemoteProductPermission(t, gdb, "research-role", "InSilicoResearchAgent", 1)
	calls := 0
	srv := researchCatalogServer(t, `{}`, &calls)
	t.Cleanup(srv.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, ResearchEnabled: true}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	err := NewService().CheckRemoteProductAllowed(context.Background(), "research@example.com", "InSilicoResearchAgent")
	if !errors.Is(err, ErrResearchInputIncompatible) {
		t.Fatalf("Research admission error = %v, want ErrResearchInputIncompatible", err)
	}
	if calls != 1 {
		t.Fatalf("Research catalog calls = %d, want 1", calls)
	}
}

func TestCheckRemoteProductAllowedUnauthorizedResearchSkipsResearchContract(t *testing.T) {
	gdb := setupChatGateDB(t)
	seedChatGateUser(t, gdb, "denied@example.com", "ordinary", 5)
	calls := 0
	srv := researchCatalogServer(t, `{}`, &calls)
	t.Cleanup(srv.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, ResearchEnabled: true}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	err := NewService().CheckRemoteProductAllowed(context.Background(), "denied@example.com", "InSilicoResearchAgent")
	if !errors.Is(err, ErrRemoteProductForbidden) {
		t.Fatalf("unauthorized Research error = %v, want ErrRemoteProductForbidden", err)
	}
	if calls != 0 {
		t.Fatalf("unauthorized Research called catalog %d time(s)", calls)
	}
}

func TestCheckRemoteProductAllowedOtherAgentDoesNotRequireResearchContract(t *testing.T) {
	gdb := setupChatGateDB(t)
	seedChatGateUser(t, gdb, "design@example.com", "design-role", 5)
	seedRemoteProductPermission(t, gdb, "design-role", "DigitalDesignAgent", 1)
	calls := 0
	srv := researchCatalogServer(t, `{}`, &calls)
	t.Cleanup(srv.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, DesignEnabled: true}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	if err := NewService().CheckRemoteProductAllowed(context.Background(), "design@example.com", "DigitalDesignAgent"); err != nil {
		t.Fatalf("Design admission changed with incompatible Research: %v", err)
	}
	if calls != 0 {
		t.Fatalf("Design admission called Research catalog %d time(s)", calls)
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
	for _, tool := range []string{"AnalystAgent", "analyst", "InSilicoResearchAgent", "DigitalDesignAgent", "GeneNetworkAgent"} {
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

func TestPermissionFailure(t *testing.T) {
	tests := []struct {
		name        string
		permissions AgentPermissionResolution
		requested   string
		want        error
	}{
		{
			name:        "requested canonical tool is not granted",
			permissions: AgentPermissionResolution{GrantedTools: []string{"DataAgent"}},
			requested:   "ChatAgent",
			want:        ErrAgentToolForbidden,
		},
		{
			name:      "no grants for autonomous routing",
			requested: "",
			want:      ErrNoExecutableAgentTools,
		},
		{
			name: "granted tools are all unavailable",
			permissions: AgentPermissionResolution{
				GrantedTools: []string{"InSilicoResearchAgent"},
				AllowedTools: []string{},
			},
			want: ErrAgentToolsUnavailable,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if err := permissionFailure(tc.permissions, tc.requested); !errors.Is(err, tc.want) {
				t.Fatalf("permissionFailure(%#v, %q) = %v, want %v", tc.permissions, tc.requested, err, tc.want)
			}
		})
	}
}

func TestQueryInstantRemoteProductRejectsBeforeFeatureGate(t *testing.T) {
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{ProxyEnabled: true, BaseURL: "http://127.0.0.1:1"}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	_, err := NewService().Query(context.Background(), "network@example.com", QueryInput{
		Query: "network",
		Tool:  "GeneNetworkAgent",
		Mode:  "instant",
	})
	if !errors.Is(err, ErrInvalidChatRouting) {
		t.Fatalf("instant Chat Query error = %v, want ErrInvalidChatRouting", err)
	}
}

func TestQueryInstantRemoteProductRejectsBeforePermissionCheck(t *testing.T) {
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
	if !errors.Is(err, ErrInvalidChatRouting) {
		t.Fatalf("instant Chat Query error = %v, want ErrInvalidChatRouting", err)
	}
}

func TestQueryRemoteProductEmptyModeRejectsBeforePermissionCheck(t *testing.T) {
	gdb := setupChatGateDB(t)
	seedChatGateUser(t, gdb, "network@example.com", "network-role", 5)
	previous := rxBot.BotConfig
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		hits++
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{
		ProxyEnabled: true,
		BaseURL:      srv.URL,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	_, err := NewService().Query(context.Background(), "network@example.com", QueryInput{
		Query: "network",
		Tool:  "GeneNetworkAgent",
	})
	if !errors.Is(err, ErrInvalidChatRouting) {
		t.Fatalf("empty-mode Chat Query error = %v, want ErrInvalidChatRouting", err)
	}
	if hits != 0 {
		t.Fatalf("empty-mode Chat request reached Bot %d time(s)", hits)
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

func TestValidateChatRouting(t *testing.T) {
	tests := []struct {
		name       string
		mode       string
		tool       string
		wantMode   string
		wantForced string
		wantErr    bool
	}{
		{"missing defaults to instant", "", "", "instant", "", false},
		{"instant chat", "instant", "", "instant", "", false},
		{"instant tool rejected", "instant", "DataAgent", "", "", true},
		{"expert autonomous", "expert", "", "expert", "", false},
		{"expert forced", "expert", "DataAgent", "expert", "DataAgent", false},
		{"unknown mode", "fast", "", "", "", true},
		{"unknown tool", "expert", "MissingAgent", "", "", true},
		{"padded mode", " expert", "", "", "", true},
		{"padded tool", "expert", " DataAgent", "", "", true},
		{"joined tools", "expert", "DataAgent,AnalystAgent", "", "", true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ValidateChatRouting(tc.mode, tc.tool)
			if tc.wantErr {
				if !errors.Is(err, ErrInvalidChatRouting) {
					t.Fatalf("ValidateChatRouting(%q, %q) error = %v, want ErrInvalidChatRouting", tc.mode, tc.tool, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("ValidateChatRouting(%q, %q): %v", tc.mode, tc.tool, err)
			}
			if got.Mode != tc.wantMode || got.ForcedTool != tc.wantForced {
				t.Fatalf("decision = %#v, want mode=%q forced_tool=%q", got, tc.wantMode, tc.wantForced)
			}
		})
	}
}

func TestQueryRejectsLegacyRemoteProductOnChatSurface(t *testing.T) {
	previous := rxBot.BotConfig
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		hits++
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	_, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query:   "legacy product request",
		Tool:    "InSilicoResearchAgent",
		Mode:    "instant",
		Surface: QuerySurfaceChat,
	})
	if !errors.Is(err, ErrInvalidChatRouting) {
		t.Fatalf("Query error = %v, want ErrInvalidChatRouting", err)
	}
	if hits != 0 {
		t.Fatalf("legacy Chat request reached Bot %d time(s)", hits)
	}
}
