package router

import (
	"nky_client_go/log"

	ginzap "github.com/gin-contrib/zap"
	"github.com/gin-gonic/gin"
)

func All() func(r *gin.Engine) {
	return func(r *gin.Engine) {

		// panic日志
		r.Use(ginzap.RecoveryWithZap(log.Sugar().Desugar(), true))
		r.MaxMultipartMemory = 10 << 20 // 10MB

		prefixRouter := r.Group("/")

		// 默认的Api路由
		Api(prefixRouter)
	}
}
