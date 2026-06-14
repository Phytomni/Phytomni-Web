package api_service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/spf13/viper"
	"gorm.io/gorm"

	"nky_client_go/db"
	"nky_client_go/utils"
	"nky_client_go/utils/errs"
)

// setupUserTestDB 建一个空的 in-memory SQLite,手写 s_user 最小列集并注册到全局 db
// registry。手写 CREATE TABLE(而非 AutoMigrate SUser)的理由同 agent_task_test.go:
// SUser 的 first_login_status 带 MySQL 专有 `type:enum` GORM tag,SQLite AutoMigrate
// 不识别;这里只列 GetUserInfo / ApiUnlockUser 实际读写的列。
func setupUserTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	ddl := `CREATE TABLE s_user (
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
	)`
	if err := gdb.Exec(ddl).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	db.Set("nky_client_go", gdb)
	return gdb
}

// TestGetUserInfo_LockoutOnFifthFailure 钉死锁定阈值:第 5 次密码错误应锁定 15 分钟。
// 没守护时,误改阈值/锁定窗口不会被任何测试发现。
func TestGetUserInfo_LockoutOnFifthFailure(t *testing.T) {
	gdb := setupUserTestDB(t)
	if err := gdb.Exec(`INSERT INTO s_user
		(id, email, password, code, login_failed_count) VALUES
		(1, 'alice@x.com', ?, 'user', 4)`, utils.MD5String("goodpass")).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	ps := NewApiService()
	_, count, apiErr := ps.GetUserInfo(context.Background(), "alice@x.com", "wrongpass")

	if count != 0 {
		t.Fatalf("expected count=0 on locking failure, got %d", count)
	}
	if _, ok := apiErr.(*errs.LockedError); !ok {
		t.Fatalf("expected *errs.LockedError on 5th failure, got %T (%v)", apiErr, apiErr)
	}
	var lockedUntil *time.Time
	if err := gdb.Raw(`SELECT locked_until FROM s_user WHERE id = 1`).Scan(&lockedUntil).Error; err != nil {
		t.Fatalf("read locked_until: %v", err)
	}
	if lockedUntil == nil || !lockedUntil.After(time.Now()) {
		t.Errorf("expected locked_until in the future, got %v", lockedUntil)
	}
}

// TestGetUserInfo_RejectsWhileLocked 钉死:锁定窗口内即使密码正确也拒绝(命中 user.go 的
// locked_until 提前返回分支)。
func TestGetUserInfo_RejectsWhileLocked(t *testing.T) {
	gdb := setupUserTestDB(t)
	future := time.Now().Add(10 * time.Minute)
	if err := gdb.Exec(`INSERT INTO s_user
		(id, email, password, code, locked_until) VALUES
		(1, 'alice@x.com', ?, 'user', ?)`, utils.MD5String("goodpass"), future).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	ps := NewApiService()
	_, count, apiErr := ps.GetUserInfo(context.Background(), "alice@x.com", "goodpass")

	if count != 0 {
		t.Fatalf("expected count=0 while locked, got %d", count)
	}
	if _, ok := apiErr.(*errs.LockedError); !ok {
		t.Fatalf("expected *errs.LockedError while locked, got %T (%v)", apiErr, apiErr)
	}
}

// TestGetUserInfo_PasswordExpiryWarning 钉死 90 天密码过期提示:登录成功但带 PasswordWarning。
func TestGetUserInfo_PasswordExpiryWarning(t *testing.T) {
	gdb := setupUserTestDB(t)
	old := time.Now().Add(-91 * 24 * time.Hour)
	if err := gdb.Exec(`INSERT INTO s_user
		(id, email, password, code, password_change_at) VALUES
		(1, 'alice@x.com', ?, 'user', ?)`, utils.MD5String("goodpass"), old).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	ps := NewApiService()
	info, count, apiErr := ps.GetUserInfo(context.Background(), "alice@x.com", "goodpass")

	if apiErr != nil {
		t.Fatalf("expected nil apiErr on correct password, got %v", apiErr)
	}
	if count != 1 {
		t.Fatalf("expected count=1 on success, got %d", count)
	}
	if info.PasswordWarning == "" {
		t.Error("expected non-empty PasswordWarning for 91-day-old password")
	}
}

