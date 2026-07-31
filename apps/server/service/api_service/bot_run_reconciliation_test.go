package api_service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

// botRunRecordSequenceServer serves successive run snapshots so the tests
// can distinguish status-only polling from revision-aware reconciliation.
func botRunRecordSequenceServer(t *testing.T, bodies ...string) {
	t.Helper()
	if len(bodies) == 0 {
		t.Fatal("run record sequence requires at least one body")
	}
	var calls atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		index := int(calls.Add(1)) - 1
		if index >= len(bodies) {
			index = len(bodies) - 1
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(bodies[index]))
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })
}

func loadBotRunProjectionForTest(t *testing.T, username string, id int64) BotRunProjection {
	t.Helper()
	projection, err := LoadBotRunProjection(context.Background(), username, id)
	if err != nil {
		t.Fatalf("load projection row %d: %v", id, err)
	}
	return projection
}

func TestSyncBotRunsRevisionAdvancesWhileStatusStaysRunning(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, user_name, query, answer, tool_name, bot_run_id, status, created_at) VALUES
		(155, 'dlg-rev', 'alice', 'q', 'Task created: t-rev', 'DeepGenomeAgent', 'run-rev', 'RUNNING', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	botRunRecordSequenceServer(t,
		`{"run_id":"run-rev","agent":"deep_genome","status":"running","result":{"report_stage":"intermediate","report_completeness":"partial","report_revision":1,"report_updated_at":"2026-07-16T00:00:00Z","intermediate_report":"# Revision 1"}}`,
		`{"run_id":"run-rev","agent":"deep_genome","status":"running","result":{"report_stage":"intermediate","report_completeness":"partial","report_revision":2,"report_updated_at":"2026-07-16T00:01:00Z","intermediate_report":"# Revision 2"}}`,
	)
	row := model.QuestionAgentLog{Id: 155, UserName: "alice", BotRunId: "run-rev", Status: "RUNNING", ToolName: "DeepGenomeAgent"}

	SyncBotRuns([]model.QuestionAgentLog{row})
	status, answer := readStatusAnswer(t, gdb, 155)
	if status != "RUNNING" || !strings.Contains(answer, "Revision 1") {
		t.Fatalf("first poll status=%q answer=%q, want RUNNING / Revision 1", status, answer)
	}
	projection := loadBotRunProjectionForTest(t, "alice", 155)
	if projection.ReportRevision != 1 || projection.VisibleReport() != "# Revision 1" {
		t.Fatalf("first projection=%#v, want revision 1", projection)
	}

	SyncBotRuns([]model.QuestionAgentLog{row})
	status, answer = readStatusAnswer(t, gdb, 155)
	if status != "RUNNING" || !strings.Contains(answer, "Revision 2") {
		t.Fatalf("second poll status=%q answer=%q, want RUNNING / Revision 2", status, answer)
	}
	projection = loadBotRunProjectionForTest(t, "alice", 155)
	if projection.ReportRevision != 2 || projection.VisibleReport() != "# Revision 2" {
		t.Fatalf("second projection=%#v, want revision 2", projection)
	}
}

func TestSyncBotRunsKeepsIntermediateOnOptionalFailure(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, user_name, query, answer, tool_name, bot_run_id, status, created_at) VALUES
		(156, 'dlg-opt', 'alice', 'q', 'Task created: t-opt', 'DeepGenomeAgent', 'run-opt', 'RUNNING', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	botRunRecordSequenceServer(t, `{"run_id":"run-opt","agent":"deep_genome","status":"running","result":{"report_stage":"intermediate","report_completeness":"partial","report_revision":2,"intermediate_report":"# Optional report","final_report":"","degraded":true,"degraded_reason":"optional analysis unavailable","failures":[{"work_item_key":"brief_gene","status":"failed","message":"optional analysis failed"}]}}`)

	SyncBotRuns([]model.QuestionAgentLog{{Id: 156, UserName: "alice", BotRunId: "run-opt", Status: "RUNNING", ToolName: "DeepGenomeAgent"}})
	status, answer := readStatusAnswer(t, gdb, 156)
	if status != "RUNNING" || !strings.Contains(answer, "Optional report") {
		t.Fatalf("status=%q answer=%q, want RUNNING / Optional report", status, answer)
	}
	projection := loadBotRunProjectionForTest(t, "alice", 156)
	if projection.ReportRevision != 2 || projection.VisibleReport() != "# Optional report" || !projection.Degraded {
		t.Fatalf("projection=%#v, want degraded intermediate revision", projection)
	}
}

