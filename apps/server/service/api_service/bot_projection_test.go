package api_service

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	rxBot "phytomni-server/external/bot"
)

func loadRunRecordFixture(t *testing.T, name string) rxBot.RunRecord {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	raw, err := os.ReadFile(filepath.Join(filepath.Dir(filename), "..", "..", "external", "bot", "testdata", "head", name))
	if err != nil {
		t.Fatalf("read fixture %q: %v", name, err)
	}
	var record rxBot.RunRecord
	if err := json.Unmarshal(raw, &record); err != nil {
		t.Fatalf("decode fixture %q: %v", name, err)
	}
	return record
}

func TestDecodeRunProjectionKeepsIntermediateWhenFinalIsMissing(t *testing.T) {
	got, err := DecodeRunProjection(loadRunRecordFixture(t, "deep_genome_intermediate.json"))
	if err != nil {
		t.Fatal(err)
	}
	if got.RunID != "run-dg-1" || got.ReportRevision != 2 || got.VisibleReport() != "# Intermediate" {
		t.Fatalf("projection=%#v", got)
	}
	if got.Status != "RUNNING" || !got.Degraded || got.Progress.Completed != 1 || got.Progress.Total != 2 {
		t.Fatalf("intermediate state=%#v", got)
	}
}

func TestDecodeRunProjectionCompletesReviewPauseWithFormattedAnswer(t *testing.T) {
	tests := []struct {
		name       string
		answer     string
		wantAnswer string
		wantStatus string
	}{
		{name: "completed answer", answer: "# Complete review\n\nFinal evidence-backed answer.", wantAnswer: "# Complete review\n\nFinal evidence-backed answer.", wantStatus: "SUCCEEDED"},
		{name: "blank answer remains paused", answer: "  \n\t", wantStatus: "INPUT_REQUIRED"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			formatted, err := json.Marshal(map[string]string{"answer": tc.answer})
			if err != nil {
				t.Fatal(err)
			}
			result, err := json.Marshal(map[string]json.RawMessage{"formatted": formatted})
			if err != nil {
				t.Fatal(err)
			}

			got, err := DecodeRunProjection(rxBot.RunRecord{
				RunID:  "run-review-poll",
				Agent:  "review",
				Status: "input_required",
				Result: result,
			})
			if err != nil {
				t.Fatal(err)
			}
			if got.Status != tc.wantStatus || got.VisibleReport() != tc.wantAnswer {
				t.Fatalf("projection=%#v want status=%q answer=%q", got, tc.wantStatus, tc.wantAnswer)
			}
		})
	}
}

func TestDecodeRunProjectionPrefersFinalAndRejectsPrivatePayload(t *testing.T) {
	got, err := DecodeRunProjection(loadRunRecordFixture(t, "deep_genome_final.json"))
	if err != nil {
		t.Fatal(err)
	}
	if got.VisibleReport() != "# Final" || got.RawPayload != nil {
		t.Fatalf("projection leaked raw=%#v", got)
	}
	if got.ReportUpdatedAt == nil || got.ReportUpdatedAt.IsZero() || got.Progress.Completed != 2 || got.Progress.Total != 2 {
		t.Fatalf("final metadata=%#v", got)
	}
}

