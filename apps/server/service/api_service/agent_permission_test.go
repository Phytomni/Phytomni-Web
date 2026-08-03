package api_service

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"phytomni-server/db"
	rxBot "phytomni-server/external/bot"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupAgentPermissionDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if sqlDB, err := gdb.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	for _, statement := range []string{
		`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, code TEXT)`,
		`CREATE TABLE tool_names (id INTEGER PRIMARY KEY, tool_name TEXT NOT NULL)`,
		`CREATE TABLE user_tool_names (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, tool_id TEXT NOT NULL)`,
	} {
		if err := gdb.Exec(statement).Error; err != nil {
			t.Fatalf("ddl: %v", err)
		}
	}
	db.Set("phytomni-server", gdb)
	return gdb
}

func setupAgentPermissionUsersOnlyDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if sqlDB, err := gdb.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	if err := gdb.Exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, code TEXT)`).Error; err != nil {
		t.Fatalf("users ddl: %v", err)
	}
	db.Set("phytomni-server", gdb)
	return gdb
}

func seedAgentPermissionUser(t *testing.T, gdb *gorm.DB, email, code string) {
	t.Helper()
	if err := gdb.Exec(`INSERT INTO users (email, code) VALUES (?, ?)`, email, code).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
}

func seedAgentPermissionTool(t *testing.T, gdb *gorm.DB, code, tool string, id int) {
	t.Helper()
	if err := gdb.Exec(`INSERT INTO tool_names (id, tool_name) VALUES (?, ?)`, id, tool).Error; err != nil {
		t.Fatalf("seed tool: %v", err)
	}
	if err := gdb.Exec(`INSERT INTO user_tool_names (code, tool_id) VALUES (?, ?)`, code, id).Error; err != nil {
		t.Fatalf("seed grant: %v", err)
	}
}

func allAgentFlags() *rxBot.Config {
	return &rxBot.Config{AnalystEnabled: true, ResearchEnabled: true, DesignEnabled: true, NetworkEnabled: true}
}

func TestResolveAgentPermissions(t *testing.T) {
	previous := rxBot.BotConfig
	t.Cleanup(func() { rxBot.BotConfig = previous })

	t.Run("regular user orders and deduplicates canonical grants", func(t *testing.T) {
		gdb := setupAgentPermissionDB(t)
		seedAgentPermissionUser(t, gdb, "regular@example.com", "regular")
		seedAgentPermissionTool(t, gdb, "regular", "DeepGenomeAgent", 31)
		seedAgentPermissionTool(t, gdb, "regular", "ChatAgent", 7)
		seedAgentPermissionTool(t, gdb, "regular", "DeepGenomeAgent", 32)
		seedAgentPermissionTool(t, gdb, "regular", "UnknownAgent", 99)
		rxBot.BotConfig = allAgentFlags()

		got, err := NewService().ResolveAgentPermissions(context.Background(), "regular@example.com")
		if err != nil {
			t.Fatalf("resolve: %v", err)
		}
		want := []string{"ChatAgent", "DeepGenomeAgent"}
		if !reflect.DeepEqual(got.GrantedTools, want) || !reflect.DeepEqual(got.AllowedTools, want) {
			t.Fatalf("granted/allowed = %#v/%#v, want %#v", got.GrantedTools, got.AllowedTools, want)
		}
		if !reflect.DeepEqual(got.PermissionKeys, []string{"UnknownAgent"}) {
			t.Fatalf("permission keys = %#v", got.PermissionKeys)
		}
	})

	for _, role := range []string{"admin", "super_admin"} {
		t.Run(role+" receives every canonical tool without grant tables", func(t *testing.T) {
			gdb := setupAgentPermissionUsersOnlyDB(t)
			seedAgentPermissionUser(t, gdb, role+"@example.com", role)
			rxBot.BotConfig = allAgentFlags()
			got, err := NewService().ResolveAgentPermissions(context.Background(), role+"@example.com")
			if err != nil {
				t.Fatalf("resolve: %v", err)
			}
			want := rxBot.CanonicalAgentDisplayTools()
			if !reflect.DeepEqual(got.GrantedTools, want) || !reflect.DeepEqual(got.AllowedTools, want) {
				t.Fatalf("granted/allowed = %#v/%#v, want %#v", got.GrantedTools, got.AllowedTools, want)
			}
			if err := NewService().CheckRemoteProductAllowed(context.Background(), role+"@example.com", "research"); err != nil {
				t.Fatalf("remote product gate: %v", err)
			}
		})
	}

	t.Run("canonical role is a direct grant", func(t *testing.T) {
		gdb := setupAgentPermissionDB(t)
		seedAgentPermissionUser(t, gdb, "direct@example.com", "DataAgent")
		rxBot.BotConfig = allAgentFlags()
		got, err := NewService().ResolveAgentPermissions(context.Background(), "direct@example.com")
		if err != nil || !reflect.DeepEqual(got.GrantedTools, []string{"DataAgent"}) {
			t.Fatalf("resolution/error = %#v/%v", got, err)
		}
	})

	t.Run("real user without grants has empty slices", func(t *testing.T) {
		gdb := setupAgentPermissionDB(t)
		seedAgentPermissionUser(t, gdb, "empty@example.com", "user")
		got, err := NewService().ResolveAgentPermissions(context.Background(), "empty@example.com")
		if err != nil || got.GrantedTools == nil || got.AllowedTools == nil || got.PermissionKeys == nil || len(got.GrantedTools) != 0 || len(got.AllowedTools) != 0 || len(got.PermissionKeys) != 0 {
			t.Fatalf("resolution/error = %#v/%v", got, err)
		}
	})

	t.Run("missing user returns typed error", func(t *testing.T) {
		setupAgentPermissionDB(t)
		_, err := NewService().ResolveAgentPermissions(context.Background(), "missing@example.com")
		if !errors.Is(err, ErrAgentPermissionUserNotFound) {
			t.Fatalf("error = %v, want typed not-found", err)
		}
	})

	t.Run("database failures are preserved", func(t *testing.T) {
		gdb := setupAgentPermissionDB(t)
		sqlDB, err := gdb.DB()
		if err != nil {
			t.Fatalf("sql db: %v", err)
		}
		if err := sqlDB.Close(); err != nil {
			t.Fatalf("close: %v", err)
		}
		_, err = NewService().ResolveAgentPermissions(context.Background(), "closed@example.com")
		if err == nil || errors.Is(err, ErrAgentPermissionUserNotFound) {
			t.Fatalf("error = %v, want database failure", err)
		}
	})

	for _, tc := range []struct {
		name     string
		config   *rxBot.Config
		disabled string
	}{
		{"research flag", &rxBot.Config{AnalystEnabled: true, DesignEnabled: true, NetworkEnabled: true}, "InSilicoResearchAgent"},
		{"design flag", &rxBot.Config{AnalystEnabled: true, ResearchEnabled: true, NetworkEnabled: true}, "DigitalDesignAgent"},
		{"network flag", &rxBot.Config{AnalystEnabled: true, ResearchEnabled: true, DesignEnabled: true}, "GeneNetworkAgent"},
	} {
		t.Run(tc.name+" filters only its product", func(t *testing.T) {
			gdb := setupAgentPermissionDB(t)
			seedAgentPermissionUser(t, gdb, "flags@example.com", "admin")
			rxBot.BotConfig = tc.config
			got, err := NewService().ResolveAgentPermissions(context.Background(), "flags@example.com")
			if err != nil {
				t.Fatalf("resolve: %v", err)
			}
			if !reflect.DeepEqual(got.GrantedTools, rxBot.CanonicalAgentDisplayTools()) {
				t.Fatalf("granted = %#v", got.GrantedTools)
			}
			for _, tool := range got.AllowedTools {
				if tool == tc.disabled {
					t.Fatalf("disabled tool remained allowed: %s", tool)
				}
			}
			if len(got.AllowedTools) != len(rxBot.CanonicalAgentDisplayOrder)-1 {
				t.Fatalf("allowed = %#v", got.AllowedTools)
			}
		})
	}

	t.Run("all ten canonical names are granted in display order", func(t *testing.T) {
		gdb := setupAgentPermissionDB(t)
		seedAgentPermissionUser(t, gdb, "ten@example.com", "ten-role")
		for id, tool := range rxBot.CanonicalAgentDisplayOrder {
			seedAgentPermissionTool(t, gdb, "ten-role", tool, id+1)
		}
		rxBot.BotConfig = allAgentFlags()
		got, err := NewService().ResolveAgentPermissions(context.Background(), "ten@example.com")
		if err != nil || !reflect.DeepEqual(got.GrantedTools, rxBot.CanonicalAgentDisplayTools()) {
			t.Fatalf("resolution/error = %#v/%v", got, err)
		}
	})
}
