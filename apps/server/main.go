package main

import (
	"context"
	"os"
	rxRedis "phytomni-server/cache"
	"phytomni-server/commands"
	"phytomni-server/cron"
	rxMysql "phytomni-server/db"
	rxBot "phytomni-server/external/bot"
	rxLog "phytomni-server/log"
	"phytomni-server/utils"

	"github.com/spf13/viper"
	"github.com/urfave/cli/v2"
)

var configFile string

func main() {
	app := cli.NewApp()
	app.Action = commands.Serve
	app.Before = initConfig
	app.Commands = commands.Commands
	app.Flags = []cli.Flag{
		&cli.StringFlag{
			Name:        "config",
			Value:       "", // defaults to reading from the config directory
			Usage:       "specify the location of the configuration file",
			Required:    false,
			Destination: &configFile,
		},
	}
	if err := app.Run(os.Args); err != nil {
		rxLog.Sugar().Fatal(err)
	}
}

func initConfig(*cli.Context) error {
	viper.SetDefault("app", "phytomni-server")
	// GeneList reads .md examples from the obsfs FUSE mount (OBS bucket as
	// POSIX). An empty gene_obsfs_path means the mount is absent and the list
	// falls back to the Bot relay listing (gene-examples/md/). SetDefault ""
	// keeps the relay fallback as the safe dormant default.
	viper.SetDefault("gene_obsfs_path", "")
	if err := utils.LoadConfigInFile(configFile); err != nil {
		return err
	}
	// Fail fast on a misconfigured bcrypt cost rather than silently
	// degrading the work factor on the first password write.
	if err := utils.ValidateBcryptCost(); err != nil {
		return err
	}
	if err := rxLog.InitFromViper(); err != nil {
		return err
	}
	if err := rxMysql.InitMysqlDB(); err != nil {
		return err
	}
	// Redis user/product layer (token revocation, rate-limit, OBS-listing cache).
	// FAIL-OPEN: a Redis outage must NOT block boot — features degrade instead.
	// Use InitFromViper (fills the "clients" map read by cache.Client), NOT
	// InitFromViperDefault (a separate clientDefault map → nil here).
	viper.SetDefault("redis.enabled", true)
	// OBS-listing cache is a benign fail-open optimization; default ON (active
	// only when Redis is reachable). Flip to false to bypass it without
	// disabling revocation/rate-limit.
	viper.SetDefault("obscache.enabled", true)
	// Chat quota gate: default OFF (dark launch). When OFF, CheckChatAllowed
	// always allows — zero behavior change from today. Set to true in app.yml
	// to activate per-user chat_limit enforcement.
	viper.SetDefault("chatlimit.enforce", false)
	if viper.GetBool("redis.enabled") {
		if err := rxRedis.InitFromViper(); err != nil {
			rxLog.Sugar().Warnf("redis init failed; user/product features degrade fail-open: %v", err)
		}
		// Fail-fast only on a wiring/config error (no "web" client at all),
		// NOT on a transient outage (a down server still yields a non-nil client).
		if rxRedis.Client("web") == nil {
			rxLog.Sugar().Fatal("redis.enabled=true but no 'web' client configured (check redis.clients.web)")
		}
	} else {
		rxLog.Sugar().Warn("redis.enabled=false: token revocation / rate-limit / OBS-cache disabled (all fail-open)")
	}
	if err := cron.DoCron(); err != nil {
		return err
	}
	if err := rxBot.InitFromViper(); err != nil {
		return err
	}
	// Only reach out to Bot when the gateway is active. A dormant deploy
	// (proxy_enabled=false) must not depend on Bot being online to boot.
	if rxBot.BotConfig.ProxyEnabled {
		if err := rxBot.ValidateAgents(context.Background(), rxBot.NewClient()); err != nil {
			rxLog.Sugar().Fatalf("bot agent slug validation failed: %v", err)
		}
	}
	return nil
}