func TestDecodeRunProjectionPrefersCanonicalArchiveDelivery(t *testing.T) {
	digest := "sha256:" + strings.Repeat("2", 64)
	record := rxBot.RunRecord{
		RunID:  "run-archive-ready",
		Agent:  "research",
		Status: "succeeded",
		Result: json.RawMessage(`{
			"formatted":{"answer":"# Canonical report"},
			"artifacts":[{"output_dir":"obs://bucket/legacy","paths":["obs://bucket/legacy/old.txt"]}],
			"execution":{
				"output_dirs":["obs://bucket/owner/run"],
				"artifacts":[{"download_ref":"obs://bucket/owner/run/private.tsv"}],
				"delivery":{
					"schema_version":1,"required":true,"status":"ready","revision":1,
					"inventory_digest":"` + digest + `",
					"archive":{"role":"result_archive","name":"research-results.zip","media_type":"application/zip","size_bytes":4097,"downloadable":true,"report_context_eligible":false,"download_ref":"result-archive:` + digest + `"},
					"error_code":null,"retryable":false
				}
			}
		}`),
	}

	got, err := DecodeRunProjection(record)
	if err != nil {
		t.Fatal(err)
	}
	if !got.ResultArchiveV1 || got.Delivery == nil || got.Delivery.Status != "ready" {
		t.Fatalf("delivery projection = %#v", got)
	}
	if got.VisibleReport() != "# Canonical report" || !reflect.DeepEqual(got.Artifacts.OutputDirs, []string{"obs://bucket/owner/run"}) {
		t.Fatalf("canonical projection = %#v", got)
	}
	expectedArchiveRef := "obs://bucket/owner/run/delivery/" + strings.TrimPrefix(digest, "sha256:") + "/research-results.zip"
	if len(got.Artifacts.Paths) != 0 || got.Delivery.ArchiveRef != expectedArchiveRef {
		t.Fatalf("canonical artifacts = %#v delivery=%#v", got.Artifacts, got.Delivery)
	}
	browserJSON, err := json.Marshal(struct {
		Delivery *ProjectionDelivery `json:"delivery"`
	}{Delivery: got.Delivery})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(browserJSON), "download_ref") ||
		strings.Contains(string(browserJSON), "result-archive:") ||
		strings.Contains(string(browserJSON), digest) ||
		strings.Contains(string(browserJSON), expectedArchiveRef) {
		t.Fatalf("server-only archive reference leaked: %s", browserJSON)
	}
}

func TestDecodeRunProjectionRetainsLegacyArtifactsWithoutDeliveryMarker(t *testing.T) {
	record := rxBot.RunRecord{
		RunID:  "run-legacy-artifacts",
		Agent:  "research",
		Status: "succeeded",
		Result: json.RawMessage(`{
			"formatted":{"answer":"legacy report"},
			"execution":{"output_dirs":["obs://bucket/canonical-without-marker"],"delivery":null},
			"artifacts":[{"output_dir":"obs://bucket/legacy","paths":["obs://bucket/legacy/result.txt"]}]
		}`),
	}
	got, err := DecodeRunProjection(record)
	if err != nil {
		t.Fatal(err)
	}
	if got.ResultArchiveV1 || got.Delivery != nil {
		t.Fatalf("legacy record activated v1: %#v", got)
	}
	if !reflect.DeepEqual(got.Artifacts.Paths, []string{"obs://bucket/legacy/result.txt"}) {
		t.Fatalf("legacy artifacts = %#v", got.Artifacts)
	}
}

func TestDecodeRunProjectionRejectsMalformedCanonicalDelivery(t *testing.T) {
	digest := "sha256:" + strings.Repeat("3", 64)
	results := []json.RawMessage{
		json.RawMessage(`{"execution":{"output_dirs":["obs://bucket/owner/run"],"delivery":{"schema_version":1,"required":true,"status":"ready","revision":1,"inventory_digest":"` + digest + `","archive":{"role":"result_archive","name":"analyst-results.zip","media_type":"application/zip","size_bytes":1,"downloadable":true,"report_context_eligible":false,"download_ref":"result-archive:` + digest + `"},"error_code":null,"retryable":false}}}`),
		json.RawMessage(`{"execution":{"output_dirs":["obs://bucket/owner/run"],"delivery":{"schema_version":1,"required":true,"status":"pending","status":"ready","revision":1,"inventory_digest":"","archive":null,"error_code":null,"retryable":false}}}`),
	}
	for _, result := range results {
		got, err := DecodeRunProjection(rxBot.RunRecord{RunID: "run-malformed-delivery", Agent: "research", Status: "succeeded", Result: result})
		if err == nil {
			t.Fatalf("malformed canonical delivery accepted: %#v", got)
		}
	}
}

