package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	rxBot "phytomni-server/external/bot"
)

// TestApiQueryAnalystUpdateLog_Disabled: with the gateway off, update-log syncs
// nothing and returns the typed ErrGatewayDisabled (handler maps it to 503).
func TestApiQueryAnalystUpdateLog_Disabled(t *testing.T) {
	setupTestDB(t)
	rxBot.BotConfig = nil
	ps := NewService()

	_, err := ps.QueryAnalystUpdateLog(context.Background(), "alice", "t-1", "cr-1")
	if !errors.Is(err, ErrGatewayDisabled) {
		t.Fatalf("want ErrGatewayDisabled, got %v", err)
	}
}

// TestApiQueryAnalystUpdateLog_MissingBotRunID: a row found by task_id but
// carrying no bot_run_id cannot be synced and errors out rather than calling Bot.
func TestApiQueryAnalystUpdateLog_MissingBotRunID(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, query, tool_name, task_id, bot_run_id, status, created_at) VALUES
		(60, 'alice', 'q', 'AnalystAgent', 't-norun', '', 'RUNNING', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	rxBot.BotConfig = &rxBot.Config{BaseURL: "http://127.0.0.1:0", ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })
	ps := NewService()

	_, err := ps.QueryAnalystUpdateLog(context.Background(), "alice", "t-norun", "cr-1")
	if err == nil || !strings.Contains(err.Error(), "no bot_run_id") {
		t.Fatalf("want a no-bot_run_id error, got %v", err)
	}
}

// TestApiQueryAnalystUpdateLog_HappyPath: a finished run's formatted answer is
// reshaped into the row, status uppercased, compute_resource/log_status set.
func TestApiQueryAnalystUpdateLog_HappyPath(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, query, answer, tool_name, task_id, bot_run_id, status, created_at) VALUES
		(61, 'alice', 'q', '任务创建成功：t-ok', 'AnalystAgent', 't-ok', 'run-ok', 'RUNNING', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	runRecordServer(t, `{"run_id":"run-ok","agent":"analyst","status":"succeeded","answer":"plain","result":{"formatted":{"answer":"report ready"}}}`)
	ps := NewService()

	answer, err := ps.QueryAnalystUpdateLog(context.Background(), "alice", "t-ok", "cr-1")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if answer != "report ready" {
		t.Errorf("returned answer = %q, want %q", answer, "report ready")
	}
	status, stored := readStatusAnswer(t, gdb, 61)
	if status != "SUCCEEDED" || stored != "report ready" {
		t.Errorf("row not updated, status=%q answer=%q", status, stored)
	}
}

// TestApiQueryAnalystUpdateLog_SkipsBlankStatus pins the blank-status guard: a
// run that comes back with an empty status must leave the prior status in place
// (writing ” would strand the row out of the cron's RUNNING poll set), while
// still applying the new answer.
func TestApiQueryAnalystUpdateLog_SkipsBlankStatus(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, query, answer, tool_name, task_id, bot_run_id, status, created_at) VALUES
		(62, 'alice', 'q', 'prior', 'AnalystAgent', 't-blank', 'run-blank', 'RUNNING', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	runRecordServer(t, `{"run_id":"run-blank","agent":"analyst","status":"","result":{"formatted":{"answer":"new answer"}}}`)
	ps := NewService()

	if _, err := ps.QueryAnalystUpdateLog(context.Background(), "alice", "t-blank", "cr-1"); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	status, stored := readStatusAnswer(t, gdb, 62)
	if status != "RUNNING" {
		t.Errorf("blank status should not overwrite, status = %q", status)
	}
	if stored != "new answer" {
		t.Errorf("answer should still update under a blank status, got %q", stored)
	}
}

// TestApiQueryAnalystUpdateLog_NoClobberAnswer pins the no-clobber guard: a
// completed run with no rendered answer (analyst, before Bot produces the
// formatted block) must leave the prior answer column untouched.
func TestApiQueryAnalystUpdateLog_NoClobberAnswer(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, query, answer, tool_name, task_id, bot_run_id, status, created_at) VALUES
		(63, 'alice', 'q', 'keep me', 'AnalystAgent', 't-noans', 'run-noans', 'RUNNING', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	runRecordServer(t, `{"run_id":"run-noans","agent":"analyst","status":"succeeded","answer":""}`)
	ps := NewService()

	answer, err := ps.QueryAnalystUpdateLog(context.Background(), "alice", "t-noans", "cr-1")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if answer != "" {
		t.Errorf("expected empty reshaped answer, got %q", answer)
	}
	status, stored := readStatusAnswer(t, gdb, 63)
	if status != "SUCCEEDED" {
		t.Errorf("status should advance to SUCCEEDED, got %q", status)
	}
	if stored != "keep me" {
		t.Errorf("prior answer must not be clobbered, got %q", stored)
	}
}

