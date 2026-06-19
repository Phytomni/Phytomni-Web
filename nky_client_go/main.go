package main

import (
	"context"
	"nky_client_go/commands"
	"nky_client_go/cron"
	rxMysql "nky_client_go/db"
	rxBot "nky_client_go/external/bot"
	rxLog "nky_client_go/log"
	"nky_client_go/utils"
	"os"

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
			Value:       "", // 默认从config目录读取
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
	viper.SetDefault("app", "nky_client_go")
	// GeneList / GeneDetails read .md examples from this root;
	// historically the call sites carried a developer's local Windows
	// path as the fallback, which silently broke on every non-Windows
	// deploy. SetDefault here so a missing app.yml key lands on the
	// canonical Linux production-style path instead.
	viper.SetDefault("gene_file_path", "/var/lib/phytomni/gene_examples")
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
	//if err := rxRedis.InitFromViperDefault(); err != nil {
	//	return err
	//}
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
