package api_service

import (
	"context"
	"testing"
)

// AsyncTaskInfo must filter by owner: the auto-increment id is enumerable, so
// no authenticated user may read another user's task row (query/answer/task
// metadata) via someone else's id.
func TestApiAsyncTaskInfo_ScopesToOwner(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, task_id, status, created_at) VALUES
		(80, 'dlg-a', 0, 'alice', 't-a', 'SUCCEEDED', '2026-01-01 00:00:00'),
		(81, 'dlg-b', 0, 'bob',   't-b', 'SUCCEEDED', '2026-01-01 00:01:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	ps := NewService()

	// Cross-owner: alice queries bob's id=81 → must get nothing.
	if info, err := ps.AsyncTaskInfo(context.Background(), 81, "alice"); err == nil {
		t.Errorf("IDOR: alice fetched bob's task id=81 (user_name=%q)", info.UserName)
	}
	// Normal: alice queries her own id=80 → gets it.
	info, err := ps.AsyncTaskInfo(context.Background(), 80, "alice")
	if err != nil {
		t.Fatalf("owner should fetch own task, got %v", err)
	}
	if info.Id != 80 {
		t.Errorf("expected own task id=80, got %d", info.Id)
	}
}
