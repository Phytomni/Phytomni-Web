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
		{name: "input required", agent: "review", topStatus: "input_required", metaStatus: "INPUT_REQUIRED", wantStatus: "INPUT_REQUIRED"},
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

func TestDecodeResearchDesignNetworkTerminalArtifacts(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name          string
		fixture       string
		wantFixtureID string
		wantAgent     string
		wantReport    string
		wantArtifacts int
		wantPaths     int
	}{
		{
			name:          "research report and artifacts",
			fixture:       "research_terminal.json",
			wantFixtureID: "rc-web-004-research-terminal",
			wantAgent:     "research",
			wantReport:    "# Research terminal report",
			wantArtifacts: 1,
			wantPaths:     2,
		},
		{
			name:          "design formatted answer and empty artifacts",
			fixture:       "design_terminal.json",
			wantFixtureID: "rc-web-004-design-terminal",
			wantAgent:     "design",
			wantReport:    "# Design terminal answer",
			wantArtifacts: 0,
			wantPaths:     0,
		},
		{
			name:          "network report and empty artifact paths",
			fixture:       "network_terminal.json",
			wantFixtureID: "rc-web-004-network-terminal",
			wantAgent:     "network",
			wantReport:    "# Network terminal report",
			wantArtifacts: 1,
			wantPaths:     0,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var raw map[string]interface{}
			decodeFixtureForProjectionTest(t, tc.fixture, &raw)
			assertSanitizedTerminalFixture(t, raw, tc.wantFixtureID, tc.wantAgent)

			record := loadRunRecordFixture(t, tc.fixture)
			if record.Agent != tc.wantAgent {
				t.Fatalf("agent=%q want %q", record.Agent, tc.wantAgent)
			}
			if _, ok := rxBot.CanonicalAgentTool[record.Agent]; !ok {
				t.Fatalf("agent=%q is not a canonical Bot slug", record.Agent)
			}

			var envelope struct {
				FinalReport string `json:"final_report"`
				Formatted   *struct {
					Answer string `json:"answer"`
				} `json:"formatted"`
				Artifacts []struct {
					OutputDir string   `json:"output_dir"`
					Paths     []string `json:"paths"`
				} `json:"artifacts"`
			}
			if err := json.Unmarshal(record.Result, &envelope); err != nil {
				t.Fatalf("decode result envelope: %v", err)
			}
			if strings.TrimSpace(envelope.FinalReport) == "" &&
				(envelope.Formatted == nil || strings.TrimSpace(envelope.Formatted.Answer) == "") {
				t.Fatal("terminal fixture has neither a final report nor formatted answer")
			}
			if len(envelope.Artifacts) != tc.wantArtifacts {
				t.Fatalf("artifact entries=%d want %d", len(envelope.Artifacts), tc.wantArtifacts)
			}
			pathCount := 0
			for _, artifact := range envelope.Artifacts {
				if artifact.OutputDir == "" && len(artifact.Paths) > 0 {
					t.Fatal("artifact paths must not exist without an output directory")
				}
				pathCount += len(artifact.Paths)
			}
			if pathCount != tc.wantPaths {
				t.Fatalf("artifact paths=%d want %d", pathCount, tc.wantPaths)
			}

			projection, err := DecodeRunProjection(record)
			if err != nil {
				t.Fatal(err)
			}
			if projection.Agent != tc.wantAgent || projection.VisibleReport() != tc.wantReport {
				t.Fatalf("projection agent/report=%q/%q", projection.Agent, projection.VisibleReport())
			}
			if len(projection.Artifacts.Paths) != tc.wantPaths {
				t.Fatalf("projection paths=%d want %d", len(projection.Artifacts.Paths), tc.wantPaths)
			}
		})
	}
}

func assertSanitizedTerminalFixture(t *testing.T, payload map[string]interface{}, fixtureID, agent string) {
	t.Helper()
	if payload["fixture_id"] != fixtureID {
		t.Fatalf("fixture_id=%v want %q", payload["fixture_id"], fixtureID)
	}
	if payload["agent"] != agent {
		t.Fatalf("agent=%v want %q", payload["agent"], agent)
	}
	forbidden := map[string]struct{}{
		"created_at": {}, "dialogue_id": {}, "error": {}, "expires_at": {},
		"model": {}, "origin": {}, "payload": {}, "private": {},
		"private_payload": {}, "query": {}, "raw": {}, "raw_payload": {},
		"request_id": {}, "stack_trace": {}, "task_id": {}, "task_ids": {},
		"traceback": {}, "updated_at": {}, "user_id": {},
	}
	var visit func(interface{})
	visit = func(value interface{}) {
		switch current := value.(type) {
		case map[string]interface{}:
			for key, child := range current {
				if _, blocked := forbidden[key]; blocked {
					t.Fatalf("fixture contains raw/private field %q", key)
				}
				visit(child)
			}
		case []interface{}:
			for _, child := range current {
				visit(child)
			}
		}
	}
	visit(payload)
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