func TestDecodeRunProjectionStoresOnlyBoundedChildCount(t *testing.T) {
	privateChildren := []string{"private-child-a", "private-child-b"}
	projection, err := DecodeRunProjection(&rxBot.RunRecord{
		RunID: "run-child-count", Agent: "analyst", Status: "running", TaskIDs: privateChildren,
	})
	if err != nil {
		t.Fatal(err)
	}
	if projection.ChildTaskCount != len(privateChildren) {
		t.Fatalf("child task count=%d want %d", projection.ChildTaskCount, len(privateChildren))
	}
	persisted, err := marshalPersistedProjection(projection)
	if err != nil {
		t.Fatal(err)
	}
	for _, privateChild := range privateChildren {
		if strings.Contains(persisted, privateChild) {
			t.Fatalf("persisted projection retained private child %q: %s", privateChild, persisted)
		}
	}
}

func TestDecodeRunProjectionAcceptsFiniteWorkStages(t *testing.T) {
	for _, stage := range []string{"input_resolution", "planning", "execution", "report_assembly"} {
		t.Run(stage, func(t *testing.T) {
			projection, err := DecodeRunProjection(rxBot.RunRecord{
				RunID: "run-stage", Agent: "research", Status: "running", Stage: stage,
			})
			if err != nil {
				t.Fatal(err)
			}
			if projection.WorkStage != stage {
				t.Fatalf("work stage=%q want %q", projection.WorkStage, stage)
			}
		})
	}
}

func TestDecodeRunProjectionDropsInvalidWorkStageWithoutChangingRunningStatus(t *testing.T) {
	for _, stage := range []string{"unknown", strings.Repeat("x", 65)} {
		projection, err := DecodeRunProjection(rxBot.RunRecord{
			RunID: "run-legacy-stage", Agent: "research", Status: "running", Stage: stage,
		})
		if err != nil {
			t.Fatalf("stage %q rejected otherwise valid legacy run: %v", stage, err)
		}
		if projection.WorkStage != "" || projection.Status != "RUNNING" {
			t.Fatalf("projection=%#v, want sanitized generic RUNNING", projection)
		}
	}
}

func TestDecodeRunProjectionRejectsExcessChildCount(t *testing.T) {
	_, err := DecodeRunProjection(rxBot.RunRecord{
		RunID: "run-too-many-children", Agent: "analyst", Status: "running",
		TaskIDs: make([]string, maxProjectionChildTasks+1),
	})
	var projectionErr *ProjectionDecodeError
	if !errors.As(err, &projectionErr) {
		t.Fatalf("error=%T %v, want *ProjectionDecodeError", err, err)
	}
	if projectionErr.Field != "task_ids" {
		t.Fatalf("field=%q want task_ids", projectionErr.Field)
	}
}

