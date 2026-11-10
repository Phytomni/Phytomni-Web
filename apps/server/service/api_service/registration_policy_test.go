package api_service

import (
	"context"
	"errors"
	"testing"

	"phytomni-server/model"
	"phytomni-server/utils"

	"github.com/spf13/viper"
)

func resetPublicRegistrationConfig(t *testing.T) {
	t.Helper()
	previous := *viper.GetViper()
	viper.Reset()
	t.Cleanup(func() { *viper.GetViper() = previous })
}

func TestUserRegister_ConfiguredRole(t *testing.T) {
	for _, tc := range []struct {
		name, role, wantRole, wantDescription string
		wantQuota                             int
	}{
		{"missing", "", "guest", "Guest", 7},
		{"guest", "guest", "guest", "Guest", 7},
		{"user", "user", "user", "Regular User", 0},
		{"vip_user", "vip_user", "vip_user", "VIP User", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resetPublicRegistrationConfig(t)
			if tc.role != "" {
				viper.Set(utils.RegistrationDefaultRoleKey, tc.role)
			}
			viper.Set("guest_default_chat_limit", 7)
			gdb := setupUserTestDB(t)
			const password = "Synthetic12!"
			if err := NewService().UserRegister(context.Background(), "new@example.com", password); err != nil {
				t.Fatalf("register: %v", err)
			}
			var user model.User
			if err := gdb.Where("email = ?", "new@example.com").First(&user).Error; err != nil {
				t.Fatal(err)
			}
			if user.Code != tc.wantRole || user.Description != tc.wantDescription || user.ChatLimit != tc.wantQuota {
				t.Errorf("stored policy = %q/%q/%d, want %q/%q/%d", user.Code, user.Description, user.ChatLimit, tc.wantRole, tc.wantDescription, tc.wantQuota)
			}
			if ok, upgrade, err := utils.VerifyPassword(user.Password, password); !ok || upgrade || err != nil {
				t.Errorf("stored password must verify as bcrypt: ok=%v upgrade=%v err=%v", ok, upgrade, err)
			}
			if user.PasswordChangeAt == nil || user.FirstLoginStatus != "0" {
				t.Error("registration must preserve password timestamp and first-login requirement")
			}
		})
	}
}

func TestUserRegister_GuestZeroQuota(t *testing.T) {
	resetPublicRegistrationConfig(t)
	viper.Set(utils.RegistrationDefaultRoleKey, "guest")
	viper.Set("guest_default_chat_limit", 0)
	gdb := setupUserTestDB(t)
	if err := NewService().UserRegister(context.Background(), "zero@example.com", "Synthetic12!"); err != nil {
		t.Fatal(err)
	}
	var user model.User
	if err := gdb.Where("email = ?", "zero@example.com").First(&user).Error; err != nil {
		t.Fatal(err)
	}
	if user.Code != "guest" || user.ChatLimit != 0 {
		t.Fatalf("zero-quota guest stored as role=%q quota=%d", user.Code, user.ChatLimit)
	}
	if ok, upgrade, err := utils.VerifyPassword(user.Password, "Synthetic12!"); !ok || upgrade || err != nil {
		t.Errorf("stored password must verify as bcrypt: ok=%v upgrade=%v err=%v", ok, upgrade, err)
	}
	if user.PasswordChangeAt == nil || user.FirstLoginStatus != "0" {
		t.Error("registration must preserve password timestamp and first-login requirement")
	}
}

func TestUserRegister_InvalidRoleDoesNotCreateUser(t *testing.T) {
	for _, tc := range []struct {
		name string
		cost int
	}{{"valid_hash_cost", 10}, {"invalid_hash_cost", 99}} {
		t.Run(tc.name, func(t *testing.T) {
			resetPublicRegistrationConfig(t)
			viper.Set(utils.RegistrationDefaultRoleKey, "admin")
			viper.Set("bcrypt_cost", tc.cost)
			gdb := setupUserTestDB(t)
			if err := gdb.Exec("INSERT INTO users (email, code) VALUES (?, ?)", "existing@example.com", "user").Error; err != nil {
				t.Fatal(err)
			}
			err := NewService().UserRegister(context.Background(), "rejected@example.com", "Synthetic12!")
			if !errors.Is(err, utils.ErrInvalidRegistrationRole) {
				t.Errorf("invalid role must precede hashing: got %v", err)
			}
			var count int64
			if err := gdb.Model(&model.User{}).Count(&count).Error; err != nil {
				t.Fatal(err)
			}
			if count != 1 {
				t.Errorf("invalid policy changed user count: got %d, want 1", count)
			}
		})
	}
}
