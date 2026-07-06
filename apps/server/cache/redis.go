package cache

import (
	"os"

	"github.com/go-redis/redis/v8"
	"github.com/spf13/viper"
)

var defaultName string
var clients map[string]redis.UniversalClient
var clientDefault map[string]*redis.Client

type Config struct {
	Type         string   `json:"type" mapstructure:"type"` // cluster, failover,single-node , default is single-node
	Addrs        []string `json:"addrs" mapstructure:"addrs"`
	Password     string   `json:"password" mapstructure:"password"`
	DB           int      `json:"db" mapstructure:"db"`
	PoolSize     int      `json:"pool_size" mapstructure:"pool_size"`           // 0 = go-redis default (10 * CPU cores)
	MinIdleConns int      `json:"min_idle_conns" mapstructure:"min_idle_conns"` // 0 = go-redis default (0)
}

// applyEnvRedisPassword overrides cfg.Password with
// PHYTOMNI_REDIS_PASSWORD when the env var is set and non-empty. When unset
// (the current production state) cfg is returned unchanged so existing
// file-only deployments are byte-identical. Extracted from InitFromViper so
// the override can be unit-tested without a Redis connection (NewClient pings
// immediately).
func applyEnvRedisPassword(cfg Config) Config {
	if v := os.Getenv("PHYTOMNI_REDIS_PASSWORD"); v != "" {
		cfg.Password = v
	}
	return cfg
}

func InitFromViper() error {
	defaultName = viper.GetString("redis.default")
	var cfg map[string]Config
	err := viper.UnmarshalKey("redis.clients", &cfg)
	if err != nil {
		return err
	}
	clients = make(map[string]redis.UniversalClient)
	for k := range cfg {
		cfg[k] = applyEnvRedisPassword(cfg[k])
		if clients[k], err = NewClient(cfg[k]); err != nil {
			return err
		}
	}
	return nil
}

func InitFromViperDefault() error {
	defaultName = viper.GetString("redis.default")
	var cfg map[string]Config
	err := viper.UnmarshalKey("redis.clients", &cfg)
	if err != nil {
		return err
	}
	clientDefault = make(map[string]*redis.Client)
	for k := range cfg {
		if clientDefault[k], err = NewClientDefault(cfg[k]); err != nil {
			return err
		}
	}
	return nil
}
