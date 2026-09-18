package api_service

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

func loadBotRunProjectionForTest(t *testing.T, username string, id int64) BotRunProjection {
	t.Helper()
	projection, err := LoadBotRunProjection(context.Background(), username, id)
	if err != nil {
		t.Fatalf("load projection row %d: %v", id, err)
	}
	return projection
}

// applyBotRunRecordForTest exercises the current projection store and legacy
// history projector without restoring the removed production reconciler. It is
// intentionally test-only: production polling now runs through the unified
// execution runtime.
func applyBotRunRecordForTest(ctx context.Context, row *model.QuestionAgentLog, record *rxBot.RunRecord) error {
	if row == nil || record == nil {
		return fmt.Errorf("test projection requires a row and run record")
	}
	if strings.TrimSpace(row.UserName) == "" {
		return fmt.Errorf("test projection row has no owner")
	}

	incoming, err := DecodeRunProjection(record)
	if err != nil {
		return err
	}
	if incoming.RunID != strings.TrimSpace(row.BotRunId) {
		return fmt.Errorf("test projection run id %q does not match row", incoming.RunID)
	}
	formatted, _, hasFormatted := rxBot.ParseRunFormatted(record.Result)
	// Validate references before touching the durable projection, matching the
	// security boundary shared by the live history projector.
	if err := validateCitationReferencesForAgent(incoming.Agent, formatted); err != nil {
		return err
	}
	if err := saveBotRunProjectionForTest(ctx, row.UserName, row.Id, incoming); err != nil {
		return err
	}
	stored, err := LoadBotRunProjection(ctx, row.UserName, row.Id)
	if err != nil {
		return err
	}

	var durable model.QuestionAgentLog
	read := model.DB(ctx).Where("id = ? AND user_name = ? AND bot_run_id = ?", row.Id, row.UserName, row.BotRunId).First(&durable)
	if read.Error != nil {
		return read.Error
	}

	shapeFormatted := formatted
	answerProjected := false
	metadataCurrent := projectionMetadataMergeable(stored, incoming)
	if stored.Agent == "data" {
		answerProjected = metadataCurrent && hasFormattedTable(formatted)
	} else if strings.TrimSpace(stored.VisibleReport()) != "" {
		answerProjected = metadataCurrent && hasFormatted &&
			strings.TrimSpace(incoming.VisibleReport()) == strings.TrimSpace(stored.VisibleReport())
	}
	if !answerProjected {
		shapeFormatted = nil
	}
	if _, err := applyBotProjectionToHistoryRowWithFormatted(&durable, stored, shapeFormatted); err != nil {
		return err
	}

	updates := map[string]interface{}{
		"answer":    durable.Answer,
		"status":    durable.Status,
		"tool_name": durable.ToolName,
	}
	if answerProjected && formatted != nil {
		followUps := strings.TrimSpace(string(formatted.FollowUpQuestions))
		if followUps != "" && followUps != "null" {
			durable.FollowUpQuestions = string(formatted.FollowUpQuestions)
			updates["follow_up_questions"] = durable.FollowUpQuestions
		}
	}
	write := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where("id = ? AND user_name = ? AND bot_run_id = ? AND bot_report_revision = ?", row.Id, row.UserName, row.BotRunId, stored.ReportRevision).
		Updates(updates)
	if write.Error != nil {
		return write.Error
	}
	if write.RowsAffected != 1 {
		return ErrBotProjectionConflict
	}
	*row = durable
	return nil
}

