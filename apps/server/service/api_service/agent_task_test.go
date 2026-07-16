package api_service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"phytomni-server/db"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

// readStatusAnswer reads back a row's status+answer (COALESCE so a NULL column
// scans as "" instead of erroring) — used by the update-log / bot-sync tests
// that write then verify.
func readStatusAnswer(t *testing.T, gdb *gorm.DB, id int64) (status, answer string) {
	t.Helper()
	row := gdb.Raw(`SELECT COALESCE(status,''), COALESCE(answer,'') FROM question_agent_logs WHERE id = ?`, id).Row()
	if err := row.Scan(&status, &answer); err != nil {
		t.Fatalf("read row %d: %v", id, err)
	}
	return status, answer
}

// readGalleryCols reads back a row's download_path + image_paths (COALESCE so a
// NULL column scans as "") — used by the reconcile gallery-write tests.
func readGalleryCols(t *testing.T, gdb *gorm.DB, id int64) (downloadPath, imagePaths string) {
	t.Helper()
	row := gdb.Raw(`SELECT COALESCE(download_path,''), COALESCE(image_paths,'') FROM question_agent_logs WHERE id = ?`, id).Row()
	if err := row.Scan(&downloadPath, &imagePaths); err != nil {
		t.Fatalf("read gallery cols %d: %v", id, err)
	}
	return downloadPath, imagePaths
}

// setupTestDB opens an in-memory SQLite DB, creates the minimal question_agent_logs
// column set, registers it in the global db registry, and returns *gorm.DB for
// seeding test data.
//
// Hand-writing CREATE TABLE instead of AutoMigrate(QuestionAgentLog): the model
// carries several `type:enum` GORM tags (MySQL-only) that SQLite AutoMigrate does
// not recognise. The DDL includes only the columns read/written by the answer-check
// / update-log / bot-sync paths (id/user_name/dialogue_id/f_id/bot_run_id/status/
// answer + task_id/server_id/compute_resource/log_status/delete_at); all other
// fields scan as zero values.
//
// Connection pool pinned to 1: each :memory: connection is its own database; if a
// write and its verification read land on different connections the read returns
// nothing. update-log / bot-sync tests write then verify — single connection is
// the only way to make that stable.
func setupTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if sqlDB, err := gdb.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	ddl := `CREATE TABLE question_agent_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		dialogue_id TEXT,
		f_id INTEGER DEFAULT 0,
		user_name TEXT,
		query TEXT,
		answer TEXT,
		tool_name TEXT,
		bot_run_id TEXT,
		bot_projection_json TEXT,
		bot_report_revision INTEGER NOT NULL DEFAULT -1,
		server_id TEXT,
		task_id TEXT,
		task_log TEXT,
		title_query TEXT,
		follow_up_questions TEXT,
		file_name TEXT,
		upload_path TEXT,
		compute_resource TEXT,
		server_file_path TEXT,
		log_status TEXT,
		status TEXT,
		download_path TEXT,
		image_paths TEXT,
		reaction_type TEXT,
		collect_type TEXT,
		created_at DATETIME,
		updated_at DATETIME,
		delete_at DATETIME
	)`
	if err := gdb.Exec(ddl).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	db.Set("phytomni-server", gdb)
	return gdb
}

// TestApiAnswerCheck_NoHistory pins the F-001 fix core case: when there is no
// parent row, the function returns an empty list instead of a [empty_struct]
// single-element list. Without the fix: First() returned ErrRecordNotFound but
// QuestionAgentLog=&{Id:0} was still prepended, producing len(got)=1.
func TestApiAnswerCheck_NoHistory(t *testing.T) {
	setupTestDB(t)
	ps := NewService()

	got, err := ps.AnswerCheck(context.Background(), "alice", "dlg-nonexistent")

	if err != nil {
		t.Fatalf("expected nil err for missing dialogue, got %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected empty list for missing dialogue, got %d items: %+v", len(got), got)
	}
}

