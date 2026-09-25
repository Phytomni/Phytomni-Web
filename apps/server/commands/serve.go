package commands

import (
	"context"
	"fmt"
	"strings"
	"time"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/http/router"
	"phytomni-server/model"
	"phytomni-server/service/api_service"

	"phytomni-server/graceful"

	"phytomni-server/server"

	"github.com/urfave/cli/v2"
	"gorm.io/gorm"
)

func validateExecutionWorkerConfiguration() error {
	if err := rxBot.ValidateExecutionServiceConfiguration(); err != nil {
		return fmt.Errorf("execution workers require a shared Bot service credential: %w", err)
	}
	return nil
}

func validateExecutionRuntimeSchema(db *gorm.DB) error {
	requiredModels := []any{
		&model.QuestionAgentExecutionAdmission{},
		&model.ConversationTurnV2{},
		&model.ConversationTurnSequenceV2{},
		&model.ConversationMessageV2{},
		&model.QuestionAgentExecutionOutbox{},
		&model.QuestionAgentExecutionEventV2{},
	}
	missing := make([]string, 0)
	for _, requiredModel := range requiredModels {
		statement := &gorm.Statement{DB: db}
		if err := statement.Parse(requiredModel); err != nil {
			return fmt.Errorf("inspect execution runtime schema: %w", err)
		}
		table := statement.Schema.Table
		if !db.Migrator().HasTable(requiredModel) {
			missing = append(missing, table)
			continue
		}
		for _, column := range statement.Schema.DBNames {
			if !db.Migrator().HasColumn(requiredModel, column) {
				missing = append(missing, table+"."+column)
			}
		}
		for _, index := range statement.Schema.ParseIndexes() {
			if !db.Migrator().HasIndex(requiredModel, index.Name) {
				missing = append(missing, table+" index "+index.Name)
			}
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf(
			"execution runtime schema is incomplete (missing %s); run `phytomni-server migrate add-execution-runtime-v2` before starting Web",
			strings.Join(missing, ", "),
		)
	}
	return nil
}

func Serve(c *cli.Context) error {
	if err := validateExecutionWorkerConfiguration(); err != nil {
		return err
	}
	if err := validateExecutionRuntimeSchema(model.Default()); err != nil {
		return err
	}
	preflightCtx, cancelPreflight := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelPreflight()
	if err := rxBot.NewClientWithTimeout(5 * time.Second).ValidateExecutionServiceAuthentication(preflightCtx); err != nil {
		return fmt.Errorf("execution workers cannot authenticate to Bot: %w", err)
	}
	graceful.StartFunc(func(ctx context.Context) {
		api_service.RunExecutionWorkers(ctx, 250*time.Millisecond)
	})
	graceful.Start(server.NewHttp(server.Addr(":8080"), server.Router(router.All())))

	graceful.Wait()
	return nil
}
