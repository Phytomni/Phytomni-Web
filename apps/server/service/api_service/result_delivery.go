package api_service

import (
	"context"
	"errors"
	"strings"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"

	"gorm.io/gorm"
)

var (
	ErrConversationResultArchiveNotFound      = errors.New("conversation result archive not found")
	ErrConversationResultArchiveRetryConflict = errors.New("conversation result archive retry conflict")
)

// RetryConversationResultArchive retries only a failed, retryable archive for
// one authenticated conversation message. Bot remains authoritative for the
// delivery transition; Web persists its bounded projection and business state.
func (ps *Service) RetryConversationResultArchive(
	ctx context.Context,
	username string,
	dialogueID string,
	rowID int64,
) (AgentTaskDeliveryDTO, error) {
	row, err := loadConversationResultArchiveRow(ctx, username, dialogueID, rowID)
	if err != nil {
		return AgentTaskDeliveryDTO{}, err
	}
	projection, err := storedResultArchiveProjection(row)
	if err != nil {
		return AgentTaskDeliveryDTO{}, err
	}
	delivery := projection.Delivery
	if delivery.Status == "pending" {
		return *agentTaskDeliveryDTO(projection), nil
	}
	if delivery.Status != "failed" || !delivery.Retryable || strings.TrimSpace(row.BotRunId) == "" {
		return AgentTaskDeliveryDTO{}, ErrConversationResultArchiveRetryConflict
	}

	retried, err := ps.archiveDeliveryClient().RetryRunDelivery(ctx, row.BotRunId)
	if err != nil {
		return AgentTaskDeliveryDTO{}, err
	}
	if !validArchiveRetryDelivery(delivery, retried) {
		return AgentTaskDeliveryDTO{}, ErrConversationResultArchiveRetryConflict
	}

	incoming := cloneBotRunProjection(projection)
	incoming.ResultArchiveV1 = true
	incoming.Delivery = projectRunDelivery(retried)
	if err := SaveBotRunProjection(ctx, username, rowID, incoming); err != nil {
		return AgentTaskDeliveryDTO{}, err
	}
	result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where(
			"id = ? AND user_name = ? AND dialogue_id = ? AND delete_at IS NULL AND bot_run_id = ? AND UPPER(status) IN (?, ?)",
			rowID,
			username,
			dialogueID,
			row.BotRunId,
			"SUCCEEDED",
			"RUNNING",
		).
		Update("status", "RUNNING")
	if result.Error != nil {
		return AgentTaskDeliveryDTO{}, result.Error
	}
	if result.RowsAffected != 1 {
		return AgentTaskDeliveryDTO{}, ErrConversationResultArchiveRetryConflict
	}

	stored, err := LoadBotRunProjection(ctx, username, rowID)
	dto := agentTaskDeliveryDTO(stored)
	if err != nil || dto == nil {
		return AgentTaskDeliveryDTO{}, ErrConversationResultArchiveRetryConflict
	}
	return *dto, nil
}

func loadConversationResultArchiveRow(ctx context.Context, username, dialogueID string, rowID int64) (*model.QuestionAgentLog, error) {
	var row model.QuestionAgentLog
	result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Select("id, user_name, dialogue_id, bot_run_id, status, bot_projection_json, bot_report_revision").
		Where(
			"id = ? AND user_name = ? AND dialogue_id = ? AND delete_at IS NULL AND UPPER(status) IN (?, ?)",
			rowID,
			username,
			dialogueID,
			"SUCCEEDED",
			"RUNNING",
		).
		Take(&row)
	if errors.Is(result.Error, gorm.ErrRecordNotFound) || result.RowsAffected == 0 {
		return nil, ErrConversationResultArchiveNotFound
	}
	if result.Error != nil {
		return nil, result.Error
	}
	return &row, nil
}

func storedResultArchiveProjection(row *model.QuestionAgentLog) (BotRunProjection, error) {
	if row == nil {
		return BotRunProjection{}, ErrConversationResultArchiveNotFound
	}
	projection, _, err := unmarshalPersistedProjectionWithContext(row.BotProjectionJSON)
	if err != nil {
		return BotRunProjection{}, ErrConversationResultArchiveRetryConflict
	}
	projection.ReportRevision = row.BotReportRevision
	if !projection.ResultArchiveV1 || projection.Delivery == nil || !projection.Delivery.Required {
		return BotRunProjection{}, ErrConversationResultArchiveRetryConflict
	}
	return projection, nil
}

func validArchiveRetryDelivery(current *ProjectionDelivery, retried *rxBot.RunDelivery) bool {
	return current != nil && retried != nil &&
		current.InventoryDigest != "" &&
		retried.SchemaVersion == rxBot.ResultArchiveProtocolVersion &&
		retried.Required &&
		retried.Status == "pending" &&
		retried.Revision > current.Revision &&
		retried.InventoryDigest == current.InventoryDigest &&
		retried.Archive == nil && retried.ErrorCode == "" && !retried.Retryable
}