// TestApiAnswerCheck_HappyPath verifies the normal path: 1 parent + 2 children
// returns 3 rows with the parent at index 0.
func TestApiAnswerCheck_HappyPath(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, query, answer, created_at) VALUES
		(10, 'dlg-1',  0, 'alice', 'q1', 'a1', '2026-01-01 00:00:00'),
		(11, 'dlg-1', 10, 'alice', 'q2', 'a2', '2026-01-01 00:01:00'),
		(12, 'dlg-1', 10, 'alice', 'q3', 'a3', '2026-01-01 00:02:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	ps := NewService()
	got, err := ps.AnswerCheck(context.Background(), "alice", "dlg-1")

	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("expected 3 items (1 parent + 2 children), got %d", len(got))
	}
	if got[0].Id != 10 {
		t.Errorf("expected parent first (id=10), got id=%d", got[0].Id)
	}
	childIDs := map[int64]bool{got[1].Id: true, got[2].Id: true}
	if !childIDs[11] || !childIDs[12] {
		t.Errorf("expected children {11, 12}, got %v", childIDs)
	}
}

// TestApiAnswerCheck_DoesNotLeakParentsAcrossUsers pins the F-001 "f_id=0 false
// match" semantics: alice querying bob's dialogue must return zero rows, not leak
// bob's parent through the f_id=0 wildcard second query.
// Without the fix: alice/dlg-bob has no parent → First() ErrRecordNotFound →
// QuestionAgentLog.Id=0 → second query WHERE f_id=0 matched bob's parent (id=21,
// f_id=0) → 2 rows returned (empty parent + bob row).
func TestApiAnswerCheck_DoesNotLeakParentsAcrossUsers(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, created_at) VALUES
		(20, 'dlg-alice', 0, 'alice', '2026-01-01 00:00:00'),
		(21, 'dlg-bob',   0, 'bob',   '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	ps := NewService()
	// alice attempts to open bob's dialogue (cross-owner + missing-parent combined)
	got, err := ps.AnswerCheck(context.Background(), "alice", "dlg-bob")

	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected 0 items (alice has no parent in dlg-bob), got %d: %+v", len(got), got)
	}
}

// TestApiAnswerCheck_ScopesChildrenToOwner pins the child-row owner scope:
// even if a foreign child row points (via f_id) at the caller's own parent —
// the kind of cross-owner attachment a write bug or DB corruption could
// produce — the history read must filter children by user_name and never
// surface it. Mutation: drop `user_name = ?` from the child query and the
// foreign row leaks into the returned list (3 rows instead of 2).
func TestApiAnswerCheck_ScopesChildrenToOwner(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, query, answer, created_at) VALUES
		(70, 'dlg-x',  0, 'alice', 'q1',   'a1',   '2026-01-01 00:00:00'),
		(71, 'dlg-x', 70, 'alice', 'q2',   'a2',   '2026-01-01 00:01:00'),
		(72, 'dlg-x', 70, 'bob',   'leak', 'leak', '2026-01-01 00:02:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	ps := NewService()
	got, err := ps.AnswerCheck(context.Background(), "alice", "dlg-x")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected parent + alice child only (2 rows), got %d: %+v", len(got), got)
	}
	for _, r := range got {
		if r.UserName == "bob" || r.Id == 72 {
			t.Errorf("cross-owner child leaked into history: id=%d user=%q", r.Id, r.UserName)
		}
	}
}

