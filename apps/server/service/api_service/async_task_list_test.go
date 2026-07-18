package api_service

import (
	"context"
	"testing"

	"phytomni-server/db"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// setupAsyncListDB creates a table with every column mapped by
// ApiAsyncTaskListResponse. A minimal DDL missing task_log etc. would make
// Find(&[]ApiAsyncTaskListResponse) fail with "no such column".
func setupAsyncListDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if sqlDB, err := gdb.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	ddl := `CREATE TABLE question_agent_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		dialogue_id TEXT, f_id INTEGER DEFAULT 0, server_id TEXT, bot_run_id TEXT,
		user_name TEXT, query TEXT, answer TEXT, task_id TEXT, task_log TEXT,
		file_name TEXT, upload_path TEXT, download_path TEXT, compute_resource TEXT,
		server_file_path TEXT, tool_name TEXT, status TEXT, log_status TEXT,
		reaction_type TEXT, created_at DATETIME, updated_at DATETIME, delete_at DATETIME
	)`
	if err := gdb.Exec(ddl).Error; err != nil {
		t.Fatalf("ddl: %v", err)
	}
	db.Set("phytomni-server", gdb)
	return gdb
}

// AsyncTaskList must enforce cross-user list isolation: both the total from
// Count and the rows from the paged Find can only be the caller's own tasks —
// another user's tasks must never leak out.
func TestApiAsyncTaskList_ScopesToOwner(t *testing.T) {
	gdb := setupAsyncListDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, task_id, status, created_at) VALUES
		(1, 'dlg-a1', 0, 'alice', 't-a1', 'SUCCEEDED', '2026-01-01 00:00:00'),
		(2, 'dlg-a2', 0, 'alice', 't-a2', 'RUNNING',   '2026-01-01 00:01:00'),
		(3, 'dlg-b1', 0, 'bob',   't-b1', 'SUCCEEDED', '2026-01-01 00:02:00'),
		(4, 'dlg-b2', 0, 'bob',   't-b2', 'FAILED',    '2026-01-01 00:03:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	ps := NewService()
	list, total, _, err := ps.AsyncTaskList(context.Background(), "alice", 1, 10)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if total != 2 {
		t.Errorf("count must be scoped to alice (expected 2), got %d — cross-user count leak", total)
	}
	for _, v := range list {
		if v.UserName != "alice" {
			t.Errorf("cross-user list leak: alice's list returned id=%d owned by %q", v.Id, v.UserName)
		}
	}
	if len(list) != 2 {
		t.Errorf("expected exactly alice's 2 rows, got %d", len(list))
	}
}

// TestAsyncTaskListIncludesRunOnlyRemoteRow keeps the async surface anchored
// on the umbrella Bot run id. A modern remote row may have neither legacy
// server_id nor child task_id, but it must remain visible to its owner.
func TestAsyncTaskListIncludesRunOnlyRemoteRow(t *testing.T) {
	gdb := setupAsyncListDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, bot_run_id, task_id, server_id, status, created_at) VALUES
		(10, 'dlg-run-only', 0, 'alice', 'run-only', '', '', 'RUNNING', '2026-01-01 00:00:00'),
		(11, 'dlg-foreign', 0, 'bob', 'run-only', '', '', 'RUNNING', '2026-01-01 00:01:00'),
		(12, 'dlg-blank', 0, 'alice', '', '', '', 'RUNNING', '2026-01-01 00:02:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	list, total, _, err := NewService().AsyncTaskList(context.Background(), "alice", 1, 10)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if total != 1 || len(list) != 1 {
		t.Fatalf("run-only owner row missing: total=%d len=%d list=%+v", total, len(list), list)
	}
	if list[0].Id != 10 || list[0].UserName != "alice" {
		t.Fatalf("unexpected run-only row: %+v", list[0])
	}
}

// Parent dialogue enrichment must remain owner-scoped. A malformed child row
// pointing at another user's parent may stay in the owner's list, but it must
// not copy the foreign dialogue id into the response or fail the whole list.
func TestAsyncTaskListDoesNotEnrichFromForeignParent(t *testing.T) {
	gdb := setupAsyncListDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, task_id, status, created_at) VALUES
		(20, 'dlg-bob', 0, 'bob',   't-parent', 'SUCCEEDED', '2026-01-01 00:00:00'),
		(21, 'dlg-alice-child', 20, 'alice', 't-child', 'RUNNING', '2026-01-01 00:01:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	list, total, _, err := NewService().AsyncTaskList(context.Background(), "alice", 1, 10)
	if err != nil {
		t.Fatalf("foreign parent must not fail owner list: %v", err)
	}
	if total != 1 || len(list) != 1 {
		t.Fatalf("unexpected owner list: total=%d len=%d list=%+v", total, len(list), list)
	}
	if list[0].Id != 21 || list[0].FDialogueId != "" {
		t.Fatalf("foreign dialogue id leaked into task row: %+v", list[0])
	}
}
