package api_service

import (
	"context"
	"errors"
	"strings"
	"time"

	"phytomni-server/model"

	"gorm.io/gorm"
)

var (
	ErrExecutionOperatorForbidden = errors.New("execution operator access forbidden")
	ErrExecutionOperatorNotFound  = errors.New("execution not found")
	ErrExecutionOperatorConflict  = errors.New("execution operator revision conflict")
	ErrExecutionOperatorUnsafe    = errors.New("execution operator action is unsafe")
)

type ExecutionOperatorViewV2 struct {
	ExecutionID        string     `json:"execution_id"`
	OwnerRef           string     `json:"owner_ref"`
	Status             string     `json:"status"`
	TrackingHealth     string     `json:"tracking_health"`
	BotRunID           *string    `json:"bot_run_id,omitempty"`
	TerminalStatus     *string    `json:"terminal_status,omitempty"`
	LastBotContactAt   *time.Time `json:"last_bot_contact_at,omitempty"`
	LatestCursor       int64      `json:"latest_cursor"`
	ProjectionRevision int64      `json:"projection_revision"`
	ProjectionAttempts int        `json:"projection_attempts"`
	OutboxState        string     `json:"outbox_state"`
	OutboxAttempts     int        `json:"outbox_attempts"`
	OutboxRevision     int64      `json:"outbox_revision"`
	Classification     *string    `json:"classification,omitempty"`
	BoundaryState      *string    `json:"boundary_state,omitempty"`
	FirstErrorCode     *string    `json:"first_error_code,omitempty"`
	LastErrorCode      *string    `json:"last_error_code,omitempty"`
	NextAttemptAt      *time.Time `json:"next_attempt_at,omitempty"`
	NextReconcileAt    *time.Time `json:"next_reconcile_at,omitempty"`
}

type ExecutionOperatorActionV2 struct {
	Action                     string `json:"action"`
	ExpectedOutboxRevision     int64  `json:"expected_outbox_revision"`
	ExpectedProjectionAttempts int    `json:"expected_projection_attempts"`
}

func authorizeExecutionOperator(ctx context.Context, operatorName string) error {
	var operator model.User
	if err := model.DB(ctx).Where("email = ? AND delete_at IS NULL", operatorName).Take(&operator).Error; err != nil {
		return ErrExecutionOperatorForbidden
	}
	if operator.Code != "admin" && operator.Code != "super_admin" {
		return ErrExecutionOperatorForbidden
	}
	return nil
}

func executionOperatorView(admission model.QuestionAgentExecutionAdmission, outbox model.QuestionAgentExecutionOutbox) ExecutionOperatorViewV2 {
	view := ExecutionOperatorViewV2{
		ExecutionID: admission.ExecutionID, OwnerRef: admission.UserName,
		Status: admission.Status, TrackingHealth: admission.TrackingHealth,
		BotRunID: admission.BotRunID, TerminalStatus: admission.TerminalStatus,
		LastBotContactAt: admission.LastBotContactAt, LatestCursor: admission.LatestCursor,
		ProjectionRevision: admission.ProjectionRevision, ProjectionAttempts: admission.ProjectionAttempts,
		OutboxState: outbox.State, OutboxAttempts: outbox.Attempts,
		OutboxRevision: outbox.Revision, Classification: outbox.Classification,
		BoundaryState: outbox.BoundaryState, FirstErrorCode: outbox.FirstErrorCode,
		LastErrorCode: outbox.LastErrorCode, NextReconcileAt: outbox.NextReconcileAt,
	}
	if !outbox.NextAttemptAt.IsZero() {
		next := outbox.NextAttemptAt
		view.NextAttemptAt = &next
	}
	return view
}

