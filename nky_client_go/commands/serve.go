package commands

import (
	"phytomni-server/http/router"

	"phytomni-server/graceful"

	"phytomni-server/server"

	"github.com/urfave/cli/v2"
)

func Serve(c *cli.Context) error {
	// 运行HTTP服务
	graceful.Start(server.NewHttp(server.Addr(":8082"), server.Router(router.All())))

	graceful.Wait()
	return nil
}
