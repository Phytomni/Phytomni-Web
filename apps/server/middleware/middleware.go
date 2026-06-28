package middleware

import (
	"phytomni-server/common"
	"strings"

	"github.com/gin-gonic/gin"
)

func GlobalMiddleware() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		ctx.Next()
	}
}

// CheckWechatMiddleware verifies the request comes from the WeChat mini-program.
func CheckWechatMiddleware() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		if !checkRequestUserAgent(ctx) {
			ctx.Abort()
			return
		}

		ctx.Next()
	}
}

func checkRequestUserAgent(c *gin.Context) bool {
	uaText := c.Request.Header.Get("User-Agent")
	isFlag := strings.Contains(strings.ToLower(uaText), common.MINI_WECHAT)
	if !isFlag {
		common.ReturnResponse(common.FORBID, map[string]interface{}{}, common.FORBID_MSG, c)
		return false
	}
	return true
}

// CORS middleware
func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {

		// Allowed origin (* = all; can be restricted to a specific domain)
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		// Allowed request methods
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
		// Allowed request headers
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization")

		// Handle the OPTIONS preflight request
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}
