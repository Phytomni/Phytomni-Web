package api_service

import (
	"context"
	"testing"
)

// AsyncTaskInfo 必须按归属用户过滤:自增 id 可枚举,任意登录用户
// 不得用他人的 id 越权读取任务行(query/answer/任务元数据)。
func TestApiAsyncTaskInfo_ScopesToOwner(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO s_question_agent_logs
		(id, dialogue_id, f_id, user_name, task_id, status, created_at) VALUES
		(80, 'dlg-a', 0, 'alice', 't-a', 'SUCCEEDED', '2026-01-01 00:00:00'),
		(81, 'dlg-b', 0, 'bob',   't-b', 'SUCCEEDED', '2026-01-01 00:01:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	ps := NewService()

	// 越权:alice 用 bob 的 id=81 查询 → 必须拿不到。
	if info, err := ps.AsyncTaskInfo(context.Background(), 81, "alice"); err == nil {
		t.Errorf("IDOR: alice fetched bob's task id=81 (user_name=%q)", info.UserName)
	}
	// 正常:alice 查自己的 id=80 → 拿到。
	info, err := ps.AsyncTaskInfo(context.Background(), 80, "alice")
	if err != nil {
		t.Fatalf("owner should fetch own task, got %v", err)
	}
	if info.Id != 80 {
		t.Errorf("expected own task id=80, got %d", info.Id)
	}
}
