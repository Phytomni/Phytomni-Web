package api_service

import (
	"context"
	"errors"
	"testing"

	"phytomni-server/db"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// setupCronEntriesDB opens an in-memory SQLite with the users table (operator
// auth) used to verify the admin-only authorization boundary on the cron-entries
// endpoint. No audit or cron tables are needed: GetCronEntries reads the
// operator from users and the schedule from the in-process cron/base handle.
func setupCronEntriesDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if sqlDB, err := gdb.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	if err := gdb.Exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, code TEXT)`).Error; err != nil {
		t.Fatalf("ddl users: %v", err)
	}
	db.Set("phytomni-server", gdb)
	return gdb
}

// A normal logged-in user (code='user') must be denied: the cron schedule
// exposes internal job timing and registered specs, so only admins may read it.
func TestGetCronEntries_DeniesNonAdmin(t *testing.T) {
	gdb := setupCronEntriesDB(t)
	if err := gdb.Exec(`INSERT INTO users (id, email, code) VALUES (1, 'alice@example.com', 'user')`).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	ps := NewService()
	entries, err := ps.GetCronEntries(context.Background(), "alice@example.com")
	if !errors.Is(err, ErrCronEntriesForbidden) {
		t.Fatalf("expected ErrCronEntriesForbidden for non-admin, got err=%v entries=%d", err, len(entries))
	}
	if entries != nil {
		t.Errorf("non-admin must receive no entries, got %d", len(entries))
	}
}

// An unknown operator (token user not found in users) is also denied, exposing
// no schedule data — mirrors the operation-log admin boundary.
func TestGetCronEntries_DeniesUnknownOperator(t *testing.T) {
	setupCronEntriesDB(t)
	ps := NewService()
	if _, err := ps.GetCronEntries(context.Background(), "ghost@example.com"); !errors.Is(err, ErrCronEntriesForbidden) {
		t.Fatalf("expected ErrCronEntriesForbidden for unknown operator, got %v", err)
	}
}

// An admin (or super_admin) is allowed; with no started schedulers the result
// is empty, but the authorization gate is the load-bearing assertion here.
func TestGetCronEntries_AllowsAdmin(t *testing.T) {
	gdb := setupCronEntriesDB(t)
	if err := gdb.Exec(`INSERT INTO users (id, email, code) VALUES (1, 'root@example.com', 'super_admin')`).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	ps := NewService()
	if _, err := ps.GetCronEntries(context.Background(), "root@example.com"); err != nil {
		t.Fatalf("admin should be allowed, got %v", err)
	}
}