func TestIndependentReviewPublicDiagnostics(t *testing.T) {
	gdb := setupTestDB(t)
	useOfflineLegacyHistoryMode(t)
	row := model.QuestionAgentLog{Id: 9101, UserName: "alice", DialogueId: "review-diagnostics", BotRunId: "run-review-diagnostics", ToolName: "DeepGenomeAgent", Status: "RUNNING"}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	record := rxBot.RunRecord{RunID: row.BotRunId, Agent: "deep_genome", Status: "failed", Result: json.RawMessage(`{"formatted":{"answer":"# Synthetic science"},"report_revision":2,"degraded_reason":"provider diagnostic at /srv/private/synthetic-owner","failures":[{"status":"failed","message":"download failed obs://synthetic-private/path?token=synthetic"}]}`)}
	if err := applyBotRunRecordForTest(context.Background(), &row, &record); err != nil {
		t.Fatal(err)
	}
	rows, err := NewService().AnswerCheck(context.Background(), row.UserName, row.DialogueId)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(rows)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "/srv/private/") || strings.Contains(string(encoded), "obs://synthetic-private/") {
		t.Fatalf("public history exposes unredacted diagnostics: %s", encoded)
	}
}

func TestIndependentReviewDataReconciliation(t *testing.T) {
	gdb := setupTestDB(t)
	row := model.QuestionAgentLog{Id: 9102, UserName: "alice", BotRunId: "run-review-data", ToolName: "DataAgent", Status: "RUNNING"}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	record := rxBot.RunRecord{RunID: row.BotRunId, Agent: "data", Status: "succeeded", Result: json.RawMessage(`{"formatted":{"answer":"Synthetic table result","tabular":{"headers":["gene"],"rows":[["SYNTHETIC_A"]]}},"report_revision":2}`)}
	if err := applyBotRunRecordForTest(context.Background(), &row, &record); err != nil {
		t.Fatal(err)
	}
	_, answer := readStatusAnswer(t, gdb, row.Id)
	if !strings.Contains(answer, "SYNTHETIC_A") {
		t.Fatalf("reconciliation erased formatted.tabular: %s", answer)
	}
}

func TestIndependentReviewDataExport(t *testing.T) {
	gdb := setupTestDB(t)
	row := model.QuestionAgentLog{Id: 9103, UserName: "alice", BotRunId: "run-review-data-export", ToolName: "DataAgent", Status: "SUCCEEDED", Answer: `{"headers":["gene"],"rows":[["SYNTHETIC_A"]]}`}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	if err := saveBotRunProjectionForTest(context.Background(), row.UserName, row.Id, BotRunProjection{RunID: row.BotRunId, Agent: "data", Status: "SUCCEEDED", ReportRevision: 2, FinalReport: "Synthetic table result"}); err != nil {
		t.Fatal(err)
	}
	content, _, err := NewService().DownloadObsRenderingFile(context.Background(), row.UserName, int(row.Id), "Markdown")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(content), "SYNTHETIC_A") {
		t.Fatalf("export discarded a durable nonempty table: %s", content)
	}
}

func TestIndependentReviewUnversionedMetadata(t *testing.T) {
	current := BotRunProjection{RunID: "run-review-unversioned", Agent: "deep_genome", Status: "RUNNING", ReportRevision: 9, IntermediateReport: "# Current science", Report: &rxBot.RunReport{State: "intermediate", Degraded: true, SourceArtifactCount: 12}, ReportWarningCodes: []string{"deep_genome_report_degraded"}}
	incoming := BotRunProjection{RunID: current.RunID, Agent: current.Agent, Status: "FAILED", ReportRevision: -1, IntermediateReport: "# Old submission science", Report: &rxBot.RunReport{State: "none"}, ReportWarningCodes: []string{}}
	merged, _, err := MergeBotRunProjection(current, incoming)
	if err != nil {
		t.Fatal(err)
	}
	if merged.VisibleReport() != current.VisibleReport() || merged.Report.State != current.Report.State || len(merged.ReportWarningCodes) != 1 {
		t.Fatalf("unversioned terminal snapshot rewrites revision %d report=%q metadata=%+v codes=%v", merged.ReportRevision, merged.VisibleReport(), merged.Report, merged.ReportWarningCodes)
	}
	if merged.Status != "FAILED" || merged.ReportRevision != current.ReportRevision {
		t.Fatalf("execution did not settle independently of revision: %+v", merged)
	}
}

