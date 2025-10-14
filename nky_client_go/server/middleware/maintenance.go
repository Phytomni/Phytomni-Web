package middleware

import "github.com/gin-gonic/gin"

func UnderMaintenance() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		ctx.AbortWithStatusJSON(501, gin.H{
			"code": 501,
			"msg":  "系统维护中，此次维护大概需要30分钟",
		})
	}
}