// TestApiAnswerCheck_OverlayReshapesBotContent pins the activated read path:
// a knowledge row carrying a bot_run_id gets its answer reshaped into the
// {content, doc_list} JSON the Web app parses (sourced from the run's formatted
// envelope, not the flat answer), and its status uppercased.
func TestApiAnswerCheck_OverlayReshapesBotContent(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, query, answer, tool_name, bot_run_id, status, created_at) VALUES
		(30, 'dlg-k', 0, 'alice', 'q', 'stale', 'KnowledgeAgent', 'run-k', 'succeeded', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"object":"list","data":[{"run_id":"run-k","agent":"knowledge","status":"succeeded","tool_name":"KnowledgeAgent","query":"q","answer":"md body","result":{"formatted":{"answer":"md body","references":[{"file_id":"f1","title":"Doc A"}]}}}]}`))
	}))
	defer srv.Close()

	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	defer func() { rxBot.BotConfig = nil }()

	ps := NewService()
	got, err := ps.AnswerCheck(context.Background(), "alice", "dlg-k")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 row, got %d", len(got))
	}
	var parsed struct {
		Content string                   `json:"content"`
		DocList []map[string]interface{} `json:"doc_list"`
	}
	if err := json.Unmarshal([]byte(got[0].Answer), &parsed); err != nil {
		t.Fatalf("overlay answer not reshaped to JSON: %q (%v)", got[0].Answer, err)
	}
	if parsed.Content != "md body" || len(parsed.DocList) != 1 || parsed.DocList[0]["title"] != "Doc A" {
		t.Errorf("reshaped answer wrong: %s", got[0].Answer)
	}
	if got[0].Status != "SUCCEEDED" {
		t.Errorf("status not uppercased, got %q", got[0].Status)
	}
}

// TestApiAnswerCheck_OverlayReshapesFinalReport pins the deep_genome read path
// on the history overlay: a row carrying a bot_run_id whose run finished with
// result.final_report (no formatted envelope) gets its answer reshaped through
// ShapeAnswer's cited family. Mutation: drop the `else if ParseRunFinalReport`
// branch in overlayBotContent and the answer stays the stale seeded value.
func TestApiAnswerCheck_OverlayReshapesFinalReport(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, query, answer, tool_name, bot_run_id, status, created_at) VALUES
		(31, 'dlg-dg', 0, 'alice', 'q', 'stale', 'DeepGenomeAgent', 'run-dg', 'succeeded', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"object":"list","data":[{"run_id":"run-dg","agent":"deep_genome","status":"succeeded","tool_name":"DeepGenomeAgent","query":"q","result":{"final_report":"# Gene Report"}}]}`))
	}))
	defer srv.Close()

	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	defer func() { rxBot.BotConfig = nil }()

	ps := NewService()
	got, err := ps.AnswerCheck(context.Background(), "alice", "dlg-dg")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 row, got %d", len(got))
	}
	if !strings.Contains(got[0].Answer, "Gene Report") || !strings.Contains(got[0].Answer, "content") {
		t.Errorf("final_report not reshaped in overlay, got %q", got[0].Answer)
	}
}

