package api_handler

import (
	"errors"
	"net/http"
	"strings"

	"phytomni-server/common/i18n"
	"phytomni-server/service/api_service"
	"phytomni-server/utils/errs"

	"github.com/gin-gonic/gin"
)

func executionOperatorIdentity(ctx *gin.Context) (string, bool) {
	value, exists := ctx.Get("username")
	name, ok := value.(string)
	return name, exists && ok && strings.TrimSpace(name) != ""
}

func writeExecutionOperatorError(ctx *gin.Context, err error) {
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, api_service.ErrExecutionOperatorForbidden):
		status = http.StatusForbidden
	case errors.Is(err, api_service.ErrExecutionOperatorNotFound):
		status = http.StatusNotFound
	case errors.Is(err, api_service.ErrExecutionOperatorConflict):
		status = http.StatusConflict
	case errors.Is(err, api_service.ErrExecutionOperatorUnsafe):
		status = http.StatusUnprocessableEntity
	}
	ctx.JSON(status, gin.H{"code": status, "message": i18n.TMaybe(ctx, err.Error())})
}

func (ph *Handler) InspectExecutionV2(ctx *gin.Context) {
	operatorName, ok := executionOperatorIdentity(ctx)
	if !ok {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": i18n.T(ctx, "common.not_logged_in")})
		return
	}
	view, err := ph.service.InspectExecutionV2(ctx, operatorName, ctx.Query("owner_ref"), ctx.Param("execution_id"))
	if err != nil {
		writeExecutionOperatorError(ctx, err)
		return
	}
	ctx.Header("Cache-Control", "no-store")
	ctx.JSON(errs.SucResp(view))
}

func (ph *Handler) OperateExecutionV2(ctx *gin.Context) {
	operatorName, ok := executionOperatorIdentity(ctx)
	if !ok {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": i18n.T(ctx, "common.not_logged_in")})
		return
	}
	var action api_service.ExecutionOperatorActionV2
	if err := ctx.ShouldBindJSON(&action); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.TMaybe(ctx, "invalid operator action")})
		return
	}
	view, err := ph.service.OperateExecutionV2(ctx, operatorName, ctx.Query("owner_ref"), ctx.Param("execution_id"), action)
	if err != nil {
		writeExecutionOperatorError(ctx, err)
		return
	}
	ctx.Header("Cache-Control", "no-store")
	ctx.JSON(errs.SucResp(view))
}

func (ph *Handler) ExecutionRuntimeMetricsV2(ctx *gin.Context) {
	operatorName, ok := executionOperatorIdentity(ctx)
	if !ok {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": i18n.T(ctx, "common.not_logged_in")})
		return
	}
	metrics, err := ph.service.GetExecutionRuntimeMetricsV2(ctx, operatorName)
	if err != nil {
		writeExecutionOperatorError(ctx, err)
		return
	}
	ctx.Header("Cache-Control", "no-store")
	ctx.JSON(errs.SucResp(metrics))
}
