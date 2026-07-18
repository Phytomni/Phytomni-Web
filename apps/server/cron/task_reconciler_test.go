package cron

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"phytomni-server/db"
	rxBot "phytomni-server/external/bot"
)

// setupReconcilerDB builds an in-memory question_agent_logs and registers it as
// the default connection (mirrors the api_service test schema). Conn pool pinned
// to 1: each :memory: connection is its own DB, so write-then-read must reuse one.
func setupReconcilerDB(t *testing.T) *gorm.DB {
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
		dialogue_id TEXT, f_id INTEGER DEFAULT 0, user_name TEXT, query TEXT,
		answer TEXT, tool_name TEXT, bot_run_id TEXT, server_id TEXT, task_id TEXT,
		bot_projection_json TEXT, bot_report_revision INTEGER DEFAULT -1,
		compute_resource TEXT, log_status TEXT, status TEXT,
		download_path TEXT, image_paths TEXT,
		created_at DATETIME, updated_at DATETIME, delete_at DATETIME
	)`).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	db.Set("phytomni-server", gdb)
	return gdb
}

// TestReconciler_RoutesRunningRowToBot pins the post-EIHealth routing: the cron
// reconciles a RUNNING analyst-class row against its Bot run, not a dead Huawei
// poll. Before the routing switch this row went to the EIHealth IAM poll and
// stayed RUNNING; now Run() hands every RUNNING row to SyncBotRuns, so a finished
// Bot run flips it to SUCCEEDED and writes the formatted answer.
func TestReconciler_RoutesRunningRowToBot(t *testing.T) {
	gdb := setupReconcilerDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, user_name, query, answer, tool_name, bot_run_id, status, created_at) VALUES
		(60, 'dlg-r', 'alice', 'q', 'Task created: t1', 'AnalystAgent', 'run-r', 'RUNNING', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"run_id":"run-r","agent":"network","status":"succeeded","result":{"formatted":{"answer":"done"}}}`))
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	(&TaskReconciler{}).Run()

	var status, answer string
	row := gdb.Raw(`SELECT COALESCE(status,''), COALESCE(answer,'') FROM question_agent_logs WHERE id = 60`).Row()
	if err := row.Scan(&status, &answer); err != nil {
		t.Fatalf("read row: %v", err)
	}
	if status != "SUCCEEDED" || answer != "done" {
		t.Errorf("cron did not reconcile analyst via Bot: status=%q answer=%q, want SUCCEEDED/done", status, answer)
	}
}
