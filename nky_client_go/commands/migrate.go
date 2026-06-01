package commands

import (
	rxLog "nky_client_go/log"
	"nky_client_go/model"

	"github.com/urfave/cli/v2"
)

// Migrate is the CLI command `go run main.go migrate up`. It performs the
// first-login backfill: revert first_login_status from '1' to '0' for users
// whose password_change_at and created_at are within 5 seconds of each other.
// Idempotent by construction — the WHERE clause requires first_login_status='1',
// and the update sets it to '0', so a second invocation matches zero rows.
//
// Schema management is intentionally out of scope here. SUser is defined with
// `gorm:"type:enum"` (no value list), which GORM cannot translate into valid
// DDL on MariaDB/MySQL — calling AutoMigrate on either a fresh or existing
// schema generates `enum NOT NULL` and fails with SQL syntax error 1064.
// Production schema is provisioned via separate manual DDL; this command
// only handles the backfill.
//
// DB connection + Viper config are bootstrapped by main.initConfig (app.Before),
// so model.Default() is usable directly here.
func Migrate() *cli.Command {
	return &cli.Command{
		Name:  "migrate",
		Usage: "first-login 状态回填",
		Subcommands: []*cli.Command{
			{
				Name:        "up",
				Usage:       "第一次登录状态修复",
				Description: "first_login_status backfill. Idempotent — safe to re-run.",
				Action: func(ctx *cli.Context) error {
					db := model.Default()

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
