package commands

import (
	"fmt"

	rxBot "phytomni-server/external/bot"
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
// col it logs and no-ops, otherwise it executes ddl. The add-bot-run-id,
// add-image-paths, and add-mode subcommands share this single implementation of
// the HasColumn idempotency guard so a test can drive the guard directly — the
// CLI Action closures themselves are unexported and not reachable from a test.
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

// addIndexIfMissing is an idempotent helper for creating an index. The DDL is
// supplied by the operator-controlled migration command because production
// schemas are not changed during service startup.
func addIndexIfMissing(db *gorm.DB, model interface{}, indexName, ddl string) error {
	if db.Migrator().HasIndex(model, indexName) {
		rxLog.Sugar().Infof("%s index already exists, skip", indexName)
		return nil
	}
	if err := db.Exec(ddl).Error; err != nil {
		rxLog.Sugar().Errorw("create index failed", "index", indexName, "err", err)
		return err
	}
	rxLog.Sugar().Infof("%s index added", indexName)
	return nil
}

// addUniqueIndexIfMissing is an idempotent helper for creating a unique index.
// addColumnIfMissing handles columns; addIndexIfMissing handles the shared
// HasIndex guard for both unique and non-unique indexes.
// syncDefaultRoleToolGrants writes the product default role → tool map into
// user_tool_names. It only touches guest, user, and vip_user; other codes
// (admin fixtures, e2e roles) stay untouched. Idempotent.
func syncDefaultRoleToolGrants(db *gorm.DB) (int64, error) {
	var tools []model.ToolName
	if err := db.Find(&tools).Error; err != nil {
		return 0, err
	}
	idByName := make(map[string]int64, len(tools))
	for _, tool := range tools {
		idByName[tool.ToolName] = tool.Id
	}

	var changed int64
	for _, role := range []string{"guest", "user", "vip_user"} {
		desired := rxBot.DefaultRoleToolGrants[role]
		wanted := make(map[string]struct{}, len(desired))
		var wantedIDs []int64
		for _, name := range desired {
			id, ok := idByName[name]
			if !ok || id == 0 {
				return changed, fmt.Errorf("default role %s missing tool_names row %q", role, name)
			}
			wanted[fmt.Sprintf("%d", id)] = struct{}{}
			wantedIDs = append(wantedIDs, id)
		}

		var existing []model.UserToolName
		if err := db.Where("code = ?", role).Find(&existing).Error; err != nil {
			return changed, err
		}
		have := make(map[string]struct{}, len(existing))
		for _, row := range existing {
			have[row.ToolId] = struct{}{}
			if _, ok := wanted[row.ToolId]; ok {
				continue
			}
			res := db.Where("id = ? AND code = ?", row.Id, role).Delete(&model.UserToolName{})
			if res.Error != nil {
				return changed, res.Error
			}
			changed += res.RowsAffected
		}
		for _, id := range wantedIDs {
			key := fmt.Sprintf("%d", id)
			if _, ok := have[key]; ok {
				continue
			}
			res := db.Create(&model.UserToolName{Code: role, ToolId: key})
			if res.Error != nil {
				return changed, res.Error
			}
			changed += res.RowsAffected
		}
	}
	return changed, nil
}

func addUniqueIndexIfMissing(db *gorm.DB, model interface{}, indexName, ddl string) error {
	return addIndexIfMissing(db, model, indexName, ddl)
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
		Usage: "first-login status backfill",
		Subcommands: []*cli.Command{
			{
				Name:        "up",
				Usage:       "fix first-login status",
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
				Usage:       "set the chat_limit sentinel for existing non-guest users",
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
				Usage:       "add the bot_run_id column to question_agent_logs",
				Description: "Add the nullable bot_run_id join column. Idempotent — no-op if it already exists. Dev/CI fresh-schema only; production DDL stays manual.",
				Action: func(ctx *cli.Context) error {
					return addColumnIfMissing(model.Default(), &model.QuestionAgentLog{}, "bot_run_id",
						"ALTER TABLE question_agent_logs ADD COLUMN bot_run_id VARCHAR(64) NULL AFTER server_id")
				},
			},
			{
				Name:        "add-image-paths",
				Usage:       "add the image_paths column to question_agent_logs",
				Description: "Add the nullable image_paths text column (gallery image OBS paths, stored as a JSON array). Idempotent — no-op if it already exists. Dev/CI fresh-schema only; production DDL stays manual (see docs/deployment/history/python-to-go-cutover.md §5.3). Without this column every /query returns 500 (Unknown column 'image_paths').",
				Action: func(ctx *cli.Context) error {
					return addColumnIfMissing(model.Default(), &model.QuestionAgentLog{}, "image_paths",
						"ALTER TABLE question_agent_logs ADD COLUMN image_paths TEXT NULL COMMENT 'gallery image OBS paths (JSON array)' AFTER download_path")
				},
			},
			{
				Name:        "add-mode",
				Usage:       "add the mode column to question_agent_logs",
				Description: "Add the Instant/Expert mode column (varchar(20) NOT NULL DEFAULT 'instant'). Idempotent — no-op if it already exists. Without this column every chat send returns 500 (Unknown column 'mode'). Production DDL may also be applied manually (see docs/deployment/upgrading.md §3.2).",
				Action: func(ctx *cli.Context) error {
					return addColumnIfMissing(model.Default(), &model.QuestionAgentLog{}, "mode",
						"ALTER TABLE question_agent_logs ADD COLUMN mode VARCHAR(20) NOT NULL DEFAULT 'instant' AFTER tool_name")
				},
			},
			{
				Name:        "add-bot-projection",
				Usage:       "add Bot projection columns and revision index to question_agent_logs",
				Description: "Add the sanitized Bot projection and report revision columns plus an index. Idempotent — safe to re-run. Production execution remains operator-controlled; no automatic DDL is run.",
				Action: func(ctx *cli.Context) error {
					rxLog.Sugar().Info("add-bot-projection is operator-controlled; applying additive production DDL")
					db := model.Default()
					if err := addColumnIfMissing(db, &model.QuestionAgentLog{}, "bot_projection_json",
						"ALTER TABLE question_agent_logs ADD COLUMN bot_projection_json LONGTEXT NULL COMMENT 'sanitized Bot run projection' AFTER bot_run_id"); err != nil {
						return err
					}
					if err := addColumnIfMissing(db, &model.QuestionAgentLog{}, "bot_report_revision",
						"ALTER TABLE question_agent_logs ADD COLUMN bot_report_revision BIGINT NOT NULL DEFAULT -1 COMMENT 'last Bot report revision' AFTER bot_projection_json"); err != nil {
						return err
					}
					return addIndexIfMissing(db, &model.QuestionAgentLog{}, "idx_question_agent_logs_bot_report_revision",
						"CREATE INDEX idx_question_agent_logs_bot_report_revision ON question_agent_logs(bot_report_revision)")
				},
			},
			{
				Name:        "dedupe-emails",
				Usage:       "report duplicate users.email entries (read-only, no rows deleted)",
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
				Usage:       "add a unique index on users.email",
				Description: "Add a UNIQUE index on users(email). Idempotent — no-op if the index already exists. Run dedupe-emails first to confirm no duplicate emails exist; production DDL stays manual.",
				Action: func(ctx *cli.Context) error {
					return addUniqueIndexIfMissing(model.Default(), &model.User{}, "uniq_users_email",
						"CREATE UNIQUE INDEX uniq_users_email ON users(email)")
				},
			},
			{
				Name:        "rename-tool-names",
				Usage:       "rename tool_names input tokens to canonical Bot names",
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
				Usage:       "backfill question_agent_logs.tool_name to canonical Bot names",
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
				Name:        "seed-default-role-tools",
				Usage:       "sync guest/user/vip_user rows in user_tool_names",
				Description: "Write the product default role grants: guest=Chat/Knowledge/Data, user=those plus Review/BriefGene, vip_user=all ten agents. Other role codes are left untouched. Idempotent.",
				Action: func(ctx *cli.Context) error {
					n, err := syncDefaultRoleToolGrants(model.Default())
					if err != nil {
						rxLog.Sugar().Errorw("seed-default-role-tools failed", "err", err)
						return err
					}
					rxLog.Sugar().Infow("seed-default-role-tools complete", "rows_affected", n)
					return nil
				},
			},
			{
				Name:        "all",
				Usage:       "create all tables (dev/CI fresh-schema)",
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
