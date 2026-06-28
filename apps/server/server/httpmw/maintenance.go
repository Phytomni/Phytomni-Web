package httpmw

import "github.com/gin-gonic/gin"

func UnderMaintenance() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		ctx.AbortWithStatusJSON(501, gin.H{
			"code": 501,
			"msg":  "system under maintenance, this will take about 30 minutes",
		})
	}
}
