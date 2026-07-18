package api_handler

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"

	rxCache "phytomni-server/cache"
	rxLog "phytomni-server/log"
	"phytomni-server/middleware"
	"phytomni-server/utils/errs"
)

// Logout revokes the CURRENT token (single device): blocklist sha256(token) with a
// TTL equal to the token's remaining life, so the key self-expires at exp. Reads
// the token+username that AuthMiddleware put in ctx. Fail-open: if Redis is down
// the blocklist write fails and is logged, but logout still returns success — the
// durable revocation for credential changes is the password-change floor, not this.
func (ph *Handler) Logout(ctx *gin.Context) {
	tokenVal, _ := ctx.Get("token")
	token, _ := tokenVal.(string)
	if token == "" {
		ctx.JSON(errs.SucResp("logged out"))
		return
	}
	ttl := tokenRemainingTTL(token)
	if err := rxCache.Block(ctx.Request.Context(), rxCache.HashToken(token), ttl); err != nil {
		rxLog.Sugar().Warnw("logout blocklist write degraded (fail-open)", "err", err)
	}
	ctx.JSON(errs.SucResp("logged out"))
}

// LogoutAll revokes ALL of the user's tokens by bumping the per-user epoch to
// now (the real event time). AuthMiddleware compares iat < epoch-IatSkew, and
// GenerateToken sets iat = now-IatSkew, so the net effect is "revoke iff the
// token was genuinely issued before this moment" — IatSkew cancels out.
// Do NOT pass now+IatSkew here; that would double-count the skew and make the
// effective threshold now+IatSkew, wrongly revoking tokens issued up to 60s
// AFTER the logout call.
// Redis-only (fail-open): a Redis outage makes logout-all a no-op until
// Redis returns. Does NOT touch password_change_at (that is a credential-change
// marker; bumping it here would corrupt the 90-day password-age policy).
func (ph *Handler) LogoutAll(ctx *gin.Context) {
	nameVal, _ := ctx.Get("username")
	email, _ := nameVal.(string)
	if email == "" {
		ctx.JSON(errs.SucResp("logged out"))
		return
	}
	if err := rxCache.SetUserEpoch(ctx.Request.Context(), email, time.Now(), middleware.TokenLifetime); err != nil {
		rxLog.Sugar().Warnw("logout-all epoch write degraded (fail-open)", "err", err)
	}
	ctx.JSON(errs.SucResp("logged out"))
}

// tokenRemainingTTL parses the token's exp (no signature verification needed — the
// token already passed AuthMiddleware) and returns time until exp, clamped to >=0.
// Falls back to TokenLifetime if exp is unreadable (over-blocks slightly, safe).
func tokenRemainingTTL(token string) time.Duration {
	claims := &middleware.Claims{}
	parser := jwt.NewParser()
	if _, _, err := parser.ParseUnverified(token, claims); err == nil {
		if exp := claims.ExpiresAtUnix(); exp > 0 {
			if d := time.Until(time.Unix(exp, 0)); d > 0 {
				return d
			}
			return time.Second // already expired; blocklist briefly anyway
		}
	}
	return middleware.TokenLifetime
}
