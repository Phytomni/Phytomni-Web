package api_service

import (
	"context"
	"errors"
	"testing"

	"phytomni-server/db"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// setupOperationLogDB opens an in-memory SQLite with users (operator auth) +
// user_operation_logs (audit table), used to verify the admin-only authorization
// boundary on the operation-log endpoint.
func setupOperationLogDB(t *testing.T) *gorm.DB {
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
	if err := gdb.Exec(`CREATE TABLE user_operation_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, user_email TEXT,
		method TEXT, path TEXT, query_params TEXT, body_params TEXT, client_ip TEXT,
		user_agent TEXT, status_code INTEGER, latency INTEGER, error_message TEXT, created_at DATETIME
	)`).Error; err != nil {
		t.Fatalf("ddl user_operation_logs: %v", err)
	}
	db.Set("phytomni-server", gdb)
	return gdb
}

// A normal logged-in user → ErrOperationLogForbidden, and not a single audit row is returned.
func TestApiGetOperationLogs_DeniesNonAdmin(t *testing.T) {
	gdb := setupOperationLogDB(t)
	if err := gdb.Exec(`INSERT INTO users (id, email, code) VALUES (1, 'alice@example.com', 'user')`).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if err := gdb.Exec(`INSERT INTO user_operation_logs (id, user_id, user_email) VALUES (1, 9, 'victim@example.com')`).Error; err != nil {
		t.Fatalf("seed log: %v", err)
	}

	ps := NewService()
	logs, err := ps.GetOperationLogs(context.Background(), "alice@example.com", nil, "", "")
	if !errors.Is(err, ErrOperationLogForbidden) {
		t.Fatalf("expected ErrOperationLogForbidden for non-admin, got err=%v rows=%d", err, len(logs))
	}
	if logs != nil {
		t.Errorf("non-admin must receive no rows, got %d", len(logs))
	}
}

// An unknown operator (token user not found in users) is also denied, exposing no audit data.
func TestApiGetOperationLogs_DeniesUnknownOperator(t *testing.T) {
	setupOperationLogDB(t)
	ps := NewService()
	if _, err := ps.GetOperationLogs(context.Background(), "ghost@example.com", nil, "", ""); !errors.Is(err, ErrOperationLogForbidden) {
		t.Fatalf("expected ErrOperationLogForbidden for unknown operator, got %v", err)
	}
}

// An admin → allowed; empty user_ids returns all rows.
func TestApiGetOperationLogs_AllowsAdmin(t *testing.T) {
	gdb := setupOperationLogDB(t)
	if err := gdb.Exec(`INSERT INTO users (id, email, code) VALUES (1, 'root@example.com', 'super_admin')`).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if err := gdb.Exec(`INSERT INTO user_operation_logs (id, user_id, user_email, created_at) VALUES
		(1, 9, 'a@example.com', '2026-01-01 00:00:00'),
		(2, 8, 'b@example.com', '2026-01-02 00:00:00')`).Error; err != nil {
		t.Fatalf("seed logs: %v", err)
	}

	ps := NewService()
	logs, err := ps.GetOperationLogs(context.Background(), "root@example.com", nil, "", "")
	if err != nil {
		t.Fatalf("admin should be allowed, got %v", err)
	}
	if len(logs) != 2 {
		t.Errorf("admin with empty user_ids should return all rows, got %d", len(logs))
	}
}
