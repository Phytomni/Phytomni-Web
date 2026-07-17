package api_handler

import (
	"net/http"
	"strings"

	"phytomni-server/common/i18n"
	"phytomni-server/utils/errs"

	"github.com/gin-gonic/gin"
)

// BotCapabilities returns the sanitized Web-owned capability manifest. The
// route is mounted on the authenticated v1 group; this local identity check
// keeps direct handler invocation fail closed as well.
func (ph *Handler) BotCapabilities(ctx *gin.Context) {
	usernameValue, ok := ctx.Get("username")
	username, validUsername := usernameValue.(string)
	if !ok || !validUsername || strings.TrimSpace(username) == "" {
		ctx.JSON(http.StatusUnauthorized, gin.H{
			"code":    http.StatusUnauthorized,
			"message": i18n.T(ctx, "common.not_logged_in"),
		})
		return
	}

	manifest, err := ph.service.BotCapabilities(ctx, username)
	if err != nil {
		// The service normally degrades to a bounded all-disabled manifest. If a
		// future implementation returns an error, do not serialize its details
		// or any Bot payload to the browser.
		ctx.JSON(http.StatusServiceUnavailable, gin.H{
			"code":    http.StatusServiceUnavailable,
			"message": "bot capabilities unavailable",
		})
		return
	}

	ctx.JSON(errs.SucResp(manifest))
}
