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
	rxLog "nky_client_go/log"
	"nky_client_go/model"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/spf13/viper"
	"gorm.io/gorm"
)

// huaweiIAMAuthBody returns the IAM password-auth body used by both
// GetTaskStatus and ApiAnalystAgentUpdateLog. Every literal is sourced
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

// huaweiOBSCredentials returns the Huawei OBS access-key triple read from
// viper — ak / sk / endpoint. Callers feed the triple straight into
// obs.New so the credentials never appear as inline literals. Used by
// the gene_test_list download helpers (ApiDownloadAnalystAgentObsFile
// and ApiDownloadAnalystAgentObsImages). Rotation happens in
// config/app.yml without recompiling.
func huaweiOBSCredentials() (ak, sk, endpoint string) {
	return viper.GetString("huawei.obs.ak"),
		viper.GetString("huawei.obs.sk"),
		viper.GetString("huawei.obs.endpoint")
}

type TaskStatusResponse struct {
	Status string `json:"status"`
}

// GetTaskStatus is invoked from the FreshGA cron and from on-demand
// handler paths. It only reads from taskIds + the viper-backed Huawei
// IAM/EIHealth helpers — there is no *gin.Context state to thread
// through, so the parameter was removed to make the cron call site
// honest about not having a request context.
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
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
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
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
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
	err = model.DB(ctx).Model(&model.SQuestionAgentLog{}).Debug().Where("user_name = ? and dialogue_id = ?", username, dialogueId).First(&QuestionAgentLog).Error
	err = model.DB(ctx).Model(&model.SQuestionAgentLog{}).Debug().Where("f_id = ? and delete_at IS NULL", QuestionAgentLog.Id).Find(&QuestionAgentLogList).Error
	// 创建一个新的切片，将 QuestionAgentLog 放在首位
	newList := make([]*model.SQuestionAgentLog, 0, len(QuestionAgentLogList)+1)
	newList = append(newList, QuestionAgentLog)
	newList = append(newList, QuestionAgentLogList...)
	QuestionAgentLogList = newList
	//todo: 将有obs下载路径的回答进行替换展示,逻辑待定
	//for _, v := range QuestionAgentLogList {
	//	if v.DownloadPath != "" && v.ToolName == "AnalysisAgent" {
	//		v.Answer = v.DownloadPath
	//	}
	//}
	return
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

