package api_service

import (
	"context"
	"errors"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/getsentry/sentry-go"
	"gorm.io/gorm"

	"nky_client_go/common"
	rxBot "nky_client_go/external/bot"
	rxLog "nky_client_go/log"
	"nky_client_go/model"
)

func (ps *Service) AsyncTaskList(ctx context.Context, username string, current, size int) ([]*common.ApiAsyncTaskListResponse, int64, int, error) {

	var QuestionAgentLogList []*common.ApiAsyncTaskListResponse

	// 归属过滤的可复用查询:用 Session 固化 user_name + 状态 + 资源条件,让 Count
	// 和分页 Find 各自从同一组 scoped 条件克隆——既不互相污染,也不会退化成全表
	// (跨用户列表隔离显式可读,不依赖链式实例的隐式状态)。
	scoped := model.DB(ctx).Model(&model.SQuestionAgentLog{}).
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
			var result *model.SQuestionAgentLog
			if err := model.DB(ctx).Model(&model.SQuestionAgentLog{}).Where("id = ?", v.FId).First(&result).Error; err != nil {
				return nil, 0, 0, err
			}
			v.FDialogueId = result.DialogueId
		}
	}

	return QuestionAgentLogList, total, totalPages, nil
}

func (ps *Service) AsyncTaskInfo(ctx context.Context, id int, username string) (QuestionAgentLogList *model.SQuestionAgentLog, err error) {

	// 按 id + 归属用户查询,防止任意登录用户用可枚举的自增 id 越权读取他人任务行。
	if err = model.DB(ctx).Model(&model.SQuestionAgentLog{}).Debug().
		Where("id = ? and user_name = ?", id, username).First(&QuestionAgentLogList).Error; err != nil {
		return nil, errors.New("任务不存在")
	}
	if QuestionAgentLogList.TaskId == "" {
		return nil, errors.New("任务不存在")
	}

	return
}

func (ps *Service) AnalystAgentGetLog(ctx context.Context, id int, name string) (taskLog string, err error) {

	var questionAgentLogList *model.SQuestionAgentLog
	err = model.DB(ctx).Model(&model.SQuestionAgentLog{}).Debug().Where("id = ?", id).First(&questionAgentLogList).Error
	if questionAgentLogList.TaskId == "" {
		return "", errors.New("日志任务不存在")
	}
	if name != questionAgentLogList.UserName {
		return "", errors.New("日志与用户不匹配")
	}

	return questionAgentLogList.TaskLog, nil
}

func (ps *Service) QueryList(ctx context.Context, username string) ([]*common.QueryListRequest, error) {
	// 查询主列表（f_id = 0 的记录）
	var QuestionAgentLogList []*common.QueryListRequest
	if err := model.DB(ctx).Model(&model.SQuestionAgentLog{}).Where("user_name = ? AND f_id = ? AND delete_at IS NULL", username, 0).
		Order("created_at DESC").
		Find(&QuestionAgentLogList).
		Error; err != nil {
		return nil, err
	}

	var QADataList []*common.QueryListRequest
	for _, v := range QuestionAgentLogList {
		var DataList common.QueryListRequest // 改为非指针，避免 nil 问题
		createdAt := v.CreatedAt             // 默认使用主记录的 CreatedAt

		// 查询关联的最新记录（f_id = v.Id）
		err := model.DB(ctx).Model(&model.SQuestionAgentLog{}).Where("f_id = ? AND delete_at IS NULL", v.Id).
			Order("created_at DESC").
			Limit(1).
			First(&DataList).Error

		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				log.Printf("No record found for f_id=%d", v.Id) // 显式记录
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
			CreatedAt:  createdAt, // 动态赋值
		}
		QADataList = append(QADataList, QAData)
	}
	// 按照 CreatedAt 从最新到最晚排序
	sort.Slice(QADataList, func(i, j int) bool {
		return QADataList[i].CreatedAt.After(QADataList[j].CreatedAt)
	})

	return QADataList, nil
}