func TestDecodeRunProjectionMatrix(t *testing.T) {
	longFailure := strings.Repeat("x", maxProjectionFailureMessage+1)
	cases := []struct {
		name       string
		record     rxBot.RunRecord
		wantStatus string
		wantReport string
		wantErr    bool
		check      func(t *testing.T, got BotRunProjection)
	}{
		{
			name: "brief gene failure",
			record: rxBot.RunRecord{
				RunID:  "run-brief-failure",
				Agent:  "brief_gene",
				Status: "failed",
				Result: json.RawMessage(`{"report_stage":"waiting_for_brief_gene","report_completeness":"none","report_revision":1,"failures":[{"work_item_key":"brief_gene","status":"failed","message":"brief gene unavailable"}]}`),
			},
			wantStatus: "FAILED",
			check: func(t *testing.T, got BotRunProjection) {
				if len(got.Failures) != 1 || got.Failures[0] != "brief gene unavailable" {
					t.Fatalf("failures=%v", got.Failures)
				}
			},
		},
		{
			name:       "optional failure keeps intermediate",
			record:     loadRunRecordFixture(t, "deep_genome_intermediate.json"),
			wantStatus: "RUNNING",
			wantReport: "# Intermediate",
			check: func(t *testing.T, got BotRunProjection) {
				if got.DegradedReason == "" || len(got.Failures) != 1 {
					t.Fatalf("degraded=%#v", got)
				}
			},
		},
		{
			name: "final synthesis failure keeps intermediate",
			record: rxBot.RunRecord{
				RunID:  "run-final-failure",
				Agent:  "deep_genome",
				Status: "failed",
				Result: json.RawMessage(`{"report_stage":"final","report_completeness":"partial","report_revision":4,"intermediate_report":"# Keep","final_report":"","failures":[{"work_item_key":"synthesis","status":"failed","message":"final synthesis failed"}]}`),
			},
			wantStatus: "FAILED",
			wantReport: "# Keep",
			check: func(t *testing.T, got BotRunProjection) {
				if got.FinalReport != "" || len(got.Failures) != 1 {
					t.Fatalf("synthesis failure=%#v", got)
				}
			},
		},
		{
			name:       "terminal remote artifacts",
			record:     loadRunRecordFixture(t, "remote_terminal_artifacts.json"),
			wantStatus: "SUCCEEDED",
			wantReport: "# Terminal",
			check: func(t *testing.T, got BotRunProjection) {
				if len(got.Artifacts.Directories) != 1 || got.Artifacts.Directories[0] != "obs://synthetic-bucket/run-terminal-1" {
					t.Fatalf("artifact directories=%v", got.Artifacts.Directories)
				}
				if len(got.Artifacts.Paths) != 2 || got.Artifacts.Paths[1] != "obs://synthetic-bucket/run-terminal-1/data.tsv" {
					t.Fatalf("artifact paths=%v", got.Artifacts.Paths)
				}
			},
		},
		{
			name: "blank report",
			record: rxBot.RunRecord{
				RunID:  "run-blank-report",
				Agent:  "research",
				Status: "succeeded",
				Result: json.RawMessage(`{"report_stage":"final","report_completeness":"complete","report_revision":1}`),
			},
			wantStatus: "SUCCEEDED",
			check: func(t *testing.T, got BotRunProjection) {
				if got.VisibleReport() != "" {
					t.Fatalf("blank report=%q", got.VisibleReport())
				}
			},
		},
		{
			name: "negative revision",
			record: rxBot.RunRecord{
				RunID:  "run-negative-revision",
				Agent:  "deep_genome",
				Status: "running",
				Result: json.RawMessage(`{"report_revision":-1,"intermediate_report":"# nope"}`),
			},
			wantErr: true,
		},
		{
			name: "malformed run id",
			record: rxBot.RunRecord{
				RunID:  "   ",
				Agent:  "deep_genome",
				Status: "running",
				Result: json.RawMessage(`{"report_revision":1}`),
			},
			wantErr: true,
		},
		{
			name: "overlong failure message",
			record: rxBot.RunRecord{
				RunID:  "run-overlong-failure",
				Agent:  "analyst",
				Status: "failed",
				Result: json.RawMessage(`{"failures":[` + `{"work_item_key":"task","status":"failed","message":"` + longFailure + `"}` + `]}`),
			},
			wantErr: true,
		},
		{
			name: "empty artifact path list",
			record: rxBot.RunRecord{
				RunID:  "run-empty-artifact-paths",
				Agent:  "research",
				Status: "succeeded",
				Result: json.RawMessage(`{"report_revision":1,"artifacts":[{"output_dir":"obs://synthetic-bucket/run-empty","paths":[]}]}`),
			},
			wantStatus: "SUCCEEDED",
			check: func(t *testing.T, got BotRunProjection) {
				if len(got.Artifacts.Directories) != 1 || len(got.Artifacts.Paths) != 0 {
					t.Fatalf("empty artifact paths=%#v", got.Artifacts)
				}
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := DecodeRunProjection(tc.record)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected typed error, got projection=%#v", got)
				}
				var projectionErr *ProjectionDecodeError
				if !errors.As(err, &projectionErr) {
					t.Fatalf("error=%T %v, want *ProjectionDecodeError", err, err)
				}
				if !reflect.DeepEqual(got, BotRunProjection{}) {
					t.Fatalf("malformed result returned partial projection=%#v", got)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got.Status != tc.wantStatus {
				t.Fatalf("status=%q want %q", got.Status, tc.wantStatus)
			}
			if tc.wantReport != "" && got.VisibleReport() != tc.wantReport {
				t.Fatalf("report=%q want %q", got.VisibleReport(), tc.wantReport)
			}
			if tc.check != nil {
				tc.check(t, got)
			}
		})
	}
}

