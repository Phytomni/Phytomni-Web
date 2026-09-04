package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"phytomni-server/model"
)

const (
	testProjectionDigestA = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	testProjectionDigestB = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
)

func testPendingDelivery(revision int64, digest string) *ProjectionDelivery {
	return &ProjectionDelivery{
		SchemaVersion:   1,
		Required:        true,
		Status:          "pending",
		Revision:        revision,
		InventoryDigest: digest,
	}
}

func testReadyDelivery(revision int64, digest string) *ProjectionDelivery {
	return &ProjectionDelivery{
		SchemaVersion:   1,
		Required:        true,
		Status:          "ready",
		Revision:        revision,
		InventoryDigest: digest,
		ArchiveName:     "analyst-results.zip",
		ArchiveSize:     4097,
		ArchiveRef:      "obs://bucket/owner/run/delivery/" + strings.TrimPrefix(digest, "sha256:") + "/analyst-results.zip",
	}
}

func testFailedDelivery(revision int64, digest string, retryable bool) *ProjectionDelivery {
	return &ProjectionDelivery{
		SchemaVersion:   1,
		Required:        true,
		Status:          "failed",
		Revision:        revision,
		InventoryDigest: digest,
		ErrorCode:       "archive_publish_failed",
		Retryable:       retryable,
	}
}

func TestMergeBotRunProjectionRejectsOlderBlankReport(t *testing.T) {
	current := BotRunProjection{RunID: "run-1", ReportRevision: 4, IntermediateReport: "visible", Degraded: true}
	incoming := BotRunProjection{RunID: "run-1", ReportRevision: 3}
	merged, changed, err := MergeBotRunProjection(current, incoming)
	if err != nil || changed || merged.IntermediateReport != "visible" {
		t.Fatalf("merged=%#v changed=%v err=%v", merged, changed, err)
	}
}

func TestMergeBotRunProjectionPreservesNewerWorkStageFromStaleSnapshot(t *testing.T) {
	current := BotRunProjection{
		RunID: "run-stage", Status: "RUNNING", WorkStage: "planning", ReportRevision: 4,
	}
	incoming := BotRunProjection{
		RunID: "run-stage", Status: "RUNNING", WorkStage: "input_resolution", ReportRevision: 3,
	}
	merged, changed, err := MergeBotRunProjection(current, incoming)
	if err != nil || changed || merged.WorkStage != "planning" {
		t.Fatalf("merged=%#v changed=%v err=%v", merged, changed, err)
	}
}

func TestMergeBotRunProjectionRejectsInvalidWorkStage(t *testing.T) {
	for _, stage := range []string{"unknown", strings.Repeat("x", 65)} {
		merged, changed, err := MergeBotRunProjection(
			BotRunProjection{RunID: "run-invalid-stage", Status: "RUNNING", ReportRevision: 1},
			BotRunProjection{RunID: "run-invalid-stage", Status: "RUNNING", WorkStage: stage, ReportRevision: 2},
		)
		if err == nil || changed || merged.RunID != "" {
			t.Fatalf("stage=%q merged=%#v changed=%v err=%v, want rejection", stage, merged, changed, err)
		}
	}
}

