package router

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/spf13/viper"
	"gorm.io/gorm"

	rxCache "phytomni-server/cache"
	"phytomni-server/common"
	"phytomni-server/db"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/middleware"
	"phytomni-server/model"
	"phytomni-server/service/api_service"
	"phytomni-server/utils"
)

const registrationPolicyPassword = "StrongPass1!"
const registrationPolicyNewPassword = "ChangedPass2!"

func buildRegistrationPolicyAPIEnv(t *testing.T) (*gin.Engine, *gorm.DB) {
	t.Helper()
	// Keep the original Viper maps untouched, including defaults and overrides.
	// Register this before the base fixture's cleanup so restoration runs last.
	previousViper := *viper.GetViper()
	previousBot := rxBot.BotConfig
	previousMode := gin.Mode()
	previousDB, _ := db.Get("phytomni-server")
	*viper.GetViper() = *viper.New()
	t.Cleanup(func() {
		*viper.GetViper() = previousViper
		rxBot.BotConfig = previousBot
		gin.SetMode(previousMode)
		db.Set("phytomni-server", previousDB)
		if err := rxCache.InitFromViper(); err != nil {
			t.Errorf("restore cache configuration: %v", err)
		}
	})
	viper.Set(utils.RegistrationEnabledKey, true)
	viper.Set(utils.RegistrationDefaultRoleKey, "guest")
	viper.Set("guest_default_chat_limit", 7)
	viper.Set("register.durable_floor.limit", 1000)
	viper.Set("register.durable_floor.window", time.Hour)
	rxBot.BotConfig = &rxBot.Config{}
	engine, gdb := buildUserProvisioningApiEnv(t)
	sqlDB, err := gdb.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := sqlDB.Close(); err != nil {
			t.Errorf("close fixture database: %v", err)
		}
	})
	for _, statement := range []string{
		`CREATE UNIQUE INDEX registration_policy_email ON users(email)`,
		`CREATE TABLE tool_names (id INTEGER PRIMARY KEY, tool_name TEXT NOT NULL)`,
		`CREATE TABLE user_tool_names (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, tool_id TEXT NOT NULL)`,
	} {
		if err := gdb.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	// Synthetic grants, deliberately inserted out of display order. These are
	// not deployed role mappings and do not reuse the production grant builder.
	for i, tool := range []string{
		"DigitalDesignAgent", "DeepGenomeAgent", "BriefGeneAgent", "GeneNetworkAgent",
		"InSilicoResearchAgent", "ReviewAgent", "AnalystAgent", "DataAgent", "KnowledgeAgent", "ChatAgent",
	} {
		if err := gdb.Exec(`INSERT INTO tool_names VALUES (?, ?)`, i+1, tool).Error; err != nil {
			t.Fatal(err)
		}
		roles := []string{"vip_user"}
		if tool == "ChatAgent" {
			roles = append(roles, "guest", "user")
		} else if tool == "KnowledgeAgent" {
			roles = append(roles, "user")
		}
		for _, role := range roles {
			if err := gdb.Exec(`INSERT INTO user_tool_names (code, tool_id) VALUES (?, ?)`, role, i+1).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	return engine, gdb
}

type registrationPolicyResponse struct {
	Code   int             `json:"code"`
	Data   json.RawMessage `json:"data"`
	Detail json.RawMessage `json:"detail"`
}

func registrationPolicyRequest(t *testing.T, engine *gin.Engine, method, path, token string, form url.Values, status, code int) registrationPolicyResponse {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Accept-Language", "en-US")
	request.RemoteAddr = "192.0.2.10:12345"
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	gdb := model.Default()
	var before int64
	if err := gdb.Model(&model.UserOperationLog{}).Count(&before).Error; err != nil {
		t.Fatal(err)
	}
	marker := fmt.Sprintf("%s/request-%d", t.Name(), before)
	request.Header.Set("User-Agent", marker)
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)
	// The first-login rejection occurs before OperationLog. All other requests
	// here reach it; drain its async insert before swapping global DB registries.
	firstLoginDenied := path == "/api/v1/users/me/tool-permissions" && response.Code == http.StatusForbidden
	if strings.HasPrefix(path, "/api/v1/auth/") || (response.Code != http.StatusUnauthorized && !firstLoginDenied) {
		deadline := time.Now().Add(2 * time.Second)
		for {
			var after int64
			if err := gdb.Model(&model.UserOperationLog{}).Where("user_agent = ?", marker).Count(&after).Error; err != nil {
				t.Fatal(err)
			}
			if after == 1 {
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("%s %s: audit write did not finish", method, path)
			}
			time.Sleep(time.Millisecond)
		}
	}
	var envelope registrationPolicyResponse
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("%s %s: decode response: %v", method, path, err)
	}
	if response.Code != status || envelope.Code != code {
		// Diagnose clock/floor failures without logging a bearer token or hash.
		if response.Code == http.StatusUnauthorized && token != "" {
			claims := &middleware.Claims{}
			if _, _, err := jwt.NewParser().ParseUnverified(token, claims); err == nil {
				var user model.User
				if err := gdb.Select("password_change_at").Where("email = ?", claims.Username).First(&user).Error; err == nil {
					t.Logf("auth timing: issued_at=%d password_change_at=%v now=%v", claims.IssuedAtUnix(), user.PasswordChangeAt, time.Now())
				}
			}
		}
		t.Fatalf("%s %s: HTTP/code = %d/%d, want %d/%d (detail=%s)", method, path, response.Code, envelope.Code, status, code, envelope.Detail)
	}
	return envelope
}

