package api_service

import (
	"context"
	"errors"
	"log"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"

	"phytomni-server/common"
	rxBot "phytomni-server/external/bot"
	rxLog "phytomni-server/log"
	"phytomni-server/model"
)

func (ps *Service) AsyncTaskList(ctx context.Context, username string, current, size int) ([]*common.ApiAsyncTaskListResponse, int64, int, error) {

	// Normalize pagination params: the handler reads `current`/`size` query
	// params via strconv.Atoi, defaulting to 0 when absent. size=0 makes the
	// totalPages (total+size-1)/size expression integer-divide-by-zero panic
	// (gin Recovery turns it into 500). Fall back to sane defaults instead of
	// rejecting — the browser always sends current=1&size=10; this only guards
	// bare curl/monitoring probes.
	if size <= 0 {
		size = 10
	}
	if current <= 0 {
		current = 1
	}

	var QuestionAgentLogList []*common.ApiAsyncTaskListResponse

	// Reusable owner-scoped query: Session freezes user_name + status + resource
	// conditions so Count and paged Find each clone from the same scoped base —
	// no cross-contamination and no accidental full-table scan (cross-user
	// isolation is explicit, not reliant on implicit chain-instance state).
	scoped := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where("user_name = ?", username).
		Where("status = ? or status = ? or status = ?", "RUNNING", "SUCCEEDED", "FAILED").
		Where("server_id IS NOT NULL or task_id IS NOT NULL").
		Session(&gorm.Session{})

	var total int64
	if err := scoped.Count(&total).Error; err != nil {
		return nil, 0, 0, err
	}

	totalPages := int((total + int64(size) - 1) / int64(size))
	offset := (current - 1) * size
	if err := scoped.Order("created_at DESC").Offset(offset).Limit(size).Find(&QuestionAgentLogList).Error; err != nil {
		return nil, 0, 0, err
	}

	for _, v := range QuestionAgentLogList {
		if v.FId != 0 {
			var result *model.QuestionAgentLog
			if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).Where("id = ?", v.FId).First(&result).Error; err != nil {
				return nil, 0, 0, err
			}
			v.FDialogueId = result.DialogueId
		}
	}

	return QuestionAgentLogList, total, totalPages, nil
}

func (ps *Service) AsyncTaskInfo(ctx context.Context, id int, username string) (QuestionAgentLogList *model.QuestionAgentLog, err error) {

	// Scope by id AND owner: the auto-increment id is enumerable, so without the
	// user_name filter any authenticated user could read another user's task row.
	if err = model.DB(ctx).Model(&model.QuestionAgentLog{}).Debug().
		Where("id = ? and user_name = ?", id, username).First(&QuestionAgentLogList).Error; err != nil {
		return nil, errors.New("任务不存在")
	}
	if QuestionAgentLogList.TaskId == "" {
		return nil, errors.New("任务不存在")
	}

	return
}

func (ps *Service) AnalystAgentGetLog(ctx context.Context, id int, name string) (taskLog string, err error) {

	var questionAgentLogList *model.QuestionAgentLog
	err = model.DB(ctx).Model(&model.QuestionAgentLog{}).Debug().Where("id = ?", id).First(&questionAgentLogList).Error
	if questionAgentLogList.TaskId == "" {
		return "", errors.New("日志任务不存在")
	}
	if name != questionAgentLogList.UserName {
		return "", errors.New("日志与用户不匹配")
	}

	return questionAgentLogList.TaskLog, nil
}

