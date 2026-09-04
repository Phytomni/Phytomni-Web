package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/spf13/viper"
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
// answer + task_id/server_id/compute_resource/log_status/mode/delete_at); all
// other fields scan as zero values.
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
		mode TEXT,
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

func TestQueryList_EmptyResultIsJSONArray(t *testing.T) {
	setupTestDB(t)

	got, err := NewService().QueryList(context.Background(), "alice")
	if err != nil {
		t.Fatalf("QueryList returned error: %v", err)
	}
	if got == nil {
		t.Fatal("QueryList returned nil slice")
	}
	encoded, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal QueryList result: %v", err)
	}
	if string(encoded) != "[]" {
		t.Fatalf("QueryList JSON = %s, want []", encoded)
	}
}

func TestQueryCollectList_EmptyResultIsJSONArray(t *testing.T) {
	setupTestDB(t)

	got, err := NewService().QueryCollectList(context.Background(), "alice")
	if err != nil {
		t.Fatalf("QueryCollectList returned error: %v", err)
	}
	if got == nil {
		t.Fatal("QueryCollectList returned nil slice")
	}
	encoded, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal QueryCollectList result: %v", err)
	}
	if string(encoded) != "[]" {
		t.Fatalf("QueryCollectList JSON = %s, want []", encoded)
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

func TestAnswerCheckReturnsOwnerScopedAttachmentReferences(t *testing.T) {
	gdb := setupTestDB(t)
	refs := []rxBot.AssetAttachmentRef{{AssetID: "file_alice_reads"}, {AssetID: "file_alice_variants"}}
	private := persistedConversationContext{InputAttachments: refs}
	raw, err := marshalPersistedProjectionWithContext(BotRunProjection{}, &private)
	if err != nil {
		t.Fatal(err)
	}
	if err := gdb.Create(&model.QuestionAgentLog{
		Id: 73, DialogueId: "dlg-attachments", UserName: "alice",
		Query: "alice query", Status: statusSucceeded, BotProjectionJSON: raw,
		BotReportRevision: -1,
	}).Error; err != nil {
		t.Fatal(err)
	}
	rows, err := NewService().AnswerCheck(context.Background(), "alice", "dlg-attachments")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || len(rows[0].Attachments) != len(refs) ||
		rows[0].Attachments[0].AssetID != refs[0].AssetID ||
		rows[0].Attachments[1].AssetID != refs[1].AssetID {
		t.Fatalf("alice history attachments=%#v, want %#v", rows, refs)
	}

	foreign, err := NewService().AnswerCheck(context.Background(), "bob", "dlg-attachments")
	if err != nil {
		t.Fatal(err)
	}
	if len(foreign) != 0 {
		t.Fatalf("bob history enumerated Alice's attachment row: %#v", foreign)
	}
	missing, err := NewService().AnswerCheck(context.Background(), "mallory", "dlg-attachments")
	if err != nil {
		t.Fatal(err)
	}
	if len(missing) != 0 {
		t.Fatalf("foreign history enumerated attachment rows: %#v", missing)
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

// TestAnswerCheckPrefersProjectionAndFallsBackToLegacy verifies that history
// can render a persisted bounded projection without polling Bot, while rows
// without one retain their Web-owned legacy answer and reaction fields.
func TestAnswerCheckPrefersProjectionAndFallsBackToLegacy(t *testing.T) {
	gdb := setupTestDB(t)
	projection := BotRunProjection{
		RunID:              "run-projected",
		Agent:              "deep_genome",
		Status:             "SUCCEEDED",
		ReportRevision:     4,
		ReportCompleteness: "complete",
		FinalReport:        "# Projected report",
	}
	encoded, err := marshalPersistedProjection(projection)
	if err != nil {
		t.Fatalf("marshal projection: %v", err)
	}
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, query, answer, tool_name, bot_run_id, bot_projection_json, bot_report_revision, status, reaction_type, upload_path, created_at) VALUES
		(100, 'dlg-projection', 0, 'alice', 'projected-q', 'legacy-projected', 'DeepGenomeAgent', 'run-projected', ?, 4, 'RUNNING', '2', '/upload/projected', '2026-01-01 00:00:00'),
		(101, 'dlg-projection', 100, 'alice', 'legacy-q', 'legacy-a', 'ChatAgent', '', '', -1, 'SUCCEEDED', '1', '/upload/legacy', '2026-01-01 00:01:00'),
		(102, 'dlg-projection', 100, 'bob', 'foreign-q', 'foreign-a', 'ChatAgent', 'run-projected', ?, 4, 'SUCCEEDED', '0', '/upload/foreign', '2026-01-01 00:02:00')`, encoded, encoded).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	got, err := NewService().AnswerCheck(context.Background(), "alice", "dlg-projection")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected owned parent + child, got %d: %+v", len(got), got)
	}
	if got[0].Id != 100 || !strings.Contains(got[0].Answer, "Projected report") || got[0].Status != "SUCCEEDED" {
		t.Fatalf("projection was not preferred: %+v", got[0])
	}
	if got[0].ReactionType != "2" || got[0].UploadPath != "/upload/projected" {
		t.Fatalf("Web-owned fields changed: reaction=%q upload=%q", got[0].ReactionType, got[0].UploadPath)
	}
	if got[1].Answer != "legacy-a" || got[1].ReactionType != "1" || got[1].UploadPath != "/upload/legacy" {
		t.Fatalf("legacy fallback changed: %+v", got[1])
	}
	for _, row := range got {
		if row.UserName != "alice" || row.Id == 102 {
			t.Fatalf("foreign projection row leaked: %+v", row)
		}
	}
}

func useOfflineLegacyHistoryMode(t *testing.T) {
	t.Helper()
	previousBotConfig := rxBot.BotConfig
	previousDualRead := viper.Get("bot.history_dual_read")
	rxBot.BotConfig = nil
	viper.Set("bot.history_dual_read", false)
	t.Cleanup(func() {
		rxBot.BotConfig = previousBotConfig
		viper.Set("bot.history_dual_read", previousDualRead)
	})
}

func TestAnswerCheckPreservesReviewReferencesWhenProjectionContentMatches(t *testing.T) {
	gdb := setupTestDB(t)
	useOfflineLegacyHistoryMode(t)

	const report = "# Durable Review\n\nCitation-backed synthesis."
	durableAnswer, err := json.Marshal(map[string]interface{}{
		"content": report,
		"doc_list": []map[string]interface{}{
			{
				"title": "Reference One",
				"di":    "10.1000/review.1",
				"dl":    "https://example.test/review-1",
			},
		},
	})
	if err != nil {
		t.Fatalf("marshal durable answer: %v", err)
	}
	projection, err := marshalPersistedProjection(BotRunProjection{
		RunID:          "run-review-durable",
		Agent:          "review",
		Status:         "SUCCEEDED",
		ReportRevision: 3,
		FinalReport:    report,
	})
	if err != nil {
		t.Fatalf("marshal projection: %v", err)
	}
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, query, answer, tool_name, bot_run_id, bot_projection_json, bot_report_revision, status, created_at) VALUES
		(103, 'dlg-review-durable', 0, 'alice', 'review-q', ?, 'ChatAgent', 'run-review-durable', ?, 3, 'RUNNING', '2026-01-01 00:00:00')`, string(durableAnswer), projection).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	got, err := NewService().AnswerCheck(context.Background(), "alice", "dlg-review-durable")
	if err != nil {
		t.Fatalf("AnswerCheck: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("rows=%d, want 1", len(got))
	}
	var answer struct {
		Content string `json:"content"`
		DocList []struct {
			Title string `json:"title"`
			DI    string `json:"di"`
			DL    string `json:"dl"`
		} `json:"doc_list"`
	}
	if err := json.Unmarshal([]byte(got[0].Answer), &answer); err != nil {
		t.Fatalf("decode answer: %v", err)
	}
	if answer.Content != report {
		t.Fatalf("content=%q, want %q", answer.Content, report)
	}
	if len(answer.DocList) != 1 || answer.DocList[0].Title != "Reference One" ||
		answer.DocList[0].DI != "10.1000/review.1" || answer.DocList[0].DL != "https://example.test/review-1" {
		t.Fatalf("doc_list=%#v, want durable reference", answer.DocList)
	}
	if got[0].Status != "SUCCEEDED" || got[0].ToolName != "ReviewAgent" {
		t.Fatalf("projection status/tool not authoritative: status=%q tool=%q", got[0].Status, got[0].ToolName)
	}
}

func TestAnswerCheckReviewProjectionReplacesStaleOrMalformedAnswer(t *testing.T) {
	staleAnswer, err := json.Marshal(map[string]interface{}{
		"content": "# Stale Review",
		"doc_list": []map[string]interface{}{
			{"title": "Stale Reference"},
		},
	})
	if err != nil {
		t.Fatalf("marshal stale answer: %v", err)
	}
	projection, err := marshalPersistedProjection(BotRunProjection{
		RunID:          "run-review-fresh",
		Agent:          "review",
		Status:         "SUCCEEDED",
		ReportRevision: 4,
		FinalReport:    "# Fresh Review",
	})
	if err != nil {
		t.Fatalf("marshal projection: %v", err)
	}
	emptyReferencesAnswer := `{"content":"# Fresh Review","doc_list":[],"marker":"must-be-replaced"}`

	for _, tc := range []struct {
		name   string
		answer string
	}{
		{name: "stale shaped answer", answer: string(staleAnswer)},
		{name: "malformed answer", answer: "{not-json"},
		{name: "matching content with empty references", answer: emptyReferencesAnswer},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupTestDB(t)
			useOfflineLegacyHistoryMode(t)
			if err := gdb.Exec(`INSERT INTO question_agent_logs
				(id, dialogue_id, f_id, user_name, query, answer, tool_name, bot_run_id, bot_projection_json, bot_report_revision, status, created_at) VALUES
				(104, 'dlg-review-fresh', 0, 'alice', 'review-q', ?, 'ChatAgent', 'run-review-fresh', ?, 4, 'RUNNING', '2026-01-01 00:00:00')`, tc.answer, projection).Error; err != nil {
				t.Fatalf("seed: %v", err)
			}

			got, err := NewService().AnswerCheck(context.Background(), "alice", "dlg-review-fresh")
			if err != nil {
				t.Fatalf("AnswerCheck: %v", err)
			}
			if len(got) != 1 {
				t.Fatalf("rows=%d, want 1", len(got))
			}
			var answer struct {
				Content string            `json:"content"`
				DocList []json.RawMessage `json:"doc_list"`
			}
			if err := json.Unmarshal([]byte(got[0].Answer), &answer); err != nil {
				t.Fatalf("decode answer: %v", err)
			}
			if answer.Content != "# Fresh Review" || len(answer.DocList) != 0 {
				t.Fatalf("answer=%#v, want fresh projection content without legacy references", answer)
			}
			if strings.Contains(got[0].Answer, "must-be-replaced") {
				t.Fatalf("answer retained durable marker without references: %s", got[0].Answer)
			}
		})
	}
}