func registrationPolicyRegister(t *testing.T, engine *gin.Engine, email string) {
	t.Helper()
	registrationPolicyRequest(t, engine, http.MethodPost, "/api/v1/auth/registrations", "",
		url.Values{"email": {email}, "password": {registrationPolicyPassword}}, 200, 200)
}

func registrationPolicyLogin(t *testing.T, engine *gin.Engine, email, password, status string) string {
	t.Helper()
	response := registrationPolicyRequest(t, engine, http.MethodPost, "/api/v1/auth/sessions", "",
		url.Values{"email": {email}, "password": {password}}, 200, 200)
	var data struct {
		Token       string `json:"token"`
		UserName    string `json:"user_name"`
		LoginStatus string `json:"login_status"`
	}
	if err := json.Unmarshal(response.Data, &data); err != nil {
		t.Fatal(err)
	}
	if data.Token == "" || data.UserName != email || data.LoginStatus != status {
		t.Fatalf("login: token present=%v, user=%q, status=%q; want %q/%q", data.Token != "", data.UserName, data.LoginStatus, email, status)
	}
	return data.Token
}

func registrationPolicyCompleteFirstLogin(t *testing.T, engine *gin.Engine, email string) string {
	t.Helper()
	token := registrationPolicyLogin(t, engine, email, registrationPolicyPassword, "0")
	registrationPolicyRequest(t, engine, http.MethodGet, "/api/v1/users/me/tool-permissions", token, nil, 403, 403)
	registrationPolicyRequest(t, engine, http.MethodPut, "/api/v1/users/me/password", token,
		url.Values{"password": {registrationPolicyPassword}, "new_password": {registrationPolicyNewPassword}}, 200, 200)
	return registrationPolicyLogin(t, engine, email, registrationPolicyNewPassword, "1")
}

func registrationPolicyUser(t *testing.T, gdb *gorm.DB, email, role, description string, quota int) model.User {
	t.Helper()
	var user model.User
	if err := gdb.Where("email = ?", email).First(&user).Error; err != nil {
		t.Fatal(err)
	}
	if user.Code != role || user.Description != description || user.ChatLimit != quota {
		t.Fatalf("%s: role/description/quota = %q/%q/%d, want %q/%q/%d", email, user.Code, user.Description, user.ChatLimit, role, description, quota)
	}
	return user
}

func registrationPolicyNoUser(t *testing.T, gdb *gorm.DB, email string) {
	t.Helper()
	var count int64
	if err := gdb.Model(&model.User{}).Where("email = ?", email).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("denied account %s has %d rows, want 0", email, count)
	}
}

