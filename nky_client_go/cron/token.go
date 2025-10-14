package cron

import (
	rxCron "nky_client_go/cron/base"
	"nky_client_go/log"
	"nky_client_go/service/api_service"
	"nky_client_go/utils"
)

type FreshToken struct {
}

func NewFreshToken() rxCron.Cron {
	return &FreshToken{}
}

func (ts *FreshToken) Spec() string {
	return "16 11 * * *"
}

func (ts *FreshToken) Run() {
	log.SugarContext(utils.BuildRequestIdCtx()).Infow("每天凌晨00:01刷新token")
	api_service.NewApiService().GetFreshToken()
}
