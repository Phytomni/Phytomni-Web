package api_service

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"nky_client_go/common"
	"nky_client_go/common/email"
	rxBot "nky_client_go/external/bot"
	rxLog "nky_client_go/log"
	"nky_client_go/model"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/spf13/viper"
	"gorm.io/gorm"
)

// huaweiIAMAuthBody returns the IAM password-auth body used by the
// FreshGA cron's GetTaskStatus EIHealth poll. Every literal is sourced
// from viper so operators rotate creds via config/app.yml without
// recompiling. Missing keys yield empty strings, which Huawei IAM
// rejects with 400 — surfacing misconfiguration loud rather than silent.
func huaweiIAMAuthBody() map[string]interface{} {
	return map[string]interface{}{
		"auth": map[string]interface{}{
			"identity": map[string]interface{}{
				"password": map[string]interface{}{
					"user": map[string]interface{}{
						"name":     viper.GetString("huawei.iam.user_name"),
						"password": viper.GetString("huawei.iam.password"),
						"domain": map[string]interface{}{
							"name": viper.GetString("huawei.iam.domain_name"),
						},
					},
				},
				"methods": []string{"password"},
			},
			"scope": map[string]interface{}{
				"project": map[string]interface{}{
					"name": viper.GetString("huawei.iam.project_name"),
				},
			},
		},
	}
}

// huaweiEIHealthJobsBase returns the EIHealth jobs API root —
// "<base_url>/<account_id>/eihealth-projects/<project_uuid>/jobs"
// — composed from viper so account/project rotation does not need
// a recompile. Callers append "/{task_id}" or "/{task_id}/logs?...".
func huaweiEIHealthJobsBase() string {
	return fmt.Sprintf(
		"%s/%s/eihealth-projects/%s/jobs",
		viper.GetString("huawei.eihealth.base_url"),
		viper.GetString("huawei.eihealth.account_id"),
		viper.GetString("huawei.eihealth.project_uuid"),
	)
}

type TaskStatusResponse struct {
	Status string `json:"status"`
}

// GetTaskStatus is invoked from the FreshGA cron and from on-demand
// handler paths. It only reads from taskIds + the viper-backed Huawei
// IAM/EIHealth helpers — there is no *gin.Context state to thread
// through, so the parameter was removed to make the cron call site
// honest about not having a request context.
// huaweiTLSConfig builds the TLS config for the Huawei IAM / EIHealth polling
// clients. Certificate verification is ON by default; the legacy
// InsecureSkipVerify=true is now opt-in via huawei.insecure_skip_verify so a
// dev box behind a TLS-intercepting proxy can still poll while production
// verifies the cert chain (defends the IAM token exchange against MITM). The
// secure default is a behavior change on the live cron — an operator must smoke
// a real poll against the Huawei endpoint before trusting it.
func huaweiTLSConfig() *tls.Config {
	return &tls.Config{InsecureSkipVerify: viper.GetBool("huawei.insecure_skip_verify")}
}

