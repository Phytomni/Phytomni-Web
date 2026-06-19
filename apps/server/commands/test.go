package commands

import (
	"fmt"

	"github.com/urfave/cli/v2"
)

func Test() *cli.Command {
	return &cli.Command{
		Name:    "test",
		Aliases: []string{"t"},
		Usage:   "./main test",
		Action: func(c *cli.Context) error {
			fmt.Println("just test command")
			return nil
		},
	}
}
