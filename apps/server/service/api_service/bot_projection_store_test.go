package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"phytomni-server/model"
)

func TestMergeBotRunProjectionRejectsOlderBlankReport(t *testing.T) {
	current := BotRunProjection{RunID: "run-1", ReportRevision: 4, IntermediateReport: "visible", Degraded: true}
	incoming := BotRunProjection{RunID: "run-1", ReportRevision: 3}
	merged, changed, err := MergeBotRunProjection(current, incoming)
	if err != nil || changed || merged.IntermediateReport != "visible" {
		t.Fatalf("merged=%#v changed=%v err=%v", merged, changed, err)
	}
}

func TestMergeBotRunProjectionRejectsEqualBlankReport(t *testing.T) {
	current := BotRunProjection{RunID: "run-1", ReportRevision: 4, FinalReport: "visible", Status: "RUNNING"}
	incoming := BotRunProjection{RunID: "run-1", ReportRevision: 4, Status: "SUCCEEDED"}
	merged, changed, err := MergeBotRunProjection(current, incoming)
	if err != nil {
		t.Fatal(err)
	}
	if !changed || merged.VisibleReport() != "visible" || merged.Status != "SUCCEEDED" {
		t.Fatalf("merged=%#v changed=%v", merged, changed)
	}
}

func TestMergeBotRunProjectionAcceptsNewerVisibleReport(t *testing.T) {
	current := BotRunProjection{RunID: "run-1", ReportRevision: 1, IntermediateReport: "old"}
	incoming := BotRunProjection{RunID: "run-1", ReportRevision: 2, FinalReport: "new", Status: "SUCCEEDED"}
	merged, changed, err := MergeBotRunProjection(current, incoming)
	if err != nil {
		t.Fatal(err)
	}
	if !changed || merged.ReportRevision != 2 || merged.VisibleReport() != "new" || merged.Status != "SUCCEEDED" {
		t.Fatalf("merged=%#v changed=%v", merged, changed)
	}
}

func TestMergeBotRunProjectionPreservesChildCountAndTerminalStatus(t *testing.T) {
	cases := []struct {
		name     string
		current  BotRunProjection
		incoming BotRunProjection
		status   string
		children int
	}{
		{
			name:     "running child count advances",
			current:  BotRunProjection{RunID: "run-child-advance", Status: "RUNNING", ReportRevision: 1},
			incoming: BotRunProjection{RunID: "run-child-advance", Status: "RUNNING", ReportRevision: 2, ChildTaskCount: 2},
			status:   "RUNNING",
			children: 2,
		},
		{
			name:     "stale child count cannot disappear",
			current:  BotRunProjection{RunID: "run-child-retain", Status: "RUNNING", ReportRevision: 1, ChildTaskCount: 2},
			incoming: BotRunProjection{RunID: "run-child-retain", Status: "RUNNING", ReportRevision: 2},
			status:   "RUNNING",
			children: 2,
		},
		{
			name:     "succeeded cannot downgrade to running",
			current:  BotRunProjection{RunID: "run-succeeded", Status: "SUCCEEDED", ReportRevision: 1},
			incoming: BotRunProjection{RunID: "run-succeeded", Status: "RUNNING", ReportRevision: 2},
			status:   "SUCCEEDED",
		},
		{
			name:     "failed cannot downgrade to running",
			current:  BotRunProjection{RunID: "run-failed", Status: "FAILED", ReportRevision: 1},
			incoming: BotRunProjection{RunID: "run-failed", Status: "RUNNING", ReportRevision: 2},
			status:   "FAILED",
		},
		{
			name:     "cancelled cannot change to succeeded",
			current:  BotRunProjection{RunID: "run-cancelled", Status: "CANCELLED", ReportRevision: 1},
			incoming: BotRunProjection{RunID: "run-cancelled", Status: "SUCCEEDED", ReportRevision: 2},
			status:   "CANCELLED",
		},
		{
			name:     "terminal snapshot still adds visible metadata",
			current:  BotRunProjection{RunID: "run-terminal-metadata", Status: "SUCCEEDED", ReportRevision: 1},
			incoming: BotRunProjection{RunID: "run-terminal-metadata", Status: "FAILED", ReportRevision: 2, FinalReport: "finished", Artifacts: ProjectionArtifacts{Paths: []string{"obs://bucket/run-terminal-metadata/report.md"}}},
			status:   "SUCCEEDED",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			merged, _, err := MergeBotRunProjection(tc.current, tc.incoming)
			if err != nil {
				t.Fatal(err)
			}
			if merged.Status != tc.status || merged.ChildTaskCount != tc.children {
				t.Fatalf("merged=%#v want status=%q childTaskCount=%d", merged, tc.status, tc.children)
			}
			if tc.name == "terminal snapshot still adds visible metadata" && (merged.FinalReport != "finished" || len(merged.Artifacts.Paths) != 1) {
				t.Fatalf("terminal metadata not merged=%#v", merged)
			}
		})
	}
}

