package utils

import (
	"github.com/spf13/viper"
	"log"
	"os"
)

func LoadConfigInFile(filename string) error {

	// When a file is specified, read from it; otherwise load by the default rule.
	// Default rule: current-directory/{env}.{ext}; ext supports json, yaml, etc.
	if filename == "" {
		env := GetEnvironment()
		log.Printf("Current environment: %s", env)
		if _, err := os.Stat("config"); os.IsNotExist(err) {
			log.Fatal("config directory does not exist")
		}

		// 1. read the "app" config file
		if FilesExists([]string{"config/app.yml", "config/app.yaml", "config/app.json"}) {
			v := viper.New()
			v.AddConfigPath("config")
			v.SetConfigName("app")
			if err := v.ReadInConfig(); err != nil {
				return err
			}

			err := viper.MergeConfigMap(v.AllSettings())
			if err != nil {
				return err
			}
		}

		// 2. read the "env" config file, overriding values from app
		if FilesExists([]string{"config/" + env + ".yml", "config/" + env + ".yaml", "config/" + env + ".json"}) {
			v := viper.New()
			v.AddConfigPath("config")
			v.SetConfigName(env)
			if err := v.ReadInConfig(); err != nil {
				return err
			}

			err := viper.MergeConfigMap(v.AllSettings())
			if err != nil {
				return err
			}
		}

		// 3. read the "custom" config, overriding the environment defaults
		if FilesExists([]string{"config/custom.yml", "config/custom.yaml", "config/custom.json"}) {
			v := viper.New()
			v.AddConfigPath("config")
			v.SetConfigName("custom")
			if err := v.ReadInConfig(); err != nil {
				return err
			}

			err := viper.MergeConfigMap(v.AllSettings())
			if err != nil {
				return err
			}
		}

	} else {
		viper.SetConfigFile(filename)
		if err := viper.ReadInConfig(); err != nil {
			return err
		}
	}

	return nil
}
