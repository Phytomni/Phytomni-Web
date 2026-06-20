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

	// 所有异步 agent(analyst + deep_genome)都由 Bot 提交远端并持有 bot_run_id;
	// 统一交给 SyncBotRuns 按 bot_run_id 轮询 Bot run 状态回收(无 bot_run_id 的历史
	// 行由 SyncBotRuns 内部跳过)。退役产品 EIHealth 的 IAM 直连轮询已移除。
	api_service.SyncBotRuns(questionAgentList)
}
