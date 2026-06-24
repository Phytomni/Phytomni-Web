package middleware

import (
	"net/http"
	rxCache "phytomni-server/cache"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
)

// rlDefaults 各维度默认 limit/window(viper 未配时回落):
//
//	login    60/min  per-IP —— 宽到不误伤共享 NAT/办公出口,只挡脚本喷洒/洪泛
//	register 10/hour per-IP —— 注册本应罕见
//	query    30/min  per-user —— 护 Bot relay 成本,人类交互速率远低于此
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

// rateLimitConfig 读某维度配置。总开关 ratelimit.enabled 默认 OFF(暗发布:中间件随
// 代码上线但休眠,运维确认后置 true,一键回滚);单维度 limit/window 缺省回落 rlDefaults。
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

// rateLimit 构造一个固定窗口限流中间件。keyFn 提取限流身份(IP 或用户邮箱);返回
// 空串 → 放行(无法识别身份时不限流)。fail-open 全程:Redis 挂时 cache.Allow 返回
// true,绝不 429;只有 Redis 活且确认超限才 429。
func rateLimit(name string, keyFn func(*gin.Context) string) gin.HandlerFunc {
	cfg := rateLimitConfig(name)
	if !cfg.enabled {
		return func(c *gin.Context) { c.Next() } // 暗发布关闭态:直通,零开销
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
			"message": "请求过于频繁，请稍后再试",
		})
		c.Abort()
	}
}

// PerIPRateLimit 按客户端 IP 限流(c.ClientIP() 在 SetTrustedProxies 下取真实 IP)。
// 用于公开 auth 端点(登录/注册),挡跨账户喷洒 + 洪泛。
func PerIPRateLimit(name string) gin.HandlerFunc {
	return rateLimit(name, func(c *gin.Context) string { return c.ClientIP() })
}

// PerUserRateLimit 按已认证用户(AuthMiddleware 注入的 username)限流。必须挂在
// AuthMiddleware 之后。用于 /query,护 Bot relay 成本。
func PerUserRateLimit(name string) gin.HandlerFunc {
	return rateLimit(name, func(c *gin.Context) string { return c.GetString("username") })
}