func TestSaveBotRunProjectionCannotCrossOwner(t *testing.T) {
	setupTestDB(t)
	if err := setupProjectionRow(9, "bob@example.com", -1, ""); err != nil {
		t.Fatal(err)
	}
	err := SaveBotRunProjection(context.Background(), "alice@example.com", 9, BotRunProjection{RunID: "run-9", ReportRevision: 1})
	if !errors.Is(err, ErrBotProjectionNotFound) {
		t.Fatalf("err=%v", err)
	}
}

func TestLoadBotRunProjectionCannotCrossOwner(t *testing.T) {
	setupTestDB(t)
	if err := setupProjectionRow(10, "bob@example.com", 1, "{\"run_id\":\"run-10\",\"report_revision\":1}"); err != nil {
		t.Fatal(err)
	}
	_, err := LoadBotRunProjection(context.Background(), "alice@example.com", 10)
	if !errors.Is(err, ErrBotProjectionNotFound) {
		t.Fatalf("err=%v", err)
	}
}

func TestSaveAndLoadBotRunProjectionStoresOnlyPublicFields(t *testing.T) {
	gdb := setupTestDB(t)
	if err := setupProjectionRow(11, "alice@example.com", -1, ""); err != nil {
		t.Fatal(err)
	}
	updatedAt := time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC)
	incoming := BotRunProjection{
		RunID:              "run-11",
		Agent:              "research",
		Status:             "SUCCEEDED",
		ReportStage:        "final",
		ReportCompleteness: "complete",
		ReportRevision:     3,
		ReportUpdatedAt:    &updatedAt,
		IntermediateReport: "# Intermediate",
		FinalReport:        "# Final",
		Progress: ProjectionProgress{
			Completed:       2,
			Total:           2,
			Failed:          0,
			Pending:         0,
			BriefGeneStatus: "succeeded",
		},
		Degraded:       true,
		DegradedReason: "optional work failed",
		Failures:       []string{"optional work failed"},
		Artifacts: ProjectionArtifacts{
			Directories: []string{"obs://bucket/run-11"},
			OutputDirs:  []string{"obs://bucket/run-11"},
			Paths:       []string{"obs://bucket/run-11/report.md"},
		},
		RequestID:        "bot-request-secret",
		TrackingDegraded: true,
		ChildTaskCount:   2,
		RawPayload:       []byte("{\"token\":\"must-not-persist\"}"),
	}
	if err := SaveBotRunProjection(context.Background(), "alice@example.com", 11, incoming); err != nil {
		t.Fatal(err)
	}

	var raw string
	if err := gdb.Raw("SELECT bot_projection_json FROM question_agent_logs WHERE id = ?", 11).Scan(&raw).Error; err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(raw, "\"report_revision\":3") {
		t.Fatalf("revision missing from JSON: %s", raw)
	}
	if !strings.Contains(raw, "\"child_task_count\":2") {
		t.Fatalf("child task count missing from JSON: %s", raw)
	}
	for _, forbidden := range []string{"RawPayload", "raw_payload", "must-not-persist", "bot-request-secret", "private-child-a", "private-child-b"} {
		if strings.Contains(raw, forbidden) {
			t.Fatalf("private field %q serialized: %s", forbidden, raw)
		}
	}
	var public map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &public); err != nil {
		t.Fatalf("invalid projection JSON: %v", err)
	}
	if _, ok := public["request_id"]; ok {
		t.Fatalf("response metadata request_id serialized: %s", raw)
	}

	loaded, err := LoadBotRunProjection(context.Background(), "alice@example.com", 11)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.RunID != incoming.RunID || loaded.ReportRevision != incoming.ReportRevision || loaded.VisibleReport() != incoming.VisibleReport() {
		t.Fatalf("loaded=%#v incoming=%#v", loaded, incoming)
	}
	if loaded.RequestID != "" || loaded.RawPayload != nil {
		t.Fatalf("private metadata loaded=%#v", loaded)
	}
	if !loaded.TrackingDegraded || loaded.ChildTaskCount != 2 || loaded.Progress.Completed != 2 || len(loaded.Artifacts.Paths) != 1 {
		t.Fatalf("loaded public projection=%#v", loaded)
	}

	var revision int64
	if err := gdb.Raw("SELECT bot_report_revision FROM question_agent_logs WHERE id = ?", 11).Scan(&revision).Error; err != nil {
		t.Fatal(err)
	}
	if revision != incoming.ReportRevision {
		t.Fatalf("indexed revision=%d want %d", revision, incoming.ReportRevision)
	}
}

