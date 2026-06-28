package model

import (
	"context"
	"phytomni-server/db"

	"gorm.io/gorm"
)

func Default() *gorm.DB {
	return db.MustGet("phytomni-server")
}

// DB returns a Context-bound DB instance, used to pass UserID and similar info
// to the Logger. In the Service layer, use model.DB(ctx) instead of model.Default().
func DB(ctx context.Context) *gorm.DB {
	return Default().WithContext(ctx)
}