// TestApiAnswerCheck_OverlayDegradesOnBot500 pins TW-001: when the Bot
// /v1/runs read fails (HTTP 500), overlayBotContent must degrade — keep the
// legacy MySQL fields, surface no error, and never panic — even though the
// failure is logged as a warn for observability.
func TestApiAnswerCheck_OverlayDegradesOnBot500(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, query, answer, tool_name, bot_run_id, status, created_at) VALUES
		(40, 'dlg-e', 0, 'alice', 'legacy-q', 'legacy-a', 'KnowledgeAgent', 'run-e', 'RUNNING', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"boom"}`))
	}))
	defer srv.Close()

	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	defer func() { rxBot.BotConfig = nil }()

	ps := NewService()
	got, err := ps.AnswerCheck(context.Background(), "alice", "dlg-e")
	if err != nil {
		t.Fatalf("expected nil err on Bot 500 (degrade), got %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 row, got %d", len(got))
	}
	if got[0].Answer != "legacy-a" || got[0].Query != "legacy-q" {
		t.Errorf("expected legacy fields preserved on Bot 500, got query=%q answer=%q", got[0].Query, got[0].Answer)
	}
	if got[0].Status != "RUNNING" {
		t.Errorf("expected legacy status preserved on Bot 500, got %q", got[0].Status)
	}
}

// runRecordServer returns an httptest server answering GET /v1/runs/{id} with a
// single RunRecord JSON body, and points BotConfig at it for the test.
func runRecordServer(t *testing.T, body string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })
}

// TestSyncBotRuns_WritesReportAndStatusOnChange: a RUNNING deep_genome row whose
// Bot run has finished gets its status flipped and the assembled final_report
// reshaped into the {content, doc_list} JSON the Web app parses.
func TestSyncBotRuns_WritesReportAndStatusOnChange(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, user_name, query, answer, tool_name, bot_run_id, status, created_at) VALUES
		(50, 'dlg-d', 'alice', 'q', 'Server task created: t1', 'DeepGenomeAgent', 'run-d', 'RUNNING', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	runRecordServer(t, `{"run_id":"run-d","agent":"deep_genome","status":"succeeded","result":{"final_report":"# Gene Report"}}`)

	SyncBotRuns([]model.QuestionAgentLog{{Id: 50, BotRunId: "run-d", Status: "RUNNING", ToolName: "DeepGenomeAgent"}})

	status, answer := readStatusAnswer(t, gdb, 50)
	if status != "SUCCEEDED" {
		t.Errorf("status = %q, want SUCCEEDED", status)
	}
	if !strings.Contains(answer, "Gene Report") || !strings.Contains(answer, "content") {
		t.Errorf("answer not reshaped final_report JSON: %q", answer)
	}
	if dp, ip := readGalleryCols(t, gdb, 50); dp != "" || ip != "" {
		t.Errorf("deep_genome must not write gallery cols, got dp=%q ip=%q", dp, ip)
	}
}

// TestSyncBotRuns_SkipsBlankStatus pins the blank-status guard: a Bot run that
// comes back with an empty status must NOT be written (an empty status would be
// persisted verbatim by GORM's map Updates and strand the row out of the cron's
// WHERE status='RUNNING' poll set). The whole row stays untouched.
func TestSyncBotRuns_SkipsBlankStatus(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, user_name, query, answer, tool_name, bot_run_id, status, created_at) VALUES
		(51, 'dlg-e', 'alice', 'q', 'prior', 'DeepGenomeAgent', 'run-e', 'RUNNING', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	runRecordServer(t, `{"run_id":"run-e","agent":"deep_genome","status":"","result":{"final_report":"# X"}}`)

	SyncBotRuns([]model.QuestionAgentLog{{Id: 51, BotRunId: "run-e", Status: "RUNNING", ToolName: "DeepGenomeAgent"}})

	status, answer := readStatusAnswer(t, gdb, 51)
	if status != "RUNNING" || answer != "prior" {
		t.Errorf("blank status should skip all writes, got status=%q answer=%q", status, answer)
	}
}

// TestSyncBotRuns_DisabledIsNoOp: with the gateway off, the cron reconciler is
// a no-op and never touches the row (or panics on a nil client).
func TestSyncBotRuns_DisabledIsNoOp(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, user_name, query, tool_name, bot_run_id, status, created_at) VALUES
		(52, 'dlg-f', 'alice', 'q', 'DeepGenomeAgent', 'run-f', 'RUNNING', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	rxBot.BotConfig = nil // gateway disabled

	SyncBotRuns([]model.QuestionAgentLog{{Id: 52, BotRunId: "run-f", Status: "RUNNING", ToolName: "DeepGenomeAgent"}})

	if status, _ := readStatusAnswer(t, gdb, 52); status != "RUNNING" {
		t.Errorf("disabled gateway should not touch the row, status = %q", status)
	}
}

// TestSyncBotRuns_SkipsEmptyRunID pins the empty-run-id guard. Asserting only on
// the row's final status is vacuous: a removed guard would call GetRun("") and,
// whether that fails or succeeds, could land on the same status. So this asserts
// the discriminator directly — Bot is never hit (a reachable counting server
// stays at 0). The server also returns a finished run, so a removed guard would
// additionally flip the row to SUCCEEDED, giving a second red signal.
func TestSyncBotRuns_SkipsEmptyRunID(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, user_name, query, tool_name, bot_run_id, status, created_at) VALUES
		(53, 'dlg-g', 'alice', 'q', 'DeepGenomeAgent', '', 'RUNNING', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	var hits atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"run_id":"","agent":"deep_genome","status":"succeeded","result":{"final_report":"# leaked"}}`))
	}))
	defer srv.Close()
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	SyncBotRuns([]model.QuestionAgentLog{{Id: 53, BotRunId: "", Status: "RUNNING", ToolName: "DeepGenomeAgent"}})

	if n := hits.Load(); n != 0 {
		t.Errorf("empty run id must never call Bot, got %d request(s)", n)
	}
	if status, _ := readStatusAnswer(t, gdb, 53); status != "RUNNING" {
		t.Errorf("empty run id row must stay RUNNING, got %q", status)
	}
}

