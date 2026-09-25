package utils

import (
	"github.com/spf13/viper"
	"log"
	"os"
)

const RegistrationEnabledKey = "auth.registration_enabled"

func RegistrationEnabled() bool {
	if !viper.IsSet(RegistrationEnabledKey) {
		return true
	}
	return viper.GetBool(RegistrationEnabledKey)
}

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

	// Override jwt.secret_key from PHYTOMNI_JWT_SECRET only when the env var is
	// non-empty. Empty or unset env leaves the file value in place — same
	// contract as PHYTOMNI_DB_DSN / PHYTOMNI_REDIS_PASSWORD. (viper.BindEnv would
	// treat a set-empty env as an override and wipe the file secret.)
	applyEnvJWTSecret()

	return nil
}

func applyEnvJWTSecret() {
	if v := os.Getenv("PHYTOMNI_JWT_SECRET"); v != "" {
		viper.Set("jwt.secret_key", v)
	}
}
