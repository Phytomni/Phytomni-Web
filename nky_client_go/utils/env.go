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

// GetShortEnvironment 当前运行环境的简写版本，目前主要用于sentry
func GetShortEnvironment() string {
	env := GetEnvironment()
	switch env {
	case "prod", "production":
		return "prod"
	case "test":
		return "test"
	case "dev", "develop":
		return "dev"
	}
	return "prod"
}

func IsProduction() bool {
	return GetEnvironment() == "production"
}

func IsTest() bool {
	return GetEnvironment() == "test"
}
