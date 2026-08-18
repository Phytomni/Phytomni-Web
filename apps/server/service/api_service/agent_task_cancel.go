package api_service

import (
	"context"
	"errors"
	"strings"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

// AgentTaskCancel is the owner-scoped cancel command. Browser input names only
// the Web row id. The JWT owner is the sole authorizer; Bot run identity never
// comes from the client. Emitted tokens stay on the row as a cancelled draft.
func (ps *Service) AgentTaskCancel(ctx context.Context, rowID int64, username string) (AgentTaskLifecycleDTO, error) {
	row, err := loadAgentTaskLifecycleRow(ctx, rowID, username)
	if err != nil {
		return AgentTaskLifecycleDTO{}, err
	}
	if ownerTaskAlreadyCancelled(row) {
		return lifecycleFromStored(row, lifecycleReconciliationCached, nil), nil
	}
	if ownerTaskCancelBlocked(row) {
		return AgentTaskLifecycleDTO{}, ErrAgentTaskCancelConflict
	}

	if strings.TrimSpace(row.BotRunId) == "" {
		if err := persistOwnerTaskCancelled(ctx, row); err != nil {
			return AgentTaskLifecycleDTO{}, err
		}
		row, err = loadAgentTaskLifecycleRow(ctx, rowID, username)
		if err != nil {
			return AgentTaskLifecycleDTO{}, err
		}
		return lifecycleFromStored(row, lifecycleReconciliationCached, nil), nil
	}

	record, meta, err := ps.agentRunCanceller().CancelRunWithMeta(ctx, row.BotRunId)
	if err != nil {
		return AgentTaskLifecycleDTO{}, mapAgentTaskCancelAPIError(err)
	}
	if !validCancelRunRecord(record, row.BotRunId) {
		return AgentTaskLifecycleDTO{}, ErrAgentTaskCancelConflict
	}
	// Bot already accepted the cancel. Merge the draft when the snapshot is
	// well-formed, but never leave the owner row RUNNING because projection
	// apply failed (Design archive payloads are the known case).
	if _, decodeErr := DecodeRunProjection(record); decodeErr == nil {
		_ = ps.applyBotRunProjection(ctx, row, record, meta)
	}
	if err := persistOwnerTaskCancelled(ctx, row); err != nil {
		return AgentTaskLifecycleDTO{}, err
	}

	row, err = loadAgentTaskLifecycleRow(ctx, rowID, username)
	if err != nil {
		return AgentTaskLifecycleDTO{}, err
	}
	if !ownerTaskAlreadyCancelled(row) {
		return AgentTaskLifecycleDTO{}, ErrAgentTaskCancelConflict
	}
	return lifecycleFromStored(row, lifecycleReconciliationFresh, nil), nil
}

func mapAgentTaskCancelAPIError(err error) error {
	var apiErr *rxBot.APIError
	if !errors.As(err, &apiErr) {
		return err
	}
	switch apiErr.Status {
	case 404:
		return ErrAgentTaskLifecycleNotFound
	case 409:
		return ErrAgentTaskCancelConflict
	default:
		return err
	}
}

func validCancelRunRecord(record *rxBot.RunRecord, expectedRunID string) bool {
	if !validLifecycleRunRecord(record, expectedRunID) {
		return false
	}
	status, err := normalizeProjectionStatus(record.Status)
	return err == nil && status == "CANCELLED"
}

func ownerTaskAlreadyCancelled(row *model.QuestionAgentLog) bool {
	if row == nil {
		return false
	}
	if isCancelledStatus(row.Status) {
		return true
	}
	return isCancelledStatus(lifecycleStoredProjection(row).Status)
}

func ownerTaskCancelBlocked(row *model.QuestionAgentLog) bool {
	if row == nil {
		return false
	}
	if cancelBlockedStatus(row.Status) {
		return true
	}
	projection := lifecycleStoredProjection(row)
	if cancelBlockedStatus(projection.Status) {
		return true
	}
	scientific := lifecycleScientificStatus(row, projection)
	return projectionHasPendingRequiredDelivery(projection) &&
		!isProjectionFailureStatus(scientific) &&
		strings.EqualFold(strings.TrimSpace(scientific), "SUCCEEDED")
}

func isCancelledStatus(status string) bool {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "CANCELLED", "CANCELED":
		return true
	default:
		return false
	}
}

func cancelBlockedStatus(status string) bool {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "SUCCEEDED", "FAILED", "TIMED_OUT", "TIMEOUT", "FINALIZING":
		return true
	default:
		return false
	}
}

// persistOwnerTaskCancelled writes CANCELLED onto the owner row without
// clearing the answer. Projection merge cannot overlay CANCELLED onto a
// later SUCCEEDED snapshot; this write is the cancel command itself.
func persistOwnerTaskCancelled(ctx context.Context, row *model.QuestionAgentLog) error {
	if row == nil {
		return ErrAgentTaskLifecycleNotFound
	}
	for attempt := 0; attempt < botProjectionCASAttempts; attempt++ {
		projection, privateContext, currentRaw, currentRevision, err := loadPersistedBotProjectionRow(ctx, row.UserName, row.Id)
		if err != nil {
			return err
		}
		projection.Status = "CANCELLED"
		if strings.TrimSpace(projection.RunID) == "" {
			projection.RunID = strings.TrimSpace(row.BotRunId)
		}
		encoded, err := marshalPersistedProjectionWithContext(projection, privateContext)
		if err != nil {
			return err
		}
		updates := map[string]interface{}{"status": "CANCELLED"}
		if encoded != currentRaw {
			updates["bot_projection_json"] = encoded
		}
		result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
			Where(botProjectionCASPredicate, row.Id, row.UserName, currentRevision, currentRaw).
			Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 1 {
			return nil
		}
		latest, loadErr := loadAgentTaskLifecycleRow(ctx, row.Id, row.UserName)
		if loadErr != nil {
			return loadErr
		}
		if ownerTaskAlreadyCancelled(latest) {
			return nil
		}
	}
	return ErrAgentTaskCancelConflict
}