type LogData struct {
	Count int `json:"count"`
	Logs  []struct {
		CollectTime string `json:"collect_time"`
		Content     string `json:"content"`
	} `json:"logs"`
	LogStorageLink string `json:"log_storage_link"`
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

func (ps *ApiService) ApiAnalystAgentUpdateLog(ctx context.Context, name, taskId, computeResource string) (string, error) {
	//查询日志归属或是否存在
	db := model.DB(ctx).Model(&model.SQuestionAgentLog{})
	var agentLog model.SQuestionAgentLog
	result := db.Where("user_name = ? and task_id = ? and compute_resource = ? and delete_at IS NULL", name, taskId, computeResource).First(&agentLog)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return "", errors.New("任务记录不存在")
		} else {
			return "", errors.New(fmt.Sprintf(" SQL 语法错误、数据库连接问题查询失败:%v", result.Error))
		}
	}

	// 1. 首先获取华为云认证token
	authData := huaweiIAMAuthBody()

	authJson, err := json.Marshal(authData)
	if err != nil {
		return "", errors.New("获取token失败")
	}

	authReq, err := http.NewRequest("POST", viper.GetString("huawei.iam.auth_url"), bytes.NewBuffer(authJson))
	if err != nil {
		return "", errors.New("创建认证请求失败")
	}
	authReq.Header.Set("Content-Type", "application/json")

	authTr := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	authClient := &http.Client{Transport: authTr}

	authResp, err := authClient.Do(authReq)
	if err != nil {
		return "", errors.New("认证请求失败")
	}
	defer authResp.Body.Close()

	if authResp.StatusCode >= 400 {
		return "", errors.New(fmt.Sprintf("认证失败，状态码: %d", authResp.StatusCode))
	}

	// 获取X-Subject-Token
	XSToken := authResp.Header.Get("X-Subject-Token")
	if XSToken == "" {
		return "", errors.New("未获取到认证token")
	}

	//2、构建url
	url := fmt.Sprintf("%s/%s/logs?task_name=%s", huaweiEIHealthJobsBase(), taskId, computeResource)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", errors.New(fmt.Sprintf("创建请求失败: %v", err))
	}

	// 设置请求头
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Auth-Token", XSToken)

	// 发送请求
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", errors.New(fmt.Sprintf("请求失败: %v", err))
	}
	defer resp.Body.Close()

	// 读取响应
	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return "", errors.New(fmt.Sprintf("读取响应失败: %v", err))
	}
	// 解析请求体
	jsonStr := string(body)
	var data LogData
	if err := json.Unmarshal([]byte(jsonStr), &data); err != nil {
		return "", errors.New(fmt.Sprintf("JSON解析失败: %v", err))
	}

	//db := model.Default().Model(&model.SQuestionAgentLog{})
	//
	//// 查询或创建日志记录
	//var agentLog model.SQuestionAgentLog
	//result := db.Where("task_id = ?", taskId).First(&agentLog)
	//if result.Error != nil && !errors.Is(result.Error, gorm.ErrRecordNotFound) {
	//	return "", errors.New(fmt.Sprintf("查询任务日志失败: %v", result.Error))
	//}

	// 处理日志内容
	var logEntries []map[string]interface{}
	var jobFinished bool = false // 新增标志位

	for _, entry := range data.Logs {
		//content := strings.TrimSpace(entry.Content)
		logEntries = append(logEntries, map[string]interface{}{
			"content": strings.TrimSpace(entry.Content),
			// 可以添加更多字段....
		})
		// 判断是否包含关键字
		//if strings.Contains(content, "Job Finished! Cheers!") {
		//	jobFinished = true
		//}
	}

	if agentLog.Status == "SUCCEEDED" || agentLog.Status == "FAILED" {
		jobFinished = true
	}
	// 序列化为JSON
	newLogsJSON, err := json.Marshal(logEntries)
	if err != nil {
		return "", errors.New(fmt.Sprintf("JSON序列化失败: %v", err))
	}

	// 比较并更新数据,数据不同则更新数据
	if agentLog.TaskLog != string(newLogsJSON) || (jobFinished && agentLog.LogStatus != "sync_succeeded") {
		agentLog.TaskLog = string(newLogsJSON)
		if jobFinished {
			agentLog.LogStatus = "sync_succeeded" // 更新状态为 sync_succeeded
		}
		if err = db.Save(&agentLog).Error; err != nil {
			return "", errors.New(fmt.Sprintf("更新任务日志失败: %v", err))
		}
	}

	return string(newLogsJSON), nil

}

