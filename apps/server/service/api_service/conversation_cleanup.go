package api_service

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"

	rxBot "phytomni-server/external/bot"
	rxLog "phytomni-server/log"
	"phytomni-server/model"
)

const (
	conversationDeletePending = "CONTEXT_DELETE_PENDING"
	conversationDeleteAcked   = "CONTEXT_DELETE_ACKED"
	staleSubmissionReason     = "stale_submission_timeout"

	maxConversationCleanupBatch  = 100
	conversationTombstoneTimeout = 2 * time.Second
)

var (
	ErrConversationDeleteNotFound = errors.New("conversation not found")
	errConversationBotUnavailable = errors.New("bot conversation context unavailable")
)

// CleanupResult reports one bounded cleanup pass without coupling cron to
// individual row failures. Error is reserved for a batch-level database error.
type CleanupResult struct {
	Processed int
	Succeeded int
	Failed    int
	Error     error
}

func boundedConversationCleanupLimit(limit int) int {
	if limit <= 0 {
		return 0
	}
	if limit > maxConversationCleanupBatch {
		return maxConversationCleanupBatch
	}
	return limit
}

func conversationContextBotAvailable() bool {
	return rxBot.BotConfig != nil &&
		rxBot.BotConfig.ProxyEnabled &&
		rxBot.BotConfig.MultiturnV1Enabled &&
		rxBot.BotConfig.BaseURL != ""
}

func conversationTombstoneCallTimeout() time.Duration {
	timeout := conversationTombstoneTimeout
	if rxBot.BotConfig != nil && rxBot.BotConfig.TimeoutSeconds > 0 {
		configured := time.Duration(rxBot.BotConfig.TimeoutSeconds) * time.Second
		if configured < timeout {
			timeout = configured
		}
	}
	return timeout
}

func (ps *Service) tombstoneDeletedConversation(
	ctx context.Context,
	root model.QuestionAgentLog,
) error {
	if !conversationContextBotAvailable() {
		return errConversationBotUnavailable
	}
	callCtx, cancel := context.WithTimeout(
		context.WithoutCancel(ctx),
		conversationTombstoneCallTimeout(),
	)
	defer cancel()
	if _, err := rxBot.NewClient().TombstoneConversationContext(
		callCtx,
		rxBot.ContextTombstoneRequest{
			SchemaVersion:   1,
			ConversationKey: root.DialogueId,
		},
	); err != nil {
		return err
	}

	result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where(
			"id = ? AND user_name = ? AND f_id = ? AND delete_at IS NOT NULL AND log_status = ?",
			root.Id,
			root.UserName,
			0,
			conversationDeletePending,
		).
		Update("log_status", conversationDeleteAcked)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}

	var current model.QuestionAgentLog
	err := model.DB(ctx).
		Where("id = ? AND user_name = ? AND f_id = ?", root.Id, root.UserName, 0).
		First(&current).Error
	if err == nil && current.DeleteAt != nil && current.LogStatus == conversationDeleteAcked {
		return nil
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrConversationDeleteNotFound
	}
	if err != nil {
		return err
	}
	return errors.New("conversation tombstone state changed")
}

// DrainPendingConversationTombstones retries a deterministic bounded batch.
// Bot failures are isolated per row so one unavailable context cannot block the
// rest of the durable outbox.
func (ps *Service) DrainPendingConversationTombstones(
	ctx context.Context,
	limit int,
) CleanupResult {
	limit = boundedConversationCleanupLimit(limit)
	if limit == 0 {
		return CleanupResult{}
	}

	var roots []model.QuestionAgentLog
	if err := model.DB(ctx).
		Where(
			"f_id = ? AND log_status = ? AND delete_at IS NOT NULL",
			0,
			conversationDeletePending,
		).
		Order("id ASC").
		Limit(limit).
		Find(&roots).Error; err != nil {
		return CleanupResult{Failed: 1, Error: err}
	}

	result := CleanupResult{}
	for _, root := range roots {
		result.Processed++
		if err := ps.tombstoneDeletedConversation(ctx, root); err != nil {
			result.Failed++
			rxLog.SugarContext(ctx).Warnw(
				"conversation context tombstone retry deferred",
				"conversation_row_id", root.Id,
				"reason", "bot_tombstone_failed",
			)
			continue
		}
		result.Succeeded++
	}
	return result
}

// FailStaleConversationSubmissions fails only synchronous rows that never left
// SUBMITTING. Async RUNNING rows remain exclusively owned by SyncBotRuns.
func (ps *Service) FailStaleConversationSubmissions(
	ctx context.Context,
	olderThan time.Time,
	limit int,
) CleanupResult {
	limit = boundedConversationCleanupLimit(limit)
	if limit == 0 {
		return CleanupResult{}
	}

	var rows []model.QuestionAgentLog
	if err := model.DB(ctx).
		Select("id", "user_name").
		Where(
			"status = ? AND created_at < ? AND delete_at IS NULL",
			"SUBMITTING",
			olderThan,
		).
		Order("id ASC").
		Limit(limit).
		Find(&rows).Error; err != nil {
		return CleanupResult{Failed: 1, Error: err}
	}

	result := CleanupResult{}
	for _, row := range rows {
		result.Processed++
		update := model.DB(ctx).Model(&model.QuestionAgentLog{}).
			Where(
				"id = ? AND user_name = ? AND status = ? AND delete_at IS NULL",
				row.Id,
				row.UserName,
				"SUBMITTING",
			).
			Updates(map[string]any{
				"status":     "FAILED",
				"log_status": staleSubmissionReason,
			})
		if update.Error != nil {
			result.Failed++
			rxLog.SugarContext(ctx).Warnw(
				"stale conversation submission cleanup failed",
				"conversation_row_id", row.Id,
				"reason", "database_update_failed",
			)
			continue
		}
		result.Succeeded++
	}
	return result
}