func TestSyncBotRunsKeepsIntermediateOnFinalFailure(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, user_name, query, answer, tool_name, bot_run_id, status, created_at) VALUES
		(157, 'dlg-fail', 'alice', 'q', 'Task created: t-fail', 'DeepGenomeAgent', 'run-fail', 'RUNNING', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	botRunRecordSequenceServer(t, `{"run_id":"run-fail","agent":"deep_genome","status":"failed","result":{"report_stage":"final","report_completeness":"partial","report_revision":4,"intermediate_report":"# Partial report","final_report":"","failures":[{"work_item_key":"synthesis","status":"failed","message":"final synthesis failed"}]}}`)

	SyncBotRuns([]model.QuestionAgentLog{{Id: 157, UserName: "alice", BotRunId: "run-fail", Status: "RUNNING", ToolName: "DeepGenomeAgent"}})
	status, answer := readStatusAnswer(t, gdb, 157)
	if status != "FAILED" || !strings.Contains(answer, "Partial report") {
		t.Fatalf("status=%q answer=%q, want FAILED / Partial report", status, answer)
	}
	projection := loadBotRunProjectionForTest(t, "alice", 157)
	if projection.ReportRevision != 4 || projection.VisibleReport() != "# Partial report" {
		t.Fatalf("projection=%#v, want intermediate revision 4", projection)
	}
}

func TestSyncBotRunsPrefersFinalReportAndIgnoresEmptyArtifacts(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, user_name, query, answer, tool_name, bot_run_id, status, download_path, image_paths, created_at) VALUES
		(158, 'dlg-final', 'alice', 'q', 'Task created: t-final', 'DeepGenomeAgent', 'run-final', 'RUNNING', 'obs://bucket/old', '["obs://bucket/old/report.png"]', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	botRunRecordSequenceServer(t, `{"run_id":"run-final","agent":"deep_genome","status":"succeeded","result":{"report_stage":"final","report_completeness":"complete","report_revision":5,"intermediate_report":"# Intermediate","final_report":"# Final","artifacts":[]}}`)

	SyncBotRuns([]model.QuestionAgentLog{{Id: 158, UserName: "alice", BotRunId: "run-final", Status: "RUNNING", ToolName: "DeepGenomeAgent"}})
	status, answer := readStatusAnswer(t, gdb, 158)
	if status != "SUCCEEDED" || !strings.Contains(answer, "Final") || strings.Contains(answer, "Intermediate") {
		t.Fatalf("status=%q answer=%q, want final-only cited answer", status, answer)
	}
	downloadPath, imagePaths := readGalleryCols(t, gdb, 158)
	if downloadPath != "obs://bucket/old" || imagePaths != `["obs://bucket/old/report.png"]` {
		t.Fatalf("empty artifacts clobbered gallery, download=%q images=%q", downloadPath, imagePaths)
	}
	projection := loadBotRunProjectionForTest(t, "alice", 158)
	if projection.ReportRevision != 5 || projection.VisibleReport() != "# Final" {
		t.Fatalf("projection=%#v, want final revision 5", projection)
	}
}

func TestSyncBotRunsOlderRevisionCannotClobberVisibleReport(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, user_name, query, answer, tool_name, bot_run_id, status, created_at) VALUES
		(159, 'dlg-stale', 'alice', 'q', 'Task created: t-stale', 'DeepGenomeAgent', 'run-stale', 'RUNNING', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	botRunRecordSequenceServer(t,
		`{"run_id":"run-stale","agent":"deep_genome","status":"running","result":{"report_revision":2,"intermediate_report":"# New"}}`,
		`{"run_id":"run-stale","agent":"deep_genome","status":"running","result":{"report_revision":1,"intermediate_report":"# Old"}}`,
	)
	row := model.QuestionAgentLog{Id: 159, UserName: "alice", BotRunId: "run-stale", Status: "RUNNING", ToolName: "DeepGenomeAgent"}

	SyncBotRuns([]model.QuestionAgentLog{row})
	SyncBotRuns([]model.QuestionAgentLog{row})
	status, answer := readStatusAnswer(t, gdb, 159)
	if status != "RUNNING" || !strings.Contains(answer, "New") || strings.Contains(answer, "Old") {
		t.Fatalf("stale poll status=%q answer=%q, want RUNNING / New only", status, answer)
	}
	projection := loadBotRunProjectionForTest(t, "alice", 159)
	if projection.ReportRevision != 2 || projection.VisibleReport() != "# New" {
		t.Fatalf("stale projection=%#v, want revision 2", projection)
	}
}