func TestIndependentReviewRecognizedChildren(t *testing.T) {
	p, err := DecodeRunProjection(rxBot.RunRecord{RunID: "run-review-children", Agent: "deep_genome", Status: "failed", Result: json.RawMessage(`{"execution":{"tasks":[{"task_id":"umbrella","kind":"deep_genome","status":"failed"},{"task_id":"unknown","kind":"not_a_known_analysis","status":"failed"},{"task_id":"real","kind":"protein_structure_analysis","status":"succeeded"}]}}`)})
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Children) != 1 || p.ChildTaskCount != 1 {
		t.Fatalf("unrecognized/umbrella tasks counted as concrete analyses: %+v", p.Children)
	}
}

func TestIndependentReviewDirectDeepGenomeSubmission(t *testing.T) {
	runID := "run-review-submission"
	p, err := DecodeAgentRunSubmission(rxBot.AgentRunResponse{
		RunID:  &runID,
		Agent:  "deep_genome",
		Status: "failed",
		TaskIDs: []string{
			"synthetic-umbrella",
		},
		Result: rxBot.AgentRunResult{
			Formatted: &rxBot.Formatted{
				Answer:   "# Partial synthetic science",
				Metadata: json.RawMessage(`{"deep_genome":{"stage":"intermediate","completeness":"partial","revision":17,"degraded":true}}`),
			},
			Execution: json.RawMessage(`{"report":{"state":"intermediate","degraded":true,"source_artifact_count":12},"warnings":[{"code":"deep_genome_report_degraded"}]}`),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if p.Report == nil || p.ReportRevision != 17 {
		t.Fatalf("direct submission lost bounded facts: status=%s projection_run=%q revision=%d report=%+v codes=%v", p.Status, p.RunID, p.ReportRevision, p.Report, p.ReportWarningCodes)
	}
	if p.Status != "FAILED" || p.VisibleReport() != "# Partial synthetic science" || !reflect.DeepEqual(p.ReportWarningCodes, []string{"deep_genome_report_degraded"}) {
		t.Fatalf("direct submission lost scientific or execution truth: %+v", p)
	}
}

func TestReportIntegrityReviewDataTableSurvivesSnapshots(t *testing.T) {
	gdb := setupTestDB(t)
	useOfflineLegacyHistoryMode(t)
	row := model.QuestionAgentLog{Id: 9110, UserName: "alice", DialogueId: "review-table", BotRunId: "run-review-table", ToolName: "DataAgent", Status: "RUNNING"}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	for index, result := range []string{
		`{"report_revision":3,"formatted":{"answer":"","tabular":{"headers":["gene"],"rows":[["SYNTHETIC_A"]]},"follow_up_questions":["next gene"]}}`,
		`{"report_revision":4,"formatted":{"answer":"","tabular":null}}`,
		`{"report_revision":2,"formatted":{"answer":"stale table","tabular":{"headers":["gene"],"rows":[["STALE_B"]]}}}`,
		`{"formatted":{"answer":"unversioned table","tabular":{"headers":["gene"],"rows":[["STALE_C"]]}}}`,
	} {
		status := "running"
		if index == 3 {
			status = "failed"
		}
		record := rxBot.RunRecord{RunID: row.BotRunId, Agent: "data", Status: status, Result: json.RawMessage(result)}
		if err := applyBotRunRecordForTest(context.Background(), &row, &record); err != nil {
			t.Fatal(err)
		}
		_, answer := readStatusAnswer(t, gdb, row.Id)
		if answer != `{"headers":["gene"],"rows":[["SYNTHETIC_A"]]}` {
			t.Fatalf("snapshot %d changed table: %s", index, answer)
		}
		var stored model.QuestionAgentLog
		if err := gdb.Select("follow_up_questions").First(&stored, row.Id).Error; err != nil {
			t.Fatal(err)
		}
		if stored.FollowUpQuestions != `["next gene"]` {
			t.Fatalf("snapshot %d lost table follow-up questions: %s", index, stored.FollowUpQuestions)
		}
	}
	for _, mode := range []HistoryReadMode{HistoryReadModeLegacy, HistoryReadModeDual, HistoryReadModeProjection} {
		history, err := NewService().AnswerCheckWithMode(context.Background(), row.UserName, row.DialogueId, mode)
		if err != nil || len(history.Rows) != 1 || !strings.Contains(history.Rows[0].Answer, "SYNTHETIC_A") {
			t.Fatalf("history %s lost table: %+v err=%v", mode, history, err)
		}
	}
}

func TestReportIntegrityReviewPublicWarningsAreCodesOnly(t *testing.T) {
	p, err := DecodeRunProjection(rxBot.RunRecord{RunID: "run-public-codes", Agent: "deep_genome", Status: "failed", Result: json.RawMessage(`{"degraded_reason":"private reason","failures":["private failure"],"execution":{"warnings":[{"code":"report_synthesis_failed","message":"private warning"},{"code":"private_unknown"}]}}`)})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := marshalPersistedProjection(p)
	if err != nil {
		t.Fatal(err)
	}
	p, _, err = unmarshalPersistedProjectionWithContext(raw)
	if err != nil {
		t.Fatal(err)
	}
	public := publicBotProjection(p)
	for _, key := range []string{"degraded_reason", "failures", "warnings"} {
		if _, present := public[key]; present {
			t.Fatalf("free-text diagnostics exposed under %s", key)
		}
	}
	if !reflect.DeepEqual(public["report_warning_codes"], []string{"report_synthesis_failed"}) {
		t.Fatalf("recognized report codes lost: %v", public)
	}
}

func TestReportIntegrityReviewConcreteKindsRoundTrip(t *testing.T) {
	kinds := []string{"evolution_analysis", "gene_expression_tissues", "gene_expression_cultivars", "gene_expression_treatments", "gene_expression_genotypes", "single_cell_analysis", "promoter_analysis", "smep_analysis", "smoc_analysis", "protein_structure_analysis", "protein_design", "promoter_design"}
	p := BotRunProjection{RunID: "run-concrete-kinds", Agent: "deep_genome", Progress: ProjectionProgress{Total: 12, Completed: 11, Failed: 1}, Children: []BotRunChild{{Kind: "deep_genome", Phase: "FAILED"}, {Kind: "digital_design", Phase: "FAILED"}, {Kind: "unknown_analysis", Phase: "FAILED"}}}
	for _, kind := range kinds {
		p.Children = append(p.Children, BotRunChild{Kind: kind, Phase: "FAILED"})
	}
	p.ChildTaskCount = len(p.Children)
	raw, err := marshalPersistedProjection(p)
	if err != nil {
		t.Fatal(err)
	}
	loaded, _, err := unmarshalPersistedProjectionWithContext(raw)
	if err != nil || len(loaded.Children) != 12 || loaded.ChildTaskCount != 12 || loaded.Progress != p.Progress {
		t.Fatalf("concrete child projection=%+v err=%v", loaded, err)
	}
	for index, child := range loaded.Children {
		if child.Kind != kinds[index] || child.Ordinal != index+1 || child.Phase != "FAILED" {
			t.Fatalf("concrete child changed: %+v", child)
		}
	}
	empty := normalizeProjectionReports(BotRunProjection{Agent: "deep_genome", ChildTaskCount: 1})
	if empty.ChildTaskCount != 0 || len(empty.Children) != 0 {
		t.Fatalf("phantom count survived absent concrete children: %+v", empty)
	}
}

func TestReportIntegrityReviewDirectDeepGenomeRejectsMalformedReport(t *testing.T) {
	runID := "run-malformed-report"
	if _, err := DecodeAgentRunSubmission(rxBot.AgentRunResponse{
		RunID:  &runID,
		Agent:  "deep_genome",
		Status: "failed",
		Result: rxBot.AgentRunResult{Execution: json.RawMessage(`{"report":{"state":"final","degraded":false,"source_artifact_count":-1}}`)},
	}); err == nil {
		t.Fatal("direct submission bypassed report validation")
	}
}

func TestReportIntegrityReviewUnversionedDeliveryPreservesScience(t *testing.T) {
	gdb := setupTestDB(t)
	row := model.QuestionAgentLog{Id: 9111, UserName: "alice", BotRunId: "run-unversioned-delivery"}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	current := BotRunProjection{RunID: row.BotRunId, Agent: "analyst", Status: "RUNNING", ReportRevision: 9, IntermediateReport: "# Current science", ResultArchiveV1: true, Delivery: testPendingDelivery(1, testProjectionDigestA)}
	incoming := BotRunProjection{RunID: row.BotRunId, Agent: "analyst", Status: "SUCCEEDED", ReportRevision: -1, FinalReport: "# Stale science", ResultArchiveV1: true, Delivery: testReadyDelivery(1, testProjectionDigestA), OutputDirectoryCount: 1, Artifacts: ProjectionArtifacts{Directories: []string{"obs://bucket/owner/run"}, OutputDirs: []string{"obs://bucket/owner/run"}}}
	for _, snapshot := range []BotRunProjection{current, incoming} {
		if err := saveBotRunProjectionForTest(context.Background(), row.UserName, row.Id, snapshot); err != nil {
			t.Fatal(err)
		}
	}
	loaded := loadBotRunProjectionForTest(t, row.UserName, row.Id)
	if loaded.Status != "SUCCEEDED" || loaded.ReportRevision != 9 || loaded.VisibleReport() != current.VisibleReport() || loaded.Delivery.Status != "ready" {
		t.Fatalf("execution, science, or delivery lost: %+v", loaded)
	}
	if !reflect.DeepEqual(loaded.Artifacts.OutputDirs, incoming.Artifacts.OutputDirs) || loaded.OutputDirectoryCount != 1 {
		t.Fatalf("accepted delivery lost its authorized roots: %+v", loaded.Artifacts)
	}
	incoming.Delivery.Revision = 0
	incoming.ReportRevision = 10
	incoming.Artifacts.OutputDirs = []string{"obs://bucket/other/run"}
	incoming.Artifacts.Directories = append([]string(nil), incoming.Artifacts.OutputDirs...)
	if err := saveBotRunProjectionForTest(context.Background(), row.UserName, row.Id, incoming); err != nil {
		t.Fatal(err)
	}
	after := loadBotRunProjectionForTest(t, row.UserName, row.Id)
	if !reflect.DeepEqual(after.Artifacts, loaded.Artifacts) || !reflect.DeepEqual(after.Delivery, loaded.Delivery) {
		t.Fatalf("stale delivery changed archive scope: %+v", after)
	}
}

func TestIndependentReviewCanonicalProgressMapping(t *testing.T) {
	for _, value := range []string{"12", "-1", "1000000001", "1.5", `"12"`} {
		t.Run(value, func(t *testing.T) {
			result := json.RawMessage(fmt.Sprintf(`{"formatted":{"answer":"# Synthetic evidence","metadata":{"deep_genome":{"progress":{"succeeded":%s,"total":16,"failed":2,"pending":2}}}}}`, value))
			p, err := DecodeRunProjection(rxBot.RunRecord{RunID: "run-review-progress", Agent: "deep_genome", Status: "failed", Result: result})
			if value != "12" {
				if err == nil {
					t.Fatalf("malformed succeeded counter accepted: %s", value)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if p.Progress.Completed != 12 || p.Progress.Failed != 2 || p.Progress.Pending != 2 || p.Progress.Total != 16 || p.ChildTaskCount != 0 {
				t.Fatalf("incorrect mapped counters: %+v", p)
			}
			var wire struct {
				Formatted *rxBot.Formatted `json:"formatted"`
			}
			if err := json.Unmarshal(result, &wire); err != nil {
				t.Fatal(err)
			}
			runID := p.RunID
			submission, err := DecodeAgentRunSubmission(rxBot.AgentRunResponse{RunID: &runID, Agent: "deep_genome", Status: "failed", Result: rxBot.AgentRunResult{Formatted: wire.Formatted}})
			if err != nil || submission.Progress != p.Progress {
				t.Fatalf("submission progress differs: %+v err=%v", submission.Progress, err)
			}
		})
	}
}
