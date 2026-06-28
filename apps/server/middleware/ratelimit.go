package middleware

import (
	"net/http"
	rxCache "phytomni-server/cache"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
)

// rlDefaults holds the default limit/window per dimension (Viper fallback when
// not configured):
//
//	login    60/min  per-IP   — wide enough not to block shared NAT / office egress; only stops script spraying / flooding
//	register 10/hour per-IP   — registrations should be rare
//	query    30/min  per-user — protects Bot relay cost; human interaction rates are far below this
var rlDefaults = map[string]struct {
	limit  int64
	window time.Duration
}{
	"login":    {60, time.Minute},
	"register": {10, time.Hour},
	"query":    {30, time.Minute},
}

type rlConfig struct {
	enabled bool
	limit   int64
	window  time.Duration
}

// rateLimitConfig reads the configuration for one rate-limit dimension. The
// master switch ratelimit.enabled defaults to OFF (dark launch: middleware ships
// dormant, ops flip to true to activate, single-config rollback). Per-dimension
// limit/window fall back to rlDefaults when unset.
func rateLimitConfig(name string) rlConfig {
	d := rlDefaults[name]
	limit := viper.GetInt64("ratelimit." + name + ".limit")
	if limit <= 0 {
		limit = d.limit
	}
	window := viper.GetDuration("ratelimit." + name + ".window")
	if window <= 0 {
		window = d.window
	}
	return rlConfig{enabled: viper.GetBool("ratelimit.enabled"), limit: limit, window: window}
}

// rateLimit builds a fixed-window rate-limiting middleware. keyFn extracts the
// rate-limit identity (IP or user email); returning an empty string passes the
// request through (unidentifiable callers are never throttled).
// Entirely fail-open: when Redis is down, cache.Allow returns true and 429 is
// never issued; 429 is only sent when Redis is live and the limit is confirmed exceeded.
func rateLimit(name string, keyFn func(*gin.Context) string) gin.HandlerFunc {
	cfg := rateLimitConfig(name)
	if !cfg.enabled {
		return func(c *gin.Context) { c.Next() } // dark-launch OFF: pass-through, zero overhead
	}
	path := "ratelimit_" + name
	return func(c *gin.Context) {
		id := keyFn(c)
		if id == "" {
			c.Next()
			return
		}
		if rxCache.Allow(c.Request.Context(), path, "ratelimit:"+name+":"+id, cfg.limit, cfg.window) {
			c.Next()
			return
		}
		rxCache.ObserveRateLimitBlocked()
		c.Header("Retry-After", strconv.Itoa(int(cfg.window.Seconds())))
		c.JSON(http.StatusTooManyRequests, gin.H{
			"code":    http.StatusTooManyRequests,
			"message": "too many requests, please try again later",
		})
		c.Abort()
	}
}

// PerIPRateLimit rate-limits by client IP (c.ClientIP() resolves the real IP
// under SetTrustedProxies). Used on public auth endpoints (login / register) to
// block cross-account spraying and flooding.
func PerIPRateLimit(name string) gin.HandlerFunc {
	return rateLimit(name, func(c *gin.Context) string { return c.ClientIP() })
}

// PerUserRateLimit rate-limits by authenticated user (the username injected by
// AuthMiddleware). Must be registered after AuthMiddleware. Used on /query to
// protect Bot relay cost.
func PerUserRateLimit(name string) gin.HandlerFunc {
	return rateLimit(name, func(c *gin.Context) string { return c.GetString("username") })
}