func TestDecodeRunProjectionRejectsMalformedEnvelopeAndUnsafeArtifacts(t *testing.T) {
	cases := []rxBot.RunRecord{
		{RunID: "run-malformed-json", Agent: "research", Status: "running", Result: json.RawMessage(`{"progress":`)},
		{RunID: "run-negative-progress", Agent: "research", Status: "running", Result: json.RawMessage(`{"progress":{"completed":-1,"total":1}}`)},
		{RunID: "run-invalid-artifact", Agent: "research", Status: "succeeded", Result: json.RawMessage(`{"artifacts":[{"output_dir":"https://evil.invalid/x","paths":["obs://bucket/x"]}]}`)},
	}
	for _, record := range cases {
		got, err := DecodeRunProjection(record)
		if err == nil {
			t.Fatalf("record=%#v unexpectedly decoded as %#v", record, got)
		}
		var projectionErr *ProjectionDecodeError
		if !errors.As(err, &projectionErr) {
			t.Fatalf("error=%T %v, want *ProjectionDecodeError", err, err)
		}
		if !reflect.DeepEqual(got, BotRunProjection{}) {
			t.Fatalf("malformed record returned partial projection=%#v", got)
		}
	}
}

func TestDecodeRunProjectionSubmissionDegradedTrackingIsExplicit(t *testing.T) {
	var response rxBot.AgentRunResponse
	decodeFixtureForProjectionTest(t, "agent_run_degraded.json", &response)

	if _, err := DecodeRunProjection(response); err == nil {
		t.Fatal("poll decoder accepted AgentRunResponse submission")
	} else {
		var projectionErr *ProjectionDecodeError
		if !errors.As(err, &projectionErr) {
			t.Fatalf("poll decoder error=%T %v, want *ProjectionDecodeError", err, err)
		}
	}
	got, err := DecodeAgentRunSubmission(response)
	if err != nil {
		t.Fatal(err)
	}
	if got.RunID != "" || !got.TrackingDegraded || got.Agent != "analyst" || got.Status != "SUCCEEDED" {
		t.Fatalf("degraded submission projection=%#v", got)
	}
	if got.VisibleReport() != "Synthetic degraded answer" {
		t.Fatalf("degraded answer=%q", got.VisibleReport())
	}
}

func TestDecodeAgentRunSubmissionNormalizesNativeRunIdentity(t *testing.T) {
	stringPtr := func(value string) *string { return &value }
	tests := []struct {
		name      string
		id        *string
		runID     *string
		wantRunID string
		wantError bool
	}{
		{name: "native id only", id: stringPtr("run-native"), wantRunID: "run-native"},
		{name: "compatibility alias only", runID: stringPtr("run-compat"), wantRunID: "run-compat"},
		{name: "matching fields", id: stringPtr(" run-matching "), runID: stringPtr("run-matching"), wantRunID: "run-matching"},
		{name: "conflicting fields", id: stringPtr("run-primary"), runID: stringPtr("run-conflict"), wantError: true},
		{name: "missing fields", wantError: true},
		{name: "blank native id", id: stringPtr(" "), wantError: true},
		{name: "malformed native id", id: stringPtr("run/native"), wantError: true},
		{name: "control character in alias", runID: stringPtr("run-\x00compat"), wantError: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			response := rxBot.AgentRunResponse{
				ID:      tt.id,
				RunID:   tt.runID,
				Agent:   "analyst",
				Status:  "running",
				TaskIDs: []string{"task-native-submit"},
			}

			got, err := DecodeAgentRunSubmission(response)
			if tt.wantError {
				if err == nil {
					t.Fatalf("DecodeAgentRunSubmission unexpectedly returned %#v", got)
				}
				var projectionErr *ProjectionDecodeError
				if !errors.As(err, &projectionErr) || projectionErr.Field != "run_id" {
					t.Fatalf("error = %T %v, want run_id ProjectionDecodeError", err, err)
				}
				if !reflect.DeepEqual(got, BotRunProjection{}) {
					t.Fatalf("invalid identity returned partial projection %#v", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("DecodeAgentRunSubmission: %v", err)
			}
			if got.RunID != tt.wantRunID {
				t.Fatalf("submission run id = %q, want %q", got.RunID, tt.wantRunID)
			}
		})
	}
}

func TestDecodeAgentRunSubmissionRequiredInteropFailureIsTerminal(t *testing.T) {
	response := rxBot.AgentRunResponse{
		Agent:  "research",
		Status: "running",
		Result: rxBot.AgentRunResult{Formatted: &rxBot.Formatted{
			Answer:   "required peer failed",
			Metadata: json.RawMessage(`{"status":"FAILED","interop":[{"target_id":"mcp-peer","kind":"mcp","capability":"secret-capability","status":"failed","latency_ms":42,"endpoint":"https://private.invalid","credential":"token"}]}`),
		}},
	}

	got, err := DecodeAgentRunSubmission(response)
	if err != nil {
		t.Fatalf("DecodeAgentRunSubmission: %v", err)
	}
	if got.Status != "FAILED" || got.RunID != "" {
		t.Fatalf("terminal failure projection=%#v", got)
	}
	if got.InterOp == nil || got.InterOp.Status != "failed" || got.InterOp.TargetID != "mcp-peer" || got.InterOp.Kind != "mcp" {
		t.Fatalf("failed interop projection=%#v", got.InterOp)
	}
	encoded, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"secret-capability", "latency_ms", "private.invalid", "credential", "token"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("private interop field %q crossed projection boundary: %s", forbidden, encoded)
		}
	}
}

