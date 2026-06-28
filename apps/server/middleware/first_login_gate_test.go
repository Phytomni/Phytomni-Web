package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"phytomni-server/db"
)

// setupGateTestDB opens an in-memory SQLite DB with a minimal users table
// (email + first_login_status — the only columns LoginStatusMiddleware selects)
// and registers it in the global registry. Uses hand-written DDL rather than
// AutoMigrate for the same reason as service-layer tests: the MySQL type:enum
// tag on first_login_status is not recognised by SQLite.
func setupGateTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := gdb.Exec(`CREATE TABLE users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT,
		first_login_status TEXT DEFAULT '0'
	)`).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	db.Set("phytomni-server", gdb)
	return gdb
}

// runGate runs LoginStatusMiddleware on a gin test context and returns the
// response recorder. Passing username==nil skips injecting the "username" key,
// simulating a missing auth context.
func runGate(t *testing.T, gdb *gorm.DB, username interface{}, path string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	ctx.Request = httptest.NewRequest(http.MethodGet, path, nil)
	if username != nil {
		ctx.Set("username", username)
	}
	LoginStatusMiddleware()(ctx)
	return w
}

// TestLoginStatusMiddleware_FirstLoginBlocksOtherPaths pins the forced-password-change gate:
// a user with first_login_status='0' is blocked with 403 on any non-allowlisted path.
func TestLoginStatusMiddleware_FirstLoginBlocksOtherPaths(t *testing.T) {
	gdb := setupGateTestDB(t)
	if err := gdb.Exec(`INSERT INTO users (email, first_login_status) VALUES ('alice@x.com', '0')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	w := runGate(t, gdb, "alice@x.com", "/api/v1/users/me")
	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403 for first-login user on non-allowed path, got %d", w.Code)
	}
}

// TestLoginStatusMiddleware_FirstLoginAllowsPasswordChange pins the allowlist:
// a first-login user may access /api/v1/users/me/password (not blocked).
func TestLoginStatusMiddleware_FirstLoginAllowsPasswordChange(t *testing.T) {
	gdb := setupGateTestDB(t)
	if err := gdb.Exec(`INSERT INTO users (email, first_login_status) VALUES ('alice@x.com', '0')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	w := runGate(t, gdb, "alice@x.com", "/api/v1/users/me/password")
	if w.Code != http.StatusOK {
		t.Errorf("expected pass-through (200) on allowed path, got %d", w.Code)
	}
}

// TestLoginStatusMiddleware_NonFirstLoginPasses pins that a user who has already
// changed their password (first_login_status='1') is passed through on any path.
func TestLoginStatusMiddleware_NonFirstLoginPasses(t *testing.T) {
	gdb := setupGateTestDB(t)
	if err := gdb.Exec(`INSERT INTO users (email, first_login_status) VALUES ('bob@x.com', '1')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	w := runGate(t, gdb, "bob@x.com", "/api/v1/users/me")
	if w.Code != http.StatusOK {
		t.Errorf("expected pass-through (200) for non-first-login user, got %d", w.Code)
	}
}

// TestLoginStatusMiddleware_MissingContextAborts pins fail-closed behavior: missing username context → 401.
func TestLoginStatusMiddleware_MissingContextAborts(t *testing.T) {
	gdb := setupGateTestDB(t)
	w := runGate(t, gdb, nil, "/api/v1/users/me")
	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 when username context missing, got %d", w.Code)
	}
}
