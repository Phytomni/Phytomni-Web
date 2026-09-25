package api_handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"phytomni-server/db"
	"phytomni-server/model"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestAnswerCheckReturnsVersionedOrderedHistoryEnvelope(t *testing.T) {
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if sqlDB, dbErr := gdb.DB(); dbErr == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	if err := gdb.AutoMigrate(&model.ConversationMessageV2{}, &model.QuestionAgentExecutionAdmission{}, &model.QuestionAgentExecutionEventV2{}); err != nil {
		t.Fatal(err)
	}
	db.Set("phytomni-server", gdb)
	now := time.Now().UTC()
	assistantID := "msg-assistant-handler"
	if err := gdb.Create(&model.ConversationMessageV2{
		MessageID: assistantID, UserName: "alice", DialogueID: "dialogue-handler", MessageIndex: 2,
		ExecutionID: "turn-handler", SourceMessageID: assistantID, MessageType: "assistant", Role: "assistant",
		Visibility: "user", ContentRevision: 1, ContentOffset: 6, ContentLength: 6, Content: "answer",
		Status: "succeeded", OccurredAt: now, CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := gdb.Create(&model.QuestionAgentExecutionAdmission{
		UserName: "alice", ExecutionID: "turn-handler", RequestFingerprint: "fingerprint", FingerprintVersion: 2,
		DialogueID: stringPointer("dialogue-handler"), AssistantMessageID: &assistantID, Status: "succeeded",
		LatestCursor: 4, ProjectionRevision: 4, TrackingHealth: "healthy", ProjectionJSON: `{"schema_version":2,"execution_id":"turn-handler","status":"succeeded","latest_seq":4,"output_revision":1,"output_offset":6,"operation_revision":0,"tracking_health":"healthy","active_span_ids":[],"todo_declared":false,"todos":[],"results":[],"targets":[],"failed_work_unit_ids":[],"warnings":[],"input_required":null,"context_stage":null,"terminal":{"status":"succeeded","event_id":"event-terminal","result_revision":1}}`,
		CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := gdb.Create(&model.QuestionAgentExecutionEventV2{
		UserName: "alice", ExecutionID: "turn-handler", Seq: 1,
		EventID: "event-started", EventType: "execution.started",
		EventJSON:  `{"schema_version":2,"event_id":"event-started","execution_id":"turn-handler","seq":1,"type":"execution.started","status":"running","occurred_at":"2026-08-21T00:00:00Z","source":"runtime","span_id":"root","parent_span_id":null,"work_unit_id":null,"attempt":1,"summary":{"key":"activity.execution.started","text":"Execution started"},"public_payload":{},"target":null,"idempotency_key":null}`,
		OccurredAt: now, CreatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/conversations/dialogue-handler/messages?schema_version=2", nil)
	ctx.Params = gin.Params{{Key: "id", Value: "dialogue-handler"}}
	ctx.Set("username", "alice")
	NewHandler().AnswerCheck(ctx)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Code int `json:"code"`
		Data struct {
			SchemaVersion int                           `json:"schema_version"`
			Messages      []model.ConversationMessageV2 `json:"messages"`
			Executions    []struct {
				Events []json.RawMessage `json:"events"`
			} `json:"executions"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Code != 200 || response.Data.SchemaVersion != 2 || len(response.Data.Messages) != 1 || len(response.Data.Executions) != 1 || response.Data.Messages[0].MessageID != assistantID {
		t.Fatalf("response=%#v body=%s", response, recorder.Body.String())
	}
	if len(response.Data.Executions[0].Events) != 1 {
		t.Fatalf("durable activity missing from history: body=%s", recorder.Body.String())
	}
}

func stringPointer(value string) *string { return &value }
