package api_service

import (
	"context"
	"strings"

	rxBot "phytomni-server/external/bot"
	rxLog "phytomni-server/log"
	"phytomni-server/model"
)

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
	for _, row := range rows {
		if row.BotRunId == "" {
			rxLog.Sugar().Warnf("RUNNING row %d has no bot_run_id; skipping bot sync", row.Id)
			continue
		}
		// The cron query normally hydrates the owner, while older callers and
		// focused tests may pass only the lifecycle columns. Re-read the row so
		// the owner-scoped projection CAS never falls back to an unscoped write.
		if row.UserName == "" {
			var stored model.QuestionAgentLog
			if err := model.Default().Where("id = ?", row.Id).First(&stored).Error; err != nil {
				rxLog.Sugar().Error(err)
				continue
			}
			row = stored
		}
		rec, meta, err := client.GetRunWithMeta(ctx, row.BotRunId)
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
		if err := ps.applyBotRunProjection(ctx, &row, rec, meta); err != nil {
			rxLog.Sugar().Error(err)
		}
	}
}
