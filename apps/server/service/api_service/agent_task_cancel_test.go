package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

type cancelFakeRunCanceller struct {
	record *rxBot.RunRecord
	meta   rxBot.ResponseMeta
	err    error
	calls  []string
	onCall func()
}

func (f *cancelFakeRunCanceller) CancelRunWithMeta(_ context.Context, runID string) (*rxBot.RunRecord, rxBot.ResponseMeta, error) {
	f.calls = append(f.calls, runID)
	if f.onCall != nil {
		f.onCall()
	}
	return f.record, f.meta, f.err
}

func cancelDraftRunRecord(runID, draft string) *rxBot.RunRecord {
	result, _ := json.Marshal(map[string]interface{}{
		"intermediate_report": draft,
	})
	return &rxBot.RunRecord{
		RunID:  runID,
		Agent:  "analyst",
		Status: "cancelled",
		Result: result,
	}
}

func TestAgentTaskCancelHidesAbsentAndForeignRows(t *testing.T) {
	gdb := setupAgentTaskLifecycleDB(t)
	seedAgentTaskLifecycleRow(t, gdb, lifecycleSeed{id: 11, username: "alice", runID: "run-private", status: "RUNNING", reportRevision: -1})
	fake := &cancelFakeRunCanceller{record: cancelDraftRunRecord("run-private", "secret")}
	service := &Service{runCanceller: fake}

	_, absentErr := service.AgentTaskCancel(context.Background(), 99, "alice")
	_, foreignErr := service.AgentTaskCancel(context.Background(), 11, "bob")
	if !errors.Is(absentErr, ErrAgentTaskLifecycleNotFound) || !errors.Is(foreignErr, ErrAgentTaskLifecycleNotFound) || absentErr != foreignErr {
		t.Fatalf("absent=%v foreign=%v", absentErr, foreignErr)
	}
	if len(fake.calls) != 0 {
		t.Fatalf("hidden rows called Bot: %q", fake.calls)
	}
}

func TestAgentTaskCancelLocalRowKeepsDraftWithoutBotCall(t *testing.T) {
	gdb := setupAgentTaskLifecycleDB(t)
	seedAgentTaskLifecycleRow(t, gdb, lifecycleSeed{
		id:             12,
		username:       "alice",
		status:         "RUNNING",
		answer:         "already streamed tokens",
		reportRevision: -1,
	})
	fake := &cancelFakeRunCanceller{}
	got, err := (&Service{runCanceller: fake}).AgentTaskCancel(context.Background(), 12, "alice")
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if got.Phase != "CANCELLED" || !got.Terminal || !got.ArtifactSummary.HasReport {
		t.Fatalf("lifecycle=%+v", got)
	}
	if len(fake.calls) != 0 {
		t.Fatalf("local cancel called Bot: %q", fake.calls)
	}
	var row model.QuestionAgentLog
	if err := gdb.Where("id = ?", 12).Take(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != "CANCELLED" || row.Answer != "already streamed tokens" {
		t.Fatalf("row status=%q answer=%q", row.Status, row.Answer)
	}
}

func TestAgentTaskCancelIdempotentWhenAlreadyCancelled(t *testing.T) {
	gdb := setupAgentTaskLifecycleDB(t)
	seedAgentTaskLifecycleRow(t, gdb, lifecycleSeed{
		id:             13,
		username:       "alice",
		runID:          "run-13",
		status:         "CANCELLED",
		answer:         "draft",
		reportRevision: 2,
	})
	fake := &cancelFakeRunCanceller{}
	got, err := (&Service{runCanceller: fake}).AgentTaskCancel(context.Background(), 13, "alice")
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if got.Phase != "CANCELLED" || !got.Terminal || len(fake.calls) != 0 {
		t.Fatalf("lifecycle=%+v calls=%q", got, fake.calls)
	}
}

func TestAgentTaskCancelRejectsTerminalAndFinalizingRows(t *testing.T) {
	tests := []struct {
		name   string
		status string
		runID  string
	}{
		{name: "succeeded", status: "SUCCEEDED", runID: "run-succeeded"},
		{name: "failed", status: "FAILED", runID: "run-failed"},
		{name: "timed out", status: "TIMED_OUT", runID: "run-timeout"},
		{name: "finalizing", status: "FINALIZING", runID: "run-finalizing"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gdb := setupAgentTaskLifecycleDB(t)
			seedAgentTaskLifecycleRow(t, gdb, lifecycleSeed{
				id:             14,
				username:       "alice",
				runID:          tt.runID,
				status:         tt.status,
				answer:         "official",
				reportRevision: 3,
			})
			fake := &cancelFakeRunCanceller{}
			_, err := (&Service{runCanceller: fake}).AgentTaskCancel(context.Background(), 14, "alice")
			if !errors.Is(err, ErrAgentTaskCancelConflict) {
				t.Fatalf("err=%v", err)
			}
			if len(fake.calls) != 0 {
				t.Fatalf("blocked cancel called Bot: %q", fake.calls)
			}
			var status string
			if err := gdb.Raw("SELECT status FROM question_agent_logs WHERE id = ?", 14).Scan(&status).Error; err != nil {
				t.Fatal(err)
			}
			if status != tt.status {
				t.Fatalf("status=%q, want %q", status, tt.status)
			}
		})
	}
}

