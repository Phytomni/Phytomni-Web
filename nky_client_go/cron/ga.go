package cron

import (
	"fmt"
	"github.com/gin-gonic/gin"
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
	//rxLog.Sugar().Info("分析结果每5分钟查询一次")
	fmt.Println("分析结果每10分钟查询一次")
	//从数据库查询出所有taskId的status的状态为waiting的任务
	var questionAgentList []model.SQuestionAgentLog
	// todo:需要进入轮询的状态有running、waiting
	err := model.Default().Model(&model.SQuestionAgentLog{}).Debug().Where("status = ?", "RUNNING").Find(&questionAgentList).Error
	if err != nil {
		rxLog.Sugar().Error(err)
		return
	}

	var taskIdSet []string
	for _, v := range questionAgentList {
		taskIdSet = append(taskIdSet, v.TaskId)
	}
	var ctx *gin.Context
	servicega.GetTaskStatus(ctx, taskIdSet)

}
