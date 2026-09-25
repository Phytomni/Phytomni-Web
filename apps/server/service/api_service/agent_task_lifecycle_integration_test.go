package api_service

import (
	"context"
	"errors"
	"testing"

	"phytomni-server/model"
)

// Mutation coverage: lifecycle reads must expose only the latest persisted
// projector state. Reintroducing request-owned Bot polling or dropping the
// owner predicate makes one of the reads below fail.
func TestAnalystRunLifecycleReflectsPersistedProjectorStateWithoutPolling(t *testing.T) {
	gdb := setupExpertTestDB(t)
	row := model.QuestionAgentLog{
		UserName:          "owner-b5",
		BotRunId:          "run-b5-1",
		Status:            "RUNNING",
		ToolName:          "AnalystAgent",
		BotReportRevision: -1,
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatalf("persist submitted run: %v", err)
	}
	service := NewService()

	assertLifecycle := func(wantPhase string, wantChildren int, wantRevision int64, wantTerminal bool) {
		t.Helper()
		got, lifecycleErr := service.AgentTaskLifecycle(context.Background(), row.Id, "owner-b5")
		if lifecycleErr != nil {
			t.Fatalf("read lifecycle: %v", lifecycleErr)
		}
		if got.Phase != wantPhase || got.ChildTaskCount != wantChildren || got.ReportRevision != wantRevision || got.Terminal != wantTerminal {
			t.Fatalf("lifecycle=%+v, want %s/%d/revision %d/terminal %v", got, wantPhase, wantChildren, wantRevision, wantTerminal)
		}
		if got.Reconciliation != lifecycleReconciliationCached {
			t.Fatalf("reconciliation=%q, want cached projection", got.Reconciliation)
		}
	}

	assertLifecycle("RUNNING", 0, 0, false)
	projections := []BotRunProjection{
		{RunID: "run-b5-1", Agent: "analyst", Status: "RUNNING", ChildTaskCount: 1, ReportRevision: 0},
		{RunID: "run-b5-1", Agent: "analyst", Status: "RUNNING", ChildTaskCount: 1, ReportRevision: 1, IntermediateReport: "Synthetic revision one"},
		{RunID: "run-b5-1", Agent: "analyst", Status: "SUCCEEDED", ChildTaskCount: 1, ReportRevision: 2, FinalReport: "Synthetic revision two"},
	}
	wants := []struct {
		phase    string
		children int
		revision int64
		terminal bool
	}{
		{phase: "RUNNING", children: 1, revision: 0},
		{phase: "RUNNING", children: 1, revision: 1},
		{phase: "SUCCEEDED", children: 1, revision: 2, terminal: true},
	}
	for index, projection := range projections {
		if err := saveBotRunProjectionForTest(context.Background(), "owner-b5", row.Id, projection); err != nil {
			t.Fatalf("persist projector revision %d: %v", index, err)
		}
		want := wants[index]
		assertLifecycle(want.phase, want.children, want.revision, want.terminal)
	}

	// Terminal reads remain stable and cannot advance external state.
	assertLifecycle("SUCCEEDED", 1, 2, true)
	_, lifecycleErr := service.AgentTaskLifecycle(context.Background(), row.Id, "owner-b5-other")
	if !errors.Is(lifecycleErr, ErrAgentTaskLifecycleNotFound) {
		t.Fatalf("foreign lifecycle error = %v", lifecycleErr)
	}
}
