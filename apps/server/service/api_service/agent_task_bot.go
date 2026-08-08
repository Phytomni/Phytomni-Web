package api_service

import (
	"context"
	"strings"

	rxBot "phytomni-server/external/bot"
	rxLog "phytomni-server/log"
	"phytomni-server/model"
)

var botReconciliationStatuses = []string{"RUNNING", "INPUT_REQUIRED"}

// LoadBotRunReconciliationRows returns public pollable runs plus private active
// replacement candidates. SUBMITTING identities are deliberately excluded:
// they have no committed Bot-native recovery contract and must remain pending.
func LoadBotRunReconciliationRows(ctx context.Context) ([]model.QuestionAgentLog, error) {
	gdb := model.DB(ctx).Model(&model.QuestionAgentLog{})
	const sqliteProjection = "CASE WHEN json_valid(bot_projection_json) THEN bot_projection_json ELSE '{}' END"
	activeStatus := "UPPER(COALESCE(json_extract(" + sqliteProjection + ", '$.conversation_context.replacement.active_status'), '')) IN ?"
	if gdb.Dialector.Name() == "mysql" {
		const mysqlProjection = "CASE WHEN JSON_VALID(bot_projection_json) THEN bot_projection_json ELSE '{}' END"
		activeStatus = "UPPER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(" + mysqlProjection + ", '$.conversation_context.replacement.active_status')), '')) IN ?"
	}
	var rows []model.QuestionAgentLog
	err := gdb.Where(
		"UPPER(COALESCE(status, '')) IN ? OR "+activeStatus,
		botReconciliationStatuses,
		botReconciliationStatuses,
	).Find(&rows).Error
	return rows, err
}

// SyncBotRuns reconciles every RUNNING Bot-backed row (analyst + deep_genome)
// against Bot's run state. For each row it polls GET /v1/runs/{bot_run_id}, and
// when the run's status has changed it flips the MySQL status and writes the
// reshaped answer: analyst from result.formatted (+ gallery artifacts),
// deep_genome from result.final_report. It does not clobber a prior answer with a
// blank reshape. There is no *gin.Context here (the cron has no request), so it
// uses a background context and model.Default().
func SyncBotRuns(rows []model.QuestionAgentLog) {
	if len(rows) == 0 {
		return
	}
	if rxBot.BotConfig == nil || !rxBot.BotConfig.ProxyEnabled {
		return
	}
	ctx := context.Background()
	ps := NewService()
	client := rxBot.NewClient()
	for _, candidate := range rows {
		// Always re-read the complete row. Besides hydrating older callers that
		// pass only an ID, this makes the selected public/private run identity
		// fresh immediately before the external poll.
		var row model.QuestionAgentLog
		query := model.Default().Where("id = ?", candidate.Id)
		if candidate.UserName != "" {
			query = query.Where("user_name = ?", candidate.UserName)
		}
		if err := query.First(&row).Error; err != nil {
			rxLog.Sugar().Error(err)
			continue
		}
		_, private, err := unmarshalPersistedProjectionWithContext(row.BotProjectionJSON)
		if err != nil {
			rxLog.Sugar().Error(err)
			continue
		}
		runID := strings.TrimSpace(row.BotRunId)
		privateReplacement := false
		if private != nil && private.Replacement != nil &&
			(private.Replacement.ActiveStatus == "RUNNING" || private.Replacement.ActiveStatus == "INPUT_REQUIRED") {
			runID = strings.TrimSpace(private.Replacement.ActiveBotRunID)
			privateReplacement = true
		}
		if runID == "" {
			rxLog.Sugar().Warnf("pollable row %d has no bot run identity; skipping bot sync", row.Id)
			continue
		}
		rec, meta, err := client.GetRunWithMeta(ctx, runID)
		if err != nil {
			rxLog.Sugar().Error(err)
			continue
		}
		// A blank upstream status is malformed for polling. Keep the legacy
		// guard: do not even persist a report from this snapshot, otherwise the
		// row would be partially reconciled while the next poll still sees it as
		// RUNNING.
		if strings.TrimSpace(rec.Status) == "" {
			continue
		}
		if privateReplacement {
			err = ps.applyPrivateReplacementRunProjection(ctx, row.Id, row.UserName, runID, rec, meta)
		} else {
			err = ps.applyBotRunProjection(ctx, &row, rec, meta)
		}
		if err != nil {
			rxLog.Sugar().Error(err)
		}
	}
}
