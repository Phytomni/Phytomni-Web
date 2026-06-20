package api_handler

import (
	"errors"
	"net/http"
	"phytomni-server/service/api_service"
	"phytomni-server/utils/errs"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

func (ph *Handler) GetOperationLogs(ctx *gin.Context) {
	// 操作员身份(管理员鉴权在 service 层执行)
	operatorName, exists := ctx.Get("username")
	if !exists {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": "未登录"})
		return
	}

	// 获取参数
	// GET 查询:参数从查询串取(POST→GET 后由 body 改为 query)
	userIdsStr := ctx.Query("user_ids") // 逗号分隔的ID字符串，例如 "1,2,3"
	startTime := ctx.Query("start_time")
	endTime := ctx.Query("end_time")

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
	logs, err := ph.service.GetOperationLogs(ctx, operatorName.(string), userIds, startTime, endTime)
	if err != nil {
		if errors.Is(err, api_service.ErrOperationLogForbidden) {
			ctx.JSON(http.StatusForbidden, gin.H{"code": http.StatusForbidden, "message": err.Error()})
			return
		}
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(logs))
}
