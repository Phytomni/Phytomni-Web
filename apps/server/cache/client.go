package cache

import (
	"context"
	"errors"

	"github.com/go-redis/redis/v8"
)

func NewClientDefault(config Config) (*redis.Client, error) {
	var rdbDefault *redis.Client

	switch config.Type {
	default:
		rdbDefault = redis.NewClient(&redis.Options{
			Addr:     config.Addrs[0],
			Password: config.Password,
			DB:       config.DB,
		})
	}

	if err := rdbDefault.Ping(context.Background()).Err(); err != nil {
		return rdbDefault, err
	}

	return rdbDefault, nil
}

func ClientDefault(name string) *redis.Client {
	return clientDefault[name]
}

func ClientAndErrDefault(name string) (*redis.Client, error) {
	if client, ok := clientDefault[name]; ok {
		return client, nil
	}
	return nil, errors.New("redis client not exists")
}

func NewClient(config Config) (redis.UniversalClient, error) {
	var rdb redis.UniversalClient

	switch config.Type {
	case "cluster":
		rdb = redis.NewClusterClient(&redis.ClusterOptions{
			Addrs:    config.Addrs,
			Password: config.Password,
		})

	default:
		rdb = redis.NewClient(&redis.Options{
			Addr:     config.Addrs[0],
			Password: config.Password,
			DB:       config.DB,
		})
	}

	if err := rdb.Ping(context.Background()).Err(); err != nil {
		return rdb, err
	}

	return rdb, nil
}

func Client(name string) redis.UniversalClient {
	return clients[name]
}

func ClientAndErr(name string) (redis.UniversalClient, error) {
	if client, ok := clients[name]; ok {
		return client, nil
	}
	return nil, errors.New("redis client not exists")
}