func TestDecodeAgentRunSubmissionNonInteropMetadataCannotTerminalize(t *testing.T) {
	runID := "run-ordinary-submit"
	response := rxBot.AgentRunResponse{
		RunID:  &runID,
		Agent:  "analyst",
		Status: "running",
		Result: rxBot.AgentRunResult{Formatted: &rxBot.Formatted{
			Answer:   "ordinary answer",
			Metadata: json.RawMessage(`{"status":"FAILED","degraded_interop":true,"interop":[{"target_id":"mcp-peer","kind":"mcp","status":"failed","code":"interop_failed"}]}`),
		}},
	}

	got, err := DecodeAgentRunSubmission(response)
	if err != nil {
		t.Fatalf("DecodeAgentRunSubmission: %v", err)
	}
	if got.Status != "RUNNING" || got.InterOp != nil || got.DegradedInterop {
		t.Fatalf("ordinary submission projection=%#v", got)
	}
}

func TestDecodeRunProjectionNestedInteropMetadataIsBounded(t *testing.T) {
	record := rxBot.RunRecord{
		RunID:   "run-nested-interop",
		Agent:   "research",
		Status:  "running",
		TaskIDs: []string{"task-nested-interop"},
		Result:  json.RawMessage(`{"formatted":{"answer":"degraded local answer","metadata":{"interop":[{"target_id":"mcp-peer","kind":"mcp","capability":"hidden","status":"degraded","latency_ms":12,"peer_payload":{"secret":"no"}}],"degraded_interop":true}}}`),
	}

	got, err := DecodeRunProjection(record)
	if err != nil {
		t.Fatalf("DecodeRunProjection: %v", err)
	}
	if got.Status != "RUNNING" || !got.DegradedInterop || got.InterOp == nil || got.InterOp.Status != "degraded" || got.InterOp.TargetID != "mcp-peer" || got.InterOp.Kind != "mcp" {
		t.Fatalf("nested degraded projection=%#v", got)
	}
	encoded, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"hidden", "latency_ms", "peer_payload", "secret"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("private nested field %q crossed projection boundary: %s", forbidden, encoded)
		}
	}
}

