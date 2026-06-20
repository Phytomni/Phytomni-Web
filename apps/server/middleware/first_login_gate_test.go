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

// setupGateTestDB 建 in-memory SQLite 的 users(只需 email + first_login_status,
// 即 LoginStatusMiddleware 实际 Select 的列)并注册到全局 registry。
// 手写 DDL 而非 AutoMigrate 的理由同 service 层测试:first_login_status 的
// MySQL `type:enum` tag SQLite 不识别。
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

// runGate 在一个 gin 测试 context 上跑 LoginStatusMiddleware 并返回写出的 recorder。
// username==nil 表示不注入 username key(模拟缺失鉴权上下文)。
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

// TestLoginStatusMiddleware_FirstLoginBlocksOtherPaths 钉死强制改密闸:first_login_status='0'
// 的用户访问非白名单路径被 403 拦截。
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

// TestLoginStatusMiddleware_FirstLoginAllowsPasswordChange 钉死白名单:first-login 用户
// 可以访问 /api/v1/users/me/password(不被拦截)。
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

// TestLoginStatusMiddleware_NonFirstLoginPasses 钉死:已改密用户(first_login_status='1')
// 任意路径放行。
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

// TestLoginStatusMiddleware_MissingContextAborts 钉死 fail-closed:缺 username 上下文 → 401。
func TestLoginStatusMiddleware_MissingContextAborts(t *testing.T) {
	gdb := setupGateTestDB(t)
	w := runGate(t, gdb, nil, "/api/v1/users/me")
	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 when username context missing, got %d", w.Code)
	}
}
