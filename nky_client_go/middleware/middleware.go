package middleware

import (
	"fmt"
	"nky_client_go/common"
	"strings"

	"github.com/gin-gonic/gin"
)

func GlobalMiddleware() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		ctx.Next()
	}
}

// CheckWechatMiddleware 验证是否为微信小程序访问
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
		ReturnResponse(common.FORBID, map[string]interface{}{}, common.FORBID_MSG, c)
		return false
	}
	return true
}

type Response struct {
	Code int         `json:"code"`
	Msg  string      `json:"msg"`
	Data interface{} `json:"data"`
}

func ReturnResponse(code int, data interface{}, msg string, c *gin.Context) {
	c.JSON(200, Response{
		code,
		msg,
		data,
	})
}

// CORS 中间件
func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {

		// 设置允许的来源（这里用 * 表示允许所有，也可以指定特定域名）
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		// 允许的请求方法
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
		// 允许的请求头
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization")
		// 是否允许携带认证信息
		//c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")

		// 处理 OPTIONS 预检请求
		if c.Request.Method == "OPTIONS" {
			fmt.Println("进入了OPTIONS")
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}
