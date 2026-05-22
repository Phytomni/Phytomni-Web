package model

import (
	"context"
	"nky_client_go/db"

	"gorm.io/gorm"
)

func Default() *gorm.DB {
	return db.MustGet("nky_client_go")
}

// DB 获取带有 Context 的 DB 实例，用于传递 UserID 等信息给 Logger
// 在 Service 层请使用 model.DB(ctx) 替代 model.Default()
func DB(ctx context.Context) *gorm.DB {
	return Default().WithContext(ctx)
}