func loadExecutionOperatorRows(ctx context.Context, db *gorm.DB, ownerRef, executionID string) (model.QuestionAgentExecutionAdmission, model.QuestionAgentExecutionOutbox, error) {
	var admission model.QuestionAgentExecutionAdmission
	if err := db.WithContext(ctx).Where("user_name = ? AND execution_id = ?", ownerRef, executionID).Take(&admission).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return admission, model.QuestionAgentExecutionOutbox{}, ErrExecutionOperatorNotFound
		}
		return admission, model.QuestionAgentExecutionOutbox{}, err
	}
	var outbox model.QuestionAgentExecutionOutbox
	if err := db.WithContext(ctx).Where("user_name = ? AND execution_id = ?", ownerRef, executionID).Take(&outbox).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return admission, outbox, ErrExecutionOperatorNotFound
		}
		return admission, outbox, err
	}
	return admission, outbox, nil
}

func (ps *Service) InspectExecutionV2(ctx context.Context, operatorName, ownerRef, executionID string) (ExecutionOperatorViewV2, error) {
	if err := authorizeExecutionOperator(ctx, operatorName); err != nil {
		return ExecutionOperatorViewV2{}, err
	}
	admission, outbox, err := loadExecutionOperatorRows(ctx, model.DB(ctx), strings.TrimSpace(ownerRef), strings.TrimSpace(executionID))
	if err != nil {
		return ExecutionOperatorViewV2{}, err
	}
	return executionOperatorView(admission, outbox), nil
}

