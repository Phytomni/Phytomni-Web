package api_service

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"phytomni-server/db"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

// setupExpertTestDB opens an in-memory SQLite with the columns Query writes,
// INCLUDING the new `mode` column. Pinned to 1 conn (write-then-read stability).
func setupExpertTestDB(t *testing.T) *gorm.DB {
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
		dialogue_id TEXT, f_id INTEGER DEFAULT 0, server_id TEXT, bot_run_id TEXT, bot_projection_json TEXT, bot_report_revision INTEGER NOT NULL DEFAULT -1,
		user_name TEXT, query TEXT, title_query TEXT, answer TEXT,
		follow_up_questions TEXT, task_id TEXT, task_log TEXT, file_name TEXT,
		upload_path TEXT, download_path TEXT, image_paths TEXT, compute_resource TEXT,
		server_file_path TEXT, tool_name TEXT, status TEXT, log_status TEXT, mode TEXT,
		reaction_type TEXT, collect_type TEXT, created_at DATETIME, updated_at DATETIME, delete_at DATETIME
	)`).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	db.Set("phytomni-server", gdb)
	return gdb
}

// botRouter returns an httptest Bot that records the hit path and answers the
// route + chat endpoints, so a test can assert which path Expert/Instant takes.
func botRouter(t *testing.T, hit *string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*hit = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/query/route":
			_, _ = w.Write([]byte(`{"id":"run-x","object":"agent.run","agent":"knowledge","status":"succeeded","task_ids":[],"result":{"formatted":{"answer":"body","references":[{"file_id":"f1","title":"Doc A"}]}}}`))
		case "/v1/chat/completions":
			_, _ = w.Write([]byte(`{"id":"c1","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"hi"}}],"formatted":{"answer":"hi"}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, ExpertEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })
}

// TestQuery_ExpertRoutesToRouteEndpoint is the slug-gate regression lock:
// mode=expert (flag ON) MUST hit /v1/query/route, never /v1/chat/completions
// (the SlugFor("")->"chat" collapse). Reshapes by the resolved slug and
// persists mode="expert".
func TestQuery_ExpertRoutesToRouteEndpoint(t *testing.T) {
	gdb := setupExpertTestDB(t)
	var hit string
	botRouter(t, &hit)

	out, err := NewService().Query(context.Background(), "alice", QueryInput{Query: "q", Mode: "expert"})
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	if hit != "/v1/query/route" {
		t.Fatalf("expert must hit /v1/query/route, hit %q (ChatAgent collapse?)", hit)
	}
	if out.ToolName != "KnowledgeAgent" {
		t.Errorf("expected resolved tool_name KnowledgeAgent, got %q", out.ToolName)
	}
	if !strings.Contains(out.Answer, "doc_list") || !strings.Contains(out.Answer, "Doc A") {
		t.Errorf("expert answer not reshaped by resolved slug: %q", out.Answer)
	}
	var mode string
	gdb.Raw(`SELECT COALESCE(mode,'') FROM question_agent_logs WHERE id=?`, out.Id).Row().Scan(&mode)
	if mode != "expert" {
		t.Errorf("expected persisted mode=expert, got %q", mode)
	}
}

// TestQuery_ExpertDisabledReturns503Sentinel: flag OFF -> ErrExpertDisabled, no Bot call.
func TestQuery_ExpertDisabledReturns503Sentinel(t *testing.T) {
	setupExpertTestDB(t)
	var hit string
	botRouter(t, &hit)
	rxBot.BotConfig.ExpertEnabled = false

	_, err := NewService().Query(context.Background(), "alice", QueryInput{Query: "q", Mode: "expert"})
	if !errors.Is(err, ErrExpertDisabled) {
		t.Fatalf("expected ErrExpertDisabled, got %v", err)
	}
	if hit != "" {
		t.Errorf("disabled Expert must not call Bot, hit %q", hit)
	}
}

// TestQuery_InstantUnchanged: mode=instant keeps the existing ChatAgent path.
func TestQuery_InstantUnchanged(t *testing.T) {
	setupExpertTestDB(t)
	var hit string
	botRouter(t, &hit)

	if _, err := NewService().Query(context.Background(), "alice", QueryInput{Query: "q", Mode: "instant"}); err != nil {
		t.Fatalf("Query: %v", err)
	}
	if hit != "/v1/chat/completions" {
		t.Errorf("instant must hit /v1/chat/completions, hit %q", hit)
	}
}

