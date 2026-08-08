package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"gorm.io/gorm"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

func seedPrivateReplacementReconciliationRow(
	t *testing.T,
	gdb *gorm.DB,
	id int64,
	activeStatus string,
) (model.QuestionAgentLog, QueryInput, QueryInput) {
	t.Helper()
	dialogueID := fmt.Sprintf("private-replacement-dialogue-%d", id)
	baseInput := QueryInput{
		Query: "accepted base query", Mode: "expert", Tool: "AnalystAgent",
		ClientTurnID: fmt.Sprintf("private-base-key-%d", id), Surface: QuerySurfaceChat,
	}
	replacementInput := QueryInput{
		Query: "private replacement query", Mode: "expert",
		Tool: "InSilicoResearchAgent", ClientTurnID: fmt.Sprintf("private-replacement-key-%d", id),
		RefreshId: id, Surface: QuerySurfaceChat,
	}
	baseTarget := v1SubmissionTarget{dialogueID: dialogueID, mode: "expert", operation: "append"}
	replacementTarget := v1SubmissionTarget{dialogueID: dialogueID, mode: "expert", operation: "replace"}
	encoded, err := json.Marshal(map[string]interface{}{
		"run_id":          "run-accepted-base",
		"agent":           "analyst",
		"status":          statusSucceeded,
		"report_revision": 0,
		"final_report":    "# accepted public projection",
		"conversation_context": map[string]interface{}{
			"client_turn_id":      baseInput.ClientTurnID,
			"request_fingerprint": submissionRequestFingerprint(baseInput, baseTarget, false),
			"replacement": map[string]interface{}{
				"client_turn_id":         replacementInput.ClientTurnID,
				"request_fingerprint":    submissionRequestFingerprint(replacementInput, replacementTarget, false),
				"query":                  replacementInput.Query,
				"tool_name":              replacementInput.Tool,
				"mode":                   replacementInput.Mode,
				"interop_mode":           "off",
				"active_status":          activeStatus,
				"active_bot_run_id":      "run-private-replacement",
				"active_task_id":         "task-private-replacement",
				"active_report_revision": -1,
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	row := model.QuestionAgentLog{
		Id: id, DialogueId: dialogueID, UserName: "alice",
		Query: baseInput.Query, Answer: "accepted public answer",
		ToolName: baseInput.Tool, Mode: baseInput.Mode, Status: statusSucceeded,
		BotRunId: "run-accepted-base", TaskId: "task-accepted-base",
		BotProjectionJSON: string(encoded), BotReportRevision: 0,
		ReactionType: "0", CollectType: "0",
	}
	if result := gdb.Create(&row); result.Error != nil {
		t.Fatalf("seed private replacement reconciliation row: %v", result.Error)
	}
	return row, baseInput, replacementInput
}

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

func TestSyncBotRunsKeepsRequiredDeliveryPendingThenSettlesReady(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, user_name, query, answer, tool_name, bot_run_id, status, download_path, image_paths, created_at) VALUES
		(160, 'dlg-delivery', 'alice', 'q', 'Task created', 'AnalystAgent', 'run-delivery', 'RUNNING', 'obs://legacy/output', '["obs://legacy/output/plot.png"]', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	pending := `{"run_id":"run-delivery","agent":"analyst","status":"succeeded","result":{"report_revision":3,"final_report":"# Scientific result","execution":{"output_dirs":["obs://bucket/owner/run"],"delivery":{"schema_version":1,"required":true,"status":"pending","revision":1,"inventory_digest":"` + testProjectionDigestA + `","archive":null,"error_code":null,"retryable":false}}}}`
	ready := `{"run_id":"run-delivery","agent":"analyst","status":"succeeded","result":{"report_revision":3,"final_report":"# Scientific result","execution":{"output_dirs":["obs://bucket/owner/run"],"delivery":{"schema_version":1,"required":true,"status":"ready","revision":1,"inventory_digest":"` + testProjectionDigestA + `","archive":{"role":"result_archive","name":"analyst-results.zip","media_type":"application/zip","size_bytes":4097,"downloadable":true,"report_context_eligible":false,"download_ref":"result-archive:` + testProjectionDigestA + `"},"error_code":null,"retryable":false}}}}`
	botRunRecordSequenceServer(t, pending, ready)
	row := model.QuestionAgentLog{Id: 160, UserName: "alice", BotRunId: "run-delivery", Status: "RUNNING", ToolName: "AnalystAgent"}

	SyncBotRuns([]model.QuestionAgentLog{row})
	status, answer := readStatusAnswer(t, gdb, 160)
	if status != "RUNNING" || !strings.Contains(answer, "Scientific result") {
		t.Fatalf("pending status=%q answer=%q, want RUNNING with report", status, answer)
	}
	projection := loadBotRunProjectionForTest(t, "alice", 160)
	if !projection.ResultArchiveV1 || projection.Delivery == nil || projection.Delivery.Status != "pending" {
		t.Fatalf("pending projection=%#v", projection)
	}
	downloadPath, imagePaths := readGalleryCols(t, gdb, 160)
	if downloadPath != "obs://legacy/output" || imagePaths != `["obs://legacy/output/plot.png"]` {
		t.Fatalf("active v1 wrote legacy gallery, download=%q images=%q", downloadPath, imagePaths)
	}

	SyncBotRuns([]model.QuestionAgentLog{row})
	status, answer = readStatusAnswer(t, gdb, 160)
	if status != "SUCCEEDED" || !strings.Contains(answer, "Scientific result") {
		t.Fatalf("ready status=%q answer=%q, want SUCCEEDED with report", status, answer)
	}
	projection = loadBotRunProjectionForTest(t, "alice", 160)
	if projection.Delivery == nil || projection.Delivery.Status != "ready" || projection.Delivery.ArchiveRef == "" {
		t.Fatalf("ready projection=%#v", projection)
	}
	downloadPath, imagePaths = readGalleryCols(t, gdb, 160)
	if downloadPath != "obs://legacy/output" || imagePaths != `["obs://legacy/output/plot.png"]` {
		t.Fatalf("ready v1 wrote legacy gallery, download=%q images=%q", downloadPath, imagePaths)
	}
}

func TestSyncBotRunsPrivateReplacementTerminalMatrix(t *testing.T) {
	terminalStatuses := []struct {
		wire string
		want string
	}{
		{wire: "succeeded", want: "SUCCEEDED"},
		{wire: "failed", want: "FAILED"},
		{wire: "cancelled", want: "CANCELLED"},
		{wire: "timed_out", want: "TIMED_OUT"},
	}
	for _, activeStatus := range []string{"RUNNING", "INPUT_REQUIRED"} {
		for _, terminal := range terminalStatuses {
			t.Run(activeStatus+" to "+terminal.want, func(t *testing.T) {
				gdb := setupTestDB(t)
				rowID := int64(300 + len(activeStatus)*10 + len(terminal.want))
				row, baseInput, replacementInput := seedPrivateReplacementReconciliationRow(
					t, gdb, rowID, activeStatus,
				)
				var calls atomic.Int64
				var requestPath string
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					calls.Add(1)
					requestPath = r.URL.Path
					w.Header().Set("Content-Type", "application/json")
					_, _ = fmt.Fprintf(w,
						`{"run_id":"run-private-replacement","agent":"research","status":%q,"task_ids":["task-private-replacement"],"result":{"report_revision":2,"final_report":"# private replacement terminal report"}}`,
						terminal.wire,
					)
				}))
				t.Cleanup(server.Close)
				previous := rxBot.BotConfig
				rxBot.BotConfig = &rxBot.Config{BaseURL: server.URL, ProxyEnabled: true, TimeoutSeconds: 2}
				t.Cleanup(func() { rxBot.BotConfig = previous })

				SyncBotRuns([]model.QuestionAgentLog{row})

				if calls.Load() != 1 || !strings.HasSuffix(requestPath, "/v1/runs/run-private-replacement") {
					t.Fatalf("private replacement polls=%d path=%q, want one candidate-run poll", calls.Load(), requestPath)
				}
				var stored model.QuestionAgentLog
				if err := gdb.First(&stored, row.Id).Error; err != nil {
					t.Fatal(err)
				}
				baseTarget := v1SubmissionTarget{
					dialogueID: row.DialogueId, mode: "expert", operation: "append",
				}
				replacementTarget := v1SubmissionTarget{
					dialogueID: row.DialogueId, mode: "expert", operation: "replace",
				}
				if terminal.want == statusSucceeded {
					if stored.Query != replacementInput.Query || stored.ToolName != replacementInput.Tool ||
						stored.Status != statusSucceeded || stored.BotRunId != "run-private-replacement" ||
						!strings.Contains(stored.Answer, "private replacement terminal report") ||
						strings.Contains(stored.BotProjectionJSON, `"replacement"`) ||
						!strings.Contains(stored.BotProjectionJSON, `"retired_identities"`) {
						t.Fatalf("successful private replacement was not atomically promoted: %+v raw=%s", stored, stored.BotProjectionJSON)
					}
					resolved, err := NewService().resolveExistingV1SubmissionWithDB(
						context.Background(), gdb, "alice", replacementInput, replacementTarget, false,
					)
					if err != nil || resolved == nil || resolved.duplicate == nil || resolved.duplicate.Id != row.Id {
						t.Fatalf("promoted replacement key=%+v error=%v", resolved, err)
					}
					if resolved, err := NewService().resolveExistingV1SubmissionWithDB(
						context.Background(), gdb, "alice", baseInput, baseTarget, false,
					); resolved != nil || !errors.Is(err, ErrDuplicateClientTurn) {
						t.Fatalf("retired base key after promotion=%+v error=%v, want duplicate", resolved, err)
					}
					return
				}

				if stored.Query != row.Query || stored.Answer != row.Answer ||
					stored.ToolName != row.ToolName || stored.Status != row.Status ||
					stored.BotRunId != row.BotRunId ||
					!strings.Contains(stored.BotProjectionJSON, `"terminal_result"`) ||
					!strings.Contains(stored.BotProjectionJSON, `"status":"`+terminal.want+`"`) {
					t.Fatalf("terminal private replacement changed base or lost terminal identity: public=%+v raw=%s", stored, stored.BotProjectionJSON)
				}
				baseResolved, err := NewService().resolveExistingV1SubmissionWithDB(
					context.Background(), gdb, "alice", baseInput, baseTarget, false,
				)
				if err != nil || baseResolved == nil || baseResolved.duplicate == nil ||
					baseResolved.duplicate.Answer != row.Answer {
					t.Fatalf("base key after terminal replacement=%+v error=%v", baseResolved, err)
				}
				replacementResolved, err := NewService().resolveExistingV1SubmissionWithDB(
					context.Background(), gdb, "alice", replacementInput, replacementTarget, false,
				)
				if err != nil || replacementResolved == nil || replacementResolved.duplicate == nil ||
					replacementResolved.duplicate.Status != terminal.want {
					t.Fatalf("terminal replacement key=%+v error=%v", replacementResolved, err)
				}
			})
		}
	}
}

func TestSyncBotRunsPrivateReplacementWaitsForRequiredDelivery(t *testing.T) {
	const pending = `{"run_id":"run-private-replacement","agent":"research","status":"succeeded","task_ids":["task-private-replacement"],"result":{"report_revision":2,"final_report":"PRIVATE PENDING REPORT","execution":{"output_dirs":["obs://private/pending"],"delivery":{"schema_version":1,"required":true,"status":"pending","revision":1,"inventory_digest":"` + testProjectionDigestA + `","archive":null,"error_code":null,"retryable":false}}}}`
	const ready = `{"run_id":"run-private-replacement","agent":"research","status":"succeeded","task_ids":["task-private-replacement"],"result":{"report_revision":2,"final_report":"# promoted replacement report","execution":{"output_dirs":["obs://private/ready"],"delivery":{"schema_version":1,"required":true,"status":"ready","revision":1,"inventory_digest":"` + testProjectionDigestA + `","archive":{"role":"result_archive","name":"research-results.zip","media_type":"application/zip","size_bytes":4097,"downloadable":true,"report_context_eligible":false,"download_ref":"result-archive:` + testProjectionDigestA + `"},"error_code":null,"retryable":false}}}}`
	const failed = `{"run_id":"run-private-replacement","agent":"research","status":"succeeded","task_ids":["task-private-replacement"],"result":{"report_revision":2,"final_report":"PRIVATE FAILED DELIVERY REPORT","execution":{"output_dirs":["obs://private/failed"],"delivery":{"schema_version":1,"required":true,"status":"failed","revision":2,"inventory_digest":"` + testProjectionDigestA + `","archive":null,"error_code":"archive_contract_invalid","retryable":false}}}}`

	t.Run("pending remains private until ready", func(t *testing.T) {
		gdb := setupTestDB(t)
		row, _, replacementInput := seedPrivateReplacementReconciliationRow(t, gdb, 453, "RUNNING")
		botRunRecordSequenceServer(t, pending, ready)

		SyncBotRuns([]model.QuestionAgentLog{row})

		var afterPending model.QuestionAgentLog
		if err := gdb.First(&afterPending, row.Id).Error; err != nil {
			t.Fatal(err)
		}
		private, err := LoadBotConversationContext(context.Background(), "alice", row.Id)
		if err != nil {
			t.Fatal(err)
		}
		if afterPending.Query != row.Query || afterPending.Answer != row.Answer ||
			afterPending.ToolName != row.ToolName || afterPending.Status != row.Status ||
			afterPending.BotRunId != row.BotRunId || private.Replacement == nil ||
			private.Replacement.ActiveStatus != "RUNNING" ||
			!strings.Contains(afterPending.BotProjectionJSON, `"active_delivery"`) ||
			!strings.Contains(afterPending.BotProjectionJSON, `"status":"pending"`) ||
			strings.Contains(afterPending.BotProjectionJSON, "PRIVATE PENDING REPORT") ||
			strings.Contains(afterPending.BotProjectionJSON, "obs://private/pending") {
			t.Fatalf("pending delivery exposed or lost private candidate: public=%+v private=%+v raw=%s", afterPending, private, afterPending.BotProjectionJSON)
		}

		SyncBotRuns([]model.QuestionAgentLog{row})

		var promoted model.QuestionAgentLog
		if err := gdb.First(&promoted, row.Id).Error; err != nil {
			t.Fatal(err)
		}
		private, err = LoadBotConversationContext(context.Background(), "alice", row.Id)
		if err != nil {
			t.Fatal(err)
		}
		if promoted.Query != replacementInput.Query || promoted.ToolName != replacementInput.Tool ||
			promoted.Status != statusSucceeded || promoted.BotRunId != "run-private-replacement" ||
			!strings.Contains(promoted.Answer, "promoted replacement report") || private.Replacement != nil {
			t.Fatalf("ready delivery did not promote replacement: public=%+v private=%+v", promoted, private)
		}
	})

	for _, probe := range []struct {
		name string
		body string
	}{
		{
			name: "older ready delivery",
			body: `{"run_id":"run-private-replacement","agent":"research","status":"succeeded","task_ids":["task-private-replacement"],"result":{"report_revision":2,"final_report":"STALE READY REPORT","execution":{"output_dirs":["obs://private/stale"],"delivery":{"schema_version":1,"required":true,"status":"ready","revision":2,"inventory_digest":"` + testProjectionDigestA + `","archive":{"role":"result_archive","name":"research-results.zip","media_type":"application/zip","size_bytes":42,"downloadable":true,"report_context_eligible":false,"download_ref":"result-archive:` + testProjectionDigestA + `"},"error_code":null,"retryable":false}}}}`,
		},
		{
			name: "success omits active delivery",
			body: `{"run_id":"run-private-replacement","agent":"research","status":"succeeded","task_ids":["task-private-replacement"],"result":{"report_revision":4,"final_report":"MISSING DELIVERY REPORT"}}`,
		},
	} {
		t.Run("pending delivery rejects "+probe.name, func(t *testing.T) {
			gdb := setupTestDB(t)
			row, _, replacementInput := seedPrivateReplacementReconciliationRow(t, gdb, 456, "RUNNING")
			const pendingRevisionThree = `{"run_id":"run-private-replacement","agent":"research","status":"succeeded","task_ids":["task-private-replacement"],"result":{"report_revision":3,"final_report":"PRIVATE REVISION THREE","execution":{"output_dirs":["obs://private/pending-three"],"delivery":{"schema_version":1,"required":true,"status":"pending","revision":3,"inventory_digest":"` + testProjectionDigestA + `","archive":null,"error_code":null,"retryable":false}}}}`
			const readyRevisionThree = `{"run_id":"run-private-replacement","agent":"research","status":"succeeded","task_ids":["task-private-replacement"],"result":{"report_revision":3,"final_report":"# monotonic ready replacement","execution":{"output_dirs":["obs://private/ready-three"],"delivery":{"schema_version":1,"required":true,"status":"ready","revision":3,"inventory_digest":"` + testProjectionDigestA + `","archive":{"role":"result_archive","name":"research-results.zip","media_type":"application/zip","size_bytes":4097,"downloadable":true,"report_context_eligible":false,"download_ref":"result-archive:` + testProjectionDigestA + `"},"error_code":null,"retryable":false}}}}`
			botRunRecordSequenceServer(t, pendingRevisionThree, probe.body, readyRevisionThree)

			SyncBotRuns([]model.QuestionAgentLog{row})
			var afterPending model.QuestionAgentLog
			if err := gdb.First(&afterPending, row.Id).Error; err != nil {
				t.Fatal(err)
			}
			SyncBotRuns([]model.QuestionAgentLog{row})

			var afterProbe model.QuestionAgentLog
			if err := gdb.First(&afterProbe, row.Id).Error; err != nil {
				t.Fatal(err)
			}
			private, err := LoadBotConversationContext(context.Background(), "alice", row.Id)
			if err != nil {
				t.Fatal(err)
			}
			if afterProbe.Query != row.Query || afterProbe.Answer != row.Answer ||
				afterProbe.ToolName != row.ToolName || afterProbe.Status != row.Status ||
				afterProbe.BotRunId != row.BotRunId || private.Replacement == nil ||
				private.Replacement.ActiveStatus != "RUNNING" ||
				private.Replacement.ActiveReportRevision != 3 ||
				private.Replacement.ActiveDelivery == nil ||
				private.Replacement.ActiveDelivery.Revision != 3 ||
				private.Replacement.ActiveDelivery.Status != "pending" ||
				afterProbe.BotProjectionJSON != afterPending.BotProjectionJSON {
				t.Fatalf("stale/omitted delivery advanced candidate: public=%+v private=%+v", afterProbe, private)
			}

			SyncBotRuns([]model.QuestionAgentLog{row})
			var promoted model.QuestionAgentLog
			if err := gdb.First(&promoted, row.Id).Error; err != nil {
				t.Fatal(err)
			}
			private, err = LoadBotConversationContext(context.Background(), "alice", row.Id)
			if err != nil {
				t.Fatal(err)
			}
			if promoted.Query != replacementInput.Query ||
				promoted.ToolName != replacementInput.Tool || promoted.Status != statusSucceeded ||
				!strings.Contains(promoted.Answer, "monotonic ready replacement") ||
				private.Replacement != nil {
				t.Fatalf("current ready delivery did not promote: public=%+v private=%+v", promoted, private)
			}
		})
	}

	t.Run("delivery failure is private terminal", func(t *testing.T) {
		gdb := setupTestDB(t)
		row, _, _ := seedPrivateReplacementReconciliationRow(t, gdb, 454, "INPUT_REQUIRED")
		botRunRecordSequenceServer(t, failed)

		SyncBotRuns([]model.QuestionAgentLog{row})

		var stored model.QuestionAgentLog
		if err := gdb.First(&stored, row.Id).Error; err != nil {
			t.Fatal(err)
		}
		private, err := LoadBotConversationContext(context.Background(), "alice", row.Id)
		if err != nil {
			t.Fatal(err)
		}
		if stored.Query != row.Query || stored.Answer != row.Answer || stored.ToolName != row.ToolName ||
			stored.Status != row.Status || stored.BotRunId != row.BotRunId ||
			private.Replacement == nil || private.Replacement.TerminalResult == nil ||
			private.Replacement.TerminalResult.Status != "FAILED" ||
			strings.Contains(stored.BotProjectionJSON, "PRIVATE FAILED DELIVERY REPORT") ||
			strings.Contains(stored.BotProjectionJSON, "obs://private/failed") {
			t.Fatalf("delivery failure changed public or leaked projection: public=%+v private=%+v raw=%s", stored, private, stored.BotProjectionJSON)
		}
	})
}

func TestSyncBotRunsPrivateReplacementRejectsWrongAgentWithoutMutation(t *testing.T) {
	gdb := setupTestDB(t)
	row, _, _ := seedPrivateReplacementReconciliationRow(t, gdb, 455, "RUNNING")
	beforeRaw := row.BotProjectionJSON
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"run_id":"run-private-replacement","agent":"data","status":"succeeded","result":{"report_revision":2,"final_report":"wrong-agent replacement"}}`))
	}))
	t.Cleanup(server.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: server.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	SyncBotRuns([]model.QuestionAgentLog{row})

	var stored model.QuestionAgentLog
	if err := gdb.First(&stored, row.Id).Error; err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 || stored.Query != row.Query || stored.Answer != row.Answer ||
		stored.ToolName != row.ToolName || stored.Status != row.Status ||
		stored.BotRunId != row.BotRunId || stored.BotProjectionJSON != beforeRaw {
		t.Fatalf("wrong agent changed private replacement: calls=%d before=%+v after=%+v", calls.Load(), row, stored)
	}
}

func TestSyncBotRunsPrivateReplacementNonterminalProjectionStaysBounded(t *testing.T) {
	gdb := setupTestDB(t)
	row, _, _ := seedPrivateReplacementReconciliationRow(t, gdb, 451, "RUNNING")
	const forbiddenReport = "PRIVATE-CANDIDATE-REPORT-MUST-NOT-PERSIST"
	botRunRecordSequenceServer(t,
		`{"run_id":"run-private-replacement","agent":"research","status":"running","result":{"report_revision":3,"intermediate_report":"`+forbiddenReport+`"}}`,
	)

	SyncBotRuns([]model.QuestionAgentLog{row})

	var stored model.QuestionAgentLog
	if err := gdb.First(&stored, row.Id).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Query != row.Query || stored.Answer != row.Answer || stored.Status != row.Status ||
		stored.BotRunId != row.BotRunId {
		t.Fatalf("nonterminal replacement changed public base: before=%+v after=%+v", row, stored)
	}
	if strings.Contains(stored.BotProjectionJSON, forbiddenReport) {
		t.Fatalf("nonterminal private projection persisted report text: %s", stored.BotProjectionJSON)
	}
	var raw struct {
		ConversationContext struct {
			Replacement struct {
				ActiveStatus         string `json:"active_status"`
				ActiveBotRunID       string `json:"active_bot_run_id"`
				ActiveReportRevision int64  `json:"active_report_revision"`
			} `json:"replacement"`
		} `json:"conversation_context"`
	}
	if err := json.Unmarshal([]byte(stored.BotProjectionJSON), &raw); err != nil {
		t.Fatal(err)
	}
	active := raw.ConversationContext.Replacement
	if active.ActiveStatus != "RUNNING" || active.ActiveBotRunID != "run-private-replacement" ||
		active.ActiveReportRevision != 3 {
		t.Fatalf("bounded private active projection=%+v", active)
	}
}

func TestApplyBotRunProjectionRejectsStaleRunAfterRunIdentityChanged(t *testing.T) {
	gdb := setupTestDB(t)
	raw, err := marshalPersistedProjectionWithContext(
		BotRunProjection{ReportRevision: -1},
		&persistedConversationContext{ClientTurnID: "new-run-key"},
	)
	if err != nil {
		t.Fatal(err)
	}
	stored := model.QuestionAgentLog{
		Id: 452, DialogueId: "stale-poll-dialogue", UserName: "alice",
		Query: "new query", Answer: "new answer", ToolName: "InSilicoResearchAgent",
		Mode: "expert", Status: "RUNNING", BotRunId: "run-new",
		BotProjectionJSON: raw, BotReportRevision: -1,
	}
	if err := gdb.Create(&stored).Error; err != nil {
		t.Fatal(err)
	}
	stale := stored
	stale.BotRunId = "run-old"
	record := &rxBot.RunRecord{
		RunID: "run-old", Agent: "analyst", Status: "succeeded",
		Result: json.RawMessage(`{"report_revision":2,"final_report":"# stale old report"}`),
	}
	err = NewService().applyBotRunProjection(context.Background(), &stale, record, rxBot.ResponseMeta{})
	if !errors.Is(err, ErrBotProjectionConflict) {
		t.Fatalf("stale old-run projection error=%v, want ErrBotProjectionConflict", err)
	}
	var after model.QuestionAgentLog
	if err := gdb.First(&after, stored.Id).Error; err != nil {
		t.Fatal(err)
	}
	if after.BotRunId != stored.BotRunId || after.Status != stored.Status || after.Answer != stored.Answer ||
		after.BotProjectionJSON != stored.BotProjectionJSON {
		t.Fatalf("stale poll clobbered new run: before=%+v after=%+v", stored, after)
	}
}