func GetTaskStatus(taskIds []string) {
	fmt.Printf("当前共%d条任务开始查询！\n", len(taskIds))

	// 1. 首先获取华为云认证token (提取到循环外，避免重复认证)
	authData := huaweiIAMAuthBody()

	authJson, err := json.Marshal(authData)
	if err != nil {
		log.Printf("JSON编码失败: %v", err)
		return
	}

	authReq, err := http.NewRequest("POST", viper.GetString("huawei.iam.auth_url"), bytes.NewBuffer(authJson))
	if err != nil {
		log.Printf("创建认证请求失败: %v", err)
		return
	}
	authReq.Header.Set("Content-Type", "application/json")

	authTr := &http.Transport{
		TLSClientConfig: huaweiTLSConfig(),
	}
	authClient := &http.Client{Transport: authTr}

	authResp, err := authClient.Do(authReq)
	if err != nil {
		log.Printf("认证请求失败: %v", err)
		return
	}
	defer authResp.Body.Close()

	if authResp.StatusCode >= 400 {
		log.Printf("认证失败，状态码: %d", authResp.StatusCode)
		// 读取并打印详细错误信息
		bodyBytes, _ := ioutil.ReadAll(authResp.Body)
		log.Printf("认证失败详情: %s", string(bodyBytes))
		return
	}

	// 获取X-Subject-Token
	XSToken := authResp.Header.Get("X-Subject-Token")
	if XSToken == "" {
		log.Printf("未获取到认证token")
		return
	}

	var wg sync.WaitGroup
	maxConcurrent := 10 // 最大并发数
	sem := make(chan struct{}, maxConcurrent)

	for _, taskId := range taskIds {
		sem <- struct{}{} // 占用信号量
		//协程执行查询
		wg.Add(1)

		go func(TId string) {
			defer func() {
				<-sem // 释放信号量
				wg.Done()
			}()

			// 2、使用token获取任务状态
			tr := &http.Transport{
				TLSClientConfig: huaweiTLSConfig(),
			}
			client := &http.Client{Transport: tr}
			req, err := http.NewRequest("GET", huaweiEIHealthJobsBase()+"/"+TId, nil)
			if err != nil {
				log.Printf("创建请求失败: %v", err)
				return
			}
			req.Header.Set("X-Auth-Token", XSToken) // 添加认证token
			req.Header.Set("Content-Type", "application/json")

			resp, err := client.Do(req)
			if err != nil {
				log.Printf("请求失败: %v", err)
				return
			}
			defer func(Body io.ReadCloser) {
				err = Body.Close()
				if err != nil {
					log.Printf("关闭响应体出错: %v", err)
				}
			}(resp.Body)

			body, err := io.ReadAll(resp.Body)
			if err != nil {
				rxLog.Sugar().Error(err)
				return
			}

			var taskResp TaskStatusResponse
			if err = json.Unmarshal(body, &taskResp); err != nil {
				rxLog.Sugar().Error(err)
				return
			}

			//todo 变更状态
			var existingLog model.SQuestionAgentLog
			err = model.Default().Model(&model.SQuestionAgentLog{}).Where("task_id = ?", TId).First(&existingLog).Error
			if err != nil {
				rxLog.Sugar().Error(err)
				return
			}
			fmt.Println(existingLog.UserName, " ", TId, " ", taskResp)
			// 只有当状态不同时才更新
			if existingLog.Status != taskResp.Status {
				err = model.Default().Model(&model.SQuestionAgentLog{}).Debug().Where("task_id = ?", TId).
					Updates(&model.SQuestionAgentLog{
						Status:    taskResp.Status,
						UpdatedAt: time.Time{},
					}).Error
				rxLog.Sugar().Infof("%s当前任务%s,状态变更为%s", existingLog.CreatedAt, TId, taskResp.Status)
				if err != nil {
					rxLog.Sugar().Error(err)
					return
				}
				// 获取执行结果成功则给用户发送邮件提示
				if taskResp.Status == "SUCCEEDED" {
					if existingLog.FId != 0 {
						var fExistingLog *model.SQuestionAgentLog
						if result := model.Default().Debug().Where("id = ?", existingLog.FId).First(&fExistingLog).RowsAffected; result == 0 {
							rxLog.Sugar().Error(existingLog.DialogueId, "的对话页面不存在")
							return
						}
						email.SendEmail(existingLog.UserName, TId, fExistingLog.DialogueId, existingLog.DownloadPath)
						//email.SendEmailWmxx(existingLog.UserName, TId, fExistingLog.DialogueId, taskResp.Result.OutputFile)
					} else {
						email.SendEmail(existingLog.UserName, TId, existingLog.DialogueId, existingLog.DownloadPath)
						//email.SendEmailWmxx(existingLog.UserName, TId, existingLog.DialogueId, taskResp.Result.OutputFile)
					}
				}
			} else {
				rxLog.Sugar().Infof("%s当前任务%s,状态%s未变更", existingLog.CreatedAt, TId, taskResp.Status)
			}
			//强行触发发送邮件
			//if existingLog.FId != 0 {
			//	var fExistingLog *model.SQuestionAgentLog
			//	if result := model.Default().Debug().Where("id = ?", existingLog.FId).First(&fExistingLog).RowsAffected; result == 0 {
			//		rxLog.Sugar().Error(existingLog.DialogueId, "的对话页面不存在")
			//		return
			//	}
			//	fmt.Print("这里发送111")
			//	email.SendEmail(existingLog.UserName, TId, fExistingLog.DialogueId, taskResp.Result.OutputFile)
			//} else {
			//	fmt.Print("这里发送222")
			//	email.SendEmail(existingLog.UserName, TId, existingLog.DialogueId, taskResp.Result.OutputFile)
			//}
		}(taskId)
	}

	wg.Wait()
}

// SyncBotRuns reconciles RUNNING deep_genome rows against Bot's in-process run
// state. These rows never hit EIHealth (the report workflow runs inside Bot),
// so the legacy GetTaskStatus IAM poll cannot advance them. For each row it
// polls GET /v1/runs/{bot_run_id}, and when the run's status has changed it
// flips the MySQL status and writes the assembled report (result.final_report,
// reshaped into the {content, doc_list} JSON chat-ai parses). It does not
// clobber the prior answer with a blank reshape (only writes answer when a
// final_report is present). There is no *gin.Context here (the cron has no
// request), so it uses a background context and model.Default(), mirroring
// GetTaskStatus.
func SyncBotRuns(rows []model.SQuestionAgentLog) {
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
		if err := model.Default().Model(&model.SQuestionAgentLog{}).
			Where("id = ?", row.Id).Updates(updates).Error; err != nil {
			rxLog.Sugar().Error(err)
		}
	}
}

