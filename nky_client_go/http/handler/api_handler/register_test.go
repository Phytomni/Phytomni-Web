package api_handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"nky_client_go/db"
)

// setupProfileTestDB 建一个 in-memory SQLite,创建 ApiGetUserProfile 实际查的两张表
// (s_user / s_question_agent_logs) 的最小列集,注册到全局 db registry。
//
// 手写 CREATE TABLE 而非 AutoMigrate:SUser 带 MySQL 专有的 type:enum tag,
// SQLite AutoMigrate 不识别;这里只列 profile 路径读到的列,其余按零值填充。
func setupProfileTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	ddl := []string{
		`CREATE TABLE s_user (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT,
			code TEXT,
			description TEXT,
			locked_until DATETIME,
			last_login_at DATETIME,
			phone TEXT,
			organization TEXT,
			position TEXT,
			chat_limit INTEGER DEFAULT 0,
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE s_question_agent_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			dialogue_id TEXT,
			f_id INTEGER DEFAULT 0,
			user_name TEXT,
			delete_at DATETIME
		)`,
	}
	for _, stmt := range ddl {
		if err := gdb.Exec(stmt).Error; err != nil {
			t.Fatalf("create table: %v", err)
		}
	}
	db.Set("nky_client_go", gdb)
	return gdb
}

// newProfileRequestContext 构造一个带 query string 的 GET *gin.Context,
// 写到 httptest.ResponseRecorder;username 由调用方决定是否 Set(模拟
// AuthMiddleware 注入的 JWT 身份)。镜像 common/i18n/i18n_test.go 的
// gin.CreateTestContext 用法。
func newProfileRequestContext(t *testing.T, rawQuery string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/v1/user/profile?"+rawQuery, nil)
	return c, w
}

// TestApiGetUserProfile_IgnoresQueryEmailUsesJWT pins the AF-001 fix:
// Alice 的身份 + ?email=bob,后端必须无视 query,返回 Alice 自己的资料。
// 未 fix 时:handler 读 ctx.Query("email")=="bob@x.com" → 返回 Bob 的资料(IDOR)。
func TestApiGetUserProfile_IgnoresQueryEmailUsesJWT(t *testing.T) {
	gdb := setupProfileTestDB(t)
	if err := gdb.Exec(`INSERT INTO s_user (id, email, code) VALUES
		(1, 'alice@x.com', 'user'),
		(2, 'bob@x.com',   'user')`).Error; err != nil {
		t.Fatalf("seed users: %v", err)
	}

	ph := NewApiHandler()
	c, w := newProfileRequestContext(t, "email=bob@x.com")
	c.Set("username", "alice@x.com") // AuthMiddleware 注入的身份

	ph.ApiGetUserProfile(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body=%s)", w.Code, w.Body.String())
	}
	var parsed struct {
		Data struct {
			Email string `json:"email"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("decode body %s: %v", w.Body.String(), err)
	}
	if parsed.Data.Email != "alice@x.com" {
		t.Errorf("IDOR: expected caller's own email alice@x.com, got %q", parsed.Data.Email)
	}
}

// TestApiGetUserProfile_MissingUsernameReturns401 钉死缺身份分支:
// 没有 AuthMiddleware 注入的 username 时,handler 必须 401,不得回落到
// ?email= 或返回任何资料。未 fix 时:handler 读 ctx.Query("email") → 200。
func TestApiGetUserProfile_MissingUsernameReturns401(t *testing.T) {
	gdb := setupProfileTestDB(t)
	if err := gdb.Exec(`INSERT INTO s_user (id, email, code) VALUES
		(2, 'bob@x.com', 'user')`).Error; err != nil {
		t.Fatalf("seed users: %v", err)
	}

	ph := NewApiHandler()
	c, w := newProfileRequestContext(t, "email=bob@x.com")
	// 故意不 Set username

	ph.ApiGetUserProfile(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 when username missing, got %d (body=%s)", w.Code, w.Body.String())
	}
}
