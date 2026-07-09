package api_handler

import (
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/service/api_service"
)

func (ph *Handler) A2uiAction(ctx *gin.Context) {
	username, _ := ctx.Get("username")
	email, _ := username.(string)
	if email == "" {
		ctx.JSON(http.StatusUnauthorized, gin.H{"message": "not logged in"})
		return
	}
	dialogueID := ctx.Param("id")
	raw, err := io.ReadAll(ctx.Request.Body)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"message": "invalid body"})
		return
	}
	out, err := ph.service.A2uiAction(ctx.Request.Context(), email, dialogueID, raw)
	if err != nil {
		switch {
		case errors.Is(err, api_service.ErrA2uiActionBadRequest):
			ctx.JSON(http.StatusBadRequest, gin.H{"message": "invalid a2ui action"})
		case errors.Is(err, api_service.ErrA2uiActionNotFound):
			ctx.JSON(http.StatusNotFound, gin.H{"message": "not found"})
		case errors.Is(err, api_service.ErrGatewayDisabled):
			ctx.JSON(http.StatusServiceUnavailable, gin.H{"message": "service temporarily unavailable"})
		case errors.Is(err, rxBot.ErrBotTimeout):
			ctx.JSON(http.StatusGatewayTimeout, gin.H{"message": "request timed out, please try again later"})
		default:
			ctx.JSON(http.StatusInternalServerError, gin.H{"message": "request failed"})
		}
		return
	}
	ct := out.ContentType
	if ct == "" {
		ct = "application/json"
	}
	ctx.Data(out.Status, ct, out.Body)
}
