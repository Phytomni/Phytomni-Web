package api_service

import (
	"context"
	"testing"

	"phytomni-server/db"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// setupAsyncListDB 建含 ApiAsyncTaskListResponse 全部映射列的表。
// 最小 DDL 缺 task_log 等列会让 Find(&[]ApiAsyncTaskListResponse) 报 "no such column"。
func setupAsyncListDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if sqlDB, err := gdb.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	ddl := `CREATE TABLE s_question_agent_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		dialogue_id TEXT, f_id INTEGER DEFAULT 0, server_id TEXT,
		user_name TEXT, query TEXT, answer TEXT, task_id TEXT, task_log TEXT,
		file_name TEXT, upload_path TEXT, download_path TEXT, compute_resource TEXT,
		server_file_path TEXT, tool_name TEXT, status TEXT, log_status TEXT,
		reaction_type TEXT, created_at DATETIME, updated_at DATETIME, delete_at DATETIME
	)`
	if err := gdb.Exec(ddl).Error; err != nil {
		t.Fatalf("ddl: %v", err)
	}
	db.Set("nky_client_go", gdb)
	return gdb
}

// AsyncTaskList 必须做跨用户列表隔离:Count 返回的 total 与分页 Find 返回的行
// 都只能是调用者本人的任务,绝不能把别的用户的任务带出来。
func TestApiAsyncTaskList_ScopesToOwner(t *testing.T) {
	gdb := setupAsyncListDB(t)
	if err := gdb.Exec(`INSERT INTO s_question_agent_logs
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