// TestSyncBotRuns_AnalystWritesAnswerAndGallery: a RUNNING analyst-class row
// whose Bot run finished gets its status flipped, its formatted answer written
// (passed through ShapeAnswer's default as plain markdown), and its gallery
// columns populated from result.artifacts.
func TestSyncBotRuns_AnalystWritesAnswerAndGallery(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, user_name, query, answer, tool_name, bot_run_id, status, created_at) VALUES
		(54, 'dlg-a', 'alice', 'q', 'Task created: t1', 'AnalystAgent', 'run-a', 'RUNNING', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	runRecordServer(t, `{"run_id":"run-a","agent":"network","status":"succeeded","result":{"formatted":{"answer":"analysis done"},"artifacts":[{"task_id":"t1","output_dir":"/obs/p/r1","paths":["/obs/p/r1/a.png"]}]}}`)

	SyncBotRuns([]model.QuestionAgentLog{{Id: 54, BotRunId: "run-a", Status: "RUNNING", ToolName: "AnalystAgent"}})

	status, answer := readStatusAnswer(t, gdb, 54)
	if status != "SUCCEEDED" || answer != "analysis done" {
		t.Errorf("status=%q answer=%q, want SUCCEEDED / analysis done", status, answer)
	}
	dp, ip := readGalleryCols(t, gdb, 54)
	if dp != "/obs/p/r1" {
		t.Errorf("download_path = %q, want /obs/p/r1", dp)
	}
	var paths []string
	if err := json.Unmarshal([]byte(ip), &paths); err != nil || len(paths) != 1 || paths[0] != "/obs/p/r1/a.png" {
		t.Errorf("image_paths = %q (%v)", ip, err)
	}
}

// TestAsyncTaskList_ZeroPageSizeNoPanic: the handler reads pagination query
// params via strconv.Atoi, defaulting to 0 when absent. size=0 used to make the
// totalPages (total+size-1)/size expression integer-divide-by-zero panic (gin
// Recovery turned it into 500). The normalization guard must fall back to sane
// defaults and return a normal page instead of panicking.
func TestAsyncTaskList_ZeroPageSizeNoPanic(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, dialogue_id, status, server_id, created_at) VALUES
		(1, 'alice', 'd1', 'SUCCEEDED', 'srv-1', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	ps := NewService()

	// size=0, current=0 — old code panicked here; the guard normalizes and returns.
	list, total, totalPages, err := ps.AsyncTaskList(context.Background(), "alice", 0, 0)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if total != 1 {
		t.Fatalf("expected total=1, got %d", total)
	}
	if totalPages != 1 {
		t.Fatalf("expected totalPages=1, got %d", totalPages)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 row, got %d", len(list))
	}
}