func historyObservationCount(t *testing.T, source string) uint64 {
	t.Helper()
	for _, observation := range HistoryReadObservations() {
		if observation.Source == source {
			return observation.Count
		}
	}
	t.Fatalf("missing history observation source %q", source)
	return 0
}

func TestHistoryReadModeFromConfigDefaultsOff(t *testing.T) {
	previous := viper.Get("bot.history_dual_read")
	t.Cleanup(func() { viper.Set("bot.history_dual_read", previous) })

	viper.Set("bot.history_dual_read", false)
	if got := HistoryReadModeFromConfig(); got != HistoryReadModeLegacy {
		t.Fatalf("flag-off history mode=%q, want %q", got, HistoryReadModeLegacy)
	}
	viper.Set("bot.history_dual_read", true)
	if got := HistoryReadModeFromConfig(); got != HistoryReadModeDual {
		t.Fatalf("flag-on history mode=%q, want %q", got, HistoryReadModeDual)
	}
}

// TestAnswerCheckDualReadRecordsSanitizedOutcome verifies that dual mode
// renders an owner-scoped persisted projection while preserving Web-owned
// reaction/upload fields and exposing only a bounded source classification.
func TestAnswerCheckDualReadRecordsSanitizedOutcome(t *testing.T) {
	gdb := setupTestDB(t)
	ResetHistoryReadObservations()
	projection := BotRunProjection{
		RunID:          "run-dual",
		Agent:          "deep_genome",
		Status:         "SUCCEEDED",
		ReportRevision: 7,
		FinalReport:    "# Dual report",
	}
	encoded, err := marshalPersistedProjection(projection)
	if err != nil {
		t.Fatalf("marshal projection: %v", err)
	}
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, query, answer, tool_name, bot_run_id, bot_projection_json, bot_report_revision, status, reaction_type, upload_path, created_at) VALUES
		(110, 'dlg-dual', 0, 'alice', 'dual-q', 'legacy-a', 'DeepGenomeAgent', 'run-dual', ?, 7, 'RUNNING', '2', '/upload/dual', '2026-01-01 00:00:00')`, encoded).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	result, err := NewService().AnswerCheckWithMode(context.Background(), "alice", "dlg-dual", HistoryReadModeDual)
	if err != nil {
		t.Fatalf("dual read: %v", err)
	}
	if result.Source != historySourceProjection || result.FallbackReason != "" {
		t.Fatalf("unexpected dual outcome: %#v", result)
	}
	if len(result.Rows) != 1 || !strings.Contains(result.Rows[0].Answer, "Dual report") {
		t.Fatalf("projection was not rendered: %#v", result.Rows)
	}
	if result.Rows[0].ReactionType != "2" || result.Rows[0].UploadPath != "/upload/dual" {
		t.Fatalf("Web-owned fields changed: reaction=%q upload=%q", result.Rows[0].ReactionType, result.Rows[0].UploadPath)
	}
	if got := historyObservationCount(t, historyObservationProjectionHit); got != 1 {
		t.Fatalf("projection_hit=%d, want 1", got)
	}
	encodedObservations, err := json.Marshal(HistoryReadObservations())
	if err != nil {
		t.Fatalf("marshal observations: %v", err)
	}
	for _, forbidden := range []string{"dual-q", "legacy-a", "dlg-dual", "alice", "run-dual"} {
		if strings.Contains(string(encodedObservations), forbidden) {
			t.Fatalf("observation contains forbidden content %q: %s", forbidden, encodedObservations)
		}
	}
}

func TestAnswerCheckProjectionNormalizesPersistedCompletedReviewPause(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, query, answer, tool_name, bot_run_id, bot_projection_json, bot_report_revision, status, created_at) VALUES
		(112, 'dlg-review-persisted', 0, 'alice', 'review-q', 'legacy-a', 'ReviewAgent', 'run-review-persisted', ?, 2, 'INPUT_REQUIRED', '2026-01-01 00:00:00')`, `{
			"run_id":"run-review-persisted",
			"agent":"review",
			"status":"INPUT_REQUIRED",
			"report_revision":2,
			"final_report":"# Persisted complete review"
		}`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	result, err := NewService().AnswerCheckWithMode(context.Background(), "alice", "dlg-review-persisted", HistoryReadModeProjection)
	if err != nil {
		t.Fatalf("projection read: %v", err)
	}
	if result.Source != historySourceProjection || len(result.Rows) != 1 {
		t.Fatalf("unexpected projection read result: %#v", result)
	}
	if row := result.Rows[0]; row.Status != "SUCCEEDED" || row.ToolName != "ReviewAgent" || !strings.Contains(row.Answer, "Persisted complete review") {
		t.Fatalf("completed Review history row=%#v", row)
	}
}

