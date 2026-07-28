package api_service

import (
	"context"
	"errors"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"phytomni-server/db"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

// setupQueryTestDB opens an in-memory SQLite with a question_agent_logs table
// whose columns match what resolveDialogue reads (id/user_name/dialogue_id/f_id).
// Hand-written DDL for the same reason as agent_task_test.go.
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

func TestQueryModeLockRejectsConflictingOwnerTurnBeforeAllocation(t *testing.T) {
	gdb := setupExpertTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, query, mode, status)
		VALUES (91, ?, 0, 'alice', 'root', 'instant', 'SUCCEEDED')`,
		ledgerTestDialogueID,
	).Error; err != nil {
		t.Fatalf("seed root: %v", err)
	}

	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		ProxyEnabled: true, ExpertEnabled: true, MultiturnV1Enabled: true,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	_, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "continue", Id: 91, Mode: "expert", ClientTurnID: "mode-lock-1",
	})
	if !errors.Is(err, ErrConversationModeConflict) {
		t.Fatalf("Query() error = %v, want mode conflict", err)
	}
	var count int64
	if err := gdb.Model(&model.QuestionAgentLog{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("row count = %d, want root only", count)
	}
}

// TestResolveDialogue_RefreshScopedToOwner pins refresh ownership isolation:
// alice must not refresh bob's row (the WHERE user_name=? clause in
// resolveDialogue collapses cross-owner access into ErrRecordNotFound).
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

// TestResolveDialogue_ThreadScopedToOwner pins threading ownership isolation:
// alice must not thread a child turn onto bob's parent (same user_name gate).
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

// TestResolveDialogue_OwnerThreadsOwnParent pins the happy path: an owner
// threading onto their own parent returns the parent's dialogue_id with f_id==in.Id.
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

// TestResolveDialogue_NewConversation pins the new-conversation path: Id=0/RefreshId=0
// generates a fresh dialogue_id with f_id=0.
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
