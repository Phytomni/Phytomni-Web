package api_service

import (
	"context"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"phytomni-server/db"
	"phytomni-server/model"
)

func setupAbandonSubmissionDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if sqlDB, err := gdb.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	if err := gdb.Exec(`CREATE TABLE question_agent_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		dialogue_id TEXT, f_id INTEGER DEFAULT 0, server_id TEXT, bot_run_id TEXT,
		bot_projection_json TEXT, bot_report_revision INTEGER NOT NULL DEFAULT -1,
		user_name TEXT, query TEXT, title_query TEXT, answer TEXT,
		follow_up_questions TEXT, task_id TEXT, task_log TEXT, file_name TEXT,
		upload_path TEXT, download_path TEXT, image_paths TEXT, compute_resource TEXT,
		server_file_path TEXT, tool_name TEXT, status TEXT, log_status TEXT, mode TEXT,
		reaction_type TEXT, collect_type TEXT, created_at DATETIME, updated_at DATETIME, delete_at DATETIME
	)`).Error; err != nil {
		t.Fatalf("create question_agent_logs: %v", err)
	}
	db.Set("phytomni-server", gdb)
	return gdb
}

func TestAbandonUnstartedV1SubmissionHidesRowFromList(t *testing.T) {
	gdb := setupAbandonSubmissionDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs (
		dialogue_id, f_id, user_name, query, title_query, answer, follow_up_questions,
		task_id, task_log, tool_name, status, log_status, mode, reaction_type, collect_type
	) VALUES ('dlg-unstarted', 0, 'alice@example.com', 'q', 'q', '', '', '', '', 'ChatAgent', 'SUBMITTING', '', 'instant', '0', '0')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	var id int64
	if err := gdb.Raw(`SELECT id FROM question_agent_logs`).Scan(&id).Error; err != nil || id < 1 {
		t.Fatalf("id=%d err=%v", id, err)
	}
	if err := abandonUnstartedV1Submission(context.Background(), "alice@example.com", id); err != nil {
		t.Fatalf("abandon: %v", err)
	}
	var visible int64
	if err := gdb.Model(&model.QuestionAgentLog{}).Where("delete_at IS NULL").Count(&visible).Error; err != nil {
		t.Fatalf("count visible: %v", err)
	}
	if visible != 0 {
		t.Fatalf("visible rows=%d, want 0 after abandon", visible)
	}
}

func TestAbandonUnstartedV1SubmissionLeavesStartedRunFailed(t *testing.T) {
	gdb := setupAbandonSubmissionDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs (
		dialogue_id, f_id, bot_run_id, user_name, query, title_query, answer, follow_up_questions,
		task_id, task_log, tool_name, status, log_status, mode, reaction_type, collect_type
	) VALUES ('dlg-started', 0, 'run_real', 'alice@example.com', 'q', 'q', '', '', '', '', 'ChatAgent', 'RUNNING', '', 'instant', '0', '0')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	var id int64
	if err := gdb.Raw(`SELECT id FROM question_agent_logs`).Scan(&id).Error; err != nil || id < 1 {
		t.Fatalf("id=%d err=%v", id, err)
	}
	if err := abandonUnstartedV1Submission(context.Background(), "alice@example.com", id); err != nil {
		t.Fatalf("abandon: %v", err)
	}
	var row model.QuestionAgentLog
	if err := gdb.Where("id = ?", id).Take(&row).Error; err != nil {
		t.Fatalf("load: %v", err)
	}
	if row.DeleteAt != nil {
		t.Fatalf("started run must stay listed, delete_at=%v", row.DeleteAt)
	}
	if row.Status != "FAILED" {
		t.Fatalf("status=%q, want FAILED", row.Status)
	}
}
