package model

import (
	"nky_client_go/db"

	"gorm.io/gorm"
)

func Default() *gorm.DB {
	return db.MustGet("nky_client_go")
}
