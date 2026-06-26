package commands

import (
	"fmt"

	rxLog "phytomni-server/log"
	"phytomni-server/model"

	"github.com/urfave/cli/v2"
	"gorm.io/gorm"
)

// agentToolNameRenames maps every retired agent name to its canonical Bot
// tool name. Applied to tool_names (input tokens) and question_agent_logs
// (persisted render key). Idempotent: each UPDATE's WHERE pins the old value.
var agentToolNameRenames = map[string]string{
	"ChatAgents":       "ChatAgent",
	"KnowledgeAgents":  "KnowledgeAgent",
	"DatabaseAgents":   "DataAgent",
	"ReviewAgents":     "ReviewAgent",
	"AnalysisAgents":   "AnalystAgent",
	"BriefReviewAgent": "BriefGeneAgent",
}

// renameAgentToolNames runs agentToolNameRenames as idempotent UPDATEs against
// the given table/column and returns total rows affected. table/column are
// hardcoded constants from the subcommands (never user input), so the
// fmt.Sprintf is injection-safe; values are bound parameters.
func renameAgentToolNames(db *gorm.DB, table, column string) (int64, error) {
	var total int64
	for oldName, newName := range agentToolNameRenames {
		res := db.Exec(
			fmt.Sprintf("UPDATE %s SET %s = ? WHERE %s = ?", table, column, column),
			newName, oldName)
		if res.Error != nil {
			return total, res.Error
		}
		total += res.RowsAffected
	}
	return total, nil
}

// addColumnIfMissing runs an idempotent additive ALTER: if model already has
// col it logs and no-ops, otherwise it executes ddl. The add-bot-run-id and
// add-image-paths subcommands share this single implementation of the
// HasColumn idempotency guard so a test can drive the guard directly — the CLI
// Action closures themselves are unexported and not reachable from a test.
func addColumnIfMissing(db *gorm.DB, model interface{}, col, ddl string) error {
	if db.Migrator().HasColumn(model, col) {
		rxLog.Sugar().Infof("%s column already exists, skip", col)
		return nil
	}
	if err := db.Exec(ddl).Error; err != nil {
		rxLog.Sugar().Errorw("add column failed", "column", col, "err", err)
		return err
	}
	rxLog.Sugar().Infof("%s column added", col)
	return nil
}

// addUniqueIndexIfMissing is an idempotent helper for creating a unique index.
// addColumnIfMissing handles columns; this companion handles indexes using
// db.Migrator().HasIndex since the column helpers cannot create indexes.
func addUniqueIndexIfMissing(db *gorm.DB, model interface{}, indexName, ddl string) error {
	if db.Migrator().HasIndex(model, indexName) {
		rxLog.Sugar().Infof("%s index already exists, skip", indexName)
		return nil
	}
	if err := db.Exec(ddl).Error; err != nil {
		rxLog.Sugar().Errorw("create unique index failed", "index", indexName, "err", err)
		return err
	}
	rxLog.Sugar().Infof("%s unique index added", indexName)
	return nil
}

// firstLoginBackfillSQL is the exact production statement run by `migrate up`.
// It reverts first_login_status from '1' to '0' for users whose
// password_change_at and created_at are within 5 seconds of each other (the
// password was never independently changed after account creation).
//
// Idempotent by construction: the WHERE clause requires first_login_status='1'
// and the UPDATE sets it to '0', so a second run matches zero rows.
// TIMESTAMPDIFF is MySQL-specific; SQLite backfill tests drive
// backfillFirstLoginStatusWith with a portable time-window expression to
// exercise the same row-selection semantics without re-running this text.
const firstLoginBackfillSQL = `
	UPDATE users
	SET first_login_status = '0'
	WHERE first_login_status = '1'
	  AND password_change_at IS NOT NULL
	  AND created_at IS NOT NULL
	  AND ABS(TIMESTAMPDIFF(SECOND, password_change_at, created_at)) < 5`

// backfillFirstLoginStatus runs the production backfill and returns the number
// of rows flipped. Extracted as a package-level seam so a test can drive the
// backfill directly — the `up` Action closure is unexported and unreachable.
func backfillFirstLoginStatus(db *gorm.DB) (int64, error) {
	return backfillFirstLoginStatusWith(db, firstLoginBackfillSQL)
}