// TestQuery_RefreshClearsTaskColumns dynamically exercises the blocking Query
// path's RefreshId!=0 two-step UPDATE branch — the same branch QueryStream
// shares via persistQuestionLog. The streaming sibling test proves the shared
// helper clears the transitional task columns; this locks the blocking caller
// against a regression too (its byte-equivalence was otherwise only verified
// statically, since every other TestQuery_* uses the insert path).
func TestQuery_RefreshClearsTaskColumns(t *testing.T) {
	gdb := setupExpertTestDB(t)
	var hit string
	botRouter(t, &hit)

	// Seed a prior async-agent row with transitional task columns set.
	seed := model.QuestionAgentLog{
		DialogueId: "d1", UserName: "dan", Query: "old",
		ServerId: "srv-1", TaskId: "task-1", LogStatus: "RUNNING",
		ServerFilePath: "obs://old/path", Status: "RUNNING", Mode: "instant",
	}
	if err := gdb.Create(&seed).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	// Re-answer that turn via the blocking chat path (RefreshId points at it).
	out, err := NewService().Query(context.Background(), "dan",
		QueryInput{Query: "hi", RefreshId: seed.Id, Mode: "instant"})
	if err != nil {
		t.Fatalf("Query refresh: %v", err)
	}
	if out.Id != seed.Id {
		t.Fatalf("refresh must update in place: out.Id=%d, want %d", out.Id, seed.Id)
	}
	var serverID, taskID, logStatus, serverFilePath string
	row := gdb.Raw(`SELECT COALESCE(server_id,''), COALESCE(task_id,''), COALESCE(log_status,''), COALESCE(server_file_path,'') FROM question_agent_logs WHERE id=?`, seed.Id)
	if err := row.Row().Scan(&serverID, &taskID, &logStatus, &serverFilePath); err != nil {
		t.Fatalf("read task columns: %v", err)
	}
	if serverID != "" || taskID != "" || logStatus != "" || serverFilePath != "" {
		t.Fatalf("stale task columns not cleared: server_id=%q task_id=%q log_status=%q server_file_path=%q",
			serverID, taskID, logStatus, serverFilePath)
	}
}

// expertRouteServer returns an httptest Bot whose /v1/query/route answers with
// the supplied body, so a test can exercise the Expert RUNNING / dedup arms.
func expertRouteServer(t *testing.T, routeBody string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/query/route" {
			_, _ = w.Write([]byte(routeBody))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, ExpertEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })
}

// TestQuery_ExpertRunningArm covers the Expert async (non-"succeeded") arm: a
// "running" route response must persist Status=RUNNING with the run id and the
// task id from task_ids, and surface the task id in the answer.
func TestQuery_ExpertRunningArm(t *testing.T) {
	gdb := setupExpertTestDB(t)
	expertRouteServer(t, `{"id":"completion-async","run_id":"run-async","object":"agent.run","agent":"analyst","status":"running","task_ids":["task-async-1"],"result":{}}`)

	out, err := NewService().Query(context.Background(), "alice", QueryInput{Query: "q", Mode: "expert"})
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	if out.Status != "RUNNING" {
		t.Errorf("expected out.Status=RUNNING, got %q", out.Status)
	}
	if !strings.Contains(out.Answer, "task-async-1") {
		t.Errorf("expected answer to contain task-async-1, got %q", out.Answer)
	}
	var botRunID, taskID string
	gdb.Raw(`SELECT COALESCE(bot_run_id,''), COALESCE(task_id,'') FROM question_agent_logs WHERE id=?`, out.Id).
		Row().Scan(&botRunID, &taskID)
	if botRunID != "run-async" {
		t.Errorf("expected persisted bot_run_id=run-async, got %q", botRunID)
	}
	if taskID != "task-async-1" {
		t.Errorf("expected persisted task_id=task-async-1, got %q", taskID)
	}
}

// TestQuery_ExpertRunningArmDedupHit locks Finding C: a dedup-hit running
// response (task_ids empty, result.dedup_hit=true, result.task_id set) must
// resolve the task id from result.task_id. Without the DedupHit fallback the
// persisted task_id is "" and the row strands RUNNING forever.
func TestQuery_ExpertRunningArmDedupHit(t *testing.T) {
	gdb := setupExpertTestDB(t)
	expertRouteServer(t, `{"id":"completion-dedup","run_id":"run-dedup","object":"agent.run","agent":"analyst","status":"running","task_ids":[],"result":{"dedup_hit":true,"task_id":"dedup-77"}}`)

	out, err := NewService().Query(context.Background(), "alice", QueryInput{Query: "q", Mode: "expert"})
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	var taskID string
	gdb.Raw(`SELECT COALESCE(task_id,'') FROM question_agent_logs WHERE id=?`, out.Id).Row().Scan(&taskID)
	if taskID != "dedup-77" {
		t.Errorf("expected persisted task_id=dedup-77 (DedupHit fallback), got %q", taskID)
	}
}

// TestExpertModeEnabled_TracksBotConfig pins the UI flag source: it mirrors
// BotConfig.ExpertEnabled (single source of truth) — false when BotConfig is
// nil OR the flag is off, true only when ExpertEnabled is true.
func TestExpertModeEnabled_TracksBotConfig(t *testing.T) {
	// Register cleanup before mutating the global so it runs even if a future
	// regression panics on the nil path (mirrors botRouter's t.Cleanup idiom).
	t.Cleanup(func() { rxBot.BotConfig = nil })

	rxBot.BotConfig = nil
	if NewService().ExpertModeEnabled() {
		t.Error("nil BotConfig must report ExpertModeEnabled=false")
	}
	rxBot.BotConfig = &rxBot.Config{ExpertEnabled: false}
	if NewService().ExpertModeEnabled() {
		t.Error("ExpertEnabled=false must report ExpertModeEnabled=false")
	}
	rxBot.BotConfig = &rxBot.Config{ExpertEnabled: true}
	if !NewService().ExpertModeEnabled() {
		t.Error("ExpertModeEnabled must be true when BotConfig.ExpertEnabled=true")
	}
}
