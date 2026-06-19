package cron

import (
	"testing"

	"phytomni-server/model"
)

// TestPartitionRunningRows pins the cron's platform split: deep_genome rows go
// to the Bot reconcile set, every other (analyst / EIHealth-backed) tool goes
// to the legacy IAM job poll keyed by task_id. A regression that mis-routed
// either class (e.g. a wrong tool_name literal) would flip these buckets, so
// this asserts both bucket contents directly rather than just their sizes.
func TestPartitionRunningRows(t *testing.T) {
	rows := []model.SQuestionAgentLog{
		{Id: 1, ToolName: "DeepGenomeAgent", TaskId: "dg-1", BotRunId: "run-1"},
		{Id: 2, ToolName: "AnalystAgent", TaskId: "an-1"},
		{Id: 3, ToolName: "DeepGenomeAgent", TaskId: "dg-2", BotRunId: "run-2"},
		{Id: 4, ToolName: "NetworkAgent", TaskId: "an-2"},
	}

	eiHealthTaskIds, botRows := partitionRunningRows(rows)

	if len(eiHealthTaskIds) != 2 || eiHealthTaskIds[0] != "an-1" || eiHealthTaskIds[1] != "an-2" {
		t.Errorf("eihealth task ids = %v, want [an-1 an-2]", eiHealthTaskIds)
	}
	if len(botRows) != 2 || botRows[0].Id != 1 || botRows[1].Id != 3 {
		t.Errorf("bot rows = %+v, want deep_genome rows {1,3}", botRows)
	}
}

// TestPartitionRunningRows_Empty: no RUNNING rows yields two empty buckets, so
// the cron skips both pollers rather than calling them with empty input.
func TestPartitionRunningRows_Empty(t *testing.T) {
	eiHealthTaskIds, botRows := partitionRunningRows(nil)
	if len(eiHealthTaskIds) != 0 || len(botRows) != 0 {
		t.Errorf("empty input must yield empty buckets, got ei=%v bot=%v", eiHealthTaskIds, botRows)
	}
}