func TestPublicRegistration_RoleLoginAndPermissions(t *testing.T) {
	for _, tc := range []struct {
		role, description string
		quota             int
		tools             []string
	}{
		{"guest", "Guest", 7, []string{"ChatAgent"}},
		{"user", "Regular User", 0, []string{"ChatAgent", "KnowledgeAgent"}},
		{"vip_user", "VIP User", 0, []string{"ChatAgent", "KnowledgeAgent", "DataAgent", "AnalystAgent", "ReviewAgent", "InSilicoResearchAgent", "GeneNetworkAgent", "BriefGeneAgent", "DeepGenomeAgent", "DigitalDesignAgent"}},
	} {
		t.Run(tc.role, func(t *testing.T) {
			engine, gdb := buildRegistrationPolicyAPIEnv(t)
			viper.Set(utils.RegistrationDefaultRoleKey, tc.role)
			const email = "role@example.test"
			registrationPolicyRegister(t, engine, email)
			created := registrationPolicyUser(t, gdb, email, tc.role, tc.description, tc.quota)
			if created.FirstLoginStatus != "0" {
				t.Fatalf("new account first_login_status = %q, want 0", created.FirstLoginStatus)
			}
			token := registrationPolicyCompleteFirstLogin(t, engine, email)
			updated := registrationPolicyUser(t, gdb, email, tc.role, tc.description, tc.quota)
			if updated.FirstLoginStatus != "1" || updated.Password == created.Password {
				t.Fatal("password change must update the stored password and first-login status")
			}
			// Current product admission no longer filters canonical grants by
			// proxy enablement; both settings must retain the literal tool order.
			for _, enabled := range []bool{false, true} {
				rxBot.BotConfig = &rxBot.Config{ProxyEnabled: enabled}
				response := registrationPolicyRequest(t, engine, http.MethodGet, "/api/v1/users/me/tool-permissions", token, nil, 200, 200)
				var permissions common.LoginResponse
				if err := json.Unmarshal(response.Data, &permissions); err != nil {
					t.Fatal(err)
				}
				if permissions.Permission != tc.role || !reflect.DeepEqual(permissions.ToolList, tc.tools) || len(permissions.PermissionList) != 0 {
					t.Fatalf("proxy=%v: permissions=%+v, want role=%s tools=%v and no extra permissions", enabled, permissions, tc.role, tc.tools)
				}
			}
		})
	}
}

func TestPublicRegistration_ClientRoleCannotEscalate(t *testing.T) {
	engine, gdb := buildRegistrationPolicyAPIEnv(t)
	const email = "forged@example.test"
	registrationPolicyRequest(t, engine, http.MethodPost, "/api/v1/auth/registrations", "", url.Values{
		"email": {email}, "password": {registrationPolicyPassword},
		"code": {"admin"}, "role": {"super_admin"}, "description": {"Administrator"},
		"permission": {"admin"}, "permission_list": {"admin"}, "tool_list": {"DigitalDesignAgent"},
		"chat_limit": {"999999"}, "guest_default_chat_limit": {"999999"}, "first_login_status": {"1"},
	}, 200, 200)
	registrationPolicyUser(t, gdb, email, "guest", "Guest", 7)
	token := registrationPolicyCompleteFirstLogin(t, engine, email)
	response := registrationPolicyRequest(t, engine, http.MethodGet, "/api/v1/users/me/tool-permissions", token, nil, 200, 200)
	var permissions common.LoginResponse
	if err := json.Unmarshal(response.Data, &permissions); err != nil {
		t.Fatal(err)
	}
	if permissions.Permission != "guest" || !reflect.DeepEqual(permissions.ToolList, []string{"ChatAgent"}) || len(permissions.PermissionList) != 0 {
		t.Fatalf("forged fields changed guest permissions: %+v", permissions)
	}
	registrationPolicyRequest(t, engine, http.MethodPost, "/api/v1/users", token,
		url.Values{"email": {"escalated@example.test"}, "password": {registrationPolicyPassword}, "code": {"user"}}, 409, 500)
	registrationPolicyNoUser(t, gdb, "escalated@example.test")
	registrationPolicyRequest(t, engine, http.MethodGet, "/api/v1/operation-logs", token, nil, 403, 403)
	registrationPolicyUser(t, gdb, email, "guest", "Guest", 7)
}

func TestPublicRegistration_PolicyChangesOnlyNewAccounts(t *testing.T) {
	engine, gdb := buildRegistrationPolicyAPIEnv(t)
	registrationPolicyRegister(t, engine, "a@example.test")
	viper.Set(utils.RegistrationDefaultRoleKey, "vip_user")
	viper.Set("guest_default_chat_limit", 99)
	registrationPolicyRegister(t, engine, "b@example.test")
	for _, tc := range []struct {
		name    string
		enabled bool
		role    string
		status  int
	}{
		{"closed", false, "vip_user", 403},
		{"invalid", true, "admin", 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			viper.Set(utils.RegistrationEnabledKey, tc.enabled)
			viper.Set(utils.RegistrationDefaultRoleKey, tc.role)
			email := tc.name + "@example.test"
			registrationPolicyRequest(t, engine, http.MethodPost, "/api/v1/auth/registrations", "",
				url.Values{"email": {email}, "password": {registrationPolicyPassword}}, tc.status, tc.status)
			registrationPolicyNoUser(t, gdb, email)
			registrationPolicyLogin(t, engine, "a@example.test", registrationPolicyPassword, "0")
			registrationPolicyLogin(t, engine, "b@example.test", registrationPolicyPassword, "0")
			registrationPolicyUser(t, gdb, "a@example.test", "guest", "Guest", 7)
			registrationPolicyUser(t, gdb, "b@example.test", "vip_user", "VIP User", 0)
		})
	}
}