func (ps *Service) AnswerCheck(ctx context.Context, username string, dialogueId string) (QuestionAgentLogList []*model.SQuestionAgentLog, err error) {
	var QuestionAgentLog *model.SQuestionAgentLog
	// First() 在没匹配时给出 ErrRecordNotFound,但 QuestionAgentLog 仍是 &{Id:0} 空结构;
	// 若直接接着用 QuestionAgentLog.Id 查 children,会以 f_id=0 (parent 约定值) 误匹配所有 dialogue 的根行。
	// Defensive guard:RecordNotFound 视为"新对话",返回空 list;其他错误上抛。
	if err = model.DB(ctx).Model(&model.SQuestionAgentLog{}).Debug().Where("user_name = ? and dialogue_id = ?", username, dialogueId).First(&QuestionAgentLog).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	// Scope children to the same owner as the parent. Defense-in-depth: child
	// rows are written under the dialogue owner, so a row with a different
	// user_name attached to an owned parent (via a write bug or DB corruption)
	// must never surface through history.
	if err = model.DB(ctx).Model(&model.SQuestionAgentLog{}).Debug().Where("user_name = ? and f_id = ? and delete_at IS NULL", username, QuestionAgentLog.Id).Find(&QuestionAgentLogList).Error; err != nil {
		return nil, err
	}
	// 创建一个新的切片，将 QuestionAgentLog 放在首位
	newList := make([]*model.SQuestionAgentLog, 0, len(QuestionAgentLogList)+1)
	newList = append(newList, QuestionAgentLog)
	newList = append(newList, QuestionAgentLogList...)
	QuestionAgentLogList = newList

	// Bot 是内容 source of truth:网关激活时用 Bot 内容覆盖 MySQL 过渡字段,
	// 保留 Web-only 的 id / reaction_type / upload_path。proxy_enabled=false
	// 或 Bot 不可达时维持 MySQL legacy 字段(降级,不报错),与切流前行为一致。
	if rxBot.BotConfig != nil && rxBot.BotConfig.ProxyEnabled {
		ps.overlayBotContent(ctx, dialogueId, QuestionAgentLogList)
	}
	//todo: 将有obs下载路径的回答进行替换展示,逻辑待定
	//for _, v := range QuestionAgentLogList {
	//	if v.DownloadPath != "" && v.ToolName == "AnalysisAgent" {
	//		v.Answer = v.DownloadPath
	//	}
	//}
	return
}

// overlayBotContent fetches Bot runs for a dialogue in a single call and
// overrides the content columns (query/answer/tool_name/status) on rows that
// carry a bot_run_id, leaving Web-only fields (id, reaction_type, upload_path)
// intact. Any Bot failure leaves the MySQL legacy fields in place — a degrade,
// not an error — so history replay never 500s on Bot trouble.
func (ps *Service) overlayBotContent(ctx context.Context, dialogueId string, list []*model.SQuestionAgentLog) {
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
		// 降级:回落 legacy 字段(语义不变);同时上报 Sentry 使 Bot 读路径失败可观测/可告警。
		rxLog.Sugar().Warnw("answer-check bot list runs failed, using legacy fields", "dialogue_id", dialogueId, "err", err)
		sentry.CaptureException(err)
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
		// the JSON chat-ai parses. deep_genome's assembled report arrives as
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
			// chat-ai gates the download button on the exact-case "SUCCEEDED";
			// Bot returns lowercase. Normalize like the update-log write path.
			row.Status = strings.ToUpper(rec.Status)
		}
	}
}

func (ps *Service) QueryListDelete(ctx context.Context, name string, id int) (int, error) {
	db := model.DB(ctx).Model(&model.SQuestionAgentLog{}).Debug()

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
	db := model.DB(ctx).Model(&model.SQuestionAgentLog{}).Debug()

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
	db := model.DB(ctx).Model(&model.SQuestionAgentLog{}).Debug()

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
	db := model.DB(ctx).Model(&model.SQuestionAgentLog{}).Debug()

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
	err := model.DB(ctx).Model(&model.SQuestionAgentLog{}).Debug().
		Where("user_name = ? and collect_type =? and delete_at IS NULL", name, "1").
		Order("created_at DESC").
		Find(&CollectList).Error
	if err != nil {
		return nil, errors.New("collect_list查询失败")
	}

	return CollectList, nil
}