func TestAgentTaskCancelAppliesBotDraftAndStaysCancelled(t *testing.T) {
	gdb := setupAgentTaskLifecycleDB(t)
	seedAgentTaskLifecycleRow(t, gdb, lifecycleSeed{
		id:             15,
		username:       "alice",
		runID:          "run-15",
		status:         "RUNNING",
		answer:         "partial before cancel",
		reportRevision: -1,
	})
	canceller := &cancelFakeRunCanceller{record: cancelDraftRunRecord("run-15", "cancelled draft")}
	got, err := (&Service{runCanceller: canceller}).AgentTaskCancel(context.Background(), 15, "alice")
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if got.Phase != "CANCELLED" || !got.Terminal || got.Reconciliation != "FRESH" {
		t.Fatalf("lifecycle=%+v", got)
	}
	if len(canceller.calls) != 1 || canceller.calls[0] != "run-15" {
		t.Fatalf("Bot calls=%q", canceller.calls)
	}

	var row model.QuestionAgentLog
	if err := gdb.Where("id = ?", 15).Take(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != "CANCELLED" {
		t.Fatalf("status=%q", row.Status)
	}
	if row.Answer != "cancelled draft" && row.Answer != "partial before cancel" {
		t.Fatalf("answer wiped: %q", row.Answer)
	}

	reader := &lifecycleFakeRunReader{record: lifecycleRunRecord("run-15", "succeeded")}
	cached, err := (&Service{runReader: reader}).AgentTaskLifecycle(context.Background(), 15, "alice")
	if err != nil {
		t.Fatalf("lifecycle: %v", err)
	}
	if cached.Phase != "CANCELLED" || !cached.Terminal || reader.calls != 0 {
		t.Fatalf("cancelled row resurrected: %+v calls=%d", cached, reader.calls)
	}

	if err := SaveBotRunProjection(context.Background(), "alice", 15, BotRunProjection{
		RunID:          "run-15",
		Agent:          "analyst",
		Status:         "SUCCEEDED",
		FinalReport:    "shared fingerprint official report",
		ReportRevision: 99,
	}); err != nil {
		t.Fatalf("save succeeded snapshot: %v", err)
	}
	stored, err := LoadBotRunProjection(context.Background(), "alice", 15)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != "CANCELLED" {
		t.Fatalf("cancelled status overwritten: %q", stored.Status)
	}
}

func TestAgentTaskCancelBotSuccessWinsOverConcurrentSucceededSnapshot(t *testing.T) {
	gdb := setupAgentTaskLifecycleDB(t)
	seedAgentTaskLifecycleRow(t, gdb, lifecycleSeed{
		id:             18,
		username:       "alice",
		runID:          "run-18",
		status:         "RUNNING",
		answer:         "partial",
		reportRevision: 1,
	})
	if err := SaveBotRunProjection(context.Background(), "alice", 18, BotRunProjection{
		RunID:          "run-18",
		Agent:          "analyst",
		Status:         "RUNNING",
		ReportRevision: 1,
	}); err != nil {
		t.Fatal(err)
	}
	fake := &cancelFakeRunCanceller{
		record: cancelDraftRunRecord("run-18", "cancelled draft"),
		onCall: func() {
			if err := SaveBotRunProjection(context.Background(), "alice", 18, BotRunProjection{
				RunID:          "run-18",
				Agent:          "analyst",
				Status:         "SUCCEEDED",
				FinalReport:    "stale official report",
				ReportRevision: 2,
			}); err != nil {
				t.Fatalf("install concurrent success: %v", err)
			}
			if err := gdb.Model(&model.QuestionAgentLog{}).Where("id = ?", 18).Update("status", "SUCCEEDED").Error; err != nil {
				t.Fatalf("mark concurrent success: %v", err)
			}
		},
	}
	got, err := (&Service{runCanceller: fake}).AgentTaskCancel(context.Background(), 18, "alice")
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if got.Phase != "CANCELLED" || !got.Terminal {
		t.Fatalf("lifecycle=%+v", got)
	}
	stored, err := LoadBotRunProjection(context.Background(), "alice", 18)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != "CANCELLED" {
		t.Fatalf("status=%q", stored.Status)
	}
}

func TestAgentTaskCancelMapsBotNotFoundAndConflict(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want error
	}{
		{
			name: "not found",
			err:  &rxBot.APIError{Status: 404, Code: "not_found", Message: "run not found: run-16"},
			want: ErrAgentTaskLifecycleNotFound,
		},
		{
			name: "conflict",
			err:  &rxBot.APIError{Status: 409, Code: "run_state_conflict", Message: "Run cancellation is no longer available."},
			want: ErrAgentTaskCancelConflict,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gdb := setupAgentTaskLifecycleDB(t)
			seedAgentTaskLifecycleRow(t, gdb, lifecycleSeed{
				id:             16,
				username:       "alice",
				runID:          "run-16",
				status:         "RUNNING",
				answer:         "keep me",
				reportRevision: -1,
			})
			fake := &cancelFakeRunCanceller{err: tt.err}
			_, err := (&Service{runCanceller: fake}).AgentTaskCancel(context.Background(), 16, "alice")
			if !errors.Is(err, tt.want) {
				t.Fatalf("err=%v want %v", err, tt.want)
			}
			var row model.QuestionAgentLog
			if scanErr := gdb.Where("id = ?", 16).Take(&row).Error; scanErr != nil {
				t.Fatal(scanErr)
			}
			if row.Status != "RUNNING" || row.Answer != "keep me" {
				t.Fatalf("row mutated on Bot error: status=%q answer=%q", row.Status, row.Answer)
			}
		})
	}
}

func TestAgentTaskCancelRejectsMismatchedBotRecord(t *testing.T) {
	gdb := setupAgentTaskLifecycleDB(t)
	seedAgentTaskLifecycleRow(t, gdb, lifecycleSeed{
		id:             17,
		username:       "alice",
		runID:          "run-17",
		status:         "RUNNING",
		reportRevision: -1,
	})
	fake := &cancelFakeRunCanceller{record: cancelDraftRunRecord("run-other", "draft")}
	_, err := (&Service{runCanceller: fake}).AgentTaskCancel(context.Background(), 17, "alice")
	if !errors.Is(err, ErrAgentTaskCancelConflict) {
		t.Fatalf("err=%v", err)
	}
	var status string
	if err := gdb.Raw("SELECT status FROM question_agent_logs WHERE id = ?", 17).Scan(&status).Error; err != nil {
		t.Fatal(err)
	}
	if status != "RUNNING" {
		t.Fatalf("status=%q", status)
	}
}