func TestPublicRegistration_AdminProvisioningIgnoresPolicy(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		name := "OFF"
		if enabled {
			name = "ON_invalid_role"
		}
		t.Run(name, func(t *testing.T) {
			engine, gdb := buildRegistrationPolicyAPIEnv(t)
			viper.Set(utils.RegistrationEnabledKey, enabled)
			viper.Set(utils.RegistrationDefaultRoleKey, "super_admin")
			for _, role := range []string{"admin", "user"} {
				email := role + "@example.test"
				if err := gdb.Exec(`INSERT INTO users (email, code, first_login_status) VALUES (?, ?, '1')`, email, role).Error; err != nil {
					t.Fatal(err)
				}
				token, err := middleware.GenerateToken(email)
				if err != nil {
					t.Fatal(err)
				}
				target := role + "-created@example.test"
				status, code := 200, 200
				if role == "user" {
					status, code = 409, 500
				}
				registrationPolicyRequest(t, engine, http.MethodPost, "/api/v1/users", token,
					url.Values{"email": {target}, "password": {registrationPolicyPassword}, "code": {"user"}}, status, code)
				if role == "user" {
					registrationPolicyNoUser(t, gdb, target)
					continue
				}
				created := registrationPolicyUser(t, gdb, target, "user", "Regular User", 0)
				if created.FirstLoginStatus != "0" || created.Password == "" || created.Password == registrationPolicyPassword {
					t.Fatal("admin-created account must retain first-login gate and hashed password")
				}
			}
		})
	}
}

func TestPublicRegistration_CapabilitiesExposeOnlySwitch(t *testing.T) {
	for _, tc := range []struct {
		name    string
		enabled bool
		role    string
	}{
		{"ON", true, "guest"}, {"OFF", false, "guest"}, {"ON_invalid_role", true, "admin"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			engine, _ := buildRegistrationPolicyAPIEnv(t)
			viper.Set(utils.RegistrationEnabledKey, tc.enabled)
			viper.Set(utils.RegistrationDefaultRoleKey, tc.role)
			response := registrationPolicyRequest(t, engine, http.MethodGet, "/api/v1/auth/capabilities", "", nil, 200, 200)
			var data map[string]interface{}
			if err := json.Unmarshal(response.Data, &data); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(data, map[string]interface{}{"registration_enabled": tc.enabled}) {
				t.Fatalf("capabilities = %v, want only registration_enabled=%v", data, tc.enabled)
			}
		})
	}
}

func TestPublicRegistration_QuotaSemantics(t *testing.T) {
	for _, tc := range []struct {
		name, role, description string
		quota                   int
		enforce, denied         bool
	}{
		{"positive_guest", "guest", "Guest", 7, true, false},
		{"zero_guest", "guest", "Guest", 0, true, true},
		{"vip_bypass", "vip_user", "VIP User", 0, true, false},
		{"enforcement_off", "guest", "Guest", 0, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			engine, gdb := buildRegistrationPolicyAPIEnv(t)
			viper.Set(utils.RegistrationDefaultRoleKey, tc.role)
			viper.Set("guest_default_chat_limit", tc.quota)
			viper.Set("chatlimit.enforce", tc.enforce)
			const email = "quota@example.test"
			registrationPolicyRegister(t, engine, email)
			registrationPolicyUser(t, gdb, email, tc.role, tc.description, tc.quota)
			err := api_service.NewService().CheckChatAllowed(context.Background(), email)
			if tc.denied {
				if !errors.Is(err, api_service.ErrChatQuotaExhausted) {
					t.Fatalf("quota gate error = %v, want ErrChatQuotaExhausted", err)
				}
			} else if err != nil {
				t.Fatalf("quota gate must allow account: %v", err)
			}
		})
	}
}