// backfillFirstLoginStatusWith executes the given backfill SQL and returns the
// rows affected. The SQL is a parameter only so SQLite tests can substitute a
// portable time-window expression for MySQL's TIMESTAMPDIFF; production always
// goes through backfillFirstLoginStatus with firstLoginBackfillSQL.
func backfillFirstLoginStatusWith(db *gorm.DB, sql string) (int64, error) {
	result := db.Exec(sql)
	if result.Error != nil {
		return 0, result.Error
	}
	return result.RowsAffected, nil
}

// chatLimitBackfillSQL sets chat_limit to the sentinel value (2^30 = 1073741824)
// for every non-guest user currently at 0. The later enforcement gate checks
// chat_limit > 0 (boolean, no decrement), so any large positive value lets
// existing legitimate users pass without being retroactively blocked. New
// self-registered accounts are created at 0 and remain inert until approved.
//
// Idempotent by construction: the WHERE requires chat_limit = 0, so a second
// run finds no matching rows. Guest users keep whatever limit their account
// type assigns — the code <> 'guest' clause leaves them untouched.
const chatLimitBackfillSQL = `
	UPDATE users
	SET chat_limit = 1073741824
	WHERE chat_limit = 0
	  AND code <> 'guest'`

// backfillChatLimit runs the production backfill and returns the number of
// rows updated. Extracted as a package-level seam so tests can drive the
// logic directly — the CLI Action closure is unexported and unreachable from
// tests. Mirrors the backfillFirstLoginStatus / backfillFirstLoginStatusWith
// pattern.
func backfillChatLimit(db *gorm.DB) (int64, error) {
	return backfillChatLimitWith(db, chatLimitBackfillSQL)
}

// backfillChatLimitWith executes the given SQL and returns rows affected.
// The sql parameter lets SQLite tests substitute a portable expression when
// needed; production always goes through backfillChatLimit.
func backfillChatLimitWith(db *gorm.DB, sql string) (int64, error) {
	result := db.Exec(sql)
	if result.Error != nil {
		return 0, result.Error
	}
	return result.RowsAffected, nil
}

// reportDuplicateEmails returns every email address that appears more than once
// in the users table. It never modifies any row — operators must resolve
// existing duplicates manually before a UNIQUE index is added to users.email.
// Used by the `migrate dedupe-emails` subcommand.
func reportDuplicateEmails(db *gorm.DB) ([]string, error) {
	var dups []string
	err := db.Model(&model.User{}).
		Select("email").
		Group("email").
		Having("COUNT(*) > 1").
		Pluck("email", &dups).Error
	return dups, err
}

