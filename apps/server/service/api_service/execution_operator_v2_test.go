package api_service

import (
	"context"
	"errors"
	"testing"
	"time"

	"phytomni-server/model"
)

func seedExecutionOperatorTest(t *testing.T) context.Context {
	t.Helper()
	setupExecutionRuntimeV2DB(t)
	ctx := context.Background()
	if err := model.DB(ctx).Exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, code TEXT, delete_at DATETIME NULL)`).Error; err != nil {
		t.Fatalf("migrate users: %v", err)
	}
	if err := model.DB(ctx).Exec(`INSERT INTO users (email, code) VALUES ('root@example.com', 'admin'), ('alice@example.com', 'user')`).Error; err != nil {
		t.Fatalf("seed users: %v", err)
	}
	now := time.Now().UTC()
	admission := model.QuestionAgentExecutionAdmission{
		UserName: "owner@example.com", ExecutionID: "turn-operator-0001",
		RequestFingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		FingerprintVersion: 2, Status: "failed", TrackingHealth: "degraded",
		CreatedAt: now, UpdatedAt: now,
	}
	outbox := model.QuestionAgentExecutionOutbox{
		UserName: admission.UserName, ExecutionID: admission.ExecutionID,
		CommandJSON: `{}`, State: "dead_letter", Attempts: 6, Revision: 4,
		NextAttemptAt: now, DeadLetterAt: &now, CreatedAt: now, UpdatedAt: now,
	}
	if err := model.DB(ctx).Create(&admission).Error; err != nil {
		t.Fatalf("seed admission: %v", err)
	}
	if err := model.DB(ctx).Create(&outbox).Error; err != nil {
		t.Fatalf("seed outbox: %v", err)
	}
	return ctx
}

func TestExecutionOperatorRequiresAdminAndReturnsBoundedView(t *testing.T) {
	ctx := seedExecutionOperatorTest(t)
	service := NewService()
	if _, err := service.InspectExecutionV2(ctx, "alice@example.com", "owner@example.com", "turn-operator-0001"); !errors.Is(err, ErrExecutionOperatorForbidden) {
		t.Fatalf("non-admin error = %v", err)
	}
	view, err := service.InspectExecutionV2(ctx, "root@example.com", "owner@example.com", "turn-operator-0001")
	if err != nil {
		t.Fatalf("inspect: %v", err)
	}
	if view.OutboxState != "dead_letter" || view.OutboxRevision != 4 || view.OwnerRef != "owner@example.com" {
		t.Fatalf("unexpected view: %#v", view)
	}
}

func TestExecutionOperatorRetryDispatchIsRevisionCheckedAndNeverCallsBot(t *testing.T) {
	ctx := seedExecutionOperatorTest(t)
	service := NewService()
	if _, err := service.OperateExecutionV2(ctx, "root@example.com", "owner@example.com", "turn-operator-0001", ExecutionOperatorActionV2{Action: "retry_dispatch", ExpectedOutboxRevision: 3}); !errors.Is(err, ErrExecutionOperatorConflict) {
		t.Fatalf("stale revision error = %v", err)
	}
	view, err := service.OperateExecutionV2(ctx, "root@example.com", "owner@example.com", "turn-operator-0001", ExecutionOperatorActionV2{Action: "retry_dispatch", ExpectedOutboxRevision: 4})
	if err != nil {
		t.Fatalf("retry dispatch: %v", err)
	}
	if view.OutboxState != "pending" || view.OutboxRevision != 5 || view.OutboxAttempts != 0 || view.BotRunID != nil {
		t.Fatalf("unexpected retry state: %#v", view)
	}
}

func TestExecutionOperatorRefusesRedispatchAfterBotAcknowledgement(t *testing.T) {
	ctx := seedExecutionOperatorTest(t)
	runID := "run-already-admitted"
	if err := model.DB(ctx).Model(&model.QuestionAgentExecutionAdmission{}).
		Where("user_name = ? AND execution_id = ?", "owner@example.com", "turn-operator-0001").
		Updates(map[string]any{"bot_run_id": runID, "dispatch_revision": 1}).Error; err != nil {
		t.Fatal(err)
	}
	_, err := NewService().OperateExecutionV2(ctx, "root@example.com", "owner@example.com", "turn-operator-0001", ExecutionOperatorActionV2{Action: "retry_dispatch", ExpectedOutboxRevision: 4})
	if !errors.Is(err, ErrExecutionOperatorUnsafe) {
		t.Fatalf("acknowledged redispatch error = %v", err)
	}
}

func TestExecutionOperatorCanScheduleProjectionOnlyWithoutLiveLease(t *testing.T) {
	ctx := seedExecutionOperatorTest(t)
	runID := "run-project"
	past := time.Now().UTC().Add(-time.Minute)
	if err := model.DB(ctx).Model(&model.QuestionAgentExecutionAdmission{}).
		Where("user_name = ? AND execution_id = ?", "owner@example.com", "turn-operator-0001").
		Updates(map[string]any{"bot_run_id": runID, "projection_attempts": 2, "projection_lease_until": past}).Error; err != nil {
		t.Fatal(err)
	}
	view, err := NewService().OperateExecutionV2(ctx, "root@example.com", "owner@example.com", "turn-operator-0001", ExecutionOperatorActionV2{Action: "retry_projection", ExpectedProjectionAttempts: 2})
	if err != nil {
		t.Fatalf("retry projection: %v", err)
	}
	if view.TrackingHealth != "pending" || view.ProjectionAttempts != 2 {
		t.Fatalf("unexpected projection state: %#v", view)
	}
}

func TestExecutionOperatorSchedulesReconciliationWithoutRedispatch(t *testing.T) {
	ctx := seedExecutionOperatorTest(t)
	if err := model.DB(ctx).Model(&model.QuestionAgentExecutionAdmission{}).
		Where("user_name = ? AND execution_id = ?", "owner@example.com", "turn-operator-0001").
		Updates(map[string]any{
			"status": "admitted", "terminal_status": nil,
			"terminal_at": nil, "projection_attempts": 3,
		}).Error; err != nil {
		t.Fatal(err)
	}
	if err := model.DB(ctx).Model(&model.QuestionAgentExecutionOutbox{}).
		Where("user_name = ? AND execution_id = ?", "owner@example.com", "turn-operator-0001").
		Updates(map[string]any{
			"state": "reconcile", "classification": "reconcile",
			"boundary_state": "entered", "dead_letter_at": nil,
		}).Error; err != nil {
		t.Fatal(err)
	}

	service := NewService()
	if _, err := service.OperateExecutionV2(
		ctx, "root@example.com", "owner@example.com", "turn-operator-0001",
		ExecutionOperatorActionV2{Action: "retry_reconcile", ExpectedOutboxRevision: 3},
	); !errors.Is(err, ErrExecutionOperatorConflict) {
		t.Fatalf("stale reconcile revision error=%v", err)
	}
	view, err := service.OperateExecutionV2(
		ctx, "root@example.com", "owner@example.com", "turn-operator-0001",
		ExecutionOperatorActionV2{Action: "retry_reconcile", ExpectedOutboxRevision: 4},
	)
	if err != nil {
		t.Fatalf("retry reconcile: %v", err)
	}
	if view.OutboxState != "reconcile" || view.OutboxRevision != 5 ||
		view.BotRunID != nil || view.TrackingHealth != "pending" {
		t.Fatalf("unexpected reconcile view: %#v", view)
	}
}
