package api_handler

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"phytomni-server/utils/errs"
)

func (ph *Handler) ServerCreateTask(ctx *gin.Context) {
	serverId := ctx.PostForm("server_id")
	serverStatus := ctx.PostForm("server_status")
	toolName := ctx.PostForm("tool_name")

	id, err := ph.service.ServerCreateTask(ctx, serverId, serverStatus, toolName)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{
			"code": http.StatusInternalServerError,
			"msg":  "failed to store task in database" + err.Error(),
			"data": nil,
		})
		return
	}

	ctx.JSON(errs.SucResp(gin.H{"create_id": id}))
}

func (ph *Handler) ServerUpdateTask(ctx *gin.Context) {
	// New path PATCH /api/v1/server/tasks/:id takes server_id from the path; the
	// legacy alias POST /v1/nky/server/update_task still takes it from the body
	// (until external clients backport).
	serverId := ctx.Param("id")
	if serverId == "" {
		serverId = ctx.PostForm("server_id")
	}
	toolResult := ctx.PostForm("tool_result")
	serverFilePath := ctx.PostForm("server_file_path")
	serverStatus := ctx.PostForm("server_status")

	id, err := ph.service.ServerUpdateTask(ctx, serverId, toolResult, serverFilePath, serverStatus)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{
			"code": http.StatusInternalServerError,
			"msg":  "failed to update task data in database" + err.Error(),
			"data": nil,
		})
		return
	}

	ctx.JSON(errs.SucResp(gin.H{"update_id": id}))
}