func TestAnswerCheckDualReadFallsBackForUnavailableProjection(t *testing.T) {
	tests := []struct {
		name       string
		botRunID   string
		projection string
		revision   int64
	}{
		{name: "missing", botRunID: "run-missing", projection: "", revision: -1},
		{name: "malformed", botRunID: "run-malformed", projection: "{not-json", revision: -1},
		{name: "blank-run-id", botRunID: "", projection: "", revision: -1},
		{name: "run-id-mismatch", botRunID: "run-row", projection: `{"run_id":"run-other","agent":"chat","status":"succeeded","report_revision":1}`, revision: 1},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupTestDB(t)
			ResetHistoryReadObservations()
			if err := gdb.Exec(`INSERT INTO question_agent_logs
				(id, dialogue_id, f_id, user_name, query, answer, tool_name, bot_run_id, bot_projection_json, bot_report_revision, status, created_at) VALUES
				(111, ?, 0, 'alice', 'legacy-q', 'legacy-a', 'ChatAgent', ?, ?, ?, 'RUNNING', '2026-01-01 00:00:00')`, "dlg-fallback-"+tc.name, tc.botRunID, tc.projection, tc.revision).Error; err != nil {
				t.Fatalf("seed: %v", err)
			}
			result, err := NewService().AnswerCheckWithMode(context.Background(), "alice", "dlg-fallback-"+tc.name, HistoryReadModeDual)
			if err != nil {
				t.Fatalf("dual read: %v", err)
			}
			if result.Source != historySourceLegacy || result.FallbackReason == "" {
				t.Fatalf("expected bounded legacy fallback, got %#v", result)
			}
			if len(result.Rows) != 1 || result.Rows[0].Answer != "legacy-a" {
				t.Fatalf("legacy row changed: %#v", result.Rows)
			}
			if got := historyObservationCount(t, historyObservationLegacyFallback); got != 1 {
				t.Fatalf("legacy_fallback=%d, want 1", got)
			}
		})
	}
}