func (ps *ApiService) ApiAsyncTaskList(ctx context.Context, username string, current, size int) ([]*common.ApiAsyncTaskListResponse, int64, int, error) {

	var QuestionAgentLogList []*common.ApiAsyncTaskListResponse
	db := model.DB(ctx).Model(&model.SQuestionAgentLog{})
	err := db.Where("user_name = ?", username).
		Where("status = ? or status = ? or status = ?", "RUNNING", "SUCCEEDED", "FAILED").
		Where("server_id IS NOT NULL or task_id IS NOT NULL").
		Order("created_at DESC").
		Find(&QuestionAgentLogList).Error

	for _, v := range QuestionAgentLogList {
		fmt.Println(v.Id)
	}
	var total int64
	if err = db.Count(&total).Error; err != nil {
		return nil, 0, 0, err
	}
	totalPages := int((total + int64(size) - 1) / int64(size))
	offset := (current - 1) * size
	if err = db.Offset(offset).Limit(size).Find(&QuestionAgentLogList).Error; err != nil {
		return nil, 0, 0, err
	}

	for _, v := range QuestionAgentLogList {

		if v.FId != 0 {
			var result *model.SQuestionAgentLog
			if err = model.DB(ctx).Model(&model.SQuestionAgentLog{}).Debug().Where("id = ?", v.FId).First(&result).Error; err != nil {
				return nil, 0, 0, err
			}
			v.FDialogueId = result.DialogueId
		}
	}

	return QuestionAgentLogList, total, totalPages, nil
}

func (ps *ApiService) ApiAsyncTaskInfo(ctx context.Context, id int) (QuestionAgentLogList *model.SQuestionAgentLog, err error) {

	err = model.DB(ctx).Model(&model.SQuestionAgentLog{}).Debug().Where("id = ?", id).First(&QuestionAgentLogList).Error
	if QuestionAgentLogList.TaskId == "" {
		return nil, errors.New("任务不存在")
	}

	return
}

func (ps *ApiService) ApiAnalystAgentGetLog(ctx context.Context, id int, name string) (taskLog string, err error) {

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

func (ps *ApiService) ApiQueryList(ctx context.Context, username string) ([]*common.QueryListRequest, error) {
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

//func (ps *ApiService) ApiQueryList(ctx *gin.Context, username string) ([]*common.QueryListRequest, error) {
//	db := model.Default().Model(&model.SQuestionAgentLog{}).Debug()
//
//	// 一次性查询所有需要的数据
//	var results []struct {
//		MainRecord  common.QueryListRequest
//		LatestReply common.QueryListRequest
//		HasReply    bool
//	}
//
//	// 查询主记录并左连接最新的回复记录
//	err := db.Table("s_question_agent_logs AS main").
//		Select("main.*, reply.*, reply.id IS NOT NULL AS has_reply").
//		Joins("LEFT JOIN (SELECT f_id, MAX(created_at) AS max_created_at FROM s_question_agent_logs WHERE f_id != 0 AND delete_at IS NULL GROUP BY f_id) AS latest ON main.id = latest.f_id").
//		Joins("LEFT JOIN s_question_agent_logs AS reply ON reply.f_id = main.id AND reply.created_at = latest.max_created_at AND reply.delete_at IS NULL").
//		Where("main.user_name = ? AND main.f_id = ? AND main.delete_at IS NULL", username, 0).
//		Order("COALESCE(reply.created_at, main.created_at) DESC").
//		Scan(&results).Error
//
//	if err != nil {
//		return nil, err
//	}
//
//	// 构建最终结果
//	QADataList := make([]*common.QueryListRequest, 0, len(results))
//	for _, result := range results {
//		createdAt := result.MainRecord.CreatedAt
//		if result.HasReply {
//			createdAt = result.LatestReply.CreatedAt
//		}
//
//		QADataList = append(QADataList, &common.QueryListRequest{
//			Id:         result.MainRecord.Id,
//			DialogueId: result.MainRecord.DialogueId,
//			Query:      result.MainRecord.Query,
//			CreatedAt:  createdAt,
//		})
//	}
//
//	return QADataList, nil
//}

func (ps *ApiService) ApiAnswerCheck(ctx context.Context, username string, dialogueId string) (QuestionAgentLogList []*model.SQuestionAgentLog, err error) {
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
func (ps *ApiService) overlayBotContent(ctx context.Context, dialogueId string, list []*model.SQuestionAgentLog) {
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

func (ps *ApiService) ApiQueryListDelete(ctx context.Context, name string, id int) (int, error) {
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

func (ps *ApiService) ApiQueryListRename(ctx context.Context, name string, id int, rename string) (string, error) {
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

func (ps *ApiService) ApiQueryReactionType(ctx context.Context, id int, reactionType, name string) (int, error) {
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

func (ps *ApiService) ApiQueryCollect(ctx context.Context, id int, collectType, name string) (int, error) {
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

func (ps *ApiService) ApiQueryCollectList(ctx context.Context, name string) ([]*common.ApiQueryCollectListResponse, error) {

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