// TestApiQueryAnalystUpdateLog_WritesGalleryPaths: a finished analyst-class run
// (formatted envelope present) writes the representative output_dir into
// download_path and the flattened multi-directory image list into image_paths.
func TestApiQueryAnalystUpdateLog_WritesGalleryPaths(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, query, answer, tool_name, task_id, bot_run_id, status, created_at) VALUES
		(64, 'alice', 'q', '任务创建成功：t-g', 'AnalystAgent', 't-g', 'run-g', 'RUNNING', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	runRecordServer(t, `{"run_id":"run-g","agent":"network","status":"succeeded","result":{"formatted":{"answer":"done"},"artifacts":[{"task_id":"t1","output_dir":"/obs/p/r1","paths":["/obs/p/r1/a.png","/obs/p/r1/t.csv"]},{"task_id":"t2","output_dir":"/obs/p/r2","paths":["/obs/p/r2/b.png"]}]}}`)
	ps := NewService()

	if _, err := ps.QueryAnalystUpdateLog(context.Background(), "alice", "t-g", "cr-1"); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	dp, ip := readGalleryCols(t, gdb, 64)
	if dp != "/obs/p/r1" {
		t.Errorf("download_path = %q, want representative dir /obs/p/r1", dp)
	}
	var paths []string
	if err := json.Unmarshal([]byte(ip), &paths); err != nil {
		t.Fatalf("image_paths not JSON: %q (%v)", ip, err)
	}
	if len(paths) != 3 || paths[0] != "/obs/p/r1/a.png" || paths[2] != "/obs/p/r2/b.png" {
		t.Errorf("image_paths = %v", paths)
	}
}

// TestApiQueryAnalystUpdateLog_FinalReport pins the deep_genome read path on the
// async write-back: a finished run carrying result.final_report (no formatted
// envelope) reshapes through ShapeAnswer's cited family and lands in the row.
// Mutation: drop the `else if ParseRunFinalReport` branch in query.go and the
// answer stays the seeded placeholder (the report never surfaces) — this fails.
func TestApiQueryAnalystUpdateLog_FinalReport(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, query, answer, tool_name, task_id, bot_run_id, status, created_at) VALUES
		(66, 'alice', 'q', 'server任务创建成功：t-dg', 'DeepGenomeAgent', 't-dg', 'run-dg', 'RUNNING', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	runRecordServer(t, `{"run_id":"run-dg","agent":"deep_genome","status":"succeeded","result":{"final_report":"# Gene Report"}}`)
	ps := NewService()

	answer, err := ps.QueryAnalystUpdateLog(context.Background(), "alice", "t-dg", "cr-1")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !strings.Contains(answer, "Gene Report") || !strings.Contains(answer, "content") {
		t.Errorf("final_report not reshaped into cited JSON, got %q", answer)
	}
	status, stored := readStatusAnswer(t, gdb, 66)
	if status != "SUCCEEDED" {
		t.Errorf("status = %q, want SUCCEEDED", status)
	}
	if stored != answer {
		t.Errorf("stored answer %q != returned answer %q", stored, answer)
	}
}

// TestApiQueryAnalystUpdateLog_NoArtifactsNoClobber: a finished run with no
// artifacts must not wipe an already-populated download_path/image_paths.
func TestApiQueryAnalystUpdateLog_NoArtifactsNoClobber(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, query, answer, tool_name, task_id, bot_run_id, status, download_path, image_paths, created_at) VALUES
		(65, 'alice', 'q', 'prior', 'AnalystAgent', 't-na', 'run-na', 'RUNNING', '/obs/old', '["/obs/old/x.png"]', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	runRecordServer(t, `{"run_id":"run-na","agent":"network","status":"succeeded","result":{"formatted":{"answer":"done"}}}`)
	ps := NewService()

	if _, err := ps.QueryAnalystUpdateLog(context.Background(), "alice", "t-na", "cr-1"); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	dp, ip := readGalleryCols(t, gdb, 65)
	if dp != "/obs/old" || ip != `["/obs/old/x.png"]` {
		t.Errorf("no-artifacts run must not clobber gallery, got dp=%q ip=%q", dp, ip)
	}
}
