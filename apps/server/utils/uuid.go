package utils

import "github.com/google/uuid"

// GenUUID 生成UUID
func GenUUID() string {
	return uuid.New().String()
}