func TestLoadBotRunProjectionReadsLegacyJSON(t *testing.T) {
	setupTestDB(t)
	if err := setupProjectionRow(15, "alice@example.com", 1, `{"run_id":"run-15","status":"RUNNING","report_revision":1}`); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadBotRunProjection(context.Background(), "alice@example.com", 15)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.ChildTaskCount != 0 {
		t.Fatalf("legacy child task count=%d want 0", loaded.ChildTaskCount)
	}
}

func TestSaveBotRunProjectionPreservesVisibleReportFromOlderBlankSnapshot(t *testing.T) {
	setupTestDB(t)
	current := BotRunProjection{RunID: "run-12", ReportRevision: 4, IntermediateReport: "visible"}
	if err := seedProjection(t, 12, "alice@example.com", current); err != nil {
		t.Fatal(err)
	}
	if err := SaveBotRunProjection(context.Background(), "alice@example.com", 12, BotRunProjection{RunID: "run-12", ReportRevision: 3}); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadBotRunProjection(context.Background(), "alice@example.com", 12)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.ReportRevision != 4 || loaded.VisibleReport() != "visible" {
		t.Fatalf("older blank snapshot clobbered current=%#v", loaded)
	}
}

func TestSaveBotRunProjectionConcurrentUpdatesDoNotClobberNewest(t *testing.T) {
	setupTestDB(t)
	if err := seedProjection(t, 13, "alice@example.com", BotRunProjection{RunID: "run-13", ReportRevision: 1, IntermediateReport: "seed"}); err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for _, report := range []BotRunProjection{
		{RunID: "run-13", ReportRevision: 2, IntermediateReport: "revision two"},
		{RunID: "run-13", ReportRevision: 3, FinalReport: "revision three"},
	} {
		wg.Add(1)
		go func(incoming BotRunProjection) {
			defer wg.Done()
			errs <- SaveBotRunProjection(context.Background(), "alice@example.com", 13, incoming)
		}(report)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil && !errors.Is(err, ErrBotProjectionConflict) {
			t.Fatalf("concurrent save error=%v", err)
		}
	}

	loaded, err := LoadBotRunProjection(context.Background(), "alice@example.com", 13)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.ReportRevision != 3 || loaded.VisibleReport() != "revision three" {
		t.Fatalf("concurrent save lost newest snapshot=%#v", loaded)
	}
}

func TestSaveBotRunProjectionPreservesPrivateConversationContext(t *testing.T) {
	setupTestDB(t)
	if err := setupProjectionRow(14, "alice@example.com", 1, `{"run_id":"run-14","status":"RUNNING"}`); err != nil {
		t.Fatal(err)
	}
	privateContext := validPersistedConversationContext()
	if err := SaveBotConversationContext(context.Background(), "alice@example.com", 14, privateContext); err != nil {
		t.Fatal(err)
	}
	if err := SaveBotRunProjection(context.Background(), "alice@example.com", 14, BotRunProjection{
		RunID:          "run-14",
		Status:         "SUCCEEDED",
		ReportRevision: 2,
		FinalReport:    "final answer",
	}); err != nil {
		t.Fatal(err)
	}

	gotContext, err := LoadBotConversationContext(context.Background(), "alice@example.com", 14)
	if err != nil {
		t.Fatal(err)
	}
	if gotContext.ClientTurnID != privateContext.ClientTurnID || gotContext.SettlementState != privateContext.SettlementState || len(gotContext.ArtifactRefs) != 1 {
		t.Fatalf("public projection save clobbered context=%#v", gotContext)
	}
	gotProjection, err := LoadBotRunProjection(context.Background(), "alice@example.com", 14)
	if err != nil {
		t.Fatal(err)
	}
	if gotProjection.ReportRevision != 2 || gotProjection.VisibleReport() != "final answer" {
		t.Fatalf("public projection=%#v", gotProjection)
	}
}

func setupProjectionRow(id int64, owner string, revision int64, projectionJSON string) error {
	return model.Default().Exec("INSERT INTO question_agent_logs (id, user_name, bot_report_revision, bot_projection_json) VALUES (?, ?, ?, ?)", id, owner, revision, projectionJSON).Error
}

func seedProjection(t *testing.T, id int64, owner string, projection BotRunProjection) error {
	t.Helper()
	encoded, err := json.Marshal(map[string]interface{}{
		"run_id":              projection.RunID,
		"report_revision":     projection.ReportRevision,
		"intermediate_report": projection.IntermediateReport,
		"final_report":        projection.FinalReport,
	})
	if err != nil {
		return err
	}
	return model.Default().Exec("INSERT INTO question_agent_logs (id, user_name, bot_report_revision, bot_projection_json) VALUES (?, ?, ?, ?)", id, owner, projection.ReportRevision, encoded).Error
}
