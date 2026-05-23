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
	// NewFreshToken / NewFreshGALog were removed alongside their unregistered
	// type files — see git history of cron/token.go and cron/ga_log.go.
	freshTokenList = append(freshTokenList, NewFreshGA())
	if err := rxCron.InitFromMinute(freshTokenList); err != nil {
		return err
	}
	return nil
}
