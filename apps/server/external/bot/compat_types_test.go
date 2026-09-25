package bot

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func decodeFixture(t *testing.T, name string, out interface{}) {
	t.Helper()

	raw, err := os.ReadFile(filepath.Join("testdata", "head", name))
	if err != nil {
		t.Fatalf("read fixture %q: %v", name, err)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		t.Fatalf("decode fixture %q: %v", name, err)
	}
}

func TestHeadFixturesDecodeDistinctRunIdentity(t *testing.T) {
	var got ChatCompletionResponse
	decodeFixture(t, "chat_completion_run_id.json", &got)
	if got.ID != "chatcmpl-1" || got.RunID == nil || *got.RunID != "run-chat-1" {
		t.Fatalf("completion identity = %#v", got)
	}
}

func TestHeadFixturesPreserveNullRunAndInputRequired(t *testing.T) {
	var degraded AgentRunResponse
	decodeFixture(t, "agent_run_degraded.json", &degraded)
	if degraded.RunID != nil || !degraded.DegradedTracking || degraded.Status != "succeeded" {
		t.Fatalf("degraded=%#v", degraded)
	}

	var paused AgentRunResponse
	decodeFixture(t, "review_input_required.json", &paused)
	if paused.Status != "input_required" || paused.Interrupt == nil || paused.Interrupt.ThreadID != "run-review-1" || paused.Interrupt.RunID != "run-review-1" {
		t.Fatalf("paused=%#v", paused)
	}
	var draft struct {
		A2UI struct {
			Props map[string]json.RawMessage `json:"props"`
		} `json:"a2ui"`
	}
	if err := json.Unmarshal(paused.Interrupt.Draft, &draft); err != nil {
		t.Fatalf("decode review draft: %v", err)
	}
	if len(draft.A2UI.Props) != 1 || string(draft.A2UI.Props["title"]) != `"Synthetic review"` {
		t.Fatalf("review props=%s", paused.Interrupt.Draft)
	}
}

func TestHeadFixturesNormalizeLegacyInterruptRunID(t *testing.T) {
	var paused AgentRunResponse
	if err := json.Unmarshal([]byte(`{"status":"input_required","interrupt":{"run_id":"run-legacy-1","draft":{}}}`), &paused); err != nil {
		t.Fatalf("decode legacy interrupt: %v", err)
	}
	if paused.Interrupt == nil || paused.Interrupt.ThreadID != "" || paused.Interrupt.RunID != "run-legacy-1" {
		t.Fatalf("legacy interrupt = %#v", paused.Interrupt)
	}
}

func TestHeadFixturesDecodeProjectionEnvelopes(t *testing.T) {
	var intermediate RunRecord
	decodeFixture(t, "deep_genome_intermediate.json", &intermediate)
	if intermediate.RunID != "run-dg-1" {
		t.Fatalf("intermediate run_id = %q", intermediate.RunID)
	}

	var projection RunProjectionEnvelope
	if err := json.Unmarshal(intermediate.Result, &projection); err != nil {
		t.Fatalf("decode intermediate projection: %v", err)
	}
	if projection.ReportRevision == nil || *projection.ReportRevision != 2 || projection.IntermediateReport != "# Intermediate" {
		t.Fatalf("intermediate projection = %#v", projection)
	}
	if len(projection.Failures) != 1 || projection.Failures[0] != "analysis task failed" {
		t.Fatalf("intermediate failures = %#v", projection.Failures)
	}

	var final RunRecord
	decodeFixture(t, "deep_genome_final.json", &final)
	if final.RunID != "run-dg-1" {
		t.Fatalf("final run_id = %q", final.RunID)
	}
	if err := json.Unmarshal(final.Result, &projection); err != nil {
		t.Fatalf("decode final projection: %v", err)
	}
	if projection.ReportRevision == nil || *projection.ReportRevision != 3 || projection.FinalReport != "# Final" {
		t.Fatalf("final projection = %#v", projection)
	}
}

func TestRunProjectionRetainsBoundedFailureMessage(t *testing.T) {
	var projection RunProjectionEnvelope
	raw := []byte(`{"failures":[{"work_item_key":"protein_design","status":"failed","message":"optional analysis unavailable","traceback":"private"}]}`)
	if err := json.Unmarshal(raw, &projection); err != nil {
		t.Fatalf("decode bounded failure: %v", err)
	}
	if len(projection.Failures) != 1 || projection.Failures[0] != "optional analysis unavailable" {
		t.Fatalf("normalized failures = %#v", projection.Failures)
	}
}

func TestHeadFixturesDecodeRemoteTerminalArtifacts(t *testing.T) {
	var got RunRecord
	decodeFixture(t, "remote_terminal_artifacts.json", &got)

	var projection RunProjectionEnvelope
	if err := json.Unmarshal(got.Result, &projection); err != nil {
		t.Fatalf("decode terminal projection: %v", err)
	}
	if got.RunID != "run-terminal-1" || len(projection.Artifacts) == 0 {
		t.Fatalf("terminal projection = %#v", projection)
	}
}

