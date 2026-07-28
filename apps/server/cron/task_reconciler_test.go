package cron

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

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

func TestReconciler_CleansTombstonesAndStaleSubmissionsWithoutSyncingSubmitting(t *testing.T) {
	gdb := setupReconcilerDB(t)
	now := time.Now()
	const tombstoneDialogue = "77777777-7777-4777-8777-777777777777"
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, query, answer, tool_name, bot_run_id,
		 log_status, status, created_at, delete_at) VALUES
		(70, 'running-dialogue', 0, 'alice', 'q', 'pending', 'AnalystAgent', 'run-70',
		 '', 'RUNNING', ?, NULL),
		(71, 'stale-dialogue', 70, 'alice', 'q', '', 'ChatAgent', '',
		 '', 'SUBMITTING', ?, NULL),
		(72, 'fresh-dialogue', 70, 'alice', 'q', '', 'ChatAgent', '',
		 '', 'SUBMITTING', ?, NULL),
		(73, ?, 0, 'alice', 'q', 'answer', 'ChatAgent', '',
		 'CONTEXT_DELETE_PENDING', 'SUCCEEDED', ?, ?)`,
		now.Add(-time.Hour),
		now.Add(-10*time.Second),
		now.Add(-500*time.Millisecond),
		tombstoneDialogue,
		now.Add(-time.Hour),
		now.Add(-time.Minute),
	).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	var runCalls atomic.Int32
	var tombstoneCalls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost {
			var request rxBot.ContextTombstoneRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Fatalf("decode tombstone: %v", err)
			}
			if request.ConversationKey != tombstoneDialogue {
				t.Fatalf("tombstone conversation=%q", request.ConversationKey)
			}
			tombstoneCalls.Add(1)
			_, _ = w.Write([]byte(`{"schema_version":1,"state":"tombstoned","context_version":0}`))
			return
		}
		runCalls.Add(1)
		_, _ = w.Write([]byte(
			`{"run_id":"run-70","agent":"analyst","status":"succeeded","result":{"formatted":{"answer":"done"}}}`,
		))
	}))
	t.Cleanup(srv.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, MultiturnV1Enabled: true, TimeoutSeconds: 1,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	(&TaskReconciler{}).Run()

	statusByID := make(map[int]string)
	logStatusByID := make(map[int]string)
	for _, id := range []int{70, 71, 72, 73} {
		var status, logStatus string
		if err := gdb.Raw(
			`SELECT COALESCE(status, ''), COALESCE(log_status, '') FROM question_agent_logs WHERE id = ?`,
			id,
		).Row().Scan(&status, &logStatus); err != nil {
			t.Fatalf("read row %d: %v", id, err)
		}
		statusByID[id] = status
		logStatusByID[id] = logStatus
	}
	if statusByID[70] != "SUCCEEDED" {
		t.Fatalf("RUNNING row status=%q, want existing reconciliation to succeed", statusByID[70])
	}
	if statusByID[71] != "FAILED" || logStatusByID[71] != "stale_submission_timeout" {
		t.Fatalf("stale submission status=%q reason=%q", statusByID[71], logStatusByID[71])
	}
	if statusByID[72] != "SUBMITTING" {
		t.Fatalf("fresh submission status=%q, want SUBMITTING", statusByID[72])
	}
	if logStatusByID[73] != "CONTEXT_DELETE_ACKED" {
		t.Fatalf("tombstone status=%q, want ACKED", logStatusByID[73])
	}
	if runCalls.Load() != 1 {
		t.Fatalf("Bot run polls=%d, want only RUNNING row", runCalls.Load())
	}
	if tombstoneCalls.Load() != 1 {
		t.Fatalf("Bot tombstone calls=%d, want 1", tombstoneCalls.Load())
	}
}

func TestReconciler_TombstoneFailureDoesNotStopBatch(t *testing.T) {
	gdb := setupReconcilerDB(t)
	const firstDialogue = "88888888-8888-4888-8888-888888888888"
	const secondDialogue = "99999999-9999-4999-8999-999999999999"
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, log_status, status, created_at, delete_at) VALUES
		(80, ?, 0, 'alice', 'CONTEXT_DELETE_PENDING', 'SUCCEEDED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
		(81, ?, 0, 'alice', 'CONTEXT_DELETE_PENDING', 'SUCCEEDED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		firstDialogue,
		secondDialogue,
	).Error; err != nil {
		t.Fatalf("seed tombstones: %v", err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request rxBot.ContextTombstoneRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode tombstone: %v", err)
		}
		if request.ConversationKey == firstDialogue {
			http.Error(w, "temporary", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"schema_version":1,"state":"tombstoned","context_version":0}`))
	}))
	t.Cleanup(srv.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, MultiturnV1Enabled: true, TimeoutSeconds: 1,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	(&TaskReconciler{}).Run()

	var firstStatus, secondStatus string
	if err := gdb.Raw(`SELECT log_status FROM question_agent_logs WHERE id = 80`).
		Scan(&firstStatus).Error; err != nil {
		t.Fatalf("read failed tombstone: %v", err)
	}
	if err := gdb.Raw(`SELECT log_status FROM question_agent_logs WHERE id = 81`).
		Scan(&secondStatus).Error; err != nil {
		t.Fatalf("read successful tombstone: %v", err)
	}
	if firstStatus != "CONTEXT_DELETE_PENDING" {
		t.Fatalf("failed tombstone status=%q, want pending", firstStatus)
	}
	if secondStatus != "CONTEXT_DELETE_ACKED" {
		t.Fatalf("second tombstone status=%q, want ACKED", secondStatus)
	}
}
