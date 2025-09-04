package cron

import (
	"fmt"
	rxCron "nky_client_go/cron/base"
	rxLog "nky_client_go/log"
	"nky_client_go/model"
)

type FreshGALog struct {
}

func NewFreshGALog() rxCron.Cron {
	return &FreshGALog{}
}

func (ts *FreshGALog) Spec() string {
	return "*/10 * * * *"
	//return "* * * * *"
}

func (ts *FreshGALog) Run() {
	//rxLog.Sugar().Info("日志结果每10分钟查询一次")
	fmt.Println("日志结果每10分钟查询一次")
	db := model.Default().Model(&model.SQuestionAgentLog{})
	var questionAgentLogList []*model.SQuestionAgentLog
	err := db.Where("tool_name = ? AND status IN (?) and log_status = ?", "AnalystAgent", []string{"RUNNING", "SUCCEEDED", "FAILED"}, "sync_running").Find(&questionAgentLogList).Error

	if err != nil {
		rxLog.Sugar().Error(err)
		return
	}
	listMap := make(map[string]interface{})
	for _, v := range questionAgentLogList {
		listMap[v.TaskId] = v.ComputeResource
	}

	//servicega.GetAnalystAgentLog(listMap)

}
