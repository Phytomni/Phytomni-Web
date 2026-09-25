package api_service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

const integrityScientificReport = "# Expression evidence\n\nThe perturbation failed to alter expression [1].\n"

func TestVisibleReportRejectsPlaceholderFinal(t *testing.T) {
	for _, final := range []string{"Task created: synthetic-task", "Server task created: synthetic-task", "FAILED", "  "} {
		t.Run(final, func(t *testing.T) {
			p := BotRunProjection{Agent: "deep_genome", Status: "FAILED", FinalReport: final, IntermediateReport: integrityScientificReport}
			if got := p.VisibleReport(); got != integrityScientificReport {
				t.Fatalf("selected=%q, want untouched intermediate science", got)
			}
		})
	}
}

func TestProjectionReportIntegrityMetadataRoundTrip(t *testing.T) {
	execution := json.RawMessage(`{"report":{"state":"degraded","degraded":true,"source_artifact_count":2},"warnings":[{"code":"report_synthesis_failed"},{"code":"private_unknown","message":"private diagnostic"}],"tracking":{"degraded":false}}`)
	runID := "run-report-integrity"
	for _, submission := range []bool{false, true} {
		t.Run(fmt.Sprintf("submission=%v", submission), func(t *testing.T) {
			var p BotRunProjection
			var err error
			if submission {
				p, err = DecodeAgentRunSubmission(rxBot.AgentRunResponse{RunID: &runID, Agent: "design", Status: "succeeded", Result: rxBot.AgentRunResult{Execution: execution}})
			} else {
				p, err = DecodeRunProjection(rxBot.RunRecord{RunID: runID, Agent: "design", Status: "succeeded", Result: json.RawMessage(`{"execution":` + string(execution) + `}`)})
			}
			if err != nil {
				t.Fatal(err)
			}
			for i := 0; i < 2; i++ {
				raw, err := marshalPersistedProjection(p)
				if err != nil {
					t.Fatal(err)
				}
				var stored map[string]json.RawMessage
				if err := json.Unmarshal([]byte(raw), &stored); err != nil {
					t.Fatal(err)
				}
				if string(stored["report"]) != `{"state":"degraded","degraded":true,"source_artifact_count":2}` || string(stored["report_warning_codes"]) != `["report_synthesis_failed"]` {
					t.Errorf("report metadata lost in roundtrip %d: %s", i, raw)
				}
				if strings.Contains(raw, "private_") || strings.Contains(raw, "private diagnostic") || p.Status != "SUCCEEDED" || p.TrackingDegraded {
					t.Fatal("scientific degradation changed execution/tracking or leaked unknown warnings")
				}
				p, _, err = unmarshalPersistedProjectionWithContext(raw)
				if err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}

func TestProjectionReportIntegrityMergeRejectsStaleReplacement(t *testing.T) {
	current := BotRunProjection{RunID: "run-report-integrity", Agent: "deep_genome", Status: "RUNNING", ReportRevision: 7, FinalReport: "Task created: synthetic-task", IntermediateReport: integrityScientificReport}
	incoming := BotRunProjection{RunID: current.RunID, Agent: current.Agent, Status: "FAILED", ReportRevision: 6, FinalReport: "Stale scientific synthesis"}
	merged, changed, err := MergeBotRunProjection(current, incoming)
	if err != nil {
		t.Fatal(err)
	}
	if !changed || merged.FinalReport != "" || merged.VisibleReport() != integrityScientificReport || merged.ReportRevision != 7 || merged.Status != "RUNNING" {
		t.Fatalf("merge=%+v changed=%v", merged, changed)
	}
	incoming.ReportRevision = 8
	incoming.FinalReport = ""
	merged, _, err = MergeBotRunProjection(merged, incoming)
	if err != nil || merged.VisibleReport() != integrityScientificReport || merged.Status != "FAILED" {
		t.Fatalf("terminal merge=%+v err=%v", merged, err)
	}
}

func TestProjectionReportIntegrityDeepGenomeChildren(t *testing.T) {
	for _, agent := range []string{"deep_genome", "analyst"} {
		t.Run(agent, func(t *testing.T) {
			p, err := DecodeRunProjection(rxBot.RunRecord{RunID: "run-child-integrity", Agent: agent, Status: "failed", TaskIDs: []string{"umbrella"}, Result: json.RawMessage(`{"progress":{"completed":12,"total":12,"failed":0},"execution":{"tasks":[{"task_id":"umbrella","status":"failed"},{"task_id":"real","kind":"protein_structure_analysis","status":"failed","error_code":"analysis_failed"}]}}`)})
			if err != nil {
				t.Fatal(err)
			}
			want := 2
			if agent == "deep_genome" {
				want = 1
			}
			if len(p.Children) != want || p.Children[len(p.Children)-1].Kind != "protein_structure_analysis" || p.Progress.Completed != 12 || p.Progress.Failed != 0 {
				t.Fatalf("child projection=%+v", p)
			}
		})
	}
}

func TestProjectionReportIntegrityHistoricalSelectionAndExport(t *testing.T) {
	gdb := setupTestDB(t)
	oldConfig := rxBot.BotConfig
	rxBot.BotConfig = nil
	t.Cleanup(func() { rxBot.BotConfig = oldConfig })
	raw, err := json.Marshal(map[string]any{"run_id": "run-history-integrity", "agent": "deep_genome", "status": "FAILED", "report_revision": 7, "final_report": "Task created: synthetic-task", "intermediate_report": integrityScientificReport})
	if err != nil {
		t.Fatal(err)
	}
	row := model.QuestionAgentLog{Id: 4000, UserName: "alice", DialogueId: "dlg-history-integrity", BotRunId: "run-history-integrity", ToolName: "DeepGenomeAgent", Status: "FAILED", BotReportRevision: 7, BotProjectionJSON: string(raw), Answer: `{"content":"Task created: synthetic-task","doc_list":[{"title":"Plant expression study"}]}`}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	service := NewService()
	for _, mode := range []HistoryReadMode{HistoryReadModeLegacy, HistoryReadModeDual, HistoryReadModeProjection} {
		result, err := service.AnswerCheckWithMode(context.Background(), "alice", row.DialogueId, mode)
		if err != nil || len(result.Rows) != 1 {
			t.Fatalf("history=%+v err=%v", result, err)
		}
		var answer struct {
			Content string           `json:"content"`
			DocList []map[string]any `json:"doc_list"`
		}
		if err := json.Unmarshal([]byte(result.Rows[0].Answer), &answer); err != nil {
			t.Fatal(err)
		}
		if answer.Content != integrityScientificReport || len(answer.DocList) != 1 || answer.DocList[0]["title"] != "Plant expression study" || result.Rows[0].Status != "FAILED" {
			t.Errorf("history mode=%s answer=%s", mode, result.Rows[0].Answer)
		}
	}
	content, _, err := service.DownloadObsRenderingFile(context.Background(), "alice", int(row.Id), "Markdown")
	if err != nil || !strings.Contains(string(content), "The perturbation failed to alter expression [1].") || strings.Contains(string(content), "Task created") || !strings.Contains(string(content), "Plant expression study") {
		t.Errorf("export=%s err=%v", content, err)
	}
	var stored model.QuestionAgentLog
	if err := gdb.First(&stored, row.Id).Error; err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(stored.BotProjectionJSON, row.BotProjectionJSON) || stored.Answer != row.Answer || stored.Status != row.Status {
		t.Fatal("historical read rewrote persisted content")
	}
}

func TestReportIntegritySharedValidity(t *testing.T) {
	raw, err := os.ReadFile("../../../web/tests/fixtures/report-integrity/report-validity.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Name     string `json:"name"`
			ToolName string `json:"tool_name"`
			Text     string `json:"text"`
			Valid    bool   `json:"valid"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil || len(fixture.Cases) == 0 {
		t.Fatalf("fixture err=%v cases=%d", err, len(fixture.Cases))
	}
	for _, tc := range fixture.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			if validReportText(tc.ToolName, tc.Text) != tc.Valid {
				t.Fatalf("validity mismatch for %q", tc.Text)
			}
			if tc.Valid && (BotRunProjection{Agent: tc.ToolName, FinalReport: tc.Text}).VisibleReport() != tc.Text {
				t.Fatal("valid science changed")
			}
		})
	}
	long := strings.Repeat("The failed assay constrained interpretation [1].\n", 2000)
	if got := (BotRunProjection{Agent: "deep_genome", FinalReport: long}).VisibleReport(); got != long {
		t.Fatal("long science changed")
	}
}

func TestReportIntegrityWarningRevisionAndPresence(t *testing.T) {
	current := BotRunProjection{RunID: "run-warning", Agent: "design", Status: "RUNNING", ReportRevision: 7, TrackingDegraded: true, Report: &rxBot.RunReport{State: "degraded", Degraded: true, SourceArtifactCount: 2}, ReportWarningCodes: []string{"report_synthesis_failed"}}
	for _, revision := range []int64{6, 7, 8} {
		t.Run(fmt.Sprint(revision), func(t *testing.T) {
			incoming := BotRunProjection{RunID: current.RunID, Agent: current.Agent, ReportRevision: revision, Report: &rxBot.RunReport{State: "none"}, ReportWarningCodes: []string{}}
			merged, _, err := MergeBotRunProjection(current, incoming)
			if err != nil {
				t.Fatal(err)
			}
			if revision == 6 {
				if !reflect.DeepEqual(merged, current) {
					t.Fatal("stale metadata overwrote report")
				}
			} else if merged.Report.State != "none" || merged.Report.Degraded || merged.ReportWarningCodes == nil || len(merged.ReportWarningCodes) != 0 || !merged.TrackingDegraded {
				t.Fatalf("explicit clear lost or tracking altered: %+v", merged)
			}
			raw, err := marshalPersistedProjection(merged)
			if err != nil {
				t.Fatal(err)
			}
			restored, _, err := unmarshalPersistedProjectionWithContext(raw)
			if err != nil || !reflect.DeepEqual(restored.ReportWarningCodes, merged.ReportWarningCodes) {
				t.Fatalf("roundtrip=%s err=%v", raw, err)
			}
			incoming.Report.State = "final"
			if merged.Report.State == "final" {
				t.Fatal("merge aliases descriptor")
			}
		})
	}
	for _, codes := range [][]string{nil, {}, {"private_unknown"}} {
		p := BotRunProjection{ReportWarningCodes: codes}
		raw, err := marshalPersistedProjection(p)
		if err != nil {
			t.Fatal(err)
		}
		var data map[string]json.RawMessage
		if err := json.Unmarshal([]byte(raw), &data); err != nil {
			t.Fatal(err)
		}
		_, present := data["report_warning_codes"]
		if present != (codes != nil) || (present && string(data["report_warning_codes"]) != "[]") {
			t.Fatalf("presence=%s", raw)
		}
	}
}

func TestReportIntegrityRejectsMalformedStoredReport(t *testing.T) {
	for _, raw := range []string{
		`{"report":{"state":"final"}}`,
		`{"report":{"state":"final","degraded":false,"source_artifact_count":-1}}`,
		`{"report":{"state":"final","degraded":false,"source_artifact_count":1000000001}}`,
		`{"report":{"state":"private diagnostic","degraded":false,"source_artifact_count":0}}`,
		`{"report":{"state":"final","state":"none","degraded":false,"source_artifact_count":0}}`,
		`{"report_warning_codes":[false]}`,
	} {
		if _, _, err := unmarshalPersistedProjectionWithContext(raw); err == nil {
			t.Errorf("accepted malformed stored report: %s", raw)
		}
	}
	if _, err := marshalPersistedProjection(BotRunProjection{Report: &rxBot.RunReport{State: "unknown"}}); err == nil {
		t.Fatal("persisted invalid report")
	}
}

func TestReportIntegrityHistoricalPublicProjection(t *testing.T) {
	gdb := setupTestDB(t)
	oldConfig := rxBot.BotConfig
	rxBot.BotConfig = nil
	t.Cleanup(func() { rxBot.BotConfig = oldConfig })
	raw := `{"run_id":"run-public-report","agent":"deep_genome","status":"FAILED","report_revision":17,"intermediate_report":"# Retained science","report":{"state":"intermediate","degraded":true,"source_artifact_count":12},"report_warning_codes":["deep_genome_report_degraded"],"progress":{"completed":12,"total":12,"failed":0},"children":[{"ordinal":1,"kind":"","phase":"FAILED","error_code":null}],"child_task_count":1}`
	row := model.QuestionAgentLog{Id: 3990, UserName: "alice", DialogueId: "dlg-public-report", BotRunId: "run-public-report", ToolName: "DeepGenomeAgent", Status: "FAILED", BotReportRevision: 17, BotProjectionJSON: raw}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	rows, err := NewService().AnswerCheck(context.Background(), "alice", row.DialogueId)
	if err != nil || len(rows) != 1 {
		t.Fatalf("history err=%v rows=%d", err, len(rows))
	}
	encoded, err := json.Marshal(rows[0])
	if err != nil {
		t.Fatal(err)
	}
	var public struct {
		Projection struct {
			Report   *rxBot.RunReport `json:"report"`
			Codes    []string         `json:"report_warning_codes"`
			Revision int64            `json:"report_revision"`
			Children []BotRunChild    `json:"children"`
			Progress struct {
				Completed int64 `json:"completed"`
			} `json:"progress"`
		} `json:"projection"`
	}
	if err := json.Unmarshal(encoded, &public); err != nil {
		t.Fatal(err)
	}
	if public.Projection.Report == nil || public.Projection.Report.State != "intermediate" || public.Projection.Revision != 17 || len(public.Projection.Codes) != 1 || public.Projection.Progress.Completed != 12 || len(public.Projection.Children) != 0 {
		t.Errorf("public report lost or phantom child retained: %s", encoded)
	}
	p := loadBotRunProjectionForTest(t, "alice", row.Id)
	if len(p.Children) != 0 || p.ChildTaskCount != 0 || p.Progress.Completed != 12 || p.Status != "FAILED" {
		t.Errorf("historical children=%+v", p)
	}
}

func TestReportIntegrityReconciliationKeepsReferenceBinding(t *testing.T) {
	gdb := setupTestDB(t)
	row := model.QuestionAgentLog{Id: 4010, UserName: "alice", DialogueId: "dlg-reference-integrity", BotRunId: "run-reference-integrity", ToolName: "DeepGenomeAgent", Status: "RUNNING", Answer: "Task created: synthetic"}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	botRunRecordSequenceServer(t,
		`{"run_id":"run-reference-integrity","agent":"deep_genome","status":"running","result":{"formatted":{"answer":"Evidence [1].","references":[{"title":"Original study"}]},"report_revision":7}}`,
		`{"run_id":"run-reference-integrity","agent":"deep_genome","status":"running","result":{"formatted":{"answer":"Stale evidence [1].","references":[{"title":"Stale study"}]},"report_revision":6}}`,
		`{"run_id":"run-reference-integrity","agent":"deep_genome","status":"failed","result":{"formatted":{"answer":""},"report_revision":8}}`,
	)
	for i := 0; i < 3; i++ {
		SyncBotRuns([]model.QuestionAgentLog{row})
		_, answer := readStatusAnswer(t, gdb, row.Id)
		var got struct {
			Content string           `json:"content"`
			DocList []map[string]any `json:"doc_list"`
		}
		if err := json.Unmarshal([]byte(answer), &got); err != nil {
			t.Fatal(err)
		}
		if got.Content != "Evidence [1]." || len(got.DocList) != 1 || got.DocList[0]["title"] != "Original study" {
			t.Errorf("poll=%d lost citation binding: %s", i, answer)
		}
	}
}

func TestReportIntegrityCanonicalSubmissionMetadata(t *testing.T) {
	runID := "run-canonical-metadata"
	p, err := DecodeAgentRunSubmission(rxBot.AgentRunResponse{RunID: &runID, Agent: "deep_genome", Status: "failed", TaskIDs: []string{"umbrella"}, Result: rxBot.AgentRunResult{
		Formatted: &rxBot.Formatted{Answer: integrityScientificReport, Metadata: json.RawMessage(`{"deep_genome":{"stage":"intermediate","completeness":"partial","revision":17,"updated_at":"2026-09-12T00:00:00Z","progress":{"succeeded":12,"total":12,"failed":0},"degraded":true}}`)},
		Execution: json.RawMessage(`{"report":{"state":"intermediate","degraded":true,"source_artifact_count":12},"tasks":[{"task_id":"umbrella","status":"failed"}]}`),
	}})
	if err != nil {
		t.Fatal(err)
	}
	if p.ReportRevision != 17 || p.ReportStage != "intermediate" || p.ReportCompleteness != "partial" || p.IntermediateReport != integrityScientificReport || p.FinalReport != "" || p.Progress.Completed != 12 || len(p.Children) != 0 || p.Status != "FAILED" || p.ReportUpdatedAt == nil {
		t.Fatalf("canonical metadata lost: %+v", p)
	}
}

func TestReportIntegrityCanonicalFinalContent(t *testing.T) {
	p, err := DecodeRunProjection(rxBot.RunRecord{RunID: "run-canonical-final", Agent: "deep_genome", Status: "succeeded", Result: json.RawMessage(`{"formatted":{"answer":"# Complete science","metadata":{"deep_genome":{"stage":"final","completeness":"complete","revision":18}}},"execution":{"report":{"state":"final","degraded":false,"source_artifact_count":12}}}`)})
	if err != nil {
		t.Fatal(err)
	}
	if p.FinalReport != "# Complete science" || p.IntermediateReport != "" {
		t.Fatalf("canonical final incorrectly partial: %+v", p)
	}
}

func TestReportIntegrityLifecycleNoScience(t *testing.T) {
	p := BotRunProjection{RunID: "run-no-science", Agent: "deep_genome", Status: "FAILED", ReportRevision: 4}
	for _, answer := range []string{"Task created: synthetic", `{"content":"Task created: synthetic","doc_list":[]}`} {
		if summary := lifecycleArtifactSummary(&model.QuestionAgentLog{Answer: answer}, p); summary.HasReport {
			t.Errorf("placeholder counted as report: %s", answer)
		}
	}
}
