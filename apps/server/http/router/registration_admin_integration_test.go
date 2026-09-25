package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/spf13/viper"
	"gorm.io/gorm"

	rxCache "phytomni-server/cache"
	"phytomni-server/db"
	"phytomni-server/middleware"
	"phytomni-server/model"
	"phytomni-server/utils"
)

// buildUserProvisioningApiEnv wires the real Api router with the complete
// users schema that administrator provisioning reads and writes.
func buildUserProvisioningApiEnv(t *testing.T) (*gin.Engine, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	viper.Set("jwt.secret_key", "integration-test-secret")
	t.Cleanup(func() { viper.Set("jwt.secret_key", "") })

	// Api wires rate-limit middleware. An unconfigured cache is intentionally
	// fail-open, matching the existing real-router test fixture path.
	viper.Set("redis.default", "")
	viper.Set("redis.clients", nil)
	t.Cleanup(func() {
		viper.Set("redis.clients", nil)
		viper.Set("redis.default", "")
	})
	_ = rxCache.InitFromViper()

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
		password TEXT,
		code TEXT,
		description TEXT,
		first_login_status TEXT DEFAULT '0',
		created_at DATETIME,
		updated_at DATETIME,
		delete_at DATETIME,
		password_change_at DATETIME,
		login_failed_count INTEGER DEFAULT 0,
		locked_until DATETIME,
		last_login_at DATETIME,
		phone TEXT,
		organization TEXT,
		position TEXT,
		chat_limit INTEGER DEFAULT 0
	)`).Error; err != nil {
		t.Fatalf("create users: %v", err)
	}

	if err := gdb.Exec(`CREATE TABLE user_operation_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER,
		user_email TEXT,
		method TEXT,
		path TEXT,
		query_params TEXT,
		body_params TEXT,
		client_ip TEXT,
		user_agent TEXT,
		status_code INTEGER,
		latency INTEGER,
		error_message TEXT,
		created_at DATETIME
	)`).Error; err != nil {
		t.Fatalf("create user_operation_logs: %v", err)
	}

	db.Set("phytomni-server", gdb)
	engine := gin.New()
	Api(engine.Group("/"))
	return engine, gdb
}

func TestAdminTokenCanCreateUserWhenPublicRegistrationIsClosed(t *testing.T) {
	engine, gdb := buildUserProvisioningApiEnv(t)
	viper.Set(utils.RegistrationEnabledKey, false)
	t.Cleanup(func() { viper.Set(utils.RegistrationEnabledKey, nil) })
	if err := gdb.Exec("INSERT INTO users (id, email, code, first_login_status) VALUES (1, 'admin@example.test', 'admin', '1')").Error; err != nil {
		t.Fatal(err)
	}

	token, err := middleware.GenerateToken("admin@example.test")
	if err != nil {
		t.Fatal(err)
	}
	form := strings.NewReader("email=created%40example.test&password=StrongPass1%21&code=user")
	request := httptest.NewRequest(http.MethodPost, "/api/v1/users", form)
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("admin create status = %d, want 200 (body=%s)", response.Code, response.Body.String())
	}

	var created model.User
	if err := gdb.Where("email = ?", "created@example.test").First(&created).Error; err != nil {
		t.Fatalf("created user missing: %v", err)
	}
	if created.Password == "" || created.Password == "StrongPass1!" {
		t.Fatal("admin-created password must be stored as a hash")
	}
}

func TestRegularUserCannotCreateUserWhenPublicRegistrationIsClosed(t *testing.T) {
	engine, gdb := buildUserProvisioningApiEnv(t)
	viper.Set(utils.RegistrationEnabledKey, false)
	t.Cleanup(func() { viper.Set(utils.RegistrationEnabledKey, nil) })
	if err := gdb.Exec("INSERT INTO users (id, email, code, first_login_status) VALUES (1, 'user@example.test', 'user', '1')").Error; err != nil {
		t.Fatal(err)
	}

	token, err := middleware.GenerateToken("user@example.test")
	if err != nil {
		t.Fatal(err)
	}
	form := strings.NewReader("email=created%40example.test&password=StrongPass1%21&code=user")
	request := httptest.NewRequest(http.MethodPost, "/api/v1/users", form)
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)

	if response.Code != http.StatusConflict {
		t.Fatalf("regular create status = %d, want 409 (body=%s)", response.Code, response.Body.String())
	}
	var body struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode regular-user denial: %v", err)
	}
	if body.Code != http.StatusInternalServerError || body.Message != "you are not an administrator and cannot create users" {
		t.Fatalf("regular-user denial = %#v, want code=500 localized admin-permission message", body)
	}

	var count int64
	if err := gdb.Model(&model.User{}).Where("email = ?", "created@example.test").Count(&count).Error; err != nil {
		t.Fatalf("count target user: %v", err)
	}
	if count != 0 {
		t.Fatalf("regular user created %d target rows, want 0", count)
	}
}
