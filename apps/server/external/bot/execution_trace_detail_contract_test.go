package bot

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type executionTraceDetailFixtures struct {
	SchemaVersion int `json:"schema_version"`
	Records       map[string]struct {
		Attempts []struct {
			Status string `json:"status"`
		} `json:"attempts"`
		Progress map[string]any `json:"progress"`
		Detail   map[string]any `json:"detail"`
	} `json:"records"`
	ExecutionLog struct {
		ArtifactRole string `json:"artifact_role"`
		Target       struct {
			Kind string `json:"kind"`
		} `json:"target"`
	} `json:"execution_log"`
	InvalidPayloads []struct {
		Reason string `json:"reason"`
	} `json:"invalid_payloads"`
	StageContract struct {
		Stages []string `json:"stages"`
	} `json:"stage_contract"`
	StageTransitionCases []struct {
		Name     string `json:"name"`
		Previous *struct {
			Clocks map[string]string `json:"clocks"`
		} `json:"previous"`
		State struct {
			ChildStatus      string            `json:"child_status"`
			RootStatus       string            `json:"root_status"`
			PendingStatusKey string            `json:"pending_status_key"`
			Clocks           map[string]string `json:"clocks"`
		} `json:"state"`
	} `json:"stage_transition_cases"`
	InvalidStageCases []struct {
		Reason string `json:"reason"`
	} `json:"invalid_stage_cases"`
}

func TestExecutionTraceDetailSharedFixtureFreezesRequiredRecords(t *testing.T) {
	path := filepath.Join(
		"..", "..", "..", "..", "docs", "reference",
		"execution-trace-detail.v1.fixtures.json",
	)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read shared execution trace fixture: %v", err)
	}
	var fixtures executionTraceDetailFixtures
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatalf("decode shared execution trace fixture: %v", err)
	}

	if fixtures.SchemaVersion != 1 || len(fixtures.Records) != 2 {
		t.Fatalf("unexpected fixture contract: %#v", fixtures)
	}
	grouped := fixtures.Records["grouped_operation"]
	if len(grouped.Attempts) != 2 || grouped.Attempts[0].Status != "failed" {
		t.Fatalf("retry attempt history is not frozen: %#v", grouped.Attempts)
	}
	unknown := fixtures.Records["unknown_presenter"]
	if len(unknown.Detail) != 0 {
		t.Fatalf("unknown presenter copied detail: %#v", unknown.Detail)
	}
	if fixtures.ExecutionLog.ArtifactRole != "execution_log" ||
		fixtures.ExecutionLog.Target.Kind != "artifact" {
		t.Fatalf("unexpected execution-log target: %#v", fixtures.ExecutionLog)
	}
	if len(fixtures.InvalidPayloads) != 9 {
		t.Fatalf("invalid payload cases = %d, want 9", len(fixtures.InvalidPayloads))
	}
}

func TestExecutionTraceDetailSharedFixtureFreezesStageSemantics(t *testing.T) {
	path := filepath.Join(
		"..", "..", "..", "..", "docs", "reference",
		"execution-trace-detail.v1.fixtures.json",
	)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read shared execution trace fixture: %v", err)
	}
	var fixtures executionTraceDetailFixtures
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatalf("decode shared execution trace fixture: %v", err)
	}

	wantStages := []string{
		"orchestration", "scientific_execution", "consolidation", "response_settlement",
	}
	if len(fixtures.StageContract.Stages) != len(wantStages) {
		t.Fatalf("stage count = %d, want %d", len(fixtures.StageContract.Stages), len(wantStages))
	}
	for i, want := range wantStages {
		if fixtures.StageContract.Stages[i] != want {
			t.Fatalf("stage[%d] = %q, want %q", i, fixtures.StageContract.Stages[i], want)
		}
	}
	if len(fixtures.StageTransitionCases) < 7 {
		t.Fatalf("stage transition cases = %d, want at least 7", len(fixtures.StageTransitionCases))
	}
	if len(fixtures.InvalidStageCases) != 7 {
		t.Fatalf("invalid stage cases = %d, want 7", len(fixtures.InvalidStageCases))
	}
	for _, testCase := range fixtures.StageTransitionCases {
		if testCase.Name == "child_submission_succeeded" {
			if testCase.State.ChildStatus != "succeeded" || testCase.State.RootStatus != "running" {
				t.Fatalf("child terminal closed root: %#v", testCase.State)
			}
			return
		}
	}
	t.Fatal("child submission stage fixture is missing")
}
