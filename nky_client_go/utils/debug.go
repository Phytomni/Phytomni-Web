package utils

import (
	"os"

	"github.com/spf13/viper"
)

func Debug() bool {
	viper.SetDefault("debug", os.Getenv("DEBUG"))
	return viper.GetBool("debug")
}
