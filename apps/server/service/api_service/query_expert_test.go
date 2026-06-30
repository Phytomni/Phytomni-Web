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
		dialogue_id TEXT, f_id INTEGER DEFAULT 0, server_id TEXT, bot_run_id TEXT,
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
