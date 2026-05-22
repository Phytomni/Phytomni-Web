package api_handler

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"nky_client_go/utils/errs"
)

func (ph *ApiHandler) ApiServerCreateTask(ctx *gin.Context) {
	serverId := ctx.PostForm("server_id")
	serverStatus := ctx.PostForm("server_status")
	toolName := ctx.PostForm("tool_name")

	id, err := ph.service.ApiServerCreateTask(ctx, serverId, serverStatus, toolName)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{
			"code": http.StatusInternalServerError,
			"msg":  "数据库存储创建任务失败" + err.Error(),
			"data": nil,
		})
		return
	}

	ctx.JSON(errs.SucResp(gin.H{"create_id": id}))
}

func (ph *ApiHandler) ApiServerUpdateTask(ctx *gin.Context) {
	serverId := ctx.PostForm("server_id")
	toolResult := ctx.PostForm("tool_result")
	serverFilePath := ctx.PostForm("server_file_path")
	serverStatus := ctx.PostForm("server_status")

	id, err := ph.service.ApiServerUpdateTask(ctx, serverId, toolResult, serverFilePath, serverStatus)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{
			"code": http.StatusInternalServerError,
			"msg":  "数据库任务数据变更失败" + err.Error(),
			"data": nil,
		})
		return
	}

	ctx.JSON(errs.SucResp(gin.H{"update_id": id}))
}
