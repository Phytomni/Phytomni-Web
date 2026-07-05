package api_handler

import (
	"errors"
	"net/http"
	"phytomni-server/common/i18n"
	"phytomni-server/service/api_service"
	"phytomni-server/utils/errs"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

func (ph *Handler) GetOperationLogs(ctx *gin.Context) {
	// Operator identity (admin authorization is enforced in the service layer)
	operatorName, exists := ctx.Get("username")
	if !exists {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": i18n.T(ctx, "common.not_logged_in")})
		return
	}

	// GET query params (after the POST→GET migration, params moved from body to query)
	userIdsStr := ctx.Query("user_ids") // comma-separated id string, e.g. "1,2,3"
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

	logs, err := ph.service.GetOperationLogs(ctx, operatorName.(string), userIds, startTime, endTime)
	if err != nil {
		if errors.Is(err, api_service.ErrOperationLogForbidden) {
			ctx.JSON(http.StatusForbidden, gin.H{"code": http.StatusForbidden, "message": i18n.TMaybe(ctx, err.Error())})
			return
		}
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": i18n.TMaybe(ctx, err.Error())})
		return
	}

	ctx.JSON(errs.SucResp(logs))
}
