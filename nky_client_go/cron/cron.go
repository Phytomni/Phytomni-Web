package cron

import (
	rxCron "nky_client_go/cron/base"

	"github.com/spf13/viper"
)

func DoCron() error {
	if !viper.GetBool("cron.switch") {
		return nil
	}
	freshTokenList := make([]rxCron.Cron, 0)
	// todo 暂停定时任务查询
	//NewFreshToken(),NewFreshGA(),NewFreshGALog()
	freshTokenList = append(freshTokenList, NewFreshGA())
	if err := rxCron.InitFromMinute(freshTokenList); err != nil {
		return err
	}
	return nil
}