// TestAnswerCheckProjectionModeDoesNotPollBot makes the projection-only mode
// safe to activate independently of Bot/list availability.
func TestAnswerCheckProjectionModeDoesNotPollBot(t *testing.T) {
	gdb := setupTestDB(t)
	projection := BotRunProjection{RunID: "run-projection-only", Agent: "chat", Status: "SUCCEEDED", ReportRevision: 1, FinalReport: "projection"}
	encoded, err := marshalPersistedProjection(projection)
	if err != nil {
		t.Fatalf("marshal projection: %v", err)
	}
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, answer, tool_name, bot_run_id, bot_projection_json, bot_report_revision, status, created_at) VALUES
		(112, 'dlg-projection-only', 0, 'alice', 'legacy', 'ChatAgent', 'run-projection-only', ?, 1, 'RUNNING', '2026-01-01 00:00:00')`, encoded).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	var hits atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	defer func() { rxBot.BotConfig = nil }()

	result, err := NewService().AnswerCheckWithMode(context.Background(), "alice", "dlg-projection-only", HistoryReadModeProjection)
	if err != nil || result.Source != historySourceProjection {
		t.Fatalf("projection read result=%#v err=%v", result, err)
	}
	if hits.Load() != 0 {
		t.Fatalf("projection mode polled Bot %d time(s)", hits.Load())
	}
	if result.Rows[0].Answer == "legacy" {
		t.Fatalf("projection content was not applied: %#v", result.Rows[0])
	}
	_ = gdb
}

func TestAnswerCheckDualReadRecordsCountMismatch(t *testing.T) {
	gdb := setupTestDB(t)
	ResetHistoryReadObservations()
	projection := BotRunProjection{RunID: "run-count", Agent: "chat", Status: "SUCCEEDED", ReportRevision: 2, FinalReport: "count"}
	encoded, err := marshalPersistedProjection(projection)
	if err != nil {
		t.Fatalf("marshal projection: %v", err)
	}
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, answer, tool_name, bot_run_id, bot_projection_json, bot_report_revision, status, created_at) VALUES
		(113, 'dlg-count', 0, 'alice', 'legacy', 'ChatAgent', 'run-count', ?, 2, 'SUCCEEDED', '2026-01-01 00:00:00')`, encoded).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"object":"list","data":[{"run_id":"run-count","agent":"chat","status":"running","result":{"report_revision":4}},{"run_id":"run-extra","agent":"chat","status":"succeeded","result":{}}]}`))
	}))
	defer srv.Close()
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	defer func() { rxBot.BotConfig = nil }()

	result, err := NewService().AnswerCheckWithMode(context.Background(), "alice", "dlg-count", HistoryReadModeDual)
	if err != nil || result.Source != historySourceProjection {
		t.Fatalf("dual count result=%#v err=%v", result, err)
	}
	if got := historyObservationCount(t, historyObservationCountMismatch); got != 1 {
		t.Fatalf("count_mismatch=%d, want 1", got)
	}
	if got := historyObservationCount(t, historyObservationStatusMismatch); got != 1 {
		t.Fatalf("status_mismatch=%d, want 1", got)
	}
	if got := historyObservationCount(t, historyObservationRevisionMismatch); got != 1 {
		t.Fatalf("revision_mismatch=%d, want 1", got)
	}
}

func TestAnswerCheckDualReadBotFailureFallsBackWithoutError(t *testing.T) {
	gdb := setupTestDB(t)
	ResetHistoryReadObservations()
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, query, answer, tool_name, bot_run_id, status, created_at) VALUES
		(114, 'dlg-bot-unavailable', 0, 'alice', 'legacy-q', 'legacy-a', 'ChatAgent', 'run-unavailable', 'RUNNING', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"private failure"}`))
	}))
	defer srv.Close()
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	defer func() { rxBot.BotConfig = nil }()

	result, err := NewService().AnswerCheckWithMode(context.Background(), "alice", "dlg-bot-unavailable", HistoryReadModeDual)
	if err != nil {
		t.Fatalf("Bot read failure must degrade, got %v", err)
	}
	if result.Source != historySourceLegacy || result.FallbackReason != historyFallbackBotUnavailable {
		t.Fatalf("unexpected Bot failure outcome: %#v", result)
	}
	if len(result.Rows) != 1 || result.Rows[0].Answer != "legacy-a" {
		t.Fatalf("legacy row not preserved: %#v", result.Rows)
	}
	if got := historyObservationCount(t, historyObservationBotUnavailable); got != 1 {
		t.Fatalf("bot_read_unavailable=%d, want 1", got)
	}
	encodedObservations, err := json.Marshal(HistoryReadObservations())
	if err != nil {
		t.Fatalf("marshal observations: %v", err)
	}
	for _, forbidden := range []string{"private failure", "dlg-bot-unavailable", "alice", "run-unavailable", "legacy-a"} {
		if strings.Contains(string(encodedObservations), forbidden) {
			t.Fatalf("observation contains forbidden content %q: %s", forbidden, encodedObservations)
		}
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

// TestSyncBotRuns_UnversionedDesignSuccessClosesZeroRevisionLedger pins the
// Design wait-card incident: a RUNNING row whose stored revision is 0 must
// still take a succeeded GET that omits report_revision.
func TestSyncBotRuns_UnversionedDesignSuccessClosesZeroRevisionLedger(t *testing.T) {
	gdb := setupTestDB(t)
	digest := testProjectionDigestA
	projection := `{"run_id":"run-design-unversioned","agent":"design","status":"RUNNING","report_revision":0,"result_archive_v1":true,"delivery":{"schema_version":1,"required":true,"status":"pending","revision":1,"retryable":false}}`
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, user_name, query, answer, tool_name, bot_run_id, status, bot_projection_json, bot_report_revision, created_at) VALUES
		(55, 'dlg-design-unversioned', 'alice', 'AT1G66350 ath', '', 'DigitalDesignAgent', 'run-design-unversioned', 'RUNNING', ?, 0, '2026-01-01 00:00:00')`, projection).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	runRecordServer(t, `{"run_id":"run-design-unversioned","agent":"design","status":"succeeded","result":{"formatted":{"answer":"...terminal outcome..."},"execution":{"output_dirs":["/obs/bucket/owner/run/children/part-001"],"delivery":{"schema_version":1,"required":true,"status":"ready","revision":1,"inventory_digest":"`+digest+`","archive":{"role":"result_archive","name":"design-results.zip","media_type":"application/zip","size_bytes":20619922,"downloadable":true,"report_context_eligible":false,"download_ref":"result-archive:`+digest+`"},"error_code":null,"retryable":false}}}}`)

	SyncBotRuns([]model.QuestionAgentLog{{Id: 55, BotRunId: "run-design-unversioned", Status: "RUNNING", ToolName: "DigitalDesignAgent"}})

	status, answer := readStatusAnswer(t, gdb, 55)
	if status != "SUCCEEDED" {
		t.Errorf("status = %q, want SUCCEEDED", status)
	}
	if !strings.Contains(answer, "...terminal outcome...") {
		t.Errorf("answer = %q, want terminal report", answer)
	}
	var revision int64
	if err := gdb.Raw(`SELECT bot_report_revision FROM question_agent_logs WHERE id = 55`).Scan(&revision).Error; err != nil {
		t.Fatalf("revision: %v", err)
	}
	if revision != 0 {
		t.Errorf("bot_report_revision = %d, want stored 0", revision)
	}
}

// TestDeepGenomeProjectionE2E_SubmitPollHistoryOwnerScope follows the supported
// Expert route for a Bot-resolved DeepGenome run: the Web submits one umbrella
// run, reconciles two intermediate revisions and a final report, then reads
// history through AnswerCheck. A foreign row carrying the same run id must not
// appear in the owner's history response.
func TestDeepGenomeProjectionE2E_SubmitPollHistoryOwnerScope(t *testing.T) {
	gdb := setupExpertTestDB(t)
	const runID = "run-deep-genome-e2e"
	var submittedDialogue string
	var poll atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/agents/deep_genome/runs":
			var req rxBot.AgentRunRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Errorf("decode submit request: %v", err)
			}
			if req.DialogueID == "" {
				t.Error("submit dialogue_id must be non-empty")
			}
			submittedDialogue = req.DialogueID
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"run-deep-genome-e2e","object":"agent.run","agent":"deep_genome","status":"running","task_ids":["child-deep-genome-e2e"],"result":{}}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/runs/"+runID:
			var body string
			switch poll.Add(1) {
			case 1:
				body = `{"run_id":"run-deep-genome-e2e","agent":"deep_genome","status":"running","result":{"report_stage":"intermediate","report_completeness":"partial","report_revision":1,"intermediate_report":"# Revision 1"}}`
			case 2:
				body = `{"run_id":"run-deep-genome-e2e","agent":"deep_genome","status":"running","result":{"report_stage":"intermediate","report_completeness":"partial","report_revision":2,"intermediate_report":"# Revision 2"}}`
			default:
				body = `{"run_id":"run-deep-genome-e2e","agent":"deep_genome","status":"succeeded","result":{"report_stage":"final","report_completeness":"complete","report_revision":3,"intermediate_report":"# Revision 2","final_report":"# Final DeepGenome report"}}`
			}
			_, _ = w.Write([]byte(body))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/runs":
			if got := r.URL.Query().Get("dialogue_id"); got != submittedDialogue {
				t.Errorf("history dialogue_id=%q, want %q", got, submittedDialogue)
			}
			_, _ = w.Write([]byte(`{"object":"list","data":[{"run_id":"run-deep-genome-e2e","agent":"deep_genome","status":"succeeded","result":{"report_stage":"final","report_revision":3,"final_report":"# Final DeepGenome report"}}]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5,
	}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	out, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "inspect the gene", Tool: "DeepGenomeAgent", Mode: "expert", Id: 0,
	})
	if err != nil {
		t.Fatalf("submit DeepGenome query: %v", err)
	}
	if out.Status != "RUNNING" || out.BotRunID != runID || out.BotRunID == "child-deep-genome-e2e" {
		t.Fatalf("submission identity/status=%#v", out)
	}
	if out.DialogueId == "" || out.DialogueId != submittedDialogue {
		t.Fatalf("generated dialogue id=%q, submitted=%q", out.DialogueId, submittedDialogue)
	}
	dialogueID := out.DialogueId

	row := model.QuestionAgentLog{
		Id: out.Id, UserName: "alice", BotRunId: out.BotRunID,
		Status: out.Status, ToolName: out.ToolName,
	}
	SyncBotRuns([]model.QuestionAgentLog{row})
	projection, err := LoadBotRunProjection(context.Background(), "alice", out.Id)
	if err != nil || projection.ReportRevision != 1 || projection.VisibleReport() != "# Revision 1" {
		t.Fatalf("revision 1 projection=%#v err=%v", projection, err)
	}
	SyncBotRuns([]model.QuestionAgentLog{row})
	projection, err = LoadBotRunProjection(context.Background(), "alice", out.Id)
	if err != nil || projection.ReportRevision != 2 || projection.VisibleReport() != "# Revision 2" {
		t.Fatalf("revision 2 projection=%#v err=%v", projection, err)
	}
	SyncBotRuns([]model.QuestionAgentLog{row})
	if got := poll.Load(); got != 3 {
		t.Fatalf("poll count=%d, want revision 1, revision 2, and final report", got)
	}

	projection, err = LoadBotRunProjection(context.Background(), "alice", out.Id)
	if err != nil {
		t.Fatalf("load final projection: %v", err)
	}
	if projection.RunID != runID || projection.ReportRevision != 3 || projection.VisibleReport() != "# Final DeepGenome report" {
		t.Fatalf("final projection=%#v", projection)
	}

	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, query, answer, tool_name, bot_run_id, status, created_at) VALUES
		(900, ?, ?, 'bob', 'foreign', 'foreign', 'DeepGenomeAgent', ?, 'SUCCEEDED', '2026-01-01 00:01:00')`, dialogueID, out.Id, runID).Error; err != nil {
		t.Fatalf("seed foreign row: %v", err)
	}
	got, err := NewService().AnswerCheck(context.Background(), "alice", dialogueID)
	if err != nil {
		t.Fatalf("AnswerCheck: %v", err)
	}
	if len(got) != 1 || got[0].Id != out.Id || got[0].UserName != "alice" || got[0].Status != "SUCCEEDED" {
		t.Fatalf("owner-scoped history=%+v", got)
	}
	var answer struct {
		Content string        `json:"content"`
		DocList []interface{} `json:"doc_list"`
	}
	if err := json.Unmarshal([]byte(got[0].Answer), &answer); err != nil {
		t.Fatalf("final history answer is not shaped JSON: %q (%v)", got[0].Answer, err)
	}
	if answer.Content != "# Final DeepGenome report" || answer.DocList == nil || len(answer.DocList) != 0 {
		t.Fatalf("history final report=%+v", answer)
	}
	var distinctRunIDs int64
	if err := gdb.Raw(`SELECT COUNT(DISTINCT bot_run_id) FROM question_agent_logs WHERE dialogue_id = ?`, dialogueID).Scan(&distinctRunIDs).Error; err != nil {
		t.Fatalf("count umbrella run ids: %v", err)
	}
	if distinctRunIDs != 1 {
		t.Fatalf("distinct bot_run_id=%d, want one umbrella run id", distinctRunIDs)
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

func TestAnalystAgentGetLog_ReturnsDatabaseErrorBeforeRowAccess(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec("DROP TABLE question_agent_logs").Error; err != nil {
		t.Fatalf("drop test table: %v", err)
	}

	_, err := NewService().AnalystAgentGetLog(context.Background(), 70, "alice")
	if err == nil || !strings.Contains(err.Error(), "no such table") {
		t.Fatalf("expected database error, got %v", err)
	}
}

func TestAnalystAgentGetLogReturnsSharedNotFoundForMissingIdentity(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, task_id, bot_run_id, task_log) VALUES (71, 'alice', '', '', 'ignored')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	_, err := NewService().AnalystAgentGetLog(context.Background(), 71, "alice")
	if err == nil || err.Error() != "agent task log not found" {
		t.Fatalf("error = %v, want shared owner-scoped not found", err)
	}
}

func TestAnalystAgentGetLogUsesOwnerScopedLookupBeforeIdentityChecks(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, task_id, bot_run_id, task_log) VALUES (72, 'bob', 'task-72', 'run-72', 'private log')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	var querySQL []string
	if err := gdb.Callback().Query().After("gorm:query").Register("test:agent-log-owner-scope", func(tx *gorm.DB) {
		querySQL = append(querySQL, tx.Statement.SQL.String())
	}); err != nil {
		t.Fatalf("register query observer: %v", err)
	}

	fake := &agentTaskLogFakeReader{}
	_, err := (&Service{runReader: fake}).AnalystAgentGetLog(context.Background(), 72, "alice")
	if err == nil || err.Error() != "agent task log not found" {
		t.Fatalf("error = %v, want shared owner-scoped not found", err)
	}
	if len(querySQL) != 1 || !strings.Contains(querySQL[0], "WHERE id = ? AND user_name = ?") {
		t.Fatalf("query = %v, want owner-scoped id lookup before identities", querySQL)
	}
	if fake.logCalls != 0 {
		t.Fatalf("Bot calls = %d, want zero", fake.logCalls)
	}
}

func TestQueryListDelete_HidesOwnerConversationBeforeBotTombstone(t *testing.T) {
	gdb := setupTestDB(t)
	const dialogueID = "11111111-1111-4111-8111-111111111111"
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, query, answer, log_status, status, created_at) VALUES
		(100, ?, 0, 'alice', 'root', 'answer', '', 'SUCCEEDED', CURRENT_TIMESTAMP),
		(101, ?, 100, 'alice', 'child', 'answer', '', 'SUCCEEDED', CURRENT_TIMESTAMP)`,
		dialogueID, dialogueID).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var deleteAt *string
		var logStatus string
		if err := gdb.Raw(
			`SELECT delete_at, COALESCE(log_status, '') FROM question_agent_logs WHERE id = 100`,
		).Row().Scan(&deleteAt, &logStatus); err != nil {
			t.Fatalf("read committed delete state: %v", err)
		}
		if deleteAt == nil || logStatus != conversationDeletePending {
			t.Fatalf("Bot called before durable delete: delete_at=%v log_status=%q", deleteAt, logStatus)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"schema_version":1,"state":"tombstoned","context_version":0}`))
	}))
	t.Cleanup(srv.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	gotID, err := NewService().QueryListDelete(context.Background(), "alice", 100)
	if err != nil || gotID != 100 {
		t.Fatalf("QueryListDelete = %d, %v; want 100, nil", gotID, err)
	}
	history, err := NewService().AnswerCheck(context.Background(), "alice", dialogueID)
	if err != nil || len(history) != 0 {
		t.Fatalf("deleted history = %+v, %v; want empty", history, err)
	}
	var logStatus string
	if err := gdb.Raw(`SELECT COALESCE(log_status, '') FROM question_agent_logs WHERE id = 100`).
		Scan(&logStatus).Error; err != nil {
		t.Fatalf("read status: %v", err)
	}
	if logStatus != conversationDeleteAcked {
		t.Fatalf("log_status=%q, want %q", logStatus, conversationDeleteAcked)
	}
	var firstDeleteAt time.Time
	if err := gdb.Raw(`SELECT delete_at FROM question_agent_logs WHERE id = 100`).
		Scan(&firstDeleteAt).Error; err != nil {
		t.Fatalf("read first delete time: %v", err)
	}

	if _, err := NewService().QueryListDelete(context.Background(), "alice", 100); err != nil {
		t.Fatalf("repeat delete: %v", err)
	}
	var repeatedDeleteAt time.Time
	if err := gdb.Raw(`SELECT delete_at FROM question_agent_logs WHERE id = 100`).
		Scan(&repeatedDeleteAt).Error; err != nil {
		t.Fatalf("read repeated delete time: %v", err)
	}
	if !repeatedDeleteAt.Equal(firstDeleteAt) {
		t.Fatalf("repeat delete changed delete_at: first=%v repeat=%v", firstDeleteAt, repeatedDeleteAt)
	}
	if calls.Load() != 1 {
		t.Fatalf("tombstone calls=%d, want one idempotent call", calls.Load())
	}
}

func TestQueryListDelete_BotFailureLeavesPendingAndReturnsSuccess(t *testing.T) {
	gdb := setupTestDB(t)
	const dialogueID = "22222222-2222-4222-8222-222222222222"
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, query, answer, status, created_at) VALUES
		(110, ?, 0, 'alice', 'root', 'answer', 'SUCCEEDED', CURRENT_TIMESTAMP),
		(111, ?, 110, 'alice', 'child', 'answer', 'SUCCEEDED', CURRENT_TIMESTAMP)`,
		dialogueID, dialogueID).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
	}))
	t.Cleanup(srv.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 1,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	if got, err := NewService().QueryListDelete(context.Background(), "alice", 110); err != nil || got != 110 {
		t.Fatalf("delete during Bot outage = %d, %v; want success", got, err)
	}
	var logStatus string
	var deleteAt *time.Time
	if err := gdb.Raw(
		`SELECT COALESCE(log_status, ''), delete_at FROM question_agent_logs WHERE id = 110`,
	).Row().Scan(&logStatus, &deleteAt); err != nil {
		t.Fatalf("read deleted row: %v", err)
	}
	if deleteAt == nil || logStatus != conversationDeletePending {
		t.Fatalf("delete state: delete_at=%v log_status=%q", deleteAt, logStatus)
	}
	history, err := NewService().AnswerCheck(context.Background(), "alice", dialogueID)
	if err != nil || len(history) != 0 {
		t.Fatalf("history after failed tombstone = %+v, %v; want empty", history, err)
	}
}

func TestQueryListDelete_CrossOwnerIsSafeNotFound(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, status, created_at) VALUES
		(120, '33333333-3333-4333-8333-333333333333', 0, 'alice', 'SUCCEEDED', CURRENT_TIMESTAMP)`).
		Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	_, err := NewService().QueryListDelete(context.Background(), "bob", 120)
	if !errors.Is(err, ErrConversationDeleteNotFound) {
		t.Fatalf("cross-owner error=%v, want safe not found", err)
	}
	var count int64
	if err := gdb.Model(&model.QuestionAgentLog{}).
		Where("id = ? AND delete_at IS NULL", 120).
		Count(&count).Error; err != nil {
		t.Fatalf("count owner row: %v", err)
	}
	if count != 1 {
		t.Fatalf("owner row changed after cross-owner delete, count=%d", count)
	}
}