// OperateExecutionV2 exposes only revision-checked, duplicate-safe recovery
// transitions. It never invokes Bot or an Agent directly: dispatcher/projector
// workers remain the only side-effect owners.
func (ps *Service) OperateExecutionV2(ctx context.Context, operatorName, ownerRef, executionID string, action ExecutionOperatorActionV2) (ExecutionOperatorViewV2, error) {
	if err := authorizeExecutionOperator(ctx, operatorName); err != nil {
		return ExecutionOperatorViewV2{}, err
	}
	ownerRef, executionID = strings.TrimSpace(ownerRef), strings.TrimSpace(executionID)
	action.Action = strings.ToLower(strings.TrimSpace(action.Action))
	now := time.Now().UTC()
	err := model.DB(ctx).Transaction(func(tx *gorm.DB) error {
		admission, outbox, err := loadExecutionOperatorRows(ctx, tx, ownerRef, executionID)
		if err != nil {
			return err
		}
		switch action.Action {
		case "retry_dispatch":
			if outbox.State != "dead_letter" || admission.BotRunID != nil || admission.DispatchRevision != 0 {
				return ErrExecutionOperatorUnsafe
			}
			result := tx.WithContext(ctx).Model(&model.QuestionAgentExecutionOutbox{}).
				Where("user_name = ? AND execution_id = ? AND state = ? AND revision = ?", ownerRef, executionID, "dead_letter", action.ExpectedOutboxRevision).
				Updates(map[string]any{"state": "pending", "attempts": 0, "next_attempt_at": now, "lease_owner": nil, "lease_until": nil, "last_error_code": nil, "dead_letter_at": nil, "revision": outbox.Revision + 1, "updated_at": now})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrExecutionOperatorConflict
			}
			return tx.WithContext(ctx).Model(&model.QuestionAgentExecutionAdmission{}).
				Where("user_name = ? AND execution_id = ?", ownerRef, executionID).
				Updates(map[string]any{"status": "admitted", "tracking_health": "pending", "terminal_status": nil, "terminal_at": nil, "updated_at": now}).Error
		case "retry_projection":
			if (admission.BotRunID == nil && outbox.State != "reconcile") || admission.TerminalStatus != nil {
				return ErrExecutionOperatorUnsafe
			}
			if admission.ProjectionLeaseUntil != nil && admission.ProjectionLeaseUntil.After(now) {
				return ErrExecutionOperatorUnsafe
			}
			result := tx.WithContext(ctx).Model(&model.QuestionAgentExecutionAdmission{}).
				Where("user_name = ? AND execution_id = ? AND projection_attempts = ?", ownerRef, executionID, action.ExpectedProjectionAttempts).
				Updates(map[string]any{"next_projection_at": now, "projection_lease_owner": nil, "projection_lease_until": nil, "tracking_health": "pending", "updated_at": now})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrExecutionOperatorConflict
			}
			return nil
		case "retry_reconcile":
			leaseLive := admission.ProjectionLeaseUntil != nil && admission.ProjectionLeaseUntil.After(now)
			if outbox.State != "reconcile" || admission.TerminalStatus != nil || leaseLive {
				return ErrExecutionOperatorUnsafe
			}
			result := tx.WithContext(ctx).Model(&model.QuestionAgentExecutionOutbox{}).
				Where("user_name = ? AND execution_id = ? AND state = ? AND revision = ?", ownerRef, executionID, "reconcile", action.ExpectedOutboxRevision).
				Updates(map[string]any{
					"next_reconcile_at": now, "revision": outbox.Revision + 1,
					"updated_at": now,
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrExecutionOperatorConflict
			}
			return tx.WithContext(ctx).Model(&model.QuestionAgentExecutionAdmission{}).
				Where("user_name = ? AND execution_id = ? AND terminal_status IS NULL", ownerRef, executionID).
				Updates(map[string]any{
					"next_projection_at": now, "tracking_health": "pending",
					"projection_lease_owner": nil, "projection_lease_until": nil,
					"updated_at": now,
				}).Error
		case "dead_letter_dispatch":
			leaseLive := outbox.State == "processing" && outbox.LeaseUntil != nil && outbox.LeaseUntil.After(now)
			if admission.BotRunID != nil || leaseLive || outbox.Attempts != 0 || outbox.State != "pending" {
				return ErrExecutionOperatorUnsafe
			}
			result := tx.WithContext(ctx).Model(&model.QuestionAgentExecutionOutbox{}).
				Where("user_name = ? AND execution_id = ? AND revision = ?", ownerRef, executionID, action.ExpectedOutboxRevision).
				Updates(map[string]any{
					"state": "rejected", "classification": "reject",
					"boundary_state": "not_entered", "lease_owner": nil,
					"lease_until": nil, "first_error_code": gorm.Expr("COALESCE(first_error_code, ?)", "operator_rejected"),
					"last_error_code": "operator_rejected", "revision": outbox.Revision + 1,
					"updated_at": now,
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrExecutionOperatorConflict
			}
			return settleStrandedExecution(ctx, tx, admission, now)
		case "settle_stranded_failed":
			if outbox.State != "rejected" || admission.BotRunID != nil ||
				outbox.Classification == nil || *outbox.Classification != "reject" ||
				outbox.BoundaryState == nil || *outbox.BoundaryState != "not_entered" {
				return ErrExecutionOperatorUnsafe
			}
			return settleStrandedExecution(ctx, tx, admission, now)
		default:
			return ErrExecutionOperatorUnsafe
		}
	})
	if err != nil {
		return ExecutionOperatorViewV2{}, err
	}
	return ps.InspectExecutionV2(ctx, operatorName, ownerRef, executionID)
}

func settleStrandedExecution(ctx context.Context, tx *gorm.DB, admission model.QuestionAgentExecutionAdmission, now time.Time) error {
	if err := tx.WithContext(ctx).Model(&model.QuestionAgentExecutionAdmission{}).
		Where("user_name = ? AND execution_id = ? AND bot_run_id IS NULL", admission.UserName, admission.ExecutionID).
		Updates(map[string]any{"status": "failed", "terminal_status": "failed", "terminal_at": now, "tracking_health": "degraded", "updated_at": now}).Error; err != nil {
		return err
	}
	return tx.WithContext(ctx).Model(&model.ConversationMessageV2{}).
		Where("user_name = ? AND execution_id = ? AND message_type = ?", admission.UserName, admission.ExecutionID, "assistant").
		Updates(map[string]any{"status": "failed", "updated_at": now}).Error
}