func (ps *Service) QueryList(ctx context.Context, username string) ([]*common.QueryListRequest, error) {
	var QuestionAgentLogList []*common.QueryListRequest
	if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).Where("user_name = ? AND f_id = ? AND delete_at IS NULL", username, 0).
		Order("created_at DESC").
		Find(&QuestionAgentLogList).
		Error; err != nil {
		return nil, err
	}

	var QADataList []*common.QueryListRequest
	for _, v := range QuestionAgentLogList {
		var DataList common.QueryListRequest // non-pointer: zero value is safe when GORM finds no record
		createdAt := v.CreatedAt

		// latest child record for this parent
		err := model.DB(ctx).Model(&model.QuestionAgentLog{}).Where("f_id = ? AND delete_at IS NULL", v.Id).
			Order("created_at DESC").
			Limit(1).
			First(&DataList).Error

		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				log.Printf("No record found for f_id=%d", v.Id)
			} else {
				return nil, err
			}
		}

		if DataList.Id != 0 {
			createdAt = DataList.CreatedAt
		}

		QAData := &common.QueryListRequest{
			Id:         v.Id,
			DialogueId: v.DialogueId,
			TitleQuery: v.TitleQuery,
			CreatedAt:  createdAt,
		}
		QADataList = append(QADataList, QAData)
	}
	sort.Slice(QADataList, func(i, j int) bool {
		return QADataList[i].CreatedAt.After(QADataList[j].CreatedAt)
	})

	return QADataList, nil
}

func (ps *Service) AnswerCheck(ctx context.Context, username string, dialogueId string) (QuestionAgentLogList []*model.QuestionAgentLog, err error) {
	var QuestionAgentLog *model.QuestionAgentLog
	// First() returns ErrRecordNotFound when there is no match but still fills the
	// struct with &{Id:0}; if that Id were used to query children, f_id=0 (the
	// parent-row sentinel) would match every root row across all dialogues.
	// Defensive guard: treat RecordNotFound as a new/empty dialogue and return nil;
	// propagate all other errors.
	if err = model.DB(ctx).Model(&model.QuestionAgentLog{}).Debug().Where("user_name = ? and dialogue_id = ?", username, dialogueId).First(&QuestionAgentLog).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	// Scope children to the same owner as the parent. Defense-in-depth: child
	// rows are written under the dialogue owner, so a row with a different
	// user_name attached to an owned parent (via a write bug or DB corruption)
	// must never surface through history.
	if err = model.DB(ctx).Model(&model.QuestionAgentLog{}).Debug().Where("user_name = ? and f_id = ? and delete_at IS NULL", username, QuestionAgentLog.Id).Find(&QuestionAgentLogList).Error; err != nil {
		return nil, err
	}
	newList := make([]*model.QuestionAgentLog, 0, len(QuestionAgentLogList)+1)
	newList = append(newList, QuestionAgentLog)
	newList = append(newList, QuestionAgentLogList...)
	QuestionAgentLogList = newList

	// Bot is the content source of truth when the gateway is active: overlay MySQL
	// transition fields with Bot content, leaving Web-only fields (id,
	// reaction_type, upload_path) intact. proxy_enabled=false or Bot unreachable
	// falls back to MySQL legacy fields (degrade, not error).
	if rxBot.BotConfig != nil && rxBot.BotConfig.ProxyEnabled {
		ps.overlayBotContent(ctx, dialogueId, QuestionAgentLogList)
	}
	return
}