func TestPersistedProjectionStoresOnlyFiniteWorkStage(t *testing.T) {
	encoded, err := marshalPersistedProjection(BotRunProjection{
		RunID: "run-stage", Status: "RUNNING", WorkStage: "report_assembly", ReportRevision: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(encoded, `"work_stage":"report_assembly"`) {
		t.Fatalf("persisted projection missing finite work stage: %s", encoded)
	}

	if _, err := marshalPersistedProjection(BotRunProjection{WorkStage: "unknown"}); err == nil {
		t.Fatal("invalid work stage persisted")
	}
	if _, _, err := unmarshalPersistedProjectionWithContext(`{"status":"RUNNING","work_stage":"unknown","report_revision":1}`); err == nil {
		t.Fatal("invalid persisted work stage restored")
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

func TestMergeBotRunProjectionAcceptsUnversionedTerminalOverZeroRevision(t *testing.T) {
	current := BotRunProjection{
		RunID: "run-design-wait", Status: "RUNNING", ReportRevision: 0, ResultArchiveV1: true,
		Delivery: testPendingDelivery(1, testProjectionDigestA),
	}
	incoming := BotRunProjection{
		RunID: "run-design-wait", Status: "SUCCEEDED", ReportRevision: -1,
		FinalReport: "...terminal outcome...", ResultArchiveV1: true,
		Delivery: testReadyDelivery(1, testProjectionDigestA),
	}
	merged, changed, err := MergeBotRunProjection(current, incoming)
	if err != nil {
		t.Fatal(err)
	}
	if !changed || merged.Status != "SUCCEEDED" || merged.VisibleReport() != "...terminal outcome..." {
		t.Fatalf("merged=%#v changed=%v, want SUCCEEDED with terminal report", merged, changed)
	}
	if merged.ReportRevision != 0 {
		t.Fatalf("report revision=%d, want stored 0 (do not persist -1)", merged.ReportRevision)
	}
	if merged.Delivery == nil || merged.Delivery.Status != "ready" {
		t.Fatalf("delivery=%#v, want ready", merged.Delivery)
	}
}

func TestMergeBotRunProjectionAcceptsUnversionedSucceededOnBothSentinels(t *testing.T) {
	current := BotRunProjection{RunID: "run-both-sentinel", Status: "RUNNING", ReportRevision: -1}
	incoming := BotRunProjection{
		RunID: "run-both-sentinel", Status: "SUCCEEDED", ReportRevision: -1, FinalReport: "done",
	}
	merged, changed, err := MergeBotRunProjection(current, incoming)
	if err != nil {
		t.Fatal(err)
	}
	if !changed || merged.Status != "SUCCEEDED" || merged.VisibleReport() != "done" || merged.ReportRevision != -1 {
		t.Fatalf("merged=%#v changed=%v", merged, changed)
	}
}

func TestMergeBotRunProjectionAcceptsUnversionedTerminalOverPositiveRevision(t *testing.T) {
	current := BotRunProjection{
		RunID: "run-rev5", Status: "RUNNING", ReportRevision: 5, IntermediateReport: "partial",
	}
	incoming := BotRunProjection{
		RunID: "run-rev5", Status: "SUCCEEDED", ReportRevision: -1, FinalReport: "final",
	}
	merged, changed, err := MergeBotRunProjection(current, incoming)
	if err != nil {
		t.Fatal(err)
	}
	if !changed || merged.Status != "SUCCEEDED" || merged.VisibleReport() != "final" || merged.ReportRevision != 5 {
		t.Fatalf("merged=%#v changed=%v, want SUCCEEDED at stored revision 5", merged, changed)
	}
}

func TestMergeBotRunProjectionKeepsTerminalAgainstUnversionedFailure(t *testing.T) {
	current := BotRunProjection{
		RunID: "run-already-done", Status: "SUCCEEDED", ReportRevision: 0, FinalReport: "kept",
	}
	incoming := BotRunProjection{
		RunID: "run-already-done", Status: "FAILED", ReportRevision: -1, FinalReport: "should not replace",
	}
	merged, changed, err := MergeBotRunProjection(current, incoming)
	if err != nil {
		t.Fatal(err)
	}
	if changed || merged.Status != "SUCCEEDED" || merged.VisibleReport() != "kept" {
		t.Fatalf("merged=%#v changed=%v, want stored success kept", merged, changed)
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

func TestMergeBotRunProjectionMergesDeliveryRevisionIndependently(t *testing.T) {
	t.Run("lower delivery revision ignores mismatched digest", func(t *testing.T) {
		current := BotRunProjection{
			RunID: "run-delivery", ReportRevision: 4, ResultArchiveV1: true,
			Delivery: testReadyDelivery(2, testProjectionDigestA),
		}
		incoming := BotRunProjection{
			RunID: "run-delivery", ReportRevision: 4, ResultArchiveV1: true,
			Delivery: testFailedDelivery(1, testProjectionDigestB, true),
		}
		merged, changed, err := MergeBotRunProjection(current, incoming)
		if err != nil || changed || !reflect.DeepEqual(merged.Delivery, current.Delivery) {
			t.Fatalf("merged=%#v changed=%v err=%v", merged, changed, err)
		}
	})

	t.Run("same revision initializes pending digest once", func(t *testing.T) {
		current := BotRunProjection{
			RunID: "run-init", Status: "RUNNING", ReportRevision: 1, ResultArchiveV1: true,
			Delivery: testPendingDelivery(1, ""),
		}
		incoming := BotRunProjection{
			RunID: "run-init", Status: "RUNNING", ReportRevision: 1, ResultArchiveV1: true,
			Delivery: testPendingDelivery(1, testProjectionDigestA),
		}
		merged, changed, err := MergeBotRunProjection(current, incoming)
		if err != nil || !changed || merged.Delivery == nil || merged.Delivery.InventoryDigest != testProjectionDigestA {
			t.Fatalf("merged=%#v changed=%v err=%v", merged, changed, err)
		}
	})

	t.Run("same revision pending advances to ready", func(t *testing.T) {
		current := BotRunProjection{
			RunID: "run-ready", Status: "RUNNING", ReportRevision: 2, ResultArchiveV1: true,
			Delivery: testPendingDelivery(1, testProjectionDigestA),
		}
		incoming := BotRunProjection{
			RunID: "run-ready", Status: "SUCCEEDED", ReportRevision: 2, ResultArchiveV1: true,
			Delivery: testReadyDelivery(1, testProjectionDigestA),
		}
		merged, changed, err := MergeBotRunProjection(current, incoming)
		if err != nil || !changed || merged.Delivery == nil || merged.Delivery.Status != "ready" || merged.Status != "SUCCEEDED" {
			t.Fatalf("merged=%#v changed=%v err=%v", merged, changed, err)
		}
	})

	t.Run("same revision failed cannot regress ready", func(t *testing.T) {
		current := BotRunProjection{
			RunID: "run-terminal", Status: "SUCCEEDED", ReportRevision: 2, ResultArchiveV1: true,
			Delivery: testReadyDelivery(1, testProjectionDigestA),
		}
		incoming := BotRunProjection{
			RunID: "run-terminal", Status: "SUCCEEDED", ReportRevision: 2, ResultArchiveV1: true,
			Delivery: testFailedDelivery(1, testProjectionDigestA, true),
		}
		merged, changed, err := MergeBotRunProjection(current, incoming)
		if err != nil || changed || merged.Delivery == nil || merged.Delivery.Status != "ready" {
			t.Fatalf("merged=%#v changed=%v err=%v", merged, changed, err)
		}
	})

	t.Run("ready descriptor is immutable", func(t *testing.T) {
		current := BotRunProjection{
			RunID: "run-immutable", Status: "SUCCEEDED", ReportRevision: 2, ResultArchiveV1: true,
			Delivery: testReadyDelivery(1, testProjectionDigestA),
		}
		incoming := current
		incoming.Delivery = testReadyDelivery(1, testProjectionDigestA)
		incoming.Delivery.ArchiveName = "replacement.zip"
		incoming.Delivery.ArchiveRef = "obs://bucket/owner/run/delivery/replacement.zip"
		merged, changed, err := MergeBotRunProjection(current, incoming)
		if err != nil || changed || !reflect.DeepEqual(merged.Delivery, current.Delivery) {
			t.Fatalf("merged=%#v changed=%v err=%v", merged, changed, err)
		}
	})
}

func TestMergeBotRunProjectionAcceptsOnlyValidManualRetry(t *testing.T) {
	current := BotRunProjection{
		RunID: "run-retry", Status: "SUCCEEDED", ReportRevision: 5, ResultArchiveV1: true,
		Delivery: testFailedDelivery(1, testProjectionDigestA, true),
	}
	incoming := BotRunProjection{
		RunID: "run-retry", Status: "SUCCEEDED", ReportRevision: 5, ResultArchiveV1: true,
		Delivery: testPendingDelivery(2, testProjectionDigestA),
	}
	merged, changed, err := MergeBotRunProjection(current, incoming)
	if err != nil || !changed || merged.Delivery == nil || merged.Delivery.Status != "pending" || merged.Delivery.Revision != 2 {
		t.Fatalf("merged=%#v changed=%v err=%v", merged, changed, err)
	}

	invalidCurrent := []struct {
		name     string
		delivery *ProjectionDelivery
	}{
		{name: "nonretryable failed", delivery: testFailedDelivery(1, testProjectionDigestA, false)},
		{name: "pending", delivery: testPendingDelivery(1, testProjectionDigestA)},
		{name: "ready", delivery: testReadyDelivery(1, testProjectionDigestA)},
	}
	for _, tc := range invalidCurrent {
		t.Run(tc.name, func(t *testing.T) {
			base := current
			base.Delivery = tc.delivery
			got, accepted, mergeErr := MergeBotRunProjection(base, incoming)
			if mergeErr == nil || accepted || got.RunID != "" {
				t.Fatalf("merged=%#v changed=%v err=%v, want rejected retry", got, accepted, mergeErr)
			}
		})
	}
}

func TestMergeBotRunProjectionRejectsDeliveryDigestMutation(t *testing.T) {
	current := BotRunProjection{
		RunID: "run-digest", Status: "RUNNING", ReportRevision: 2, ResultArchiveV1: true,
		Delivery: testPendingDelivery(1, testProjectionDigestA),
	}
	incoming := BotRunProjection{
		RunID: "run-digest", Status: "SUCCEEDED", ReportRevision: 2, ResultArchiveV1: true,
		Delivery: testReadyDelivery(1, testProjectionDigestB),
	}
	merged, changed, err := MergeBotRunProjection(current, incoming)
	if err == nil || changed || merged.RunID != "" {
		t.Fatalf("merged=%#v changed=%v err=%v, want digest mutation rejected", merged, changed, err)
	}
}

func TestMergeBotRunProjectionKeepsReportAndDeliveryRevisionsIndependent(t *testing.T) {
	current := BotRunProjection{
		RunID: "run-independent", Status: "SUCCEEDED", ReportRevision: 5, FinalReport: "new report", ResultArchiveV1: true,
		Delivery: testPendingDelivery(1, testProjectionDigestA),
	}
	olderReportReady := BotRunProjection{
		RunID: "run-independent", Status: "SUCCEEDED", ReportRevision: 4, FinalReport: "old report", ResultArchiveV1: true,
		Delivery: testReadyDelivery(1, testProjectionDigestA),
	}
	merged, changed, err := MergeBotRunProjection(current, olderReportReady)
	if err != nil || !changed || merged.ReportRevision != 5 || merged.FinalReport != "new report" || merged.Delivery == nil || merged.Delivery.Status != "ready" {
		t.Fatalf("older-report merge=%#v changed=%v err=%v", merged, changed, err)
	}

	newerReportStaleDelivery := BotRunProjection{
		RunID: "run-independent", Status: "SUCCEEDED", ReportRevision: 6, FinalReport: "latest report", ResultArchiveV1: true,
		Delivery: testPendingDelivery(0, testProjectionDigestA),
	}
	merged, changed, err = MergeBotRunProjection(merged, newerReportStaleDelivery)
	if err != nil || !changed || merged.ReportRevision != 6 || merged.FinalReport != "latest report" || merged.Delivery == nil || merged.Delivery.Status != "ready" {
		t.Fatalf("newer-report merge=%#v changed=%v err=%v", merged, changed, err)
	}
}

func TestMergeBotRunProjectionRejectsActiveV1SuccessWithoutDelivery(t *testing.T) {
	current := BotRunProjection{
		RunID: "run-missing-delivery", Status: "RUNNING", ReportRevision: 1, ResultArchiveV1: true,
		Delivery: testPendingDelivery(1, testProjectionDigestA),
	}
	incoming := BotRunProjection{RunID: "run-missing-delivery", Status: "SUCCEEDED", ReportRevision: 2}
	merged, changed, err := MergeBotRunProjection(current, incoming)
	if err == nil || changed || merged.RunID != "" {
		t.Fatalf("merged=%#v changed=%v err=%v, want missing delivery rejected", merged, changed, err)
	}
}

func TestMergeBotRunProjectionDeepClonesDelivery(t *testing.T) {
	current := BotRunProjection{
		RunID: "run-clone", ReportRevision: 1, ResultArchiveV1: true,
		Delivery: testReadyDelivery(1, testProjectionDigestA),
	}
	merged, _, err := MergeBotRunProjection(current, BotRunProjection{RunID: "run-clone", ReportRevision: 0})
	if err != nil {
		t.Fatal(err)
	}
	merged.Delivery.ArchiveName = "mutated.zip"
	if current.Delivery.ArchiveName != "analyst-results.zip" {
		t.Fatalf("current delivery mutated through clone: %#v", current.Delivery)
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
		Agent:              "analyst",
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
		ResultArchiveV1:  true,
		Delivery:         testReadyDelivery(2, testProjectionDigestA),
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
	for _, required := range []string{"\"result_archive_v1\":true", testProjectionDigestA, incoming.Delivery.ArchiveRef} {
		if !strings.Contains(raw, required) {
			t.Fatalf("persisted delivery field %q missing from JSON: %s", required, raw)
		}
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
	if !loaded.ResultArchiveV1 || !reflect.DeepEqual(loaded.Delivery, incoming.Delivery) {
		t.Fatalf("loaded delivery=%#v incoming=%#v", loaded.Delivery, incoming.Delivery)
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

func TestLoadBotRunProjectionNormalizesPersistedCompletedReviewPause(t *testing.T) {
	setupTestDB(t)
	if err := setupProjectionRow(16, "alice@example.com", 2, `{
		"run_id":"run-review-persisted",
		"agent":"review",
		"status":"INPUT_REQUIRED",
		"report_revision":2,
		"intermediate_report":"# Persisted complete review"
	}`); err != nil {
		t.Fatal(err)
	}

	loaded, err := LoadBotRunProjection(context.Background(), "alice@example.com", 16)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Status != "SUCCEEDED" || loaded.VisibleReport() != "# Persisted complete review" {
		t.Fatalf("persisted completed Review projection=%#v", loaded)
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
