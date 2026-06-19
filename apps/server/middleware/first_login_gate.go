// Server-side first-login gate. First-login users (those who have not yet
// changed their initial password, identified by User.FirstLoginStatus == "0")
// are restricted to the password-change endpoint only. All other /v1/*
// requests return 403.
//
// Position in the middleware chain: AFTER AuthMiddleware (needs the
// "username" key in ctx), BEFORE OperationLog (which records the outcome).
package middleware

import (
	"net/http"

	rxLog "phytomni-server/log"
	"phytomni-server/model"

	"github.com/gin-gonic/gin"
)

// firstLoginAllowedPaths lists the only paths a first-login user may hit.
// Exact match (not prefix) prevents query-string / trailing-slash bypass.
var firstLoginAllowedPaths = []string{
	"/v1/modify/password",
}

// LoginStatusMiddleware enforces the first-login-only-modify-password policy.
//
// It fails closed: any DB error or missing context value blocks the request
// rather than fail-opens to the handler. Rationale: this is a security gate;
// permitting requests on internal failure would silently bypass enforcement.
func LoginStatusMiddleware() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		usernameVal, ok := ctx.Get("username")
		if !ok {
			ctx.JSON(http.StatusUnauthorized, gin.H{
				"code":    http.StatusUnauthorized,
				"message": "missing authentication context",
			})
			ctx.Abort()
			return
		}
		username, _ := usernameVal.(string)
		if username == "" {
			ctx.JSON(http.StatusUnauthorized, gin.H{
				"code":    http.StatusUnauthorized,
				"message": "missing authentication context",
			})
			ctx.Abort()
			return
		}

		var user model.User
		if err := model.DB(ctx).Select("first_login_status").
			Where("email = ?", username).First(&user).Error; err != nil {
			rxLog.Sugar().Errorw("first_login_gate user lookup failed",
				"username", username, "err", err)
			ctx.JSON(http.StatusInternalServerError, gin.H{
				"code":    http.StatusInternalServerError,
				"message": "user lookup failed",
			})
			ctx.Abort()
			return
		}

		if user.FirstLoginStatus != "0" {
			ctx.Next()
			return
		}

		path := ctx.Request.URL.Path
		for _, allowed := range firstLoginAllowedPaths {
			if path == allowed {
				ctx.Next()
				return
			}
		}

		ctx.JSON(http.StatusForbidden, gin.H{
			"code":    http.StatusForbidden,
			"message": "first-login users must change their initial password before accessing other endpoints",
		})
		ctx.Abort()
	}
}
