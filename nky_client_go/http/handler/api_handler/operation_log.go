package api_handler

import (
	"net/http"
	"nky_client_go/utils/errs"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

func (ph *ApiHandler) ApiGetOperationLogs(ctx *gin.Context) {
	// 获取参数
	userIdsStr := ctx.PostForm("user_ids") // 逗号分隔的ID字符串，例如 "1,2,3"
	startTime := ctx.PostForm("start_time")
	endTime := ctx.PostForm("end_time")

	var userIds []int64
	if userIdsStr != "" {
		ids := strings.Split(userIdsStr, ",")
		for _, idStr := range ids {
			id, err := strconv.ParseInt(strings.TrimSpace(idStr), 10, 64)
			if err == nil {
				userIds = append(userIds, id)
			}
		}
	}

	// 调用服务层
	logs, err := ph.service.ApiGetOperationLogs(ctx, userIds, startTime, endTime)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(logs))
}
