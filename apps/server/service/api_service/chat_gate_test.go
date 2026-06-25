package api_service

import (
	"context"
	"errors"
	"testing"

	"phytomni-server/db"

	"github.com/glebarez/sqlite"
	"github.com/spf13/viper"
	"gorm.io/gorm"
)

// setupChatGateDB 建一个含 users 的 in-memory SQLite,用于验证 CheckChatAllowed 边界。
// 只建 users 表中 CheckChatAllowed 路径实际读写的列(email/code/chat_limit)。
func setupChatGateDB(t *testing.T) *gorm.DB {
	t.Helper()
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
		code TEXT,
		chat_limit INTEGER DEFAULT 0
	)`).Error; err != nil {
		t.Fatalf("ddl users: %v", err)
	}
	db.Set("phytomni-server", gdb)
	return gdb
}

// seed 在测试库中插入一条 user 行并返回其 email。
func seedChatGateUser(t *testing.T, gdb *gorm.DB, email, code string, chatLimit int) {
	t.Helper()
	if err := gdb.Exec(
		`INSERT INTO users (email, code, chat_limit) VALUES (?, ?, ?)`,
		email, code, chatLimit,
	).Error; err != nil {
		t.Fatalf("seed user %s: %v", email, err)
	}
}

// TestCheckChatAllowed_EnforceOff 验证暗发布开关:enforce=false(默认)时,
// 任何用户(含 chat_limit=0)均放行,行为与今日完全一致。
// 变异守卫:如果删除 enforce 短路 → chat_limit=0 用户会被拒 → 该 case 变红。
func TestCheckChatAllowed_EnforceOff(t *testing.T) {
	gdb := setupChatGateDB(t)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", nil) })

	viper.Set("chatlimit.enforce", false)
	seedChatGateUser(t, gdb, "zero@example.com", "user", 0)

	ps := NewService()
	if err := ps.CheckChatAllowed(context.Background(), "zero@example.com"); err != nil {
		t.Errorf("enforce=false: chat_limit=0 user must be allowed, got %v", err)
	}
}

// TestCheckChatAllowed_EnforceOn_UserZero 验证 enforce=ON 时,
// code='user' + chat_limit=0 → ErrChatQuotaExhausted。
func TestCheckChatAllowed_EnforceOn_UserZero(t *testing.T) {
	gdb := setupChatGateDB(t)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", nil) })

	viper.Set("chatlimit.enforce", true)
	seedChatGateUser(t, gdb, "zero@example.com", "user", 0)

	ps := NewService()
	err := ps.CheckChatAllowed(context.Background(), "zero@example.com")
	if !errors.Is(err, ErrChatQuotaExhausted) {
		t.Errorf("enforce=ON user/0: expected ErrChatQuotaExhausted, got %v", err)
	}
}

// TestCheckChatAllowed_EnforceOn_UserNonZero 验证 enforce=ON 时,
// code='user' + chat_limit=5 → 放行(额度充足)。
func TestCheckChatAllowed_EnforceOn_UserNonZero(t *testing.T) {
	gdb := setupChatGateDB(t)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", nil) })

	viper.Set("chatlimit.enforce", true)
	seedChatGateUser(t, gdb, "funded@example.com", "user", 5)

	ps := NewService()
	if err := ps.CheckChatAllowed(context.Background(), "funded@example.com"); err != nil {
		t.Errorf("enforce=ON user/5: expected nil, got %v", err)
	}
}

// TestCheckChatAllowed_EnforceOn_AdminBypass 验证 enforce=ON 时,
// code='admin' + chat_limit=0 → 放行(角色旁路)。
// 变异守卫:如果从 chatGateBypassCodes 删除 admin → 该 case 变红。
func TestCheckChatAllowed_EnforceOn_AdminBypass(t *testing.T) {
	gdb := setupChatGateDB(t)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", nil) })

	viper.Set("chatlimit.enforce", true)
	seedChatGateUser(t, gdb, "admin@example.com", "admin", 0)

	ps := NewService()
	if err := ps.CheckChatAllowed(context.Background(), "admin@example.com"); err != nil {
		t.Errorf("enforce=ON admin/0: expected nil (bypass), got %v", err)
	}
}

// TestCheckChatAllowed_EnforceOn_SuperAdminBypass 验证 enforce=ON 时,
// code='super_admin' + chat_limit=0 → 放行(角色旁路)。
func TestCheckChatAllowed_EnforceOn_SuperAdminBypass(t *testing.T) {
	gdb := setupChatGateDB(t)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", nil) })

	viper.Set("chatlimit.enforce", true)
	seedChatGateUser(t, gdb, "superadmin@example.com", "super_admin", 0)

	ps := NewService()
	if err := ps.CheckChatAllowed(context.Background(), "superadmin@example.com"); err != nil {
		t.Errorf("enforce=ON super_admin/0: expected nil (bypass), got %v", err)
	}
}

// TestCheckChatAllowed_EnforceOn_VipUserBypass 验证 enforce=ON 时,
// code='vip_user' + chat_limit=0 → 放行(暂不限额,角色旁路)。
// 变异守卫:如果从 chatGateBypassCodes 删除 vip_user → 该 case 变红。
func TestCheckChatAllowed_EnforceOn_VipUserBypass(t *testing.T) {
	gdb := setupChatGateDB(t)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", nil) })

	viper.Set("chatlimit.enforce", true)
	seedChatGateUser(t, gdb, "vip@example.com", "vip_user", 0)

	ps := NewService()
	if err := ps.CheckChatAllowed(context.Background(), "vip@example.com"); err != nil {
		t.Errorf("enforce=ON vip_user/0: expected nil (bypass), got %v", err)
	}
}

// TestCheckChatAllowed_EnforceOn_GuestBlocked 验证 enforce=ON 时,
// code='guest' + chat_limit=0 → ErrChatQuotaExhausted(guest 走普通闸,不旁路)。
func TestCheckChatAllowed_EnforceOn_GuestBlocked(t *testing.T) {
	gdb := setupChatGateDB(t)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", nil) })

	viper.Set("chatlimit.enforce", true)
	seedChatGateUser(t, gdb, "guest@example.com", "guest", 0)

	ps := NewService()
	err := ps.CheckChatAllowed(context.Background(), "guest@example.com")
	if !errors.Is(err, ErrChatQuotaExhausted) {
		t.Errorf("enforce=ON guest/0: expected ErrChatQuotaExhausted, got %v", err)
	}
}

// TestCheckChatAllowed_FailOpen 验证 enforce=ON 但 user 不在库中时 fail-open:
// 返回 nil 而不是拒绝——避免 DB 抖动误拒真实用户。
// 变异守卫:如果把 err 分支改为 return ErrChatQuotaExhausted → 该 case 变红。
func TestCheckChatAllowed_FailOpen(t *testing.T) {
	setupChatGateDB(t) // 空库,没有任何行
	t.Cleanup(func() { viper.Set("chatlimit.enforce", nil) })

	viper.Set("chatlimit.enforce", true)

	ps := NewService()
	// 不存在的 email → DB 返回 ErrRecordNotFound → 应 fail-open(nil)
	if err := ps.CheckChatAllowed(context.Background(), "nobody@example.com"); err != nil {
		t.Errorf("fail-open: missing user must allow, got %v", err)
	}
}

// TestCheckChatAllowed_FailOpen_EmptyEmail 与上同理,空 email 也 fail-open。
func TestCheckChatAllowed_FailOpen_EmptyEmail(t *testing.T) {
	setupChatGateDB(t)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", nil) })

	viper.Set("chatlimit.enforce", true)

	ps := NewService()
	if err := ps.CheckChatAllowed(context.Background(), ""); err != nil {
		t.Errorf("fail-open: empty email must allow, got %v", err)
	}
}
