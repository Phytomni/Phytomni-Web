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
