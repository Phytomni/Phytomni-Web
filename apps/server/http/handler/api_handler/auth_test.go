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

// setupProfileTestDB opens an in-memory SQLite DB, creates the minimal column set
// for the two tables GetUserProfile reads (users / question_agent_logs), and
// registers the DB in the global registry.
//
// Hand-writing CREATE TABLE instead of AutoMigrate: User carries MySQL-only
// type:enum GORM tags that SQLite AutoMigrate rejects; only the columns the
// profile path reads are listed here, all others scan as zero values.
func setupProfileTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	ddl := []string{
		`CREATE TABLE users (
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
		`CREATE TABLE question_agent_logs (
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
	db.Set("phytomni-server", gdb)
	return gdb
}

// newProfileRequestContext builds a GET *gin.Context with a query string,
// writing to an httptest.ResponseRecorder. Whether to Set "username" (to
// simulate the JWT identity injected by AuthMiddleware) is the caller's choice.
func newProfileRequestContext(t *testing.T, rawQuery string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/users/me?"+rawQuery, nil)
	return c, w
}

// TestApiGetUserProfile_IgnoresQueryEmailUsesJWT pins the AF-001 fix:
// Alice's JWT identity + ?email=bob — the backend must ignore the query param
// and return Alice's own profile. Without the fix, handler reads
// ctx.Query("email")=="bob@x.com" and returns Bob's data (IDOR).
func TestApiGetUserProfile_IgnoresQueryEmailUsesJWT(t *testing.T) {
	gdb := setupProfileTestDB(t)
	if err := gdb.Exec(`INSERT INTO users (id, email, code) VALUES
		(1, 'alice@x.com', 'user'),
		(2, 'bob@x.com',   'user')`).Error; err != nil {
		t.Fatalf("seed users: %v", err)
	}

	ph := NewHandler()
	c, w := newProfileRequestContext(t, "email=bob@x.com")
	c.Set("username", "alice@x.com") // JWT identity injected by AuthMiddleware

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

// TestApiGetUserProfile_MissingUsernameReturns401 pins the missing-identity path:
// when no AuthMiddleware-injected username is present, handler must 401 and
// must not fall back to ?email= or return any profile data. Without the fix,
// handler reads ctx.Query("email") and returns 200.
func TestApiGetUserProfile_MissingUsernameReturns401(t *testing.T) {
	gdb := setupProfileTestDB(t)
	if err := gdb.Exec(`INSERT INTO users (id, email, code) VALUES
		(2, 'bob@x.com', 'user')`).Error; err != nil {
		t.Fatalf("seed users: %v", err)
	}

	ph := NewHandler()
	c, w := newProfileRequestContext(t, "email=bob@x.com")
	// deliberately no "username" Set (simulates missing AuthMiddleware injection)

	ph.GetUserProfile(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 when username missing, got %d (body=%s)", w.Code, w.Body.String())
	}
}

// newRegisterPostContext builds a POST *gin.Context with an
// x-www-form-urlencoded body and wires in the Localize middleware so i18n.T
// can resolve keys.
func newRegisterPostContext(t *testing.T, form url.Values) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/registrations", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	c.Request = req
	i18n.Localize()(c)
	return c, w
}

// TestApiUserRegister_EmptyCredentialsUsesMessageEnvelope pins the error-envelope key:
// the empty-credentials branch must place the localized text in "message"
// (the frontend interceptor reads only res.data.message), not the legacy "error"
// key — otherwise the localized string is swallowed by the generic fallback.
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

// setupLoginTestDB creates the full users column set Login -> GetUserInfo
// reads (mirrors service/api_service/user_test.go's DDL).
func setupLoginTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	ddl := `CREATE TABLE users (
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
	db.Set("phytomni-server", gdb)
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
	if err := gdb.Exec(`INSERT INTO users (id, email, password, code, first_login_status) VALUES (1, 'a@x.com', ?, 'user', '1')`, hash).Error; err != nil {
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
