package api_service

import (
	"context"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"phytomni-server/db"
)

// setupQueryTestDB 建 question_agent_logs 的 in-memory SQLite,列集对齐
// resolveDialogue 读取的 id/user_name/dialogue_id/f_id。手写 DDL 理由同 agent_task_test.go。
func setupQueryTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := gdb.Exec(`CREATE TABLE question_agent_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		dialogue_id TEXT,
		f_id INTEGER DEFAULT 0,
		user_name TEXT
	)`).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	db.Set("phytomni-server", gdb)
	return gdb
}

// TestResolveDialogue_RefreshScopedToOwner 钉死 refresh 归属隔离:alice 不能 refresh bob 的行
// (resolveDialogue 的 WHERE user_name = ? 把跨用户访问压成 ErrRecordNotFound)。
func TestResolveDialogue_RefreshScopedToOwner(t *testing.T) {
	gdb := setupQueryTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name) VALUES (1, 'dlg-bob', 0, 'bob')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	ps := NewService()
	_, _, err := ps.resolveDialogue(context.Background(), "alice", QueryInput{RefreshId: 1})
	if err == nil {
		t.Fatal("expected error: alice must not resolve bob's row via refresh")
	}
}

// TestResolveDialogue_ThreadScopedToOwner 钉死 threading 归属隔离:alice 不能把子轮挂到
// bob 的 parent 上(同一 user_name 闸)。
func TestResolveDialogue_ThreadScopedToOwner(t *testing.T) {
	gdb := setupQueryTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name) VALUES (1, 'dlg-bob', 0, 'bob')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	ps := NewService()
	_, _, err := ps.resolveDialogue(context.Background(), "alice", QueryInput{Id: 1})
	if err == nil {
		t.Fatal("expected error: alice must not thread onto bob's parent")
	}
}

// TestResolveDialogue_OwnerThreadsOwnParent 钉死正常路径:owner 挂到自己的 parent,
// 返回 parent 的 dialogue_id 且 f_id == in.Id。
func TestResolveDialogue_OwnerThreadsOwnParent(t *testing.T) {
	gdb := setupQueryTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name) VALUES (1, 'dlg-alice', 0, 'alice')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	ps := NewService()
	dlg, fID, err := ps.resolveDialogue(context.Background(), "alice", QueryInput{Id: 1})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if dlg != "dlg-alice" {
		t.Errorf("expected dialogue_id dlg-alice, got %q", dlg)
	}
	if fID != 1 {
		t.Errorf("expected f_id=1 (parent id), got %d", fID)
	}
}

// TestResolveDialogue_NewConversation 钉死新会话路径:Id=0/RefreshId=0 生成全新 dialogue_id、
// f_id=0。
func TestResolveDialogue_NewConversation(t *testing.T) {
	setupQueryTestDB(t)
	ps := NewService()
	dlg, fID, err := ps.resolveDialogue(context.Background(), "alice", QueryInput{})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if dlg == "" {
		t.Error("expected a fresh dialogue_id for a new conversation")
	}
	if fID != 0 {
		t.Errorf("expected f_id=0 for a new conversation, got %d", fID)
	}
}
