package api_handler

import (
	"errors"
	"github.com/gin-gonic/gin"
	"net/http"
	"phytomni-server/common"
	"phytomni-server/common/i18n"
	"phytomni-server/service/api_service"
	"phytomni-server/utils/errs"
	"strconv"
)

func (ph *Handler) AsyncTaskList(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	current, _ := strconv.Atoi(ctx.Query("current"))
	size, _ := strconv.Atoi(ctx.Query("size"))

	list, total, totalPages, err := ph.service.AsyncTaskList(ctx, name.(string), current, size)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": i18n.TMaybe(ctx, err.Error())})
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
	id, _ := strconv.Atoi(ctx.Param("id")) // RESTful: task id from path /async-tasks/:id
	name, _ := ctx.Get("username")

	info, err := ph.service.AsyncTaskInfo(ctx, id, name.(string))
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": i18n.TMaybe(ctx, err.Error())})
		return
	}
	ctx.JSON(errs.SucResp(info))
}

// AgentTaskLifecycle returns a bounded lifecycle snapshot for the authenticated
// owner's task row. Browser input can name only the Web-owned row id.
func (ph *Handler) AgentTaskLifecycle(ctx *gin.Context) {
	id, err := strconv.ParseInt(ctx.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": i18n.T(ctx, "query.task_id_required"),
		})
		return
	}
	name, _ := ctx.Get("username")
	lifecycle, err := ph.service.AgentTaskLifecycle(ctx, id, name.(string))
	if err != nil {
		if errors.Is(err, api_service.ErrAgentTaskLifecycleNotFound) {
			ctx.JSON(http.StatusNotFound, gin.H{
				"code":    http.StatusNotFound,
				"message": i18n.TMaybe(ctx, err.Error()),
			})
			return
		}
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": i18n.TMaybe(ctx, err.Error())})
		return
	}
	ctx.JSON(errs.SucResp(lifecycle))
}

func (ph *Handler) AnalystAgentGetLog(ctx *gin.Context) {
	id, _ := strconv.Atoi(ctx.Param("id")) // RESTful: task id from path /async-tasks/:id
	name, _ := ctx.Get("username")
	log, err := ph.service.AnalystAgentGetLog(ctx, id, name.(string))
	if err != nil {
		if errors.Is(err, api_service.ErrAgentTaskLogNotFound) {
			ctx.JSON(http.StatusNotFound, gin.H{
				"code":    http.StatusNotFound,
				"message": i18n.TMaybe(ctx, err.Error()),
			})
			return
		}
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": i18n.TMaybe(ctx, err.Error())})
		return
	}

	ctx.JSON(errs.SucResp(log))
}

func (ph *Handler) QueryList(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	list, err := ph.service.QueryList(ctx, name.(string))
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": i18n.TMaybe(ctx, err.Error())})
		return
	}
	ctx.JSON(errs.SucResp(list))
}

func (ph *Handler) AnswerCheck(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	dialogueId := ctx.Param("id") // RESTful: conversation id from path /conversations/:id/messages
	list, err := ph.service.AnswerCheck(ctx, name.(string), dialogueId)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": i18n.TMaybe(ctx, err.Error())})
		return
	}

	ctx.JSON(errs.SucResp(list))
}

func (ph *Handler) QueryListDelete(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	id, _ := strconv.Atoi(ctx.Param("id")) // RESTful: conversation id from path /conversations/:id

	queryId, err := ph.service.QueryListDelete(ctx, name.(string), id)
	if err != nil {
		if errors.Is(err, api_service.ErrConversationDeleteNotFound) {
			ctx.JSON(http.StatusNotFound, gin.H{
				"code":    http.StatusNotFound,
				"message": i18n.TMaybe(ctx, err.Error()),
			})
			return
		}
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": i18n.TMaybe(ctx, err.Error())})
		return
	}

	ctx.JSON(errs.SucResp(queryId))
}

func (ph *Handler) QueryListRename(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	id, _ := strconv.Atoi(ctx.Param("id")) // RESTful: conversation id from path /conversations/:id
	rename := ctx.PostForm("rename")

	r, err := ph.service.QueryListRename(ctx, name.(string), id, rename)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": i18n.TMaybe(ctx, err.Error())})
		return
	}

	ctx.JSON(errs.SucResp(r))
}

func (ph *Handler) QueryReactionType(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	id, _ := strconv.Atoi(ctx.Param("id")) // RESTful: conversation id from path /conversations/:id
	reactionType := ctx.PostForm("reaction_type")

	// reaction_type must be one of 0, 1, 2
	if reactionType != "0" && reactionType != "1" && reactionType != "2" {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": i18n.T(ctx, "agent_task.invalid_reaction_type"),
		})
		return
	}

	id, err := ph.service.QueryReactionType(ctx, id, reactionType, name.(string))
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": i18n.TMaybe(ctx, err.Error())})
		return
	}

	ctx.JSON(errs.SucResp(id))
}

func (ph *Handler) QueryCollect(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	id, _ := strconv.Atoi(ctx.Param("id")) // RESTful: conversation id from path /conversations/:id
	collectType := ctx.PostForm("collect_type")

	// collect_type must be one of 0 (none), 1 (favorited)
	if collectType != "0" && collectType != "1" {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": i18n.T(ctx, "agent_task.invalid_collect_type"),
		})
		return
	}

	id, err := ph.service.QueryCollect(ctx, id, collectType, name.(string))
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": i18n.TMaybe(ctx, err.Error())})
		return
	}

	ctx.JSON(errs.SucResp(id))
}

func (ph *Handler) QueryCollectList(ctx *gin.Context) {

	name, _ := ctx.Get("username")

	collectList, err := ph.service.QueryCollectList(ctx, name.(string))
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": i18n.TMaybe(ctx, err.Error())})
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
