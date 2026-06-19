package cron

import (
	rxCron "phytomni-server/cron/base"
	"phytomni-server/log"
	"phytomni-server/utils"
)

type TestSecond struct {
}

func NewTestSecond() rxCron.Cron {
	return &TestSecond{}
}

func (ts *TestSecond) Spec() string {
	return "* * * * * *"
}

func (ts *TestSecond) Run() {
	log.SugarContext(utils.BuildRequestIdCtx()).Infow("每秒执行一次")
}

type TestMinute struct {
}

func NewTestMinute() rxCron.Cron {
	return &TestMinute{}
}

func (tm *TestMinute) Spec() string {
	return "* * * * *"
}

func (tm *TestMinute) Run() {
	log.SugarContext(utils.BuildRequestIdCtx()).Infow("没分执行一次")
}
