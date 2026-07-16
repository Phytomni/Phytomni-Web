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
	if paused.Status != "input_required" || paused.Interrupt == nil || paused.Interrupt.RunID != "run-review-1" {
		t.Fatalf("paused=%#v", paused)
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
