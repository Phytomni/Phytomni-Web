package api_handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"phytomni-server/common/i18n"
	"phytomni-server/db"
	rxBot "phytomni-server/external/bot"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupPermissionUserToolDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := gdb.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
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

func requireJSONEq(t *testing.T, want, got string) {
	t.Helper()
	var wantJSON, gotJSON interface{}
	if err := json.Unmarshal([]byte(want), &wantJSON); err != nil {
		t.Fatalf("decode expected JSON: %v", err)
	}
	if err := json.Unmarshal([]byte(got), &gotJSON); err != nil {
		t.Fatalf("decode actual JSON: %v; body=%s", err, got)
	}
	if !reflect.DeepEqual(wantJSON, gotJSON) {
		t.Fatalf("JSON = %s, want %s", got, want)
	}
}

func permissionUserToolRecorder(t *testing.T, email string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/users/me/tool-permissions", nil)
	ctx.Set("username", email)
	i18n.Localize()(ctx)
	NewHandler().PermissionUserTool(ctx)
	return recorder
}

func TestPermissionUserToolReturnsEffectivePartialOrderedList(t *testing.T) {
	previous := rxBot.BotConfig
	t.Cleanup(func() { rxBot.BotConfig = previous })
	rxBot.BotConfig = &rxBot.Config{ResearchEnabled: true, DesignEnabled: true, NetworkEnabled: true}
	gdb := setupPermissionUserToolDB(t)
	if err := gdb.Exec(`INSERT INTO users (email, code) VALUES (?, ?)`, "partial@example.com", "user").Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	for _, grant := range []struct {
		id   int
		tool string
	}{
		{1, "DeepGenomeAgent"},
		{2, "ChatAgent"},
		{3, "Profile management"},
	} {
		if err := gdb.Exec(`INSERT INTO tool_names (id, tool_name) VALUES (?, ?)`, grant.id, grant.tool).Error; err != nil {
			t.Fatalf("seed tool: %v", err)
		}
		if err := gdb.Exec(`INSERT INTO user_tool_names (code, tool_id) VALUES (?, ?)`, "user", grant.id).Error; err != nil {
			t.Fatalf("seed grant: %v", err)
		}
	}

	recorder := permissionUserToolRecorder(t, "partial@example.com")
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	requireJSONEq(t, `{
		"code": 200,
		"message": "success",
		"data": {
			"permission": "user",
			"tool_list": ["ChatAgent", "DeepGenomeAgent"],
			"permission_list": ["Profile management"],
			"expert_enabled": false
		}
	}`, recorder.Body.String())
}

func TestPermissionUserToolReturnsValidEmptyList(t *testing.T) {
	setupPermissionUserToolDB(t)
	if err := db.MustGet("phytomni-server").Exec(`INSERT INTO users (email, code) VALUES (?, ?)`, "empty@example.com", "user").Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}

	recorder := permissionUserToolRecorder(t, "empty@example.com")
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	requireJSONEq(t, `{
		"code": 200,
		"message": "success",
		"data": {
			"permission": "user",
			"tool_list": [],
			"permission_list": [],
			"expert_enabled": false
		}
	}`, recorder.Body.String())
}

func TestPermissionUserToolFailsClosedForMissingUser(t *testing.T) {
	setupPermissionUserToolDB(t)

	recorder := permissionUserToolRecorder(t, "missing@example.com")
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusInternalServerError, recorder.Body.String())
	}
	if body := recorder.Body.String(); strings.Contains(body, "missing@example.com") || strings.Contains(body, "agent permission") {
		t.Fatalf("error leaked internal identity details: %s", body)
	}
}

func TestPermissionUserToolFailsClosedForDatabaseError(t *testing.T) {
	gdb := setupPermissionUserToolDB(t)
	sqlDB, err := gdb.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatalf("close db: %v", err)
	}

	recorder := permissionUserToolRecorder(t, "db-error@example.com")
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusInternalServerError, recorder.Body.String())
	}
	if body := recorder.Body.String(); strings.Contains(body, "sql") || strings.Contains(body, "database") {
		t.Fatalf("error leaked database details: %s", body)
	}
}