//func GetAnalystAgentLog(mapList map[string]interface{}) {
//	fmt.Printf("当前共%d条日志开始查询！\n", len(mapList))
//	var wg sync.WaitGroup
//	maxConcurrent := 10 // 最大并发数
//	sem := make(chan struct{}, maxConcurrent)
//
//	for taskId, computeResource := range mapList {
//		sem <- struct{}{} // 占用信号量
//		//协程执行查询
//		wg.Add(1)
//
//		go func(TId string) {
//			defer func() {
//				<-sem // 释放信号量
//				wg.Done()
//			}()
//
//			// 1. 首先获取华为云认证token
//			authData := map[string]interface{}{
//				"auth": map[string]interface{}{
//					"identity": map[string]interface{}{
//						"password": map[string]interface{}{
//							"user": map[string]interface{}{
//								"name":     "[REDACTED]",
//								"password": "[REDACTED]",
//								"domain": map[string]interface{}{
//									"name": "[REDACTED]",
//								},
//							},
//						},
//						"methods": []string{"password"},
//					},
//					"scope": map[string]interface{}{
//						"project": map[string]interface{}{
//							"name": "cn-east-3",
//						},
//					},
//				},
//			}
//
//			authJson, err := json.Marshal(authData)
//			if err != nil {
//				rxLog.Sugar().Error(err)
//				return
//			}
//
//			authReq, err := http.NewRequest("POST", viper.GetString("huawei.iam.auth_url"), bytes.NewBuffer(authJson))
//			if err != nil {
//				rxLog.Sugar().Error(fmt.Errorf("创建认证请求失败: %v", err))
//				return
//			}
//			authReq.Header.Set("Content-Type", "application/json")
//
//			authTr := &http.Transport{
//				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
//			}
//			authClient := &http.Client{Transport: authTr}
//
//			authResp, err := authClient.Do(authReq)
//			if err != nil {
//				rxLog.Sugar().Info(fmt.Errorf("认证请求失败: %v", err))
//				return
//			}
//			defer authResp.Body.Close()
//
//			if authResp.StatusCode >= 400 {
//				log.Printf("认证失败，状态码: %d", authResp.StatusCode)
//				return
//			}
//
//			// 获取X-Subject-Token
//			XSToken := authResp.Header.Get("X-Subject-Token")
//			if XSToken == "" {
//				rxLog.Sugar().Error(errors.New("未获取到认证token"))
//				return
//			}
//
//			//2、构建url
//			url := fmt.Sprintf("%s/%s/logs?task_name=%s", huaweiEIHealthJobsBase(), taskId, computeResource)
//			req, err := http.NewRequest("GET", url, nil)
//			if err != nil {
//				rxLog.Sugar().Error(fmt.Errorf("创建请求失败: %v", err))
//				return
//			}
//
//			// 设置请求头
//			req.Header.Set("Content-Type", "application/json")
//			req.Header.Set("X-Auth-Token", XSToken)
//
//			// 发送请求
//			client := &http.Client{}
//			resp, err := client.Do(req)
//			if err != nil {
//				rxLog.Sugar().Error(fmt.Errorf("请求失败: %v", err))
//				return
//			}
//			defer resp.Body.Close()
//
//			// 读取响应
//			body, err := ioutil.ReadAll(resp.Body)
//			if err != nil {
//				rxLog.Sugar().Error(fmt.Errorf("读取响应失败: %v", err))
//				return
//			}
//			// 解析请求体
//			jsonStr := string(body)
//			var data LogData
//			if err := json.Unmarshal([]byte(jsonStr), &data); err != nil {
//				rxLog.Sugar().Errorf("JSON解析失败: %v", err)
//				return
//			}
//
//			// 获取数据库实例
//			db := model.Default().Model(&model.SQuestionAgentLog{})
//
//			// 查询或创建日志记录
//			var agentLog model.SQuestionAgentLog
//			result := db.Where("task_id = ?", taskId).First(&agentLog)
//			if result.Error != nil && !errors.Is(result.Error, gorm.ErrRecordNotFound) {
//				rxLog.Sugar().Errorf("查询任务日志失败: %v", result.Error)
//				return
//			}
//
//			// 处理日志内容
//			var logEntries []map[string]interface{}
//			var jobFinished bool = false // 新增标志位
//
//			for _, entry := range data.Logs {
//				//content := strings.TrimSpace(entry.Content)
//				logEntries = append(logEntries, map[string]interface{}{
//					"content": strings.TrimSpace(entry.Content),
//					// 可以添加更多字段....
//				})
//				// 判断是否包含关键字
//				//if strings.Contains(content, "Job Finished! Cheers!") {
//				//	jobFinished = true
//				//}
//			}
//			if agentLog.Status == "SUCCEEDED" || agentLog.Status == "FAILED" {
//				jobFinished = true
//			}
//			// 序列化为JSON
//			newLogsJSON, err := json.Marshal(logEntries)
//			if err != nil {
//				rxLog.Sugar().Errorf("JSON序列化失败: %v", err)
//				return
//			}
//
//			// 比较并更新数据
//			if agentLog.TaskLog != string(newLogsJSON) || (jobFinished && agentLog.LogStatus != "sync_succeeded") {
//				agentLog.TaskLog = string(newLogsJSON)
//				if jobFinished {
//					agentLog.LogStatus = "sync_succeeded" // 更新状态为 sync_succeeded
//				}
//				if err := db.Save(&agentLog).Error; err != nil {
//					rxLog.Sugar().Errorf("更新任务日志失败: %v", err)
//					return
//				}
//			}
//		}(taskId)
//	}
//	wg.Wait()
//}

