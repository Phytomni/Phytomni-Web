package api_service

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/spf13/viper"
	"gorm.io/gorm"

	"phytomni-server/db"
	"phytomni-server/utils"
	"phytomni-server/utils/errs"
)

// setupUserTestDB opens an in-memory SQLite DB, hand-writes a minimal users
// schema, and registers it in the global db registry. Hand-writing CREATE TABLE
// instead of AutoMigrate(User): User.FirstLoginStatus carries a MySQL-only
// `type:enum` GORM tag that breaks SQLite AutoMigrate. Only the columns read
// or written by GetUserInfo / UnlockUser are included.
func setupUserTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	ddl := `CREATE TABLE users (
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
	db.Set("phytomni-server", gdb)
	return gdb
}

// TestGetUserInfo_LockoutOnFifthFailure pins the lockout threshold: the 5th
// wrong password must lock the account for 15 minutes. Without this guard, a
// threshold or window change goes undetected by any test.
func TestGetUserInfo_LockoutOnFifthFailure(t *testing.T) {
	gdb := setupUserTestDB(t)
	if err := gdb.Exec(`INSERT INTO users
		(id, email, password, code, login_failed_count) VALUES
		(1, 'alice@x.com', ?, 'user', 4)`, utils.MD5String("goodpass")).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	ps := NewService()
	_, count, apiErr := ps.GetUserInfo(context.Background(), "alice@x.com", "wrongpass")

	if count != 0 {
		t.Fatalf("expected count=0 on locking failure, got %d", count)
	}
	if _, ok := apiErr.(*errs.LockedError); !ok {
		t.Fatalf("expected *errs.LockedError on 5th failure, got %T (%v)", apiErr, apiErr)
	}
	var lockedUntil *time.Time
	if err := gdb.Raw(`SELECT locked_until FROM users WHERE id = 1`).Scan(&lockedUntil).Error; err != nil {
		t.Fatalf("read locked_until: %v", err)
	}
	if lockedUntil == nil || !lockedUntil.After(time.Now()) {
		t.Errorf("expected locked_until in the future, got %v", lockedUntil)
	}
}

// TestGetUserInfo_RejectsWhileLocked pins that even a correct password is
// rejected while the lockout window is active (hits the locked_until
// early-return branch in user.go).
func TestGetUserInfo_RejectsWhileLocked(t *testing.T) {
	gdb := setupUserTestDB(t)
	future := time.Now().Add(10 * time.Minute)
	if err := gdb.Exec(`INSERT INTO users
		(id, email, password, code, locked_until) VALUES
		(1, 'alice@x.com', ?, 'user', ?)`, utils.MD5String("goodpass"), future).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	ps := NewService()
	_, count, apiErr := ps.GetUserInfo(context.Background(), "alice@x.com", "goodpass")

	if count != 0 {
		t.Fatalf("expected count=0 while locked, got %d", count)
	}
	if _, ok := apiErr.(*errs.LockedError); !ok {
		t.Fatalf("expected *errs.LockedError while locked, got %T (%v)", apiErr, apiErr)
	}
}

// TestGetUserInfo_PasswordExpiryWarning pins the 90-day expiry warning:
// login succeeds but the response carries a non-empty PasswordWarning.
func TestGetUserInfo_PasswordExpiryWarning(t *testing.T) {
	gdb := setupUserTestDB(t)
	old := time.Now().Add(-91 * 24 * time.Hour)
	if err := gdb.Exec(`INSERT INTO users
		(id, email, password, code, password_change_at) VALUES
		(1, 'alice@x.com', ?, 'user', ?)`, utils.MD5String("goodpass"), old).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	ps := NewService()
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

// TestGetUserInfo_SuccessResetsFailureCount pins that a successful login
// resets login_failed_count to zero.
func TestGetUserInfo_SuccessResetsFailureCount(t *testing.T) {
	gdb := setupUserTestDB(t)
	recent := time.Now().Add(-1 * time.Hour)
	if err := gdb.Exec(`INSERT INTO users
		(id, email, password, code, password_change_at, login_failed_count) VALUES
		(1, 'alice@x.com', ?, 'user', ?, 3)`, utils.MD5String("goodpass"), recent).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	ps := NewService()
	_, count, apiErr := ps.GetUserInfo(context.Background(), "alice@x.com", "goodpass")
	if apiErr != nil || count != 1 {
		t.Fatalf("expected success, got count=%d apiErr=%v", count, apiErr)
	}
	var failed int
	if err := gdb.Raw(`SELECT login_failed_count FROM users WHERE id = 1`).Scan(&failed).Error; err != nil {
		t.Fatalf("read login_failed_count: %v", err)
	}
	if failed != 0 {
		t.Errorf("expected login_failed_count reset to 0, got %d", failed)
	}
}

// TestApiUnlockUser_RejectsNonAdmin pins the unlock authorization gate: a
// non-admin/super_admin operator is rejected, and the target user remains
// locked (not unlocked by privilege escalation).
func TestApiUnlockUser_RejectsNonAdmin(t *testing.T) {
	gdb := setupUserTestDB(t)
	future := time.Now().Add(10 * time.Minute)
	if err := gdb.Exec(`INSERT INTO users (id, email, code) VALUES (1, 'op@x.com', 'user')`).Error; err != nil {
		t.Fatalf("seed operator: %v", err)
	}
	if err := gdb.Exec(`INSERT INTO users
		(id, email, code, locked_until, login_failed_count) VALUES
		(2, 'victim@x.com', 'user', ?, 5)`, future).Error; err != nil {
		t.Fatalf("seed target: %v", err)
	}

	ps := NewService()
	err := ps.UnlockUser(context.Background(), "op@x.com", 2)
	if err == nil {
		t.Fatal("expected non-admin operator to be rejected, got nil error")
	}
	var lockedUntil *time.Time
	if e := gdb.Raw(`SELECT locked_until FROM users WHERE id = 2`).Scan(&lockedUntil).Error; e != nil {
		t.Fatalf("read locked_until: %v", e)
	}
	if lockedUntil == nil {
		t.Error("non-admin rejection must not unlock the target")
	}
}

// TestApiUnlockUser_AdminUnlocks pins the success path: an admin operator
// clears the target's locked_until and resets login_failed_count to zero.
func TestApiUnlockUser_AdminUnlocks(t *testing.T) {
	gdb := setupUserTestDB(t)
	future := time.Now().Add(10 * time.Minute)
	if err := gdb.Exec(`INSERT INTO users (id, email, code) VALUES (1, 'admin@x.com', 'admin')`).Error; err != nil {
		t.Fatalf("seed operator: %v", err)
	}
	if err := gdb.Exec(`INSERT INTO users
		(id, email, code, locked_until, login_failed_count) VALUES
		(2, 'victim@x.com', 'user', ?, 5)`, future).Error; err != nil {
		t.Fatalf("seed target: %v", err)
	}

	ps := NewService()
	if err := ps.UnlockUser(context.Background(), "admin@x.com", 2); err != nil {
		t.Fatalf("expected admin unlock to succeed, got %v", err)
	}
	var lockedUntil *time.Time
	var failed int
	if e := gdb.Raw(`SELECT locked_until, login_failed_count FROM users WHERE id = 2`).
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

// TestApiUnlockUser_SuperAdminUnlocks pins that super_admin can also unlock
// (the second branch in the authorization gate).
func TestApiUnlockUser_SuperAdminUnlocks(t *testing.T) {
	gdb := setupUserTestDB(t)
	future := time.Now().Add(10 * time.Minute)
	if err := gdb.Exec(`INSERT INTO users (id, email, code) VALUES (1, 'root@x.com', 'super_admin')`).Error; err != nil {
		t.Fatalf("seed operator: %v", err)
	}
	if err := gdb.Exec(`INSERT INTO users
		(id, email, code, locked_until) VALUES (2, 'victim@x.com', 'user', ?)`, future).Error; err != nil {
		t.Fatalf("seed target: %v", err)
	}

	ps := NewService()
	if err := ps.UnlockUser(context.Background(), "root@x.com", 2); err != nil {
		t.Fatalf("expected super_admin unlock to succeed, got %v", err)
	}
}

func TestGetUserInfo_BcryptRowVerifies(t *testing.T) {
	gdb := setupUserTestDB(t)
	hash, _ := utils.HashPassword("goodpass")
	if err := gdb.Exec(`INSERT INTO users (id, email, password, code) VALUES (1, 'a@x.com', ?, 'user')`, hash).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	ps := NewService()
	_, count, apiErr := ps.GetUserInfo(context.Background(), "a@x.com", "goodpass")
	if apiErr != nil || count != 1 {
		t.Fatalf("bcrypt login: want count=1 err=nil, got count=%d err=%v", count, apiErr)
	}
}

func TestGetUserInfo_LegacyMD5UpgradesOnLogin(t *testing.T) {
	gdb := setupUserTestDB(t)
	if err := gdb.Exec(`INSERT INTO users (id, email, password, code) VALUES (1, 'a@x.com', ?, 'user')`, utils.MD5String("goodpass")).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	ps := NewService()
	_, count, apiErr := ps.GetUserInfo(context.Background(), "a@x.com", "goodpass")
	if apiErr != nil || count != 1 {
		t.Fatalf("md5 login: want count=1 err=nil, got count=%d err=%v", count, apiErr)
	}
	var stored string
	if err := gdb.Raw(`SELECT password FROM users WHERE id = 1`).Scan(&stored).Error; err != nil {
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
	if err := gdb.Exec(`INSERT INTO users (id, email, password, code) VALUES (1, 'a@x.com', ?, 'user')`, utils.MD5String("goodpass")).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	ps := NewService()
	_, count, apiErr := ps.GetUserInfo(context.Background(), "a@x.com", "goodpass")
	if apiErr != nil || count != 1 {
		t.Fatalf("login must succeed despite upgrade failure, got count=%d err=%v", count, apiErr)
	}
	var stored string
	gdb.Raw(`SELECT password FROM users WHERE id = 1`).Scan(&stored)
	if stored != utils.MD5String("goodpass") {
		t.Errorf("row should stay on MD5 when upgrade hash fails, got %q", stored)
	}
}

func TestApiModifyPassword_LegacyOldVerifiesNewIsBcrypt(t *testing.T) {
	gdb := setupUserTestDB(t)
	if err := gdb.Exec(`INSERT INTO users (id, email, password, code) VALUES (1, 'a@x.com', ?, 'user')`, utils.MD5String("oldpass")).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	ps := NewService()
	if _, err := ps.ModifyPassword(context.Background(), "a@x.com", "oldpass", "newpass"); err != nil {
		t.Fatalf("change with correct old (md5) should succeed, got %v", err)
	}
	var stored string
	gdb.Raw(`SELECT password FROM users WHERE id = 1`).Scan(&stored)
	if !strings.HasPrefix(stored, "$2") {
		t.Errorf("new password should be stored as bcrypt, got %q", stored)
	}
	ok, _, _ := utils.VerifyPassword(stored, "newpass")
	if !ok {
		t.Error("stored new hash does not verify the new password")
	}
}

func TestApiModifyPassword_WrongOldRejected(t *testing.T) {
	gdb := setupUserTestDB(t)
	if err := gdb.Exec(`INSERT INTO users (id, email, password, code) VALUES (1, 'a@x.com', ?, 'user')`, utils.MD5String("oldpass")).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	ps := NewService()
	if _, err := ps.ModifyPassword(context.Background(), "a@x.com", "WRONG", "newpass"); err == nil {
		t.Fatal("expected error on wrong old password, got nil")
	}
}

func TestApiModifyPassword_UnknownUserFailsClosed(t *testing.T) {
	setupUserTestDB(t) // no rows seeded
	ps := NewService()
	// A JWT for a since-deleted user: must error, must not panic.
	if _, err := ps.ModifyPassword(context.Background(), "ghost@x.com", "x", "newpass"); err == nil {
		t.Fatal("expected error for unknown user, got nil")
	}
}

func TestApiUserRegister_StoresBcrypt(t *testing.T) {
	gdb := setupUserTestDB(t)
	ps := NewService()
	if err := ps.UserRegister(context.Background(), "new@x.com", "Secret12!"); err != nil {
		t.Fatalf("register: %v", err)
	}
	var stored string
	gdb.Raw(`SELECT password FROM users WHERE email = 'new@x.com'`).Scan(&stored)
	if !strings.HasPrefix(stored, "$2") {
		t.Errorf("self-register should store bcrypt, got %q", stored)
	}
}

func TestRegisterAddUser_StoresBcrypt(t *testing.T) {
	gdb := setupUserTestDB(t)
	ps := NewService()
	if _, err := ps.RegisterAddUser(context.Background(), "adm@x.com", "Secret12!", "user", 0, "", "", ""); err != nil {
		t.Fatalf("admin create: %v", err)
	}
	var stored string
	gdb.Raw(`SELECT password FROM users WHERE email = 'adm@x.com'`).Scan(&stored)
	if !strings.HasPrefix(stored, "$2") {
		t.Errorf("admin-create should store bcrypt, got %q", stored)
	}
}

func TestUpdateUserPassWord_StoresBcrypt(t *testing.T) {
	gdb := setupUserTestDB(t)
	if err := gdb.Exec(`INSERT INTO users (id, email, password, code) VALUES (7, 'u@x.com', ?, 'user')`, utils.MD5String("old")).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	ps := NewService()
	if ok := ps.UpdateUserPassWord(context.Background(), "Secret12!", 7); !ok {
		t.Fatal("admin reset returned false")
	}
	var stored string
	gdb.Raw(`SELECT password FROM users WHERE id = 7`).Scan(&stored)
	if !strings.HasPrefix(stored, "$2") {
		t.Errorf("admin reset should store bcrypt, got %q", stored)
	}
}

// TestGetUserInfo_LazyUpgradePreservesPasswordChangeAt pins design §10/§274:
// lazy upgrade changes the password storage from MD5 to bcrypt but must NOT
// touch password_change_at — the credential itself did not change; it is a
// storage-format migration, not a password change. Touching it would silently
// reset the 90-day expiry timer.
// mutation: add "password_change_at": time.Now() to the upgrade Update → RED.
func TestGetUserInfo_LazyUpgradePreservesPasswordChangeAt(t *testing.T) {
	gdb := setupUserTestDB(t)
	// Fixed historical password_change_at (40 days ago: under 90-day threshold,
	// no expiry warning, non-NULL).
	changedAt := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	if err := gdb.Exec(`INSERT INTO users (id, email, password, code, password_change_at) VALUES (1, 'a@x.com', ?, 'user', ?)`,
		utils.MD5String("goodpass"), changedAt).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	ps := NewService()
	_, count, apiErr := ps.GetUserInfo(context.Background(), "a@x.com", "goodpass")
	if apiErr != nil || count != 1 {
		t.Fatalf("login should succeed, got count=%d err=%v", count, apiErr)
	}

	var stored string
	var gotChangedAt *time.Time
	if err := gdb.Raw(`SELECT password, password_change_at FROM users WHERE id = 1`).Row().Scan(&stored, &gotChangedAt); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if !strings.HasPrefix(stored, "$2") {
		t.Fatalf("expected lazy upgrade to bcrypt, got %q", stored)
	}
	if gotChangedAt == nil || !gotChangedAt.Equal(changedAt) {
		t.Errorf("lazy upgrade must NOT touch password_change_at: want %v, got %v", changedAt, gotChangedAt)
	}
}

// TestGetUserInfo_LazyUpgradeNoClobberOnConcurrentWrite pins design §274's
// concurrent no-clobber: the upgrade uses a guarded CAS
// (WHERE id=? AND password=<original MD5>) so if another concurrent write has
// already changed the row between our read and upgrade, the CAS must produce
// RowsAffected==0 without overwriting the newer value.
// Uses a GORM After-query callback + sync.Once to inject a competing bcrypt
// write between the users query and the upgrade.
// mutation: change the upgrade Where to only "id = ?" (remove AND password=) → RED (concurrent write overwritten).
func TestGetUserInfo_LazyUpgradeNoClobberOnConcurrentWrite(t *testing.T) {
	gdb := setupUserTestDB(t)
	if err := gdb.Exec(`INSERT INTO users (id, email, password, code) VALUES (1, 'a@x.com', ?, 'user')`,
		utils.MD5String("goodpass")).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Competing value: a bcrypt hash representing another concurrent session's password rotation.
	racingHash, _ := utils.HashPassword("rotated-by-someone-else")

	var once sync.Once
	cbName := "test_inject_concurrent_pw_write"
	if err := gdb.Callback().Query().After("gorm:query").Register(cbName, func(tx *gorm.DB) {
		// Fire only on users queries, and only once: simulate a racing write
		// landing between login's read and upgrade.
		if tx.Statement == nil || tx.Statement.Table != "users" {
			return
		}
		once.Do(func() {
			// Use raw SQL to avoid re-triggering this callback recursively.
			gdb.Exec(`UPDATE users SET password = ? WHERE id = 1`, racingHash)
		})
	}); err != nil {
		t.Fatalf("register callback: %v", err)
	}
	t.Cleanup(func() { _ = gdb.Callback().Query().Remove(cbName) })

	ps := NewService()
	_, count, apiErr := ps.GetUserInfo(context.Background(), "a@x.com", "goodpass")
	if apiErr != nil || count != 1 {
		t.Fatalf("login should still succeed, got count=%d err=%v", count, apiErr)
	}

	var stored string
	gdb.Raw(`SELECT password FROM users WHERE id = 1`).Scan(&stored)
	if stored != racingHash {
		t.Errorf("guarded CAS must not clobber the concurrent write: want racing hash %q, got %q", racingHash, stored)
	}
}

// TestApiModifyPassword_BcryptOldVerifies pins design §10: when the existing
// hash is already bcrypt (user was previously lazy-upgraded), changing the
// password must verify the old value correctly and store the new one as bcrypt.
// The prior test only covered an MD5 old password.
func TestApiModifyPassword_BcryptOldVerifies(t *testing.T) {
	gdb := setupUserTestDB(t)
	oldHash, _ := utils.HashPassword("oldpass")
	if err := gdb.Exec(`INSERT INTO users (id, email, password, code) VALUES (1, 'a@x.com', ?, 'user')`, oldHash).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	ps := NewService()
	if _, err := ps.ModifyPassword(context.Background(), "a@x.com", "oldpass", "newpass"); err != nil {
		t.Fatalf("change with correct bcrypt old password should succeed, got %v", err)
	}
	var stored string
	gdb.Raw(`SELECT password FROM users WHERE id = 1`).Scan(&stored)
	if !strings.HasPrefix(stored, "$2") {
		t.Errorf("new password should be stored as bcrypt, got %q", stored)
	}
	if ok, _, _ := utils.VerifyPassword(stored, "newpass"); !ok {
		t.Error("stored new hash does not verify the new password")
	}
	// Old password must no longer verify after the change.
	if ok, _, _ := utils.VerifyPassword(stored, "oldpass"); ok {
		t.Error("old password still verifies after change")
	}
}

// TestWriteSites_FailClosedOnHashError pins fail-closed behavior at all three
// write sites: when bcrypt_cost is out-of-range (causing HashPassword to error),
// register/admin-create/admin-reset must all return an error and must NOT write
// any row or overwrite the existing password with an empty or plain-text hash.
// mutation: remove `if herr != nil { return ... }` at any site → that sub-test goes RED.
func TestWriteSites_FailClosedOnHashError(t *testing.T) {
	viper.Set("bcrypt_cost", 99) // out of range → HashPassword errors
	defer viper.Set("bcrypt_cost", 0)

	t.Run("UserRegister", func(t *testing.T) {
		gdb := setupUserTestDB(t)
		ps := NewService()
		if err := ps.UserRegister(context.Background(), "new@x.com", "Secret12!"); err == nil {
			t.Error("self-register must fail when hashing errors")
		}
		var n int64
		gdb.Raw(`SELECT COUNT(*) FROM users WHERE email = 'new@x.com'`).Scan(&n)
		if n != 0 {
			t.Errorf("no row must be written on hash error, found %d", n)
		}
	})

	t.Run("RegisterAddUser", func(t *testing.T) {
		gdb := setupUserTestDB(t)
		ps := NewService()
		if ok, err := ps.RegisterAddUser(context.Background(), "adm@x.com", "Secret12!", "user", 0, "", "", ""); ok || err == nil {
			t.Errorf("admin-create must fail-closed on hash error, got ok=%v err=%v", ok, err)
		}
		var n int64
		gdb.Raw(`SELECT COUNT(*) FROM users WHERE email = 'adm@x.com'`).Scan(&n)
		if n != 0 {
			t.Errorf("no row must be written on hash error, found %d", n)
		}
	})

	t.Run("UpdateUserPassWord", func(t *testing.T) {
		gdb := setupUserTestDB(t)
		// Seed with a known MD5; assert that a reset failure leaves the
		// password unchanged (not overwritten with an empty hash).
		if err := gdb.Exec(`INSERT INTO users (id, email, password, code) VALUES (7, 'u@x.com', ?, 'user')`, utils.MD5String("orig")).Error; err != nil {
			t.Fatalf("seed: %v", err)
		}
		ps := NewService()
		if ok := ps.UpdateUserPassWord(context.Background(), "Secret12!", 7); ok {
			t.Error("admin reset must return false on hash error")
		}
		var stored string
		gdb.Raw(`SELECT password FROM users WHERE id = 7`).Scan(&stored)
		if stored != utils.MD5String("orig") {
			t.Errorf("password must stay unchanged on hash error, got %q", stored)
		}
	})
}

// setupUserTestDBWithUniqueEmail opens a fresh in-memory SQLite with the same
// users schema as setupUserTestDB but also creates a UNIQUE index on email so
// duplicate-key paths are reachable in tests. TranslateError must be on for
// gorm.ErrDuplicatedKey mapping to work on SQLite.
func setupUserTestDBWithUniqueEmail(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	ddl := `CREATE TABLE users (
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
	if err := gdb.Exec(`CREATE UNIQUE INDEX uniq_users_email ON users(email)`).Error; err != nil {
		t.Fatalf("create unique index: %v", err)
	}
	db.Set("phytomni-server", gdb)
	return gdb
}

