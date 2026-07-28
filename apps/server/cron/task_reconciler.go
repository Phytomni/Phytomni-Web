package cron

import (
	"context"
	rxCron "phytomni-server/cron/base"
	rxBot "phytomni-server/external/bot"
	rxLog "phytomni-server/log"
	"phytomni-server/model"
	"phytomni-server/service/api_service"
	"time"
)

const conversationCleanupBatchLimit = 100

type TaskReconciler struct {
}

func NewTaskReconciler() rxCron.Cron {
	return &TaskReconciler{}
}

func (r *TaskReconciler) Spec() string {
	return "*/10 * * * *"
}

func (r *TaskReconciler) Run() {
	rxLog.Sugar().Infow("running task reconciliation")
	var questionAgentList []model.QuestionAgentLog
	err := model.Default().Model(&model.QuestionAgentLog{}).
		Where("status = ?", "RUNNING").
		Find(&questionAgentList).Error
	if err != nil {
		rxLog.Sugar().Errorw("task reconciliation query failed", "reason", "database_query_failed")
		return
	}

	// All async agents (analyst + deep_genome) are submitted to the remote by Bot
	// and carry a bot_run_id; they are reconciled uniformly by SyncBotRuns, which
	// polls Bot run state by bot_run_id (historical rows without a bot_run_id are
	// skipped inside SyncBotRuns). The retired EIHealth product's direct IAM poll
	// has been removed.
	api_service.SyncBotRuns(questionAgentList)

	ctx := context.Background()
	service := api_service.NewService()
	tombstones := service.DrainPendingConversationTombstones(ctx, conversationCleanupBatchLimit)
	if tombstones.Error != nil {
		rxLog.Sugar().Errorw(
			"conversation tombstone cleanup query failed",
			"reason", "database_query_failed",
		)
	}

	timeoutSeconds := 60
	if rxBot.BotConfig != nil && rxBot.BotConfig.TimeoutSeconds > 0 {
		timeoutSeconds = rxBot.BotConfig.TimeoutSeconds
	}
	staleBefore := time.Now().Add(-2 * time.Duration(timeoutSeconds) * time.Second)
	stale := service.FailStaleConversationSubmissions(
		ctx,
		staleBefore,
		conversationCleanupBatchLimit,
	)
	if stale.Error != nil {
		rxLog.Sugar().Errorw(
			"stale conversation submission cleanup query failed",
			"reason", "database_query_failed",
		)
	}
}
