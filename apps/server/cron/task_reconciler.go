package cron

import (
	"fmt"
	rxCron "phytomni-server/cron/base"
	rxLog "phytomni-server/log"
	"phytomni-server/model"
	"phytomni-server/service/api_service"
)

type TaskReconciler struct {
}

func NewTaskReconciler() rxCron.Cron {
	return &TaskReconciler{}
}

func (r *TaskReconciler) Spec() string {
	return "*/10 * * * *"
}

func (r *TaskReconciler) Run() {
	fmt.Println("分析结果每10分钟查询一次")
	var questionAgentList []model.QuestionAgentLog
	err := model.Default().Model(&model.QuestionAgentLog{}).Debug().Where("status = ?", "RUNNING").Find(&questionAgentList).Error
	if err != nil {
		rxLog.Sugar().Error(err)
		return
	}

	// All async agents (analyst + deep_genome) are submitted to the remote by Bot
	// and carry a bot_run_id; they are reconciled uniformly by SyncBotRuns, which
	// polls Bot run state by bot_run_id (historical rows without a bot_run_id are
	// skipped inside SyncBotRuns). The retired EIHealth product's direct IAM poll
	// has been removed.
	api_service.SyncBotRuns(questionAgentList)
}