// TestUserRegister_DuplicateEmailFriendlyError pins the dup-key mapping in
// UserRegister: registering the same email twice must return a friendly Chinese
// message, not a raw GORM or driver error string. The unique index must be
// present on the test DB so the second insert genuinely violates the constraint.
// mutation: remove the errors.Is(err, gorm.ErrDuplicatedKey) branch → this
// test goes red because the generic "user registration failed" message is not the
// duplicate-specific one being asserted.
func TestUserRegister_DuplicateEmailFriendlyError(t *testing.T) {
	setupUserTestDBWithUniqueEmail(t)
	ps := NewService()

	if err := ps.UserRegister(context.Background(), "dup@x.com", "Secret12!"); err != nil {
		t.Fatalf("first registration must succeed, got %v", err)
	}

	err := ps.UserRegister(context.Background(), "dup@x.com", "Secret12!")
	if err == nil {
		t.Fatal("second registration with same email must return an error")
	}
	const want = "该邮箱已被注册"
	if err.Error() != want {
		t.Errorf("expected friendly message %q, got %q", want, err.Error())
	}
}

// TestRegisterAddUser_DuplicateEmailFriendlyError pins the same dup-key mapping
// in RegisterAddUser: an admin attempting to create a second account with an
// already-registered email must get the friendly message, not a raw error.
func TestRegisterAddUser_DuplicateEmailFriendlyError(t *testing.T) {
	setupUserTestDBWithUniqueEmail(t)
	ps := NewService()

	if _, err := ps.RegisterAddUser(context.Background(), "dup@x.com", "Secret12!", "user", 0, "", "", ""); err != nil {
		t.Fatalf("first admin-create must succeed, got %v", err)
	}

	_, err := ps.RegisterAddUser(context.Background(), "dup@x.com", "Secret12!", "user", 0, "", "", "")
	if err == nil {
		t.Fatal("second admin-create with same email must return an error")
	}
	const want = "该邮箱已被注册"
	if err.Error() != want {
		t.Errorf("expected friendly message %q, got %q", want, err.Error())
	}
}
