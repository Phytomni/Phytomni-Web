package main

import (
	"nky_client_go/commands"
	"nky_client_go/cron"
	rxMysql "nky_client_go/db"
	rxLog "nky_client_go/log"
	rxRAG "nky_client_go/service/api_service"
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
	// ApiGeneList / ApiGeneDetails read .md examples from this root;
	// historically the call sites carried a developer's local Windows
	// path as the fallback, which silently broke on every non-Windows
	// deploy. SetDefault here so a missing app.yml key lands on the
	// canonical Linux production-style path instead.
	viper.SetDefault("gene_file_path", "/var/lib/phytomni/gene_examples")
	if err := utils.LoadConfigInFile(configFile); err != nil {
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
	if err := rxRAG.InitViperRAG(); err != nil {
		return err
	}
	return nil
}