//func (ps *ApiService) StreamAnalystAgentLog(ctx *gin.Context, taskId, computeResource string, done chan bool) {
//	defer func() {
//		done <- true
//	}()
//
//	// 1. 获取华为云认证token
//	authData := map[string]interface{}{
//		"auth": map[string]interface{}{
//			"identity": map[string]interface{}{
//				"password": map[string]interface{}{
//					"user": map[string]interface{}{
//						"name":     "[REDACTED]",
//						"password": "[REDACTED]",
//						"domain": map[string]interface{}{
//							"name": "[REDACTED]",
//						},
//					},
//				},
//				"methods": []string{"password"},
//			},
//			"scope": map[string]interface{}{
//				"project": map[string]interface{}{
//					"name": "cn-east-3",
//				},
//			},
//		},
//	}
//
//	authJson, err := json.Marshal(authData)
//	if err != nil {
//		sendSSEError(ctx, fmt.Sprintf("JSON编码失败: %v", err))
//		return
//	}
//
//	authReq, err := http.NewRequest("POST", viper.GetString("huawei.iam.auth_url"), bytes.NewBuffer(authJson))
//	if err != nil {
//		sendSSEError(ctx, fmt.Sprintf("创建认证请求失败: %v", err))
//		return
//	}
//	authReq.Header.Set("Content-Type", "application/json")
//
//	authTr := &http.Transport{
//		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
//	}
//	authClient := &http.Client{Transport: authTr}
//
//	authResp, err := authClient.Do(authReq)
//	if err != nil {
//		sendSSEError(ctx, fmt.Sprintf("认证请求失败: %v", err))
//		return
//	}
//	defer authResp.Body.Close()
//
//	if authResp.StatusCode >= 400 {
//		sendSSEError(ctx, fmt.Sprintf("认证失败，状态码: %d", authResp.StatusCode))
//		return
//	}
//
//	XSToken := authResp.Header.Get("X-Subject-Token")
//	if XSToken == "" {
//		sendSSEError(ctx, "未获取到认证token")
//		return
//	}
//
//	// 初始化变量
//	url := fmt.Sprintf("%s/%s/logs?task_name=%s", huaweiEIHealthJobsBase(), taskId, computeResource)
//	var lastCount int
//	var sentLogs int
//	finished := false
//
//	// 心跳计数器
//	heartbeat := time.NewTicker(60 * time.Second)
//	defer heartbeat.Stop()
//
//	for !finished {
//		select {
//		case <-ctx.Done():
//			return
//		case <-heartbeat.C:
//			// 发送心跳保持连接
//			sendSSEData(ctx, "heartbeat", "ping")
//		default:
//			req, err := http.NewRequest("GET", url, nil)
//			if err != nil {
//				sendSSEError(ctx, fmt.Sprintf("创建请求失败: %v", err))
//				return
//			}
//
//			req.Header.Set("Content-Type", "application/json")
//			req.Header.Set("X-Auth-Token", XSToken)
//
//			client := &http.Client{Timeout: 30 * time.Second}
//			resp, err := client.Do(req)
//			if err != nil {
//				sendSSEError(ctx, fmt.Sprintf("请求失败: %v", err))
//				return
//			}
//
//			body, err := ioutil.ReadAll(resp.Body)
//			resp.Body.Close()
//			if err != nil {
//				sendSSEError(ctx, fmt.Sprintf("读取响应失败: %v", err))
//				return
//			}
//
//			var data LogData
//			err = json.Unmarshal(body, &data)
//			if err != nil {
//				sendSSEError(ctx, fmt.Sprintf("JSON解析失败: %v", err))
//				return
//			}
//
//			// 检查是否有新日志
//			if data.Count > lastCount {
//				// 只发送新增的日志内容
//				for i := sentLogs; i < len(data.Logs); i++ {
//					logEntry := data.Logs[i]
//					sendSSEData(ctx, "log", logEntry.Content)
//					//增加数据库单独字段入库task_log
//					db := model.Default().Model(&model.SQuestionAgentLog{})
//					var agentLog *model.SQuestionAgentLog
//					err = db.Where("task_id = ?", taskId).First(&agentLog).Error
//					if err != nil {
//						log.Printf("查询任务日志失败：%s", err.Error())
//					}
//					agentLog.TaskLog += logEntry.Content
//					if err = db.Save(&agentLog).Error; err != nil {
//						log.Printf("追加任务日志失败：%s", err.Error())
//					}
//					// 检查是否包含结束标记
//					if strings.Contains(logEntry.Content, "[Job Finished! Cheers!]") {
//						sendSSEData(ctx, "complete", "Job completed successfully")
//						finished = true
//						break
//					}
//				}
//				sentLogs = len(data.Logs)
//				lastCount = data.Count
//			}
//
//			// 如果已经完成，直接返回
//			if finished {
//				return
//			}
//
//			// 适当延迟，避免频繁请求
//			time.Sleep(30 * time.Second)
//		}
//	}
//}
//
//// 辅助函数：发送SSE数据
//func sendSSEData(ctx *gin.Context, event, data string) {
//	ctx.SSEvent(event, data)
//	ctx.Writer.Flush()
//}
//
//// 辅助函数：发送SSE错误
//func sendSSEError(ctx *gin.Context, message string) {
//	ctx.SSEvent("error", message)
//	ctx.Writer.Flush()
//}
