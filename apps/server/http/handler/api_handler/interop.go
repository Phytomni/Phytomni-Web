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

// InteropCapabilities returns the Web-owned, sanitized interop snapshot. The
// route is authenticated by the router; this handler-level identity check
// keeps direct invocation fail closed as well.
func (ph *Handler) InteropCapabilities(ctx *gin.Context) {
	usernameValue, ok := ctx.Get("username")
	username, validUsername := usernameValue.(string)
	if !ok || !validUsername || strings.TrimSpace(username) == "" {
		ctx.JSON(http.StatusUnauthorized, gin.H{
			"code":    http.StatusUnauthorized,
			"message": i18n.T(ctx, "common.not_logged_in"),
		})
		return
	}

	result, err := ph.service.InteropCapabilities(ctx, username)
	if err != nil {
		switch {
		case errors.Is(err, api_service.ErrInteropDisabled), errors.Is(err, api_service.ErrInteropForbidden):
			// Keep dormant and unauthorized resources indistinguishable from a
			// missing route; neither state should disclose Bot configuration.
			ctx.JSON(http.StatusNotFound, gin.H{
				"code":    http.StatusNotFound,
				"message": "interop capabilities not found",
			})
		default:
			// Registry, transport, and decode details are intentionally not
			// serialized. The local status tells clients this is retryable.
			ctx.JSON(http.StatusServiceUnavailable, gin.H{
				"code":    http.StatusServiceUnavailable,
				"message": "interop capabilities unavailable",
			})
		}
		return
	}

	ctx.JSON(errs.SucResp(result))
}
