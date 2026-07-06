package api_handler

import (
	"errors"
	"net/http"
	"phytomni-server/common/i18n"
	"phytomni-server/service/api_service"
	"phytomni-server/utils/errs"

	"github.com/gin-gonic/gin"
)

// GetCronEntries returns a read-only snapshot of every scheduled cron entry.
// Admin authorisation is enforced in the service layer (mirrors the operation-
// log admin boundary); a non-admin gets 403.
func (ph *Handler) GetCronEntries(ctx *gin.Context) {
	// Operator identity (admin authorization is enforced in the service layer)
	operatorName, exists := ctx.Get("username")
	if !exists {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": i18n.T(ctx, "common.not_logged_in")})
		return
	}

	entries, err := ph.service.GetCronEntries(ctx, operatorName.(string))
	if err != nil {
		if errors.Is(err, api_service.ErrCronEntriesForbidden) {
			ctx.JSON(http.StatusForbidden, gin.H{"code": http.StatusForbidden, "message": i18n.TMaybe(ctx, err.Error())})
			return
		}
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": i18n.TMaybe(ctx, err.Error())})
		return
	}

	ctx.JSON(errs.SucResp(entries))
}