func TestDecodeRunProjectionPollingNestedInteropCompletedPreservesSafeFields(t *testing.T) {
	record := rxBot.RunRecord{
		RunID:   "run-poll-interop",
		Agent:   "design",
		Status:  "succeeded",
		Result:  json.RawMessage(`{"formatted":{"answer":"delegated answer","metadata":{"status":"SUCCESS","interop":[{"target_id":"a2a-peer","kind":"a2a","capability":"design","status":"completed","latency_ms":9}]}}}`),
		TaskIDs: []string{},
	}

	got, err := DecodeRunProjection(record)
	if err != nil {
		t.Fatalf("DecodeRunProjection: %v", err)
	}
	if got.Status != "SUCCEEDED" || got.InterOp == nil || got.InterOp.Status != "delegated" || got.InterOp.TargetID != "a2a-peer" || got.InterOp.Kind != "a2a" {
		t.Fatalf("nested completed projection=%#v", got)
	}
}

func TestDecodeRunProjectionMixedInteropFailureWins(t *testing.T) {
	record := rxBot.RunRecord{
		RunID:   "run-mixed-interop",
		Agent:   "research",
		Status:  "succeeded",
		TaskIDs: []string{"task-mixed-interop"},
		Result:  json.RawMessage(`{"formatted":{"answer":"mixed answer","metadata":{"status":"SUCCESS","interop":[{"target_id":"mcp-completed","kind":"mcp","status":"completed"},{"target_id":"a2a-failed","kind":"a2a","status":"failed","code":"interop_failed"}]}}}`),
	}

	got, err := DecodeRunProjection(record)
	if err != nil {
		t.Fatalf("DecodeRunProjection: %v", err)
	}
	if got.Status != "SUCCEEDED" || got.InterOp == nil || got.InterOp.Status != "failed" || got.InterOp.TargetID != "a2a-failed" || got.InterOp.Kind != "a2a" || got.InterOp.Code != "interop_failed" {
		t.Fatalf("mixed interop projection=%#v", got)
	}
}

func TestDecodeRunProjectionNonInteropNestedInteropMetadataIgnored(t *testing.T) {
	record := rxBot.RunRecord{
		RunID:   "run-ordinary-poll",
		Agent:   "analyst",
		Status:  "running",
		TaskIDs: []string{"task-ordinary-poll"},
		Result:  json.RawMessage(`{"interop":{"mode":"auto","status":"degraded","target_id":"mcp-peer","kind":"mcp","code":"degraded"},"degraded_interop":true,"formatted":{"answer":"ordinary poll answer","metadata":{"status":"FAILED","degraded_interop":true,"interop":[{"target_id":"mcp-peer","kind":"mcp","status":"failed","code":"interop_failed"}]}}}`),
	}

	got, err := DecodeRunProjection(record)
	if err != nil {
		t.Fatalf("DecodeRunProjection: %v", err)
	}
	if got.Status != "RUNNING" || got.InterOp != nil || got.DegradedInterop {
		t.Fatalf("ordinary polling projection=%#v", got)
	}
}

func TestDecodeRunProjectionAcceptsNonInteropFormattedMetadata(t *testing.T) {
	for _, tc := range []struct {
		name       string
		agent      string
		topStatus  string
		metaStatus string
		wantStatus string
	}{
		{name: "success", agent: "deep_genome", topStatus: "succeeded", metaStatus: "SUCCESS", wantStatus: "SUCCEEDED"},
		{name: "running", agent: "analyst", topStatus: "running", metaStatus: "RUNNING", wantStatus: "RUNNING"},
		{name: "Review answer completes pause", agent: "review", topStatus: "input_required", metaStatus: "INPUT_REQUIRED", wantStatus: "SUCCEEDED"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			record := rxBot.RunRecord{
				RunID:  "run-non-interop-" + tc.name,
				Agent:  tc.agent,
				Status: tc.topStatus,
				Result: json.RawMessage(`{"formatted":{"answer":"ordinary answer","metadata":{"status":"` + tc.metaStatus + `","report_revision":3,"other_provider_field":{"private":"ignored"}}}}`),
			}
			got, err := DecodeRunProjection(record)
			if err != nil {
				t.Fatalf("DecodeRunProjection: %v", err)
			}
			if got.Status != tc.wantStatus || got.VisibleReport() != "ordinary answer" || got.InterOp != nil || got.DegradedInterop {
				t.Fatalf("ordinary metadata projection=%#v", got)
			}
		})
	}
}

