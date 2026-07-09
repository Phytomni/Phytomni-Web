package api_handler

import (
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"

	"phytomni-server/common/i18n"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/service/api_service"
)

func (ph *Handler) A2uiAction(ctx *gin.Context) {
	username, _ := ctx.Get("username")
	email, _ := username.(string)
	if email == "" {
		ctx.JSON(http.StatusUnauthorized, gin.H{"message": i18n.T(ctx, "common.not_logged_in")})
		return
	}
	dialogueID := ctx.Param("id")
	raw, err := io.ReadAll(ctx.Request.Body)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"message": i18n.T(ctx, "a2ui.invalid_body")})
		return
	}
	out, err := ph.service.A2uiAction(ctx.Request.Context(), email, dialogueID, raw)
	if err != nil {
		switch {
		case errors.Is(err, api_service.ErrA2uiActionBadRequest):
			ctx.JSON(http.StatusBadRequest, gin.H{"message": i18n.T(ctx, "a2ui.invalid_action")})
		case errors.Is(err, api_service.ErrA2uiActionNotFound):
			ctx.JSON(http.StatusNotFound, gin.H{"message": i18n.T(ctx, "a2ui.not_found")})
		case errors.Is(err, api_service.ErrGatewayDisabled):
			ctx.JSON(http.StatusServiceUnavailable, gin.H{"message": i18n.T(ctx, "a2ui.gateway_disabled")})
		case errors.Is(err, rxBot.ErrBotTimeout):
			ctx.JSON(http.StatusGatewayTimeout, gin.H{"message": i18n.T(ctx, "a2ui.request_timed_out")})
		default:
			ctx.JSON(http.StatusInternalServerError, gin.H{"message": i18n.T(ctx, "a2ui.request_failed")})
		}
		return
	}
	ct := out.ContentType
	if ct == "" {
		ct = "application/json"
	}
	ctx.Data(out.Status, ct, out.Body)
}
