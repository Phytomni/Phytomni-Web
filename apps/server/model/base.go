package model

import (
	"context"
	"phytomni-server/db"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func Default() *gorm.DB {
	return db.MustGet("phytomni-server")
}

// DB returns a Context-bound DB instance, used to pass UserID and similar info
// to the Logger. In the Service layer, use model.DB(ctx) instead of model.Default().
func DB(ctx context.Context) *gorm.DB {
	if c, ok := ctx.(*gin.Context); ok {
		// SQL drivers may retain the context after Gin returns it to its pool.
		// Copy middleware metadata, but keep cancellation on the original request.
		snapshot := c.Copy()
		parent := context.Background()
		if snapshot.Request != nil {
			parent = snapshot.Request.Context()
		}
		ctx = databaseRequestContext{Context: parent, values: snapshot.Keys}
	}
	return Default().WithContext(ctx)
}

type databaseRequestContext struct {
	context.Context
	values map[string]interface{}
}

func (c databaseRequestContext) Value(key interface{}) interface{} {
	if name, ok := key.(string); ok {
		if value, exists := c.values[name]; exists {
			return value
		}
	}
	return c.Context.Value(key)
}
