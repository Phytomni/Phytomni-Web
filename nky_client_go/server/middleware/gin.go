package middleware

import (
	"nky_client_go/log"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader("x-request-id")
		if id == "" {
			id = uuid.New().String()
		}
		c.Set("x-request-id", id)
		logger := log.Sugar().With("request_id", id)
		c.Set("logger", logger)

		c.Next()

		c.Header("x-request_id", id)
	}
}

func Recovery() gin.HandlerFunc {
	return gin.CustomRecovery(func(c *gin.Context, err interface{}) {
		log.Sugar().Errorf("panic recovered:: %s", err)
		c.AbortWithStatusJSON(500, gin.H{
			"code": 500,
			"msg":  "InternalServerError",
		})
	})
}