func TestHeadFixturesDecodeCanonicalResultArchiveDelivery(t *testing.T) {
	tests := []struct {
		fixture string
		agent   string
		name    string
	}{
		{fixture: "analyst_terminal.json", agent: "analyst", name: "analyst-results.zip"},
		{fixture: "research_terminal.json", agent: "research", name: "research-results.zip"},
		{fixture: "network_terminal.json", agent: "network", name: "network-results.zip"},
		{fixture: "design_terminal.json", agent: "design", name: "design-results.zip"},
	}

	for _, tt := range tests {
		t.Run(tt.agent, func(t *testing.T) {
			var record RunRecord
			decodeFixture(t, tt.fixture, &record)
			var projection struct {
				Execution json.RawMessage `json:"execution"`
			}
			if err := json.Unmarshal(record.Result, &projection); err != nil {
				t.Fatalf("decode result: %v", err)
			}
			delivery, err := DecodeRunExecutionDelivery(projection.Execution, tt.agent)
			if err != nil {
				t.Fatalf("decode delivery: %v", err)
			}
			if !delivery.ResultArchiveV1 || len(delivery.OutputDirs) != 1 || delivery.Delivery == nil ||
				delivery.Delivery.Status != "ready" || delivery.Delivery.Archive == nil ||
				delivery.Delivery.Archive.Name != tt.name || delivery.Delivery.Archive.SizeBytes <= 0 {
				t.Fatalf("canonical delivery = %#v", delivery)
			}
		})
	}
}

func TestHeadFixturesKeepHistoricalTerminalArtifactsLegacy(t *testing.T) {
	var record RunRecord
	decodeFixture(t, "remote_terminal_artifacts.json", &record)
	var projection struct {
		Execution json.RawMessage `json:"execution"`
	}
	if err := json.Unmarshal(record.Result, &projection); err != nil {
		t.Fatalf("decode result: %v", err)
	}
	delivery, err := DecodeRunExecutionDelivery(projection.Execution, "research")
	if err != nil {
		t.Fatalf("decode legacy execution: %v", err)
	}
	if delivery.ResultArchiveV1 || delivery.Delivery != nil {
		t.Fatalf("legacy terminal fixture became v1 delivery: %#v", delivery)
	}
}

func TestDecodeRunExecutionRetainsCurrentFieldsWithoutDelivery(t *testing.T) {
	execution, err := DecodeRunExecutionDelivery(json.RawMessage(`{
		"tracking":{"degraded":true},
		"output_dirs":["internal/runs/synthetic","obs://bucket/owner/run"],
		"delivery":null
	}`), "research")
	if err != nil {
		t.Fatalf("decode current execution: %v", err)
	}
	if execution.ResultArchiveV1 || execution.Delivery != nil {
		t.Fatalf("execution unexpectedly activated archive delivery: %#v", execution)
	}
	if !execution.TrackingDegraded || execution.OutputDirectoryCount != 2 ||
		!reflect.DeepEqual(execution.OutputDirs, []string{"obs://bucket/owner/run"}) {
		t.Fatalf("current execution projection = %#v", execution)
	}
}

func TestDecodeRunExecutionRejectsMalformedCurrentFieldsWithoutDelivery(t *testing.T) {
	tests := []json.RawMessage{
		json.RawMessage(`{"tracking":{"degraded":"yes"},"output_dirs":["obs://bucket/owner/run"]}`),
		json.RawMessage(`{"tracking":{"degraded":true},"output_dirs":["https://private.invalid/run"]}`),
		json.RawMessage(`{"tracking":{"degraded":true},"output_dirs":["internal/../private/run"]}`),
		json.RawMessage(`{"tracking":{"degraded":true,"private":"secret"},"output_dirs":["obs://bucket/owner/run"]}`),
	}
	for _, raw := range tests {
		if got, err := DecodeRunExecutionDelivery(raw, "research"); err == nil {
			t.Fatalf("malformed execution accepted: %#v", got)
		}
	}
}

func TestHeadFixturesDecodeRemoteLifecycleStates(t *testing.T) {
	tests := []struct {
		fixture    string
		wantStatus string
		wantChilds int
	}{
		{fixture: "remote_preparing.json", wantStatus: "running", wantChilds: 0},
		{fixture: "remote_running.json", wantStatus: "running", wantChilds: 1},
		{fixture: "remote_failed.json", wantStatus: "failed", wantChilds: 1},
		{fixture: "remote_cancelled.json", wantStatus: "cancelled", wantChilds: 1},
	}

	for _, tt := range tests {
		t.Run(tt.fixture, func(t *testing.T) {
			var got RunRecord
			decodeFixture(t, tt.fixture, &got)
			if got.Status != tt.wantStatus || len(got.TaskIDs) != tt.wantChilds {
				t.Fatalf("remote lifecycle = %#v, want status=%q children=%d", got, tt.wantStatus, tt.wantChilds)
			}
		})
	}
}
