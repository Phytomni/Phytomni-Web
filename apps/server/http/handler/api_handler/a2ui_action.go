package api_handler

import (
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"

	"phytomni-server/common"
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
		writeA2uiActionError(ctx, a2uiActionError{
			status: http.StatusBadRequest, code: "a2ui_invalid_json", messageKey: "a2ui.invalid_json",
		})
		return
	}
	out, err := ph.service.A2uiAction(ctx.Request.Context(), email, dialogueID, raw)
	if err != nil {
		writeA2uiActionError(ctx, classifyA2uiActionError(err))
		return
	}
	ct := out.ContentType
	if ct == "" {
		ct = "application/json"
	}
	ctx.Data(out.Status, ct, out.Body)
}

type a2uiActionError struct {
	status     int
	code       string
	messageKey string
	forwarded  bool
	retryable  bool
}

func classifyA2uiActionError(err error) a2uiActionError {
	switch {
	case errors.Is(err, api_service.ErrA2uiActionBadRequest):
		return a2uiActionError{status: http.StatusUnprocessableEntity, code: "a2ui_invalid_action", messageKey: "a2ui.invalid_action"}
	case errors.Is(err, api_service.ErrA2uiActionNotFound):
		return a2uiActionError{status: http.StatusNotFound, code: "a2ui_not_found", messageKey: "a2ui.not_found"}
	case errors.Is(err, api_service.ErrGatewayDisabled):
		return a2uiActionError{status: http.StatusServiceUnavailable, code: "a2ui_gateway_disabled", messageKey: "a2ui.gateway_disabled", retryable: true}
	case errors.Is(err, rxBot.ErrBotTimeout):
		return a2uiActionError{status: http.StatusGatewayTimeout, code: "a2ui_upstream_timeout", messageKey: "a2ui.request_timed_out", forwarded: true}
	case errors.Is(err, rxBot.ErrA2uiResponseTooLarge):
		return a2uiActionError{status: http.StatusBadGateway, code: "a2ui_upstream_too_large", messageKey: "a2ui.upstream_too_large", forwarded: true}
	case errors.Is(err, api_service.ErrA2uiUpstreamProtocol):
		return a2uiActionError{status: http.StatusBadGateway, code: "a2ui_upstream_invalid", messageKey: "a2ui.upstream_invalid", forwarded: true}
	default:
		return a2uiActionError{status: http.StatusInternalServerError, code: "a2ui_internal", messageKey: "a2ui.internal", retryable: true}
	}
}

func writeA2uiActionError(ctx *gin.Context, failure a2uiActionError) {
	common.WriteA2uiHTTPError(
		ctx,
		failure.status,
		failure.code,
		i18n.T(ctx, failure.messageKey),
		failure.forwarded,
		failure.retryable,
	)
}

func a2uiActionUpstreamStatus(err error) (int, bool) {
	if errors.Is(err, rxBot.ErrA2uiResponseTooLarge) || errors.Is(err, api_service.ErrA2uiUpstreamProtocol) {
		return http.StatusBadGateway, true
	}
	return 0, false
}
