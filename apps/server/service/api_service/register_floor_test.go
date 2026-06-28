package api_service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"phytomni-server/db"
)

// setupRegisterFloorDB opens an in-memory SQLite with a user_operation_logs
// table, registers it in the global db registry, and returns the *gorm.DB for
// test seeding. Hand-writes CREATE TABLE (no AutoMigrate) to avoid MySQL enum
// tag failures on SQLite.
func setupRegisterFloorDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if sqlDB, err := gdb.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	if err := gdb.Exec(`CREATE TABLE user_operation_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER DEFAULT 0,
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
		t.Fatalf("ddl user_operation_logs: %v", err)
	}
	db.Set("phytomni-server", gdb)
	return gdb
}

// seedRegisterLogs inserts n rows for the given IP and path at the given time.
func seedRegisterLogs(t *testing.T, gdb *gorm.DB, clientIP, path string, n int, at time.Time) {
	t.Helper()
	for i := 0; i < n; i++ {
		if err := gdb.Exec(
			`INSERT INTO user_operation_logs (client_ip, path, created_at) VALUES (?, ?, ?)`,
			clientIP, path, at.Format("2006-01-02 15:04:05"),
		).Error; err != nil {
			t.Fatalf("seed row %d: %v", i, err)
		}
	}
}

// TestRegisterFloor_UnderLimitPasses seeds fewer rows than the default limit (30)
// for the register path and expects CheckRegisterFloor to return nil.
// Mutation guard: removing the `count >= limit` check would make it always reject,
// breaking this test (but that mutation is the OverLimit test's guard — here we
// verify the non-rejection path).
func TestRegisterFloor_UnderLimitPasses(t *testing.T) {
	gdb := setupRegisterFloorDB(t)
	now := time.Now()
	// seed 29 rows (default limit=30, so 29 < 30 → pass)
	seedRegisterLogs(t, gdb, "1.2.3.4", registerFloorPath, 29, now)

	ps := NewService()
	if err := ps.CheckRegisterFloor(context.Background(), "1.2.3.4"); err != nil {
		t.Fatalf("expected nil for under-limit IP, got %v", err)
	}
}

// TestRegisterFloor_OverLimitRejects seeds >= limit rows and expects ErrRegisterRateLimited.
// Mutation guard: deleting the `count >= limit` return → this test goes RED.
func TestRegisterFloor_OverLimitRejects(t *testing.T) {
	gdb := setupRegisterFloorDB(t)
	now := time.Now()
	// seed 30 rows (== default limit → reject)
	seedRegisterLogs(t, gdb, "5.6.7.8", registerFloorPath, 30, now)

	ps := NewService()
	err := ps.CheckRegisterFloor(context.Background(), "5.6.7.8")
	if !errors.Is(err, ErrRegisterRateLimited) {
		t.Fatalf("expected ErrRegisterRateLimited for over-limit IP, got %v", err)
	}
}

// TestRegisterFloor_WindowExcludesOld seeds over-limit rows but with created_at
// older than the default window (1h), so they are outside the window → nil.
// Mutation guard: removing the `created_at > ?` WHERE clause → old rows counted → RED.
func TestRegisterFloor_WindowExcludesOld(t *testing.T) {
	gdb := setupRegisterFloorDB(t)
	// 2 hours ago — outside the default 1-hour window
	old := time.Now().Add(-2 * time.Hour)
	seedRegisterLogs(t, gdb, "9.10.11.12", registerFloorPath, 30, old)

	ps := NewService()
	if err := ps.CheckRegisterFloor(context.Background(), "9.10.11.12"); err != nil {
		t.Fatalf("expected nil for old rows outside window, got %v", err)
	}
}

// TestRegisterFloor_OtherPathNotCounted seeds over-limit rows for a different path;
// the register floor must not count them.
// Mutation guard: removing the `path = ?` WHERE clause → other-path rows counted → RED.
func TestRegisterFloor_OtherPathNotCounted(t *testing.T) {
	gdb := setupRegisterFloorDB(t)
	now := time.Now()
	// seed on a different path
	seedRegisterLogs(t, gdb, "13.14.15.16", "/api/v1/auth/login", 30, now)

	ps := NewService()
	if err := ps.CheckRegisterFloor(context.Background(), "13.14.15.16"); err != nil {
		t.Fatalf("expected nil for different-path rows, got %v", err)
	}
}

// TestRegisterFloor_SameIPv6AddressMatches seeds over-limit rows using a full IPv6
// address and verifies that the same full address is rejected (exact equality match).
// Mutation guard: removing the `client_ip = ?` WHERE clause → all IPs merged → may
// pass incidentally but the client_ip filter is the key invariant tested here.
func TestRegisterFloor_SameIPv6AddressMatches(t *testing.T) {
	gdb := setupRegisterFloorDB(t)
	now := time.Now()
	ipv6 := "2001:db8::1"
	seedRegisterLogs(t, gdb, ipv6, registerFloorPath, 30, now)

	ps := NewService()
	err := ps.CheckRegisterFloor(context.Background(), ipv6)
	if !errors.Is(err, ErrRegisterRateLimited) {
		t.Fatalf("expected ErrRegisterRateLimited for over-limit IPv6 full address, got %v", err)
	}

	// A different IPv6 address must NOT be rate-limited.
	otherIPv6 := "2001:db8::2"
	if err := ps.CheckRegisterFloor(context.Background(), otherIPv6); err != nil {
		t.Fatalf("different IPv6 address must not be limited, got %v", err)
	}
}

// TestRegisterFloor_EmptyIPPasses verifies that an empty clientIP bypasses the check.
// Mutation guard: removing the `clientIP == ""` early return → hits DB with empty string
// → COUNT=0 → still nil, but removes the guard that prevents unnecessary DB queries and
// ensures correct semantics for unidentifiable clients.
// We use a closed DB to prove the guard fires before any DB access.
func TestRegisterFloor_EmptyIPPasses(t *testing.T) {
	gdb := setupRegisterFloorDB(t)
	// Close the DB: if the empty-IP guard is removed, the DB call would fail.
	if sqlDB, err := gdb.DB(); err == nil {
		_ = sqlDB.Close()
	}

	ps := NewService()
	if err := ps.CheckRegisterFloor(context.Background(), ""); err != nil {
		t.Fatalf("expected nil for empty clientIP, got %v", err)
	}
}

// TestRegisterFloor_CountErrorFailsClosed verifies fail-closed behavior: when COUNT
// returns an error (table dropped), CheckRegisterFloor must return a non-nil error.
// Mutation guard: changing `return err` to `return nil` in the error branch → RED.
func TestRegisterFloor_CountErrorFailsClosed(t *testing.T) {
	gdb := setupRegisterFloorDB(t)
	// Drop the table to force a COUNT error deterministically.
	if err := gdb.Exec(`DROP TABLE user_operation_logs`).Error; err != nil {
		t.Fatalf("drop table: %v", err)
	}

	ps := NewService()
	err := ps.CheckRegisterFloor(context.Background(), "1.2.3.4")
	if err == nil {
		t.Fatal("expected non-nil error (fail-closed) when COUNT errors, got nil")
	}
	// Must NOT be ErrRegisterRateLimited — it should be the underlying DB error.
	if errors.Is(err, ErrRegisterRateLimited) {
		t.Fatalf("expected DB error (not ErrRegisterRateLimited) on COUNT failure, got %v", err)
	}
	// Sanity: the error message should mention the missing table.
	t.Logf("COUNT error (expected): %v", err)
}
