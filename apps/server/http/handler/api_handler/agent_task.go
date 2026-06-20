package api_handler

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"phytomni-server/common"
	"phytomni-server/utils/errs"
	"strconv"
)

func (ph *Handler) AsyncTaskList(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	current, _ := strconv.Atoi(ctx.Query("current"))
	size, _ := strconv.Atoi(ctx.Query("size"))

	list, total, totalPages, err := ph.service.AsyncTaskList(ctx, name.(string), current, size)
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

func (ph *Handler) AsyncTaskInfo(ctx *gin.Context) {
	id, _ := strconv.Atoi(ctx.Param("id")) // RESTful:任务 id 从路径 /async-tasks/:id 取
	name, _ := ctx.Get("username")

	info, err := ph.service.AsyncTaskInfo(ctx, id, name.(string))
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}
	ctx.JSON(errs.SucResp(info))
}

func (ph *Handler) AnalystAgentGetLog(ctx *gin.Context) {
	id, _ := strconv.Atoi(ctx.Param("id")) // RESTful:任务 id 从路径 /async-tasks/:id 取
	name, _ := ctx.Get("username")
	taskId, err := ph.service.AnalystAgentGetLog(ctx, id, name.(string))
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(taskId))
}

func (ph *Handler) QueryList(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	list, err := ph.service.QueryList(ctx, name.(string))
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}
	ctx.JSON(errs.SucResp(list))
}

func (ph *Handler) AnswerCheck(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	dialogueId := ctx.Param("id") // RESTful:会话 id 从路径 /conversations/:id/messages 取
	list, err := ph.service.AnswerCheck(ctx, name.(string), dialogueId)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(list))
}

func (ph *Handler) QueryListDelete(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	id, _ := strconv.Atoi(ctx.Param("id")) // RESTful:会话 id 从路径 /conversations/:id 取

	queryId, err := ph.service.QueryListDelete(ctx, name.(string), id)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(queryId))
}

func (ph *Handler) QueryListRename(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	id, _ := strconv.Atoi(ctx.Param("id")) // RESTful:会话 id 从路径 /conversations/:id 取
	rename := ctx.PostForm("rename")

	r, err := ph.service.QueryListRename(ctx, name.(string), id, rename)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(r))
}

func (ph *Handler) QueryReactionType(ctx *gin.Context) {
	// todo 需要判断如果接收reaction_type与数据库中的一致，则reaction_type为0，前端可以实现
	name, _ := ctx.Get("username")
	id, _ := strconv.Atoi(ctx.Param("id")) // RESTful:会话 id 从路径 /conversations/:id 取
	reactionType := ctx.PostForm("reaction_type")

	// 校验 reactionType 是否合法（0、1、2 中的一个）
	if reactionType != "0" && reactionType != "1" && reactionType != "2" {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": "reaction_type值不合法",
		})
		return
	}

	id, err := ph.service.QueryReactionType(ctx, id, reactionType, name.(string))
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(id))
}

func (ph *Handler) QueryCollect(ctx *gin.Context) {
	// todo collect_type的0无状态，1-收藏
	name, _ := ctx.Get("username")
	id, _ := strconv.Atoi(ctx.Param("id")) // RESTful:会话 id 从路径 /conversations/:id 取
	collectType := ctx.PostForm("collect_type")

	// 校验 reactionType 是否合法（0、1 中的一个）
	if collectType != "0" && collectType != "1" {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": "collect_type值不合法",
		})
		return
	}

	id, err := ph.service.QueryCollect(ctx, id, collectType, name.(string))
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(id))
}

func (ph *Handler) QueryCollectList(ctx *gin.Context) {

	name, _ := ctx.Get("username")

	collectList, err := ph.service.QueryCollectList(ctx, name.(string))
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(collectList))
}

// Conversations serves GET /api/v1/conversations. With ?favorite=true it returns
// the favorited (collected) conversations; otherwise the full list. The two were
// separate endpoints (query/list and query/collect/list) before the RESTful merge
// onto a single resource path with a query filter.
func (ph *Handler) Conversations(ctx *gin.Context) {
	if ctx.Query("favorite") == "true" {
		ph.QueryCollectList(ctx)
		return
	}
	ph.QueryList(ctx)
}
