package bot

import (
	"encoding/json"
	"os"
	"path/filepath"
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
