package api_handler

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"phytomni-server/common/i18n"
	"phytomni-server/model"
	"phytomni-server/utils"

	"github.com/spf13/viper"
	"gorm.io/gorm"
)

func setupPublicRegistrationHandlerDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb := setupLoginTestDB(t)
	sqlDB, err := gdb.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := gdb.Exec(`CREATE TABLE user_operation_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		client_ip TEXT, path TEXT, created_at DATETIME
	)`).Error; err != nil {
		t.Fatal(err)
	}
	previous := *viper.GetViper()
	viper.Reset()
	t.Cleanup(func() { *viper.GetViper() = previous })
	return gdb
}

func assertNoRegisteredUsers(t *testing.T, gdb *gorm.DB) {
	t.Helper()
	var count int64
	if err := gdb.Model(&model.User{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Errorf("rejected registration created %d users", count)
	}
}

func TestPublicRegistrationHandler_InvalidRoleReturns503(t *testing.T) {
	for _, tc := range []struct{ lang, want string }{
		{"en-US", "Service temporarily unavailable, please try again later"},
		{"zh-CN", "\u670d\u52a1\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5"},
	} {
		t.Run(tc.lang, func(t *testing.T) {
			gdb := setupPublicRegistrationHandlerDB(t)
			const role = "super_admin"
			const password = "Synthetic12!"
			viper.Set(utils.RegistrationDefaultRoleKey, role)
			c, w := newRegisterPostContext(t, url.Values{
				"email": {"new@example.com"}, "password": {password},
			})
			c.Request.Header.Set("Accept-Language", tc.lang)
			i18n.Localize()(c)
			NewHandler().UserRegister(c)
			if w.Code != http.StatusServiceUnavailable {
				t.Errorf("status = %d, want 503", w.Code)
			}
			var body map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body["code"] != float64(503) || body["message"] != tc.want {
				t.Errorf("expected localized service-unavailable envelope, got %v", body)
			}
			for _, private := range []string{role, password, utils.ErrInvalidRegistrationRole.Error()} {
				if strings.Contains(w.Body.String(), private) {
					t.Error("response leaked registration policy or credentials")
				}
			}
			assertNoRegisteredUsers(t, gdb)
		})
	}
}

func TestPublicRegistrationHandler_OffWinsOverInvalidRole(t *testing.T) {
	for _, role := range []string{"guest", "user", "vip_user", "admin"} {
		t.Run(role, func(t *testing.T) {
			gdb := setupPublicRegistrationHandlerDB(t)
			viper.Set(utils.RegistrationEnabledKey, false)
			viper.Set(utils.RegistrationDefaultRoleKey, role)
			c, w := newRegisterPostContext(t, url.Values{
				"email": {"not-an-email"}, "password": {"weak"},
			})
			NewHandler().UserRegister(c)
			if w.Code != http.StatusForbidden {
				t.Errorf("OFF status = %d, want 403", w.Code)
			}
			var body map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body["code"] != float64(403) || body["message"] != i18n.T(c, "auth.registration_disabled") {
				t.Errorf("OFF envelope = %v", body)
			}
			assertNoRegisteredUsers(t, gdb)
		})
	}
}

func TestPublicRegistrationHandler_ValidPolicyPreservesSuccessEnvelope(t *testing.T) {
	for _, role := range []string{"guest", "user", "vip_user"} {
		t.Run(role, func(t *testing.T) {
			gdb := setupPublicRegistrationHandlerDB(t)
			viper.Set(utils.RegistrationDefaultRoleKey, role)
			c, w := newRegisterPostContext(t, url.Values{
				"email": {"new@example.com"}, "password": {"Synthetic12!"},
			})
			NewHandler().UserRegister(c)
			var body map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if w.Code != http.StatusOK || body["code"] != float64(200) || body["data"] != "new@example.com" {
				t.Fatalf("success envelope changed: status=%d body=%v", w.Code, body)
			}
			if len(body) != 3 || body["message"] != "success" {
				t.Errorf("success envelope fields changed: %v", body)
			}
			var user model.User
			if err := gdb.Where("email = ?", "new@example.com").First(&user).Error; err != nil {
				t.Fatal(err)
			}
			if user.Code != role {
				t.Errorf("stored role = %q, want %q", user.Code, role)
			}
		})
	}
}