// TestGetUserInfo_SuccessResetsFailureCount 钉死成功登录重置 login_failed_count。
func TestGetUserInfo_SuccessResetsFailureCount(t *testing.T) {
	gdb := setupUserTestDB(t)
	recent := time.Now().Add(-1 * time.Hour)
	if err := gdb.Exec(`INSERT INTO s_user
		(id, email, password, code, password_change_at, login_failed_count) VALUES
		(1, 'alice@x.com', ?, 'user', ?, 3)`, utils.MD5String("goodpass"), recent).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	ps := NewApiService()
	_, count, apiErr := ps.GetUserInfo(context.Background(), "alice@x.com", "goodpass")
	if apiErr != nil || count != 1 {
		t.Fatalf("expected success, got count=%d apiErr=%v", count, apiErr)
	}
	var failed int
	if err := gdb.Raw(`SELECT login_failed_count FROM s_user WHERE id = 1`).Scan(&failed).Error; err != nil {
		t.Fatalf("read login_failed_count: %v", err)
	}
	if failed != 0 {
		t.Errorf("expected login_failed_count reset to 0, got %d", failed)
	}
}

// TestApiUnlockUser_RejectsNonAdmin 钉死解锁授权闸:非 admin/super_admin 操作者被拒,
// 且目标用户保持锁定(未被越权解锁)。
func TestApiUnlockUser_RejectsNonAdmin(t *testing.T) {
	gdb := setupUserTestDB(t)
	future := time.Now().Add(10 * time.Minute)
	if err := gdb.Exec(`INSERT INTO s_user (id, email, code) VALUES (1, 'op@x.com', 'user')`).Error; err != nil {
		t.Fatalf("seed operator: %v", err)
	}
	if err := gdb.Exec(`INSERT INTO s_user
		(id, email, code, locked_until, login_failed_count) VALUES
		(2, 'victim@x.com', 'user', ?, 5)`, future).Error; err != nil {
		t.Fatalf("seed target: %v", err)
	}

	ps := NewApiService()
	err := ps.ApiUnlockUser(context.Background(), "op@x.com", 2)
	if err == nil {
		t.Fatal("expected non-admin operator to be rejected, got nil error")
	}
	var lockedUntil *time.Time
	if e := gdb.Raw(`SELECT locked_until FROM s_user WHERE id = 2`).Scan(&lockedUntil).Error; e != nil {
		t.Fatalf("read locked_until: %v", e)
	}
	if lockedUntil == nil {
		t.Error("non-admin rejection must not unlock the target")
	}
}

// TestApiUnlockUser_AdminUnlocks 钉死成功路径:admin 操作者把目标 locked_until 清空、
// login_failed_count 归零。
func TestApiUnlockUser_AdminUnlocks(t *testing.T) {
	gdb := setupUserTestDB(t)
	future := time.Now().Add(10 * time.Minute)
	if err := gdb.Exec(`INSERT INTO s_user (id, email, code) VALUES (1, 'admin@x.com', 'admin')`).Error; err != nil {
		t.Fatalf("seed operator: %v", err)
	}
	if err := gdb.Exec(`INSERT INTO s_user
		(id, email, code, locked_until, login_failed_count) VALUES
		(2, 'victim@x.com', 'user', ?, 5)`, future).Error; err != nil {
		t.Fatalf("seed target: %v", err)
	}

	ps := NewApiService()
	if err := ps.ApiUnlockUser(context.Background(), "admin@x.com", 2); err != nil {
		t.Fatalf("expected admin unlock to succeed, got %v", err)
	}
	var lockedUntil *time.Time
	var failed int
	if e := gdb.Raw(`SELECT locked_until, login_failed_count FROM s_user WHERE id = 2`).
		Row().Scan(&lockedUntil, &failed); e != nil {
		t.Fatalf("read target: %v", e)
	}
	if lockedUntil != nil {
		t.Errorf("expected locked_until cleared, got %v", lockedUntil)
	}
	if failed != 0 {
		t.Errorf("expected login_failed_count reset to 0, got %d", failed)
	}
}

