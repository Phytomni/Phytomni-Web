package api_handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/spf13/viper"
	"gorm.io/gorm"

	"phytomni-server/common/i18n"
	"phytomni-server/db"
	"phytomni-server/utils"
)

// setupProfileTestDB 建一个 in-memory SQLite,创建 GetUserProfile 实际查的两张表
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

	ph := NewHandler()
	c, w := newProfileRequestContext(t, "email=bob@x.com")
	c.Set("username", "alice@x.com") // AuthMiddleware 注入的身份

	ph.GetUserProfile(c)

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

	ph := NewHandler()
	c, w := newProfileRequestContext(t, "email=bob@x.com")
	// 故意不 Set username

	ph.GetUserProfile(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 when username missing, got %d (body=%s)", w.Code, w.Body.String())
	}
}

// newRegisterPostContext 构造一个带 x-www-form-urlencoded body 的 POST
// *gin.Context,并绑定 Localize 中间件,使 i18n.T 能解析键。
func newRegisterPostContext(t *testing.T, form url.Values) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodPost, "/v1/user/register", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	c.Request = req
	i18n.Localize()(c)
	return c, w
}

// TestApiUserRegister_EmptyCredentialsUsesMessageEnvelope 钉死错误信封键:
// 空凭证分支必须把本地化文案放在 "message"(前端拦截器只读 res.data.message),
// 不得用旧的 "error" 键 —— 否则本地化文案在前端被通用回落吞掉。
func TestApiUserRegister_EmptyCredentialsUsesMessageEnvelope(t *testing.T) {
	ph := NewHandler()
	c, w := newRegisterPostContext(t, url.Values{})

	ph.UserRegister(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 on empty credentials, got %d (body=%s)", w.Code, w.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body %s: %v", w.Body.String(), err)
	}
	if _, hasError := body["error"]; hasError {
		t.Errorf("response uses legacy \"error\" key; frontend reads \"message\" (body=%s)", w.Body.String())
	}
	if msg, ok := body["message"].(string); !ok || msg == "" {
		t.Errorf("expected non-empty \"message\", got %v (body=%s)", body["message"], w.Body.String())
	}
}

// setupLoginTestDB creates the full s_user column set Login -> GetUserInfo
// reads (mirrors service/api_service/user_test.go's DDL).
func setupLoginTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	ddl := `CREATE TABLE s_user (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT, password TEXT, code TEXT, description TEXT,
		first_login_status TEXT DEFAULT '0',
		created_at DATETIME, updated_at DATETIME, delete_at DATETIME,
		password_change_at DATETIME, login_failed_count INTEGER DEFAULT 0,
		locked_until DATETIME, last_login_at DATETIME,
		phone TEXT, organization TEXT, position TEXT, chat_limit INTEGER DEFAULT 0
	)`
	if err := gdb.Exec(ddl).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	db.Set("nky_client_go", gdb)
	return gdb
}

// TestApiLogin_ResponseOmitsPasswordHash pins that the login success body never
// carries the stored hash (the response struct has no password field).
func TestApiLogin_ResponseOmitsPasswordHash(t *testing.T) {
	prev := viper.GetString("jwt.secret_key")
	viper.Set("jwt.secret_key", "unit-test-secret")
	t.Cleanup(func() { viper.Set("jwt.secret_key", prev) })

	gdb := setupLoginTestDB(t)
	hash, _ := utils.HashPassword("goodpass")
	if err := gdb.Exec(`INSERT INTO s_user (id, email, password, code, first_login_status) VALUES (1, 'a@x.com', ?, 'user', '1')`, hash).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	ph := NewHandler()
	c, w := newRegisterPostContext(t, url.Values{"email": {"a@x.com"}, "password": {"goodpass"}})
	ph.Login(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body=%s)", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "\"password\"") {
		t.Errorf("login response leaked a password field: %s", w.Body.String())
	}
}
