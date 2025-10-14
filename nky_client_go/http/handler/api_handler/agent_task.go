package api_handler

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"nky_client_go/common"
	"nky_client_go/utils/errs"
	"strconv"
)

func (ph *ApiHandler) ApiAsyncTaskList(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	current, _ := strconv.Atoi(ctx.Query("current"))
	size, _ := strconv.Atoi(ctx.Query("size"))

	list, total, totalPages, err := ph.service.ApiAsyncTaskList(ctx, name.(string), current, size)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}
	data := &common.ApiAsyncTaskListResponsePages{
		Total:      total,
		TotalPages: totalPages,
		GeneList:   list,
	}

	ctx.JSON(errs.SucResp(data))
}

func (ph *ApiHandler) ApiAsyncTaskInfo(ctx *gin.Context) {
	id, _ := strconv.Atoi(ctx.Query("id"))

	info, err := ph.service.ApiAsyncTaskInfo(ctx, id)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}
	ctx.JSON(errs.SucResp(info))
}

func (ph *ApiHandler) ApiAnalystAgentGetLog(ctx *gin.Context) {
	id, _ := strconv.Atoi(ctx.Query("id"))
	name, _ := ctx.Get("username")
	taskId, err := ph.service.ApiAnalystAgentGetLog(id, name.(string))
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(taskId))
}

func (ph *ApiHandler) ApiAnalystAgentUpdateLog(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	taskId := ctx.PostForm("task_id")
	computeResource := ctx.PostForm("compute_resource")

	newLogsJSON, err := ph.service.ApiAnalystAgentUpdateLog(name.(string), taskId, computeResource)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(newLogsJSON))
}

func (ph *ApiHandler) ApiQueryList(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	list, err := ph.service.ApiQueryList(ctx, name.(string))
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}
	ctx.JSON(errs.SucResp(list))
}

func (ph *ApiHandler) ApiAnswerCheck(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	dialogueId := ctx.Query("dialogue_id")
	list, err := ph.service.ApiAnswerCheck(ctx, name.(string), dialogueId)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(list))
}

func (ph *ApiHandler) ApiQueryListDelete(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	id, _ := strconv.Atoi(ctx.PostForm("id"))

	queryId, err := ph.service.ApiQueryListDelete(name.(string), id)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(queryId))
}

func (ph *ApiHandler) ApiQueryListRename(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	id, _ := strconv.Atoi(ctx.PostForm("id"))
	rename := ctx.PostForm("rename")

	r, err := ph.service.ApiQueryListRename(name.(string), id, rename)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(r))
}

func (ph *ApiHandler) ApiQueryReactionType(ctx *gin.Context) {
	// todo 需要判断如果接收reaction_type与数据库中的一致，则reaction_type为0，前端可以实现
	name, _ := ctx.Get("username")
	id, _ := strconv.Atoi(ctx.PostForm("id"))
	reactionType := ctx.PostForm("reaction_type")

	// 校验 reactionType 是否合法（0、1、2 中的一个）
	if reactionType != "0" && reactionType != "1" && reactionType != "2" {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": "reaction_type值不合法",
		})
		return
	}

	id, err := ph.service.ApiQueryReactionType(id, reactionType, name.(string))
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(id))
}

func (ph *ApiHandler) ApiQueryCollect(ctx *gin.Context) {
	// todo collect_type的0无状态，1-收藏
	name, _ := ctx.Get("username")
	id, _ := strconv.Atoi(ctx.PostForm("id"))
	collectType := ctx.PostForm("collect_type")

	// 校验 reactionType 是否合法（0、1 中的一个）
	if collectType != "0" && collectType != "1" {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": "collect_type值不合法",
		})
		return
	}

	id, err := ph.service.ApiQueryCollect(id, collectType, name.(string))
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(id))
}

func (ph *ApiHandler) ApiQueryCollectList(ctx *gin.Context) {

	name, _ := ctx.Get("username")

	collectList, err := ph.service.ApiQueryCollectList(name.(string))
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(collectList))
}

//func (ph *ApiHandler) ApiGetAnalystAgentLog(ctx *gin.Context) {
//	taskId := ctx.Query("task_id")
//	computeResource := ctx.Query("compute_resource")
//
//	body, err := ph.service.ApiGetAnalystAgentLog(taskId, computeResource)
//	if err != nil {
//		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
//		return
//	}
//
//	ctx.JSON(errs.SucResp(body))
//
//}

//流式获取日志（作废）
//func (ph *ApiHandler) ApiGetAnalystAgentLog(ctx *gin.Context) {
//	taskId := ctx.Query("task_id")
//	computeResource := ctx.Query("compute_resource")
//
//	// 设置SSE响应头
//	ctx.Writer.Header().Set("Content-Type", "text/event-stream")
//	ctx.Writer.Header().Set("Cache-Control", "no-cache")
//	ctx.Writer.Header().Set("Connection", "keep-alive")
//	ctx.Writer.Header().Set("Transfer-Encoding", "chunked")
//	ctx.Writer.Header().Set("X-Accel-Buffering", "no") // 禁用Nginx缓冲
//
//	// 创建通道用于控制流式传输
//	done := make(chan bool)
//	defer close(done)
//
//	// 启动流式传输
//	go ph.service.StreamAnalystAgentLog(ctx, taskId, computeResource, done)
//
//	// 等待客户端断开连接或传输完成
//	select {
//	case <-ctx.Done():
//		return
//	case <-done:
//		return
//	}
//}