func TestDecodeCanonicalResultArchiveTerminalFixtures(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name        string
		fixture     string
		wantAgent   string
		wantReport  string
		wantArchive string
	}{
		{
			name:        "analyst delivery",
			fixture:     "analyst_terminal.json",
			wantAgent:   "analyst",
			wantReport:  "# Synthetic Analyst Result\n\nArchive ready.",
			wantArchive: "analyst-results.zip",
		},
		{
			name:        "research delivery",
			fixture:     "research_terminal.json",
			wantAgent:   "research",
			wantReport:  "# Synthetic Research Result\n\nArchive ready.",
			wantArchive: "research-results.zip",
		},
		{
			name:        "design delivery",
			fixture:     "design_terminal.json",
			wantAgent:   "design",
			wantReport:  "# Synthetic Design Result\n\nArchive ready.",
			wantArchive: "design-results.zip",
		},
		{
			name:        "network delivery",
			fixture:     "network_terminal.json",
			wantAgent:   "network",
			wantReport:  "# Synthetic Network Result\n\nArchive ready.",
			wantArchive: "network-results.zip",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var raw map[string]interface{}
			decodeFixtureForProjectionTest(t, tc.fixture, &raw)
			assertCanonicalResultArchiveFixture(t, raw, tc.wantAgent, tc.wantArchive)

			record := loadRunRecordFixture(t, tc.fixture)
			if record.Agent != tc.wantAgent {
				t.Fatalf("agent=%q want %q", record.Agent, tc.wantAgent)
			}
			if _, ok := rxBot.CanonicalAgentTool[record.Agent]; !ok {
				t.Fatalf("agent=%q is not a canonical Bot slug", record.Agent)
			}

			var envelope struct {
				Formatted *struct {
					Answer string `json:"answer"`
				} `json:"formatted"`
			}
			if err := json.Unmarshal(record.Result, &envelope); err != nil {
				t.Fatalf("decode result envelope: %v", err)
			}
			if envelope.Formatted == nil || strings.TrimSpace(envelope.Formatted.Answer) == "" {
				t.Fatal("terminal fixture has no formatted answer")
			}

			projection, err := DecodeRunProjection(record)
			if err != nil {
				t.Fatal(err)
			}
			if projection.Agent != tc.wantAgent || projection.VisibleReport() != tc.wantReport ||
				!projection.ResultArchiveV1 || projection.Delivery == nil ||
				projection.Delivery.ArchiveName != tc.wantArchive || projection.Delivery.ArchiveSize <= 0 {
				t.Fatalf("projection agent/report=%q/%q", projection.Agent, projection.VisibleReport())
			}
			if len(projection.Artifacts.Paths) != 0 {
				t.Fatalf("active v1 projection retained legacy paths=%#v", projection.Artifacts.Paths)
			}
		})
	}
}

func assertCanonicalResultArchiveFixture(t *testing.T, payload map[string]interface{}, agent, archiveName string) {
	t.Helper()
	if payload["agent"] != agent {
		t.Fatalf("agent=%v want %q", payload["agent"], agent)
	}
	result, ok := payload["result"].(map[string]interface{})
	if !ok || result["artifacts"] != nil {
		t.Fatalf("fixture retained legacy result artifacts")
	}
	execution, ok := result["execution"].(map[string]interface{})
	if !ok {
		t.Fatal("fixture execution is missing")
	}
	delivery, ok := execution["delivery"].(map[string]interface{})
	if !ok || delivery["delivery_internal"] != nil || delivery["schema_version"] != float64(1) {
		t.Fatalf("fixture delivery is invalid")
	}
	archive, ok := delivery["archive"].(map[string]interface{})
	if !ok || archive["name"] != archiveName || archive["role"] != "result_archive" {
		t.Fatalf("fixture archive is invalid")
	}
}

func decodeFixtureForProjectionTest(t *testing.T, name string, out interface{}) {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	raw, err := os.ReadFile(filepath.Join(filepath.Dir(filename), "..", "..", "external", "bot", "testdata", "head", name))
	if err != nil {
		t.Fatalf("read fixture %q: %v", name, err)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		t.Fatalf("decode fixture %q: %v", name, err)
	}
}
