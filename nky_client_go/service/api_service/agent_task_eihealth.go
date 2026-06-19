package api_service

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"nky_client_go/common/email"
	rxLog "nky_client_go/log"
	"nky_client_go/model"
	"sync"
	"time"

	"github.com/spf13/viper"
)

// huaweiIAMAuthBody returns the IAM password-auth body used by the
// TaskReconciler cron's GetTaskStatus EIHealth poll. Every literal is sourced
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

// GetTaskStatus is invoked from the TaskReconciler cron and from on-demand
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