// TestApiUnlockUser_SuperAdminUnlocks 钉死 super_admin 同样有权解锁(闸的第二个分支)。
func TestApiUnlockUser_SuperAdminUnlocks(t *testing.T) {
	gdb := setupUserTestDB(t)
	future := time.Now().Add(10 * time.Minute)
	if err := gdb.Exec(`INSERT INTO s_user (id, email, code) VALUES (1, 'root@x.com', 'super_admin')`).Error; err != nil {
		t.Fatalf("seed operator: %v", err)
	}
	if err := gdb.Exec(`INSERT INTO s_user
		(id, email, code, locked_until) VALUES (2, 'victim@x.com', 'user', ?)`, future).Error; err != nil {
		t.Fatalf("seed target: %v", err)
	}

	ps := NewApiService()
	if err := ps.ApiUnlockUser(context.Background(), "root@x.com", 2); err != nil {
		t.Fatalf("expected super_admin unlock to succeed, got %v", err)
	}
}

func TestGetUserInfo_BcryptRowVerifies(t *testing.T) {
	gdb := setupUserTestDB(t)
	hash, _ := utils.HashPassword("goodpass")
	if err := gdb.Exec(`INSERT INTO s_user (id, email, password, code) VALUES (1, 'a@x.com', ?, 'user')`, hash).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	ps := NewApiService()
	_, count, apiErr := ps.GetUserInfo(context.Background(), "a@x.com", "goodpass")
	if apiErr != nil || count != 1 {
		t.Fatalf("bcrypt login: want count=1 err=nil, got count=%d err=%v", count, apiErr)
	}
}

func TestGetUserInfo_LegacyMD5UpgradesOnLogin(t *testing.T) {
	gdb := setupUserTestDB(t)
	if err := gdb.Exec(`INSERT INTO s_user (id, email, password, code) VALUES (1, 'a@x.com', ?, 'user')`, utils.MD5String("goodpass")).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	ps := NewApiService()
	_, count, apiErr := ps.GetUserInfo(context.Background(), "a@x.com", "goodpass")
	if apiErr != nil || count != 1 {
		t.Fatalf("md5 login: want count=1 err=nil, got count=%d err=%v", count, apiErr)
	}
	var stored string
	if err := gdb.Raw(`SELECT password FROM s_user WHERE id = 1`).Scan(&stored).Error; err != nil {
		t.Fatalf("read back: %v", err)
	}
	if !strings.HasPrefix(stored, "$2") {
		t.Errorf("expected lazy upgrade to bcrypt, password still %q", stored)
	}
}

func TestGetUserInfo_UpgradeFailureDoesNotFailLogin(t *testing.T) {
	// Force HashPassword to error (out-of-range cost) so the lazy upgrade is
	// skipped; login must still succeed and the row stays on legacy MD5.
	viper.Set("bcrypt_cost", 99)
	defer viper.Set("bcrypt_cost", 0)

	gdb := setupUserTestDB(t)
	if err := gdb.Exec(`INSERT INTO s_user (id, email, password, code) VALUES (1, 'a@x.com', ?, 'user')`, utils.MD5String("goodpass")).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	ps := NewApiService()
	_, count, apiErr := ps.GetUserInfo(context.Background(), "a@x.com", "goodpass")
	if apiErr != nil || count != 1 {
		t.Fatalf("login must succeed despite upgrade failure, got count=%d err=%v", count, apiErr)
	}
	var stored string
	gdb.Raw(`SELECT password FROM s_user WHERE id = 1`).Scan(&stored)
	if stored != utils.MD5String("goodpass") {
		t.Errorf("row should stay on MD5 when upgrade hash fails, got %q", stored)
	}
}