// overlayBotContent fetches Bot runs for a dialogue in a single call and
// overrides the content columns (query/answer/tool_name/status) on rows that
// carry a bot_run_id, leaving Web-only fields (id, reaction_type, upload_path)
// intact. Any Bot failure leaves the MySQL legacy fields in place — a degrade,
// not an error — so history replay never 500s on Bot trouble.
func (ps *Service) overlayBotContent(ctx context.Context, dialogueId string, list []*model.QuestionAgentLog) {
	hasRun := false
	for _, r := range list {
		if r.BotRunId != "" {
			hasRun = true
			break
		}
	}
	if !hasRun {
		return
	}
	resp, err := rxBot.NewClient().ListRuns(ctx, dialogueId)
	if err != nil {
		rxLog.Sugar().Warnw("answer-check bot list runs failed, using legacy fields", "dialogue_id", dialogueId, "err", err)
		return
	}
	byRun := make(map[string]rxBot.RunRecord, len(resp.Data))
	for _, rec := range resp.Data {
		byRun[rec.RunID] = rec
	}
	for _, row := range list {
		if row.BotRunId == "" {
			continue
		}
		rec, ok := byRun[row.BotRunId]
		if !ok {
			continue
		}
		if rec.Query != "" {
			row.Query = rec.Query
		}
		// Reshape from the run's formatted envelope (/v1/runs keeps
		// result.formatted in default mode) so cited/data history replays carry
		// the JSON the Web app parses. deep_genome's assembled report arrives as
		// result.final_report (no formatted block); fall back to it, then to the
		// flat answer for runs with no rendered content yet (still running, or
		// analyst awaiting Bot's formatted answer).
		if f, answerText, ok := rxBot.ParseRunFormatted(rec.Result); ok {
			row.Answer = rxBot.ShapeAnswer(rec.Agent, answerText, f)
		} else if fr, ok := rxBot.ParseRunFinalReport(rec.Result); ok {
			// final_report is deep_genome-exclusive; reshape with the known slug.
			row.Answer = rxBot.ShapeAnswer("deep_genome", fr, nil)
		} else if rec.Answer != "" {
			row.Answer = rec.Answer
		}
		if rec.ToolName != "" {
			row.ToolName = rec.ToolName
		}
		if rec.Status != "" {
			// The Web app gates the download button on the exact-case "SUCCEEDED";
			// Bot returns lowercase. Normalize like the update-log write path.
			row.Status = strings.ToUpper(rec.Status)
		}
	}
}

func (ps *Service) QueryListDelete(ctx context.Context, name string, id int) (int, error) {
	db := model.DB(ctx).Model(&model.QuestionAgentLog{}).Debug()

	result := db.Where("user_name = ? and id = ? and f_id = 0 and delete_at IS NULL", name, id).Update("delete_at", time.Now())
	if result.Error != nil {
		return 0, errors.New("删除问答记录失败")
	}
	if result.RowsAffected == 0 {
		return 0, errors.New("未找到匹配的记录")
	}

	return id, nil
}

func (ps *Service) QueryListRename(ctx context.Context, name string, id int, rename string) (string, error) {
	db := model.DB(ctx).Model(&model.QuestionAgentLog{}).Debug()

	result := db.Where("user_name = ? and id = ? and f_id = 0 and delete_at IS NULL", name, id).Update("title_query", rename)
	if result.Error != nil {
		return "", errors.New("修改title问题列表失败")
	}
	if result.RowsAffected == 0 {
		return "", errors.New("未找到title问题匹配的记录")
	}

	return rename, nil
}

func (ps *Service) QueryReactionType(ctx context.Context, id int, reactionType, name string) (int, error) {
	db := model.DB(ctx).Model(&model.QuestionAgentLog{}).Debug()

	result := db.Where("user_name = ? and id = ? and delete_at IS NULL", name, id).Update("reaction_type", reactionType)
	if result.Error != nil {
		return 0, errors.New("修改点评记录失败")
	}
	if result.RowsAffected == 0 {
		return 0, errors.New("未找到匹配的点赞/点踩记录")
	}

	return id, nil
}

func (ps *Service) QueryCollect(ctx context.Context, id int, collectType, name string) (int, error) {
	db := model.DB(ctx).Model(&model.QuestionAgentLog{}).Debug()

	result := db.Where("user_name = ? and id = ? and delete_at IS NULL", name, id).Update("collect_type", collectType)
	if result.Error != nil {
		return 0, errors.New("修改收藏记录失败")
	}
	if result.RowsAffected == 0 {
		return 0, errors.New("未找到匹配的收藏记录")
	}

	return id, nil
}

func (ps *Service) QueryCollectList(ctx context.Context, name string) ([]*common.ApiQueryCollectListResponse, error) {

	var CollectList []*common.ApiQueryCollectListResponse
	err := model.DB(ctx).Model(&model.QuestionAgentLog{}).Debug().
		Where("user_name = ? and collect_type =? and delete_at IS NULL", name, "1").
		Order("created_at DESC").
		Find(&CollectList).Error
	if err != nil {
		return nil, errors.New("collect_list查询失败")
	}

	return CollectList, nil
}
