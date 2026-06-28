package router

import (
	"phytomni-server/log"

	ginzap "github.com/gin-contrib/zap"
	"github.com/gin-gonic/gin"
)

func All() func(r *gin.Engine) {
	return func(r *gin.Engine) {

		r.Use(ginzap.RecoveryWithZap(log.Sugar().Desugar(), true))
		r.MaxMultipartMemory = 10 << 20 // 10MB

		prefixRouter := r.Group("/")

		Api(prefixRouter)
	}
}
