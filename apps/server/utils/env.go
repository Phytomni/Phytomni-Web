package utils

import (
	"os"
)

// GetEnvironment 当前运行环境
func GetEnvironment() string {
	env := os.Getenv("ENV")
	switch env {
	case "prod", "production":
		return "production"
	case "test":
		return "test"
	case "dev", "develop":
		return "develop"
	default:
		return "develop"
	}
}

func IsProduction() bool {
	return GetEnvironment() == "production"
}

func IsTest() bool {
	return GetEnvironment() == "test"
}
