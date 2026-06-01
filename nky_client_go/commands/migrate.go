package commands

import (
	rxLog "nky_client_go/log"
	"nky_client_go/model"

	"github.com/urfave/cli/v2"
)

// Migrate is the CLI command `go run main.go migrate up`. It performs:
//  1. GORM AutoMigrate against the SUser model (additive — never drops columns).
//  2. First-login backfill: revert first_login_status from '1' to '0' for
//     users whose password_change_at and created_at are within 5 seconds of
//     each other. Idempotent by construction — the WHERE clause requires
//     first_login_status='1', and the update sets it to '0', so a second
//     invocation matches zero rows.
//
// DB connection + Viper config are bootstrapped by main.initConfig (app.Before),
// so model.Default() is usable directly here.
func Migrate() *cli.Command {
	return &cli.Command{
		Name:  "migrate",
		Usage: "数据库迁移 + first-login 状态回填",
		Subcommands: []*cli.Command{
			{
				Name:        "up",
				Usage:       "自动迁移数据库 + 第一次登录状态修复",
				Description: "GORM AutoMigrate followed by the first_login_status backfill. Safe to re-run.",
				Action: func(ctx *cli.Context) error {
					db := model.Default()

					if err := db.AutoMigrate(&model.SUser{}); err != nil {
						rxLog.Sugar().Errorw("AutoMigrate SUser failed", "err", err)
						return err
					}
					rxLog.Sugar().Infow("AutoMigrate SUser complete")

					result := db.Exec(`
						UPDATE s_user
						SET first_login_status = '0'
						WHERE first_login_status = '1'
						  AND password_change_at IS NOT NULL
						  AND created_at IS NOT NULL
						  AND ABS(TIMESTAMPDIFF(SECOND, password_change_at, created_at)) < 5
					`)
					if result.Error != nil {
						rxLog.Sugar().Errorw("first_login backfill failed", "err", result.Error)
						return result.Error
					}
					rxLog.Sugar().Infow("first_login_status backfill complete",
						"rows_affected", result.RowsAffected)
					return nil
				},
			},
		},
	}
}