// Migrate is the CLI command `go run main.go migrate up`. It performs the
// first-login backfill: revert first_login_status from '1' to '0' for users
// whose password_change_at and created_at are within 5 seconds of each other.
// Idempotent by construction — the WHERE clause requires first_login_status='1',
// and the update sets it to '0', so a second invocation matches zero rows.
//
// Schema management is intentionally out of scope here. User was originally
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
					rows, err := backfillFirstLoginStatus(model.Default())
					if err != nil {
						rxLog.Sugar().Errorw("first_login backfill failed", "err", err)
						return err
					}
					rxLog.Sugar().Infow("first_login_status backfill complete",
						"rows_affected", rows)
					return nil
				},
			},
			{
				Name:        "backfill-chat-limit",
				Usage:       "置存量非 guest 用户的 chat_limit 哨兵值",
				Description: "Run before the ChatLimit enforcement gate goes live. Sets chat_limit=0 non-guest users to the large-positive sentinel so they are not retroactively blocked. New self-registered accounts stay at 0 (inert). Idempotent — safe to re-run.",
				Action: func(ctx *cli.Context) error {
					rows, err := backfillChatLimit(model.Default())
					if err != nil {
						rxLog.Sugar().Errorw("backfill-chat-limit failed", "err", err)
						return err
					}
					rxLog.Sugar().Infow("chat_limit backfill complete", "rows_affected", rows)
					return nil
				},
			},
			{
				Name:        "add-bot-run-id",
				Usage:       "给 question_agent_logs 加 bot_run_id 列",
				Description: "Add the nullable bot_run_id join column. Idempotent — no-op if it already exists. Dev/CI fresh-schema only; production DDL stays manual.",
				Action: func(ctx *cli.Context) error {
					return addColumnIfMissing(model.Default(), &model.QuestionAgentLog{}, "bot_run_id",
						"ALTER TABLE question_agent_logs ADD COLUMN bot_run_id VARCHAR(64) NULL AFTER server_id")
				},
			},
			{
				Name:        "add-image-paths",
				Usage:       "给 question_agent_logs 加 image_paths 列",
				Description: "Add the nullable image_paths text column (gallery image OBS paths, stored as a JSON array). Idempotent — no-op if it already exists. Dev/CI fresh-schema only; production DDL stays manual (see docs/web-production-deployment-manual.md §5.3). Without this column every /query returns 500 (Unknown column 'image_paths').",
				Action: func(ctx *cli.Context) error {
					return addColumnIfMissing(model.Default(), &model.QuestionAgentLog{}, "image_paths",
						"ALTER TABLE question_agent_logs ADD COLUMN image_paths TEXT NULL COMMENT '图廊图片OBS路径(JSON数组)' AFTER download_path")
				},
			},
			{
				Name:        "dedupe-emails",
				Usage:       "报告 users.email 重复项(仅读,不删行)",
				Description: "Report email addresses that appear more than once in the users table. Read-only — no rows are modified. Run before adding a UNIQUE index on users.email so the operator can manually resolve existing duplicates.",
				Action: func(ctx *cli.Context) error {
					dups, err := reportDuplicateEmails(model.Default())
					if err != nil {
						rxLog.Sugar().Errorw("dedupe-emails report failed", "err", err)
						return err
					}
					if len(dups) == 0 {
						rxLog.Sugar().Info("dedupe-emails: no duplicate emails found")
						return nil
					}
					for _, email := range dups {
						rxLog.Sugar().Warnw("duplicate email found", "email", email)
					}
					rxLog.Sugar().Warnw("dedupe-emails: operator action required before adding UNIQUE index",
						"duplicate_count", len(dups))
					return nil
				},
			},
			{
				Name:        "add-email-unique-index",
				Usage:       "给 users.email 加唯一索引",
				Description: "Add a UNIQUE index on users(email). Idempotent — no-op if the index already exists. Run dedupe-emails first to confirm no duplicate emails exist; production DDL stays manual.",
				Action: func(ctx *cli.Context) error {
					return addUniqueIndexIfMissing(model.Default(), &model.User{}, "uniq_users_email",
						"CREATE UNIQUE INDEX uniq_users_email ON users(email)")
				},
			},
			{
				Name:        "rename-tool-names",
				Usage:       "把 tool_names 输入 token 改成 Bot 规范名",
				Description: "Rename the agent @-tokens in tool_names to the canonical Bot tool names. Idempotent. Run together with the canonical-maps deploy.",
				Action: func(ctx *cli.Context) error {
					n, err := renameAgentToolNames(model.Default(), "tool_names", "tool_name")
					if err != nil {
						rxLog.Sugar().Errorw("rename-tool-names failed", "err", err)
						return err
					}
					rxLog.Sugar().Infow("rename-tool-names complete", "rows_affected", n)
					return nil
				},
			},
			{
				Name:        "backfill-agent-tool-names",
				Usage:       "回填 question_agent_logs.tool_name 为 Bot 规范名",
				Description: "Backfill persisted history tool_name to canonical Bot names so old rows render under the new frontend. Idempotent — safe to re-run.",
				Action: func(ctx *cli.Context) error {
					n, err := renameAgentToolNames(model.Default(), "question_agent_logs", "tool_name")
					if err != nil {
						rxLog.Sugar().Errorw("backfill-agent-tool-names failed", "err", err)
						return err
					}
					rxLog.Sugar().Infow("backfill-agent-tool-names complete", "rows_affected", n)
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
						&model.User{},
						&model.ToolName{},
						&model.UserToolName{},
						&model.QuestionAgentLog{},
						&model.GeneList{},
						&model.GeneExample{},
						&model.UserPermission{},
						&model.ServerToolLogs{},
						&model.UserFeedback{},
						&model.UserOperationLog{},
						&model.SqlOperationLog{},
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
