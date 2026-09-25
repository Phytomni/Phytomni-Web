package api_service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	mysqlDriver "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"phytomni-server/db"
	"phytomni-server/model"
)

func TestMySQLClientTurnLookupIsParameterized(t *testing.T) {
	gdb, err := gorm.Open(mysql.New(mysql.Config{
		DSN:                       "root:password@tcp(127.0.0.1:3306)/phytomni_ctxv1_dry_run",
		SkipInitializeWithVersion: true,
	}), &gorm.Config{
		DryRun:               true,
		DisableAutomaticPing: true,
		Logger:               logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}

	const clientTurnID = "client-turn-id-must-stay-a-bind-value"
	var rows []model.QuestionAgentLog
	result := applyClientTurnLookup(gdb, "synthetic-owner", clientTurnID).Find(&rows)
	if result.Error != nil {
		t.Fatal(result.Error)
	}
	sql := result.Statement.SQL.String()
	if strings.Contains(sql, clientTurnID) {
		t.Fatalf("client turn ID was interpolated into SQL: %s", sql)
	}
	if len(result.Statement.Vars) != 5 || result.Statement.Vars[0] != "synthetic-owner" ||
		result.Statement.Vars[1] != clientTurnID || result.Statement.Vars[2] != clientTurnID ||
		result.Statement.Vars[3] != clientTurnID || result.Statement.Vars[4] != 2 {
		t.Fatalf("unexpected SQL bind variables: %#v", result.Statement.Vars)
	}
	for _, fragment := range []string{
		"JSON_UNQUOTE(JSON_EXTRACT",
		"conversation_context.client_turn_id",
		"conversation_context.replacement.client_turn_id",
		"conversation_context.retired_identities",
		"JSON_CONTAINS",
		"LIMIT ?",
	} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("SQL missing %q: %s", fragment, sql)
		}
	}
}

