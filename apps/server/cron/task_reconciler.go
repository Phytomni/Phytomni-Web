package cron

import (
	"context"
	rxCron "phytomni-server/cron/base"
	rxLog "phytomni-server/log"
	"phytomni-server/service/api_service"
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
	rxLog.Sugar().Infow("running conversation cleanup")
	ctx := context.Background()
	service := api_service.NewService()
	tombstones := service.DrainPendingConversationTombstones(ctx, conversationCleanupBatchLimit)
	if tombstones.Error != nil {
		rxLog.Sugar().Errorw(
			"conversation tombstone cleanup query failed",
			"reason", "database_query_failed",
		)
	}
}
