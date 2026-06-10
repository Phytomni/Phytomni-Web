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
// Schema management is intentionally out of scope here. SUser was originally
// defined with `gorm:"type:enum"` (no value list), which GORM could not
// translate into valid DDL on MariaDB/MySQL — calling AutoMigrate on either
// a fresh or existing schema generated `enum NOT NULL` and failed with SQL
// syntax error 1064. The enum tag has since been fixed in model/table.go so
// fresh-schema AutoMigrate is now syntactically valid, but production DDL
// stays manual and this command continues to handle only the backfill.
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
			{
				Name:        "add-bot-run-id",
				Usage:       "给 s_question_agent_logs 加 bot_run_id 列",
				Description: "Add the nullable bot_run_id join column. Idempotent — no-op if it already exists. Dev/CI fresh-schema only; production DDL stays manual.",
				Action: func(ctx *cli.Context) error {
					db := model.Default()
					if db.Migrator().HasColumn(&model.SQuestionAgentLog{}, "bot_run_id") {
						rxLog.Sugar().Info("bot_run_id column already exists, skip")
						return nil
					}
					if err := db.Exec(
						"ALTER TABLE s_question_agent_logs ADD COLUMN bot_run_id VARCHAR(64) NULL AFTER server_id",
					).Error; err != nil {
						rxLog.Sugar().Errorw("add bot_run_id failed", "err", err)
						return err
					}
					rxLog.Sugar().Info("bot_run_id column added")
					return nil
				},
			},
			{
				Name:        "all",
				Usage:       "建全部表(dev/CI fresh-schema)",
				Description: "AutoMigrate every model into a fresh schema. Dev/CI only — production DDL stays manual. The enum tags in model/table.go carry value lists, so fresh-schema AutoMigrate generates valid MariaDB DDL.",
				Action: func(ctx *cli.Context) error {
					db := model.Default()
					if err := db.AutoMigrate(
						&model.SUser{},
						&model.SToolName{},
						&model.SUserToolName{},
						&model.SQuestionLog{},
						&model.SKooSearchQuestionLog{},
						&model.SQuestionAgentLog{},
						&model.SGeneList{},
						&model.SGeneExample{},
						&model.SUserPermission{},
						&model.SServerToolLogs{},
						&model.SUserFeedback{},
						&model.SUserOperationLog{},
						&model.SSqlOperationLog{},
					); err != nil {
						rxLog.Sugar().Errorw("automigrate all failed", "err", err)
						return err
					}
					rxLog.Sugar().Info("automigrate all complete")
					return nil
				},
			},
		},
	}
}