func TestLongResearchConversationContextMySQLIntegration(t *testing.T) {
	if os.Getenv("PHYTOMNI_RUN_MYSQL_INTEGRATION") != "1" {
		t.Skip("set PHYTOMNI_RUN_MYSQL_INTEGRATION=1 for development MySQL acceptance")
	}
	dsn := strings.TrimSpace(os.Getenv("PHYTOMNI_TEST_DB_DSN"))
	if dsn == "" {
		t.Skip("PHYTOMNI_TEST_DB_DSN is not configured")
	}
	parsed, err := mysqlDriver.ParseDSN(dsn)
	if err != nil {
		t.Fatalf("parse development DSN: %v", err)
	}
	if !strings.HasPrefix(parsed.DBName, "phytomni_ctxv1_") {
		t.Fatalf("refusing non-isolated database name")
	}

	openPool := func() (*gorm.DB, error) {
		return gorm.Open(mysql.Open(dsn), &gorm.Config{
			Logger: logger.Default.LogMode(logger.Silent),
		})
	}
	firstDB, err := openPool()
	if err != nil {
		t.Fatalf("open first development pool: %v", err)
	}
	db.Set("phytomni-server", firstDB)
	secondDB, err := openPool()
	if err != nil {
		_ = closeGormSQLDB(firstDB)
		t.Fatalf("open second development pool: %v", err)
	}
	t.Cleanup(func() {
		_ = closeGormSQLDB(firstDB)
		_ = closeGormSQLDB(secondDB)
	})

	owner := fmt.Sprintf("ctxv1-owner-%d", time.Now().UnixNano())
	dialogueID := uuid.NewString()
	oldClientTurnID := fmt.Sprintf("ctxv1-old-client-%d", time.Now().UnixNano())
	oldInput := QueryInput{
		Query:        "old query",
		Mode:         "instant",
		ClientTurnID: oldClientTurnID,
		Surface:      QuerySurfaceChat,
	}
	oldTarget := v1SubmissionTarget{
		dialogueID: dialogueID,
		mode:       "instant",
		operation:  "append",
	}
	oldProjection, err := marshalPersistedProjectionWithContext(
		BotRunProjection{ReportRevision: -1},
		&persistedConversationContext{
			ClientTurnID:       oldClientTurnID,
			RequestFingerprint: submissionRequestFingerprint(oldInput, oldTarget, true),
			SettlementState:    "submission_append",
		},
	)
	if err != nil {
		t.Fatalf("marshal old projection: %v", err)
	}
	oldRow := mysqlIntegrationRow(owner, dialogueID, oldProjection, "old query")
	if err := firstDB.Create(&oldRow).Error; err != nil {
		t.Fatalf("create retained lookup row: %v", err)
	}
	for index := 0; index < recentClientTurnLookupLimit+5; index++ {
		filler := mysqlIntegrationRow(
			owner,
			fmt.Sprintf("ctxv1-filler-dialogue-%d-%d", time.Now().UnixNano(), index),
			oldProjection,
			fmt.Sprintf("filler-%d", index),
		)
		private := persistedConversationContext{
			ClientTurnID:    fmt.Sprintf("ctxv1-filler-client-%d-%d", time.Now().UnixNano(), index),
			SettlementState: "submission_append",
		}
		filler.BotProjectionJSON, err = marshalPersistedProjectionWithContext(
			BotRunProjection{ReportRevision: -1},
			&private,
		)
		if err != nil {
			t.Fatalf("marshal filler projection: %v", err)
		}
		if err := firstDB.Create(&filler).Error; err != nil {
			t.Fatalf("create filler row %d: %v", index, err)
		}
	}
	permissions := AgentPermissionResolution{AllowedTools: []string{"ChatAgent"}}
	oldSubmission, err := NewService().allocateV1SubmissionWithDB(
		context.Background(),
		firstDB,
		owner,
		oldInput,
		oldTarget,
		permissions,
		false,
	)
	if err != nil {
		t.Fatalf("lookup retained client turn: %v", err)
	}
	if oldSubmission.row.Id != oldRow.Id || oldSubmission.duplicate == nil {
		t.Fatalf("retained lookup returned row=%d duplicate=%v, want row=%d and duplicate result", oldSubmission.row.Id, oldSubmission.duplicate != nil, oldRow.Id)
	}

	clientTurnID := fmt.Sprintf("ctxv1-client-%d", time.Now().UnixNano())
	concurrentTarget := v1SubmissionTarget{
		dialogueID: uuid.NewString(),
		mode:       "instant",
		operation:  "append",
	}
	rawQuery := syntheticLongResearchQuery(t)
	input := QueryInput{Query: rawQuery, Mode: "instant", ClientTurnID: clientTurnID}
	start := make(chan struct{})
	type allocationResult struct {
		submission *v1Submission
		err        error
	}
	results := make(chan allocationResult, 2)
	var wait sync.WaitGroup
	wait.Add(2)
	go func() {
		defer wait.Done()
		<-start
		submission, allocationErr := NewService().allocateV1SubmissionWithDB(
			context.Background(), firstDB, owner, input, concurrentTarget, permissions, false,
		)
		results <- allocationResult{submission: submission, err: allocationErr}
	}()
	go func() {
		defer wait.Done()
		<-start
		submission, allocationErr := NewService().allocateV1SubmissionWithDB(
			context.Background(), secondDB, owner, input, concurrentTarget, permissions, false,
		)
		results <- allocationResult{submission: submission, err: allocationErr}
	}()
	close(start)
	wait.Wait()
	close(results)

	var winner, loser *v1Submission
	var nonpending, pending int
	for result := range results {
		if result.err != nil {
			t.Fatalf("concurrent allocation: %v", result.err)
		}
		if result.submission == nil {
			t.Fatal("concurrent allocation returned no submission")
		}
		if result.submission.pending {
			if result.submission.duplicate == nil || result.submission.duplicate.Status != "SUBMITTING" {
				t.Fatalf("pending allocation lost durable duplicate identity: %+v", result.submission)
			}
			pending++
			loser = result.submission
			continue
		}
		if result.submission.envelope == nil {
			t.Fatal("nonpending allocation returned no envelope")
		}
		nonpending++
		winner = result.submission
	}
	if nonpending != 1 || pending != 1 || winner == nil || loser == nil ||
		winner.row.Id == 0 || loser.row.Id != winner.row.Id ||
		loser.duplicate == nil || loser.duplicate.Id != winner.row.Id ||
		loser.duplicate.DialogueId != winner.row.DialogueId ||
		winner.envelope.TurnID != strconv.FormatInt(loser.row.Id, 10) {
		t.Fatalf("concurrent allocation outcomes nonpending/pending=%d/%d winner=%+v loser=%+v", nonpending, pending, winner, loser)
	}
	var rowCount int64
	if err := firstDB.Model(&model.QuestionAgentLog{}).
		Where("user_name = ? AND dialogue_id = ?", owner, concurrentTarget.dialogueID).
		Count(&rowCount).Error; err != nil {
		t.Fatalf("count concurrent rows: %v", err)
	}
	if rowCount != 1 {
		t.Fatalf("concurrent row count = %d, want 1", rowCount)
	}
	var persisted model.QuestionAgentLog
	if err := firstDB.Where("user_name = ? AND dialogue_id = ?", owner, concurrentTarget.dialogueID).
		First(&persisted).Error; err != nil {
		t.Fatalf("read long Research allocation: %v", err)
	}
	if persisted.Query != rawQuery {
		t.Fatal("MySQL persisted query differs from the authored Research query")
	}
	if persisted.TitleQuery != longResearchPaperMarker || strings.Contains(persisted.TitleQuery, longResearchPathMarker) {
		t.Fatalf("MySQL title is not the bounded first meaningful line: code_points=%d", len([]rune(persisted.TitleQuery)))
	}

	_, err = NewService().allocateV1SubmissionWithDB(
		context.Background(),
		secondDB,
		owner,
		QueryInput{Query: "changed query", Mode: "instant", ClientTurnID: clientTurnID},
		concurrentTarget,
		permissions,
		false,
	)
	if !errors.Is(err, ErrDuplicateClientTurn) {
		t.Fatalf("conflicting payload error = %v, want duplicate client turn", err)
	}

	lockKey := turnAllocationKey(owner, clientTurnID)
	lockErr := errors.New("synthetic callback failure")
	if err := withMySQLTurnAllocationLockDB(context.Background(), firstDB, lockKey, func() error {
		return lockErr
	}); !errors.Is(err, lockErr) {
		t.Fatalf("lock callback error = %v, want %v", err, lockErr)
	}
	if err := withMySQLTurnAllocationLockDB(context.Background(), secondDB, lockKey, func() error {
		return nil
	}); err != nil {
		t.Fatalf("GET_LOCK was not released after callback error: %v", err)
	}
}

func mysqlIntegrationRow(
	owner string,
	dialogueID string,
	projection string,
	query string,
) model.QuestionAgentLog {
	return model.QuestionAgentLog{
		DialogueId:        dialogueID,
		FId:               0,
		ServerId:          "",
		UserName:          owner,
		Query:             query,
		TitleQuery:        query,
		Answer:            "",
		FollowUpQuestions: "",
		TaskId:            "",
		TaskLog:           "",
		FileName:          "",
		UploadPath:        "",
		DownloadPath:      "",
		ImagePaths:        "",
		ComputeResource:   "",
		ServerFilePath:    "",
		ToolName:          "ChatAgent",
		Mode:              "instant",
		Status:            "FAILED",
		LogStatus:         "",
		ReactionType:      "0",
		CollectType:       "0",
		BotProjectionJSON: projection,
		BotReportRevision: -1,
		CreatedAt:         time.Now().UTC(),
		UpdatedAt:         time.Now().UTC(),
	}
}

func closeGormSQLDB(gdb *gorm.DB) error {
	if gdb == nil {
		return nil
	}
	sqlDB, err := gdb.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}
