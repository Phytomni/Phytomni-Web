package cron

import (
	"fmt"
	rxCron "nky_client_go/cron/base"
	rxLog "nky_client_go/log"
	"nky_client_go/model"
	servicega "nky_client_go/service/api_service"
)

type FreshGA struct {
}

func NewFreshGA() rxCron.Cron {
	return &FreshGA{}
}

func (ts *FreshGA) Spec() string {
	return "*/10 * * * *"
}

func (ts *FreshGA) Run() {
	fmt.Println("分析结果每10分钟查询一次")
	var questionAgentList []model.SQuestionAgentLog
	err := model.Default().Model(&model.SQuestionAgentLog{}).Debug().Where("status = ?", "RUNNING").Find(&questionAgentList).Error
	if err != nil {
		rxLog.Sugar().Error(err)
		return
	}

	// deep_genome runs in-process on Bot, not on EIHealth, so its task ids are
	// not EIHealth jobs. Route by tool_name: EIHealth-backed agents (analyst)
	// keep the legacy IAM poll; deep_genome rows reconcile against Bot run state.
	eiHealthTaskIds, botRows := partitionRunningRows(questionAgentList)
	if len(eiHealthTaskIds) > 0 {
		servicega.GetTaskStatus(eiHealthTaskIds)
	}
	servicega.SyncBotRuns(botRows)
}

// partitionRunningRows splits RUNNING rows by their backing compute platform:
// deep_genome rows reconcile against Bot run state, every other (analyst /
// EIHealth-backed) tool keeps the legacy IAM job poll keyed by task_id. Pure
// (no DB / network) so the routing is unit-testable without standing up either
// backend.
func partitionRunningRows(rows []model.SQuestionAgentLog) (eiHealthTaskIds []string, botRows []model.SQuestionAgentLog) {
	for _, v := range rows {
		if v.ToolName == "DeepGenomeAgent" {
			botRows = append(botRows, v)
		} else {
			eiHealthTaskIds = append(eiHealthTaskIds, v.TaskId)
		}
	}
	return eiHealthTaskIds, botRows
}
