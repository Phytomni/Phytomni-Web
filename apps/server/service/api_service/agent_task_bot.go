package api_service

import (
	"context"
	"encoding/json"
	"strings"

	rxBot "phytomni-server/external/bot"
	rxLog "phytomni-server/log"
	"phytomni-server/model"
)

// SyncBotRuns reconciles RUNNING deep_genome rows against Bot's in-process run
// state. These rows never hit EIHealth (the report workflow runs inside Bot),
// so the legacy GetTaskStatus IAM poll cannot advance them. For each row it
// polls GET /v1/runs/{bot_run_id}, and when the run's status has changed it
// flips the MySQL status and writes the assembled report (result.final_report,
// reshaped into the {content, doc_list} JSON the Web app parses). It does not
// clobber the prior answer with a blank reshape (only writes answer when a
// final_report is present). There is no *gin.Context here (the cron has no
// request), so it uses a background context and model.Default(), mirroring
// GetTaskStatus.
func SyncBotRuns(rows []model.QuestionAgentLog) {
	if len(rows) == 0 {
		return
	}
	if rxBot.BotConfig == nil || !rxBot.BotConfig.ProxyEnabled {
		return
	}
	ctx := context.Background()
	client := rxBot.NewClient()
	for _, row := range rows {
		if row.BotRunId == "" {
			rxLog.Sugar().Warnf("deep_genome row %d is RUNNING with no bot_run_id; skipping bot sync", row.Id)
			continue
		}
		rec, err := client.GetRun(ctx, row.BotRunId)
		if err != nil {
			rxLog.Sugar().Error(err)
			continue
		}
		newStatus := strings.ToUpper(rec.Status)
		// An empty status would be written verbatim by GORM's map Updates (maps
		// do not skip zero values the way struct Updates does), flipping the row
		// out of the WHERE status='RUNNING' poll set permanently. Skip it, the
		// same way the EIHealth GetTaskStatus struct-update swallows an empty
		// status.
		if newStatus == "" || row.Status == newStatus {
			continue // still running, unchanged, or malformed — nothing to write
		}
		updates := map[string]interface{}{"status": newStatus}
		// analyst 类(cron 路由切换后才会进来):formatted 存在即非 deep_genome。
		// 答案非空才写(避免抹掉已渲染答案);同分支回填图廊路径,使 deep_genome
		// 的 final_report 路径保持原样、不产生 download_path。
		if f, answerText, ok := rxBot.ParseRunFormatted(rec.Result); ok {
			if shaped := rxBot.ShapeAnswer(rec.Agent, answerText, f); shaped != "" {
				updates["answer"] = shaped
			}
			if dirs, paths, ok2 := rxBot.ParseRunArtifacts(rec.Result); ok2 {
				if len(dirs) > 0 && dirs[0] != "" {
					updates["download_path"] = dirs[0]
				}
				if len(paths) > 0 {
					if b, err := json.Marshal(paths); err == nil {
						updates["image_paths"] = string(b)
					}
				}
			}
		} else if fr, ok := rxBot.ParseRunFinalReport(rec.Result); ok {
			// final_report is deep_genome-exclusive; reshape with the known slug.
			updates["answer"] = rxBot.ShapeAnswer("deep_genome", fr, nil)
		}
		if err := model.Default().Model(&model.QuestionAgentLog{}).
			Where("id = ?", row.Id).Updates(updates).Error; err != nil {
			rxLog.Sugar().Error(err)
		}
	}
}
