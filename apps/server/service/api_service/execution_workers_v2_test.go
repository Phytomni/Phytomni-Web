package api_service

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"

	"gorm.io/gorm"
)

func messageContentPayload(messageID, text string, revision, baseOffset, totalLength, chunkIndex, chunkCount int64, digest string) map[string]any {
	return map[string]any{
		"message_id":        messageID,
		"source_message_id": messageID,
		"text":              text,
		"output_revision":   float64(revision),
		"base_offset":       float64(baseOffset),
		"offset":            float64(baseOffset + int64(len([]rune(text)))),
		"total_length":      float64(totalLength),
		"chunk_index":       float64(chunkIndex),
		"chunk_count":       float64(chunkCount),
		"content_sha256":    digest,
	}
}

func TestReconstructProjectedMessageRejectsSourceIdentityDrift(t *testing.T) {
	payload := messageContentPayload("msg-assistant", "answer", 1, 0, 6, 0, 1, fmt.Sprintf("%x", sha256.Sum256([]byte("answer"))))
	payload["source_message_id"] = "msg-other"
	_, err := reconstructProjectedMessage([]rxBot.ExecutionEventV2{{
		SchemaVersion: 2, ExecutionID: "turn-identity", EventID: "event-message", Seq: 1,
		Type: "message.completed", Status: "succeeded", Source: "message", PublicPayload: payload,
	}}, "turn-identity", "msg-assistant")
	if err == nil {
		t.Fatal("source message identity drift was accepted")
	}
}

func TestReconstructProjectedMessageMapsTheBoundedLegacyDerivedIdentity(t *testing.T) {
	executionID := "turn-legacy-message-identity"
	expectedMessageID := "msg-web-assistant"
	legacyMessageID := legacyDerivedAssistantMessageID(executionID)
	text := "answer"
	digest := fmt.Sprintf("%x", sha256.Sum256([]byte(text)))
	payload := messageContentPayload(legacyMessageID, text, 1, 0, int64(len(text)), 0, 1, digest)

	content, err := reconstructProjectedMessage([]rxBot.ExecutionEventV2{{
		SchemaVersion: 2, ExecutionID: executionID, EventID: "event-message", Seq: 1,
		Type: "message.completed", Status: "succeeded", Source: "message", PublicPayload: payload,
	}}, executionID, expectedMessageID)
	if err != nil {
		t.Fatal(err)
	}
	if content == nil || content.MessageID != expectedMessageID || content.Text != text || !content.Complete {
		t.Fatalf("unexpected projected content: %#v", content)
	}
}

type fakeExecutionRuntimeV2 struct {
	admission     *rxBot.ExecutionAdmissionResponseV2
	admitErr      error
	page          *rxBot.ExecutionEventPageV2
	snapshot      *rxBot.ExecutionProjectionV2
	pageErr       error
	admitCall     int
	settleErr     error
	settled       []rxBot.ContextSettlementRequest
	settleObserve func()
	target        *rxBot.ExecutionTargetResolutionV2
	trace         *rxBot.ExecutionTraceResolutionV1
	traceErr      error
	operation     *rxBot.ExecutionOperationRecordV2
	targetBody    string
	targetMeta    rxBot.ExecutionTargetContentMetadataV2
}

func (f *fakeExecutionRuntimeV2) AdmitExecutionV2(context.Context, rxBot.ExecutionAdmissionRequestV2) (*rxBot.ExecutionAdmissionResponseV2, rxBot.ResponseMeta, error) {
	f.admitCall++
	return f.admission, rxBot.ResponseMeta{}, f.admitErr
}
func (f *fakeExecutionRuntimeV2) GetExecutionSnapshotV2(context.Context, string, string) (*rxBot.ExecutionProjectionV2, rxBot.ResponseMeta, error) {
	return f.snapshot, rxBot.ResponseMeta{}, f.pageErr
}
func (f *fakeExecutionRuntimeV2) GetExecutionEventsV2(context.Context, string, string, int64, int) (*rxBot.ExecutionEventPageV2, rxBot.ResponseMeta, error) {
	return f.page, rxBot.ResponseMeta{}, f.pageErr
}
func (*fakeExecutionRuntimeV2) GetExecutionEventV2(context.Context, string, string, string) (*rxBot.ExecutionEventV2, rxBot.ResponseMeta, error) {
	return nil, rxBot.ResponseMeta{}, errors.New("not implemented")
}

func (f *fakeExecutionRuntimeV2) GetExecutionOperationV2(context.Context, string, string, string) (*rxBot.ExecutionOperationRecordV2, rxBot.ResponseMeta, error) {
	if f.operation == nil {
		return nil, rxBot.ResponseMeta{}, errors.New("not implemented")
	}
	return f.operation, rxBot.ResponseMeta{}, nil
}
func (f *fakeExecutionRuntimeV2) ResolveExecutionTargetV2(context.Context, string, string, string, string) (*rxBot.ExecutionTargetResolutionV2, rxBot.ResponseMeta, error) {
	if f.target == nil {
		return nil, rxBot.ResponseMeta{}, errors.New("not implemented")
	}
	return f.target, rxBot.ResponseMeta{}, nil
}
func (f *fakeExecutionRuntimeV2) ResolveExecutionTraceV1(context.Context, string, string, string, int64, int) (*rxBot.ExecutionTraceResolutionV1, rxBot.ResponseMeta, error) {
	if f.traceErr != nil {
		return nil, rxBot.ResponseMeta{}, f.traceErr
	}
	if f.trace == nil {
		return nil, rxBot.ResponseMeta{}, errors.New("not implemented")
	}
	return f.trace, rxBot.ResponseMeta{}, nil
}
func (f *fakeExecutionRuntimeV2) OpenExecutionTargetContentV2(context.Context, string, string, string, string) (io.ReadCloser, rxBot.ExecutionTargetContentMetadataV2, rxBot.ResponseMeta, error) {
	if f.targetBody == "" {
		return nil, rxBot.ExecutionTargetContentMetadataV2{}, rxBot.ResponseMeta{}, errors.New("not implemented")
	}
	return io.NopCloser(strings.NewReader(f.targetBody)), f.targetMeta, rxBot.ResponseMeta{}, nil
}
func (*fakeExecutionRuntimeV2) PostExecutionActionV2(context.Context, string, string, rxBot.ExecutionActionRequestV2) (*rxBot.ExecutionOperationResponseV2, rxBot.ResponseMeta, error) {
	return nil, rxBot.ResponseMeta{}, errors.New("not implemented")
}
func (*fakeExecutionRuntimeV2) CancelExecutionV2(context.Context, string, string, rxBot.ExecutionCancelRequestV2) (*rxBot.ExecutionOperationResponseV2, rxBot.ResponseMeta, error) {
	return nil, rxBot.ResponseMeta{}, errors.New("not implemented")
}
func (*fakeExecutionRuntimeV2) OpenExecutionStreamV2(context.Context, string, string, int64, int64, int64) (io.ReadCloser, rxBot.ResponseMeta, error) {
	return nil, rxBot.ResponseMeta{}, errors.New("not implemented")
}
func (f *fakeExecutionRuntimeV2) SettleConversationContext(_ context.Context, request rxBot.ContextSettlementRequest) (*rxBot.ContextMutationResponse, error) {
	if f.settleObserve != nil {
		f.settleObserve()
	}
	f.settled = append(f.settled, request)
	return &rxBot.ContextMutationResponse{SchemaVersion: 1, State: "committed", ContextVersion: 1}, f.settleErr
}

func admittedExecutionForWorker(t *testing.T, executionID string) (*Service, *fakeExecutionRuntimeV2, int64) {
	t.Helper()
	setupExecutionRuntimeV2DB(t)
	ctx := context.Background()
	in := QueryInput{Query: "hello", Mode: "instant", Tool: "ChatAgent", ClientTurnID: executionID, Locale: "en-US"}
	target := v1SubmissionTarget{dialogueID: "dialogue-worker", mode: "instant", operation: "append"}
	result, err := NewService().admitExecutionCommand(ctx, "alice", in, target, AgentPermissionResolution{AllowedTools: []string{"ChatAgent"}}, false, "chat")
	if err != nil {
		t.Fatal(err)
	}
	if err := model.DB(ctx).Model(&model.QuestionAgentExecutionOutbox{}).
		Where("execution_id = ?", executionID).
		Update("next_attempt_at", time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)).Error; err != nil {
		t.Fatal(err)
	}
	var persisted model.QuestionAgentExecutionOutbox
	if err := model.DB(ctx).Where("execution_id = ?", executionID).Take(&persisted).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.State != "pending" {
		t.Fatalf("unexpected admitted outbox: %#v", persisted)
	}
	var due int64
	if err := model.DB(ctx).Model(&model.QuestionAgentExecutionOutbox{}).
		Where("state IN ? AND next_attempt_at <= ?", []string{"pending", "retry"}, time.Now().UTC()).
		Count(&due).Error; err != nil || due != 1 {
		t.Fatalf("outbox is not due: row=%#v due=%d err=%v", persisted, due, err)
	}
	fake := &fakeExecutionRuntimeV2{admission: &rxBot.ExecutionAdmissionResponseV2{
		SchemaVersion: 2, ExecutionID: executionID, RunID: "run-worker", AgentSlug: "chat",
		Status: "queued", SupervisorRevision: 1,
	}}
	return &Service{runtimeClient: fake}, fake, result.turn.ID
}

func TestExecutionDispatcherAcknowledgesOnceAndBindsRun(t *testing.T) {
	service, fake, turnID := admittedExecutionForWorker(t, "turn-worker-ack")
	stats, err := service.DispatchExecutionOutboxOnce(context.Background(), "worker-1")
	if err != nil || stats.Acknowledged != 1 || fake.admitCall != 1 {
		t.Fatalf("stats=%#v calls=%d err=%v", stats, fake.admitCall, err)
	}
	var admission model.QuestionAgentExecutionAdmission
	if err := model.DB(context.Background()).Where("turn_id = ?", turnID).Take(&admission).Error; err != nil {
		t.Fatal(err)
	}
	if admission.BotRunID == nil || *admission.BotRunID != "run-worker" || admission.DispatchRevision != 1 {
		t.Fatalf("admission=%#v", admission)
	}
	stats, err = service.DispatchExecutionOutboxOnce(context.Background(), "worker-2")
	if err != nil || stats.Claimed != 0 || fake.admitCall != 1 {
		t.Fatalf("duplicate stats=%#v calls=%d err=%v", stats, fake.admitCall, err)
	}
}

func TestExecutionDispatcherRetriesTransientFailureWithoutPrivateText(t *testing.T) {
	service, fake, _ := admittedExecutionForWorker(t, "turn-worker-retry")
	fake.admitErr = context.DeadlineExceeded
	stats, err := service.DispatchExecutionOutboxOnce(context.Background(), "worker-1")
	if err != nil || stats.Retried != 1 {
		t.Fatalf("stats=%#v err=%v", stats, err)
	}
	var row model.QuestionAgentExecutionOutbox
	if err := model.DB(context.Background()).Where("execution_id = ?", "turn-worker-retry").Take(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.State != "retry" || row.LastErrorCode == nil || row.LastErrorMessage != nil || !row.NextAttemptAt.After(time.Now().UTC()) {
		t.Fatalf("outbox=%#v", row)
	}
	if row.Classification == nil || *row.Classification != "retry" ||
		row.BoundaryState == nil || *row.BoundaryState != "entered" ||
		row.FirstErrorCode == nil || *row.FirstErrorCode != "transport_timeout" {
		t.Fatalf("dispatch classification was not persisted: %#v", row)
	}
}

func TestExecutionDispatcherLostAcknowledgementRemainsReconcilableAndProjectsLateSuccess(t *testing.T) {
	service, fake, _ := admittedExecutionForWorker(t, "turn-worker-lost-ack")
	ctx := context.Background()
	if err := model.DB(ctx).Model(&model.QuestionAgentExecutionOutbox{}).
		Where("execution_id = ?", "turn-worker-lost-ack").
		Updates(map[string]any{
			"attempts":        executionDispatchMaxAttempts - 1,
			"next_attempt_at": time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC),
		}).Error; err != nil {
		t.Fatal(err)
	}
	var admitted model.QuestionAgentExecutionAdmission
	if err := model.DB(ctx).Where("execution_id = ?", "turn-worker-lost-ack").Take(&admitted).Error; err != nil {
		t.Fatal(err)
	}
	if admitted.AssistantMessageID == nil {
		t.Fatalf("missing assistant message identity: %#v", admitted)
	}

	fake.admitErr = context.DeadlineExceeded
	answer := "late authoritative answer"
	digest := fmt.Sprintf("%x", sha256.Sum256([]byte(answer)))
	messageID := *admitted.AssistantMessageID
	fake.page = &rxBot.ExecutionEventPageV2{
		SchemaVersion: 2,
		ExecutionID:   admitted.ExecutionID,
		NextAfterSeq:  2,
		Items: []rxBot.ExecutionEventV2{
			{
				SchemaVersion: 2, ExecutionID: admitted.ExecutionID,
				EventID: "event-message", Seq: 1, Type: "message.completed",
				Status: "succeeded", OccurredAt: time.Now().UTC().Format(time.RFC3339Nano),
				Source: "message", SpanID: "root", Attempt: 1,
				PublicPayload: messageContentPayload(
					messageID, answer, 1, 0, int64(len([]rune(answer))), 0, 1, digest,
				),
			},
			{
				SchemaVersion: 2, ExecutionID: admitted.ExecutionID,
				EventID: "event-terminal", Seq: 2, Type: "execution.succeeded",
				Status: "succeeded", OccurredAt: time.Now().UTC().Format(time.RFC3339Nano),
				Source: "runtime", SpanID: "root", Attempt: 1,
				PublicPayload: map[string]any{},
			},
		},
	}
	fake.snapshot = &rxBot.ExecutionProjectionV2{
		SchemaVersion: 2, ExecutionID: admitted.ExecutionID, RunID: "run-lost-ack", Status: "succeeded",
		LatestSeq: 2, OutputRevision: 1, OutputOffset: int64(len([]rune(answer))),
		TrackingHealth: "healthy",
		Terminal: &rxBot.ExecutionTerminalV2{
			Status: "succeeded", EventID: "event-terminal", ResultRevision: 1,
		},
	}

	if _, err := service.DispatchExecutionOutboxOnce(ctx, "worker-lost-ack"); err != nil {
		t.Fatal(err)
	}
	var outbox model.QuestionAgentExecutionOutbox
	if err := model.DB(ctx).Where("execution_id = ?", admitted.ExecutionID).Take(&outbox).Error; err != nil {
		t.Fatal(err)
	}
	if outbox.State != "reconcile" {
		t.Fatalf("ambiguous delivery became %q, want reconcile", outbox.State)
	}
	if err := model.DB(ctx).Where("execution_id = ?", admitted.ExecutionID).Take(&admitted).Error; err != nil {
		t.Fatal(err)
	}
	if admitted.TerminalStatus != nil || admitted.BotRunID != nil {
		t.Fatalf("ambiguous delivery terminalized or fabricated correlation: %#v", admitted)
	}

	stats, err := service.ProjectExecutionsOnce(ctx)
	if err != nil || stats.Projected != 1 {
		t.Fatalf("late authoritative projection stats=%#v err=%v", stats, err)
	}
	var message model.ConversationMessageV2
	if err := model.DB(ctx).
		Where("execution_id = ? AND message_type = ?", admitted.ExecutionID, "assistant").
		Take(&message).Error; err != nil {
		t.Fatal(err)
	}
	if message.Status != "succeeded" || message.Content != answer {
		t.Fatalf("late authoritative result was not projected: %#v", message)
	}
	if err := model.DB(ctx).Where("execution_id = ?", admitted.ExecutionID).Take(&admitted).Error; err != nil {
		t.Fatal(err)
	}
	if admitted.BotRunID == nil || *admitted.BotRunID != "run-lost-ack" {
		t.Fatalf("late projection did not bind Bot correlation: %#v", admitted)
	}
}

func TestExecutionDispatcherRejectsDefiniteSemanticFailure(t *testing.T) {
	service, fake, _ := admittedExecutionForWorker(t, "turn-worker-reject")
	fake.admitErr = &rxBot.APIError{Status: 422, Code: "agent_business_validation_failed", Retryable: false}
	stats, err := service.DispatchExecutionOutboxOnce(context.Background(), "worker-reject")
	if err != nil || stats.Rejected != 1 {
		t.Fatalf("stats=%#v err=%v", stats, err)
	}
	var row model.QuestionAgentExecutionOutbox
	if err := model.DB(context.Background()).Where("execution_id = ?", "turn-worker-reject").Take(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.State != "rejected" || row.Classification == nil || *row.Classification != "reject" ||
		row.FirstErrorCode == nil || *row.FirstErrorCode != "agent_business_validation_failed" {
		t.Fatalf("outbox=%#v", row)
	}
}

func TestExecutionDispatcherUnknownPostBoundaryFailureReconciles(t *testing.T) {
	service, fake, _ := admittedExecutionForWorker(t, "turn-worker-unknown")
	fake.admitErr = errors.New("private unknown response failure")
	stats, err := service.DispatchExecutionOutboxOnce(context.Background(), "worker-unknown")
	if err != nil || stats.Reconciled != 1 {
		t.Fatalf("stats=%#v err=%v", stats, err)
	}
	var admission model.QuestionAgentExecutionAdmission
	if err := model.DB(context.Background()).Where("execution_id = ?", "turn-worker-unknown").Take(&admission).Error; err != nil {
		t.Fatal(err)
	}
	if admission.TerminalStatus != nil || admission.Status == "failed" {
		t.Fatalf("unknown delivery was terminalized: %#v", admission)
	}
}

func TestExecutionReconcilerBotNotFoundRemainsNonTerminal(t *testing.T) {
	service, fake, _ := admittedExecutionForWorker(t, "turn-worker-not-found")
	ctx := context.Background()
	if err := model.DB(ctx).Model(&model.QuestionAgentExecutionOutbox{}).
		Where("execution_id = ?", "turn-worker-not-found").
		Updates(map[string]any{
			"state": "reconcile", "classification": "reconcile",
			"boundary_state": "entered", "next_reconcile_at": time.Now().UTC(),
		}).Error; err != nil {
		t.Fatal(err)
	}
	fake.pageErr = &rxBot.APIError{Status: 404, Code: "execution_not_found", Retryable: false}
	stats, err := service.ProjectExecutionsOnce(ctx)
	if err == nil || stats.Claimed != 1 || stats.Projected != 0 {
		t.Fatalf("stats=%#v err=%v", stats, err)
	}
	var admission model.QuestionAgentExecutionAdmission
	if err := model.DB(ctx).Where("execution_id = ?", "turn-worker-not-found").Take(&admission).Error; err != nil {
		t.Fatal(err)
	}
	if admission.TerminalStatus != nil || admission.BotRunID != nil || admission.TrackingHealth != "degraded" {
		t.Fatalf("Bot-not-found was treated as terminal: %#v", admission)
	}
}

func TestExecutionReconcilerBindsLateRunningAdmission(t *testing.T) {
	service, fake, _ := admittedExecutionForWorker(t, "turn-worker-late-running")
	ctx := context.Background()
	if err := model.DB(ctx).Model(&model.QuestionAgentExecutionOutbox{}).
		Where("execution_id = ?", "turn-worker-late-running").
		Updates(map[string]any{
			"state": "reconcile", "classification": "reconcile",
			"boundary_state": "entered", "next_reconcile_at": time.Now().UTC(),
		}).Error; err != nil {
		t.Fatal(err)
	}
	fake.page = &rxBot.ExecutionEventPageV2{
		SchemaVersion: 2, ExecutionID: "turn-worker-late-running", NextAfterSeq: 0,
	}
	fake.snapshot = &rxBot.ExecutionProjectionV2{
		SchemaVersion: 2, ExecutionID: "turn-worker-late-running",
		RunID: "run-late-running", Status: "running", TrackingHealth: "healthy",
	}
	stats, err := service.ProjectExecutionsOnce(ctx)
	if err != nil || stats.Projected != 1 {
		t.Fatalf("stats=%#v err=%v", stats, err)
	}
	var admission model.QuestionAgentExecutionAdmission
	if err := model.DB(ctx).Where("execution_id = ?", "turn-worker-late-running").Take(&admission).Error; err != nil {
		t.Fatal(err)
	}
	var outbox model.QuestionAgentExecutionOutbox
	if err := model.DB(ctx).Where("execution_id = ?", "turn-worker-late-running").Take(&outbox).Error; err != nil {
		t.Fatal(err)
	}
	if admission.BotRunID == nil || *admission.BotRunID != "run-late-running" ||
		admission.Status != "running" || admission.TerminalStatus != nil ||
		outbox.State != "acknowledged" {
		t.Fatalf("admission=%#v outbox=%#v", admission, outbox)
	}
}

func TestExecutionProjectorPersistsTerminalMessageAndDoesNotReclaim(t *testing.T) {
	service, fake, _ := admittedExecutionForWorker(t, "turn-worker-project")
	if _, err := service.DispatchExecutionOutboxOnce(context.Background(), "dispatcher"); err != nil {
		t.Fatal(err)
	}
	fake.page = &rxBot.ExecutionEventPageV2{SchemaVersion: 2, ExecutionID: "turn-worker-project", NextAfterSeq: 2, Items: []rxBot.ExecutionEventV2{
		{SchemaVersion: 2, ExecutionID: "turn-worker-project", EventID: "event-1", Seq: 1, Type: "message.completed", Status: "succeeded", OccurredAt: time.Now().UTC().Format(time.RFC3339Nano), Source: "message", SpanID: "root", Attempt: 1, PublicPayload: map[string]any{"text": "durable answer", "output_revision": float64(1), "offset": float64(14)}},
		{SchemaVersion: 2, ExecutionID: "turn-worker-project", EventID: "event-2", Seq: 2, Type: "execution.succeeded", Status: "succeeded", OccurredAt: time.Now().UTC().Format(time.RFC3339Nano), Source: "runtime", SpanID: "root", Attempt: 1, PublicPayload: map[string]any{}},
	}}
	fake.snapshot = &rxBot.ExecutionProjectionV2{SchemaVersion: 2, ExecutionID: "turn-worker-project", Status: "succeeded", LatestSeq: 2, OutputRevision: 1, OutputOffset: 14, OperationRevision: 2, TrackingHealth: "healthy", Terminal: &rxBot.ExecutionTerminalV2{Status: "succeeded", EventID: "event-2", ResultRevision: 1}}
	stats, err := service.ProjectExecutionsOnce(context.Background())
	if err != nil || stats.Projected != 1 || stats.Claimed != 1 {
		t.Fatalf("stats=%#v err=%v", stats, err)
	}
	var message model.ConversationMessageV2
	if err := model.DB(context.Background()).Where("execution_id = ? AND message_type = ?", "turn-worker-project", "assistant").Take(&message).Error; err != nil {
		t.Fatal(err)
	}
	if message.Status != "succeeded" || message.Content != "durable answer" {
		t.Fatalf("message=%#v", message)
	}
	var projectedAdmission model.QuestionAgentExecutionAdmission
	if err := model.DB(context.Background()).Where("execution_id = ?", "turn-worker-project").Take(&projectedAdmission).Error; err != nil {
		t.Fatal(err)
	}
	if projectedAdmission.DispatchRevision != fake.snapshot.OperationRevision {
		t.Fatalf("dispatch revision=%d, want current Bot operation revision %d", projectedAdmission.DispatchRevision, fake.snapshot.OperationRevision)
	}
	stats, err = service.ProjectExecutionsOnce(context.Background())
	if err != nil || stats.Claimed != 0 {
		t.Fatalf("terminal reclaimed stats=%#v err=%v", stats, err)
	}
}

func TestExecutionProjectorReconstructsAssistantAcrossPagesWithoutCreatingAnotherMessage(t *testing.T) {
	service, fake, _ := admittedExecutionForWorker(t, "turn-worker-chunks")
	ctx := context.Background()
	if _, err := service.DispatchExecutionOutboxOnce(ctx, "dispatcher"); err != nil {
		t.Fatal(err)
	}
	var admission model.QuestionAgentExecutionAdmission
	if err := model.DB(ctx).Where("execution_id = ?", "turn-worker-chunks").Take(&admission).Error; err != nil {
		t.Fatal(err)
	}
	if admission.AssistantMessageID == nil || *admission.AssistantMessageID == "" {
		t.Fatalf("missing assistant identity: %#v", admission)
	}

	firstChunk := strings.Repeat("a", 8192)
	lastChunk := "最终答案"
	answer := firstChunk + lastChunk
	digest := fmt.Sprintf("%x", sha256.Sum256([]byte(answer)))
	totalLength := int64(len([]rune(answer)))
	messageID := *admission.AssistantMessageID
	fake.page = &rxBot.ExecutionEventPageV2{SchemaVersion: 2, ExecutionID: admission.ExecutionID, NextAfterSeq: 1, Items: []rxBot.ExecutionEventV2{
		{SchemaVersion: 2, ExecutionID: admission.ExecutionID, EventID: "event-chunk-1", Seq: 1, Type: "message.snapshot", Status: "running", OccurredAt: time.Now().UTC().Format(time.RFC3339Nano), Source: "message", SpanID: "root", Attempt: 1, PublicPayload: messageContentPayload(messageID, firstChunk, 1, 0, totalLength, 0, 2, digest)},
	}}
	fake.snapshot = &rxBot.ExecutionProjectionV2{SchemaVersion: 2, ExecutionID: admission.ExecutionID, Status: "running", LatestSeq: 1, OutputRevision: 1, OutputOffset: int64(len([]rune(firstChunk))), TrackingHealth: "healthy"}
	stats, err := service.ProjectExecutionsOnce(ctx)
	if err != nil || stats.Projected != 1 {
		t.Fatalf("first projection stats=%#v err=%v", stats, err)
	}
	var partial model.ConversationMessageV2
	if err := model.DB(ctx).Where("message_id = ?", messageID).Take(&partial).Error; err != nil {
		t.Fatal(err)
	}
	if partial.Content != firstChunk || partial.ContentRevision != 1 || partial.ContentOffset != int64(len([]rune(firstChunk))) || partial.Status != "running" {
		t.Fatalf("partial assistant=%#v", partial)
	}

	if err := model.DB(ctx).Model(&model.QuestionAgentExecutionAdmission{}).
		Where("execution_id = ?", admission.ExecutionID).
		Update("next_projection_at", time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)).Error; err != nil {
		t.Fatal(err)
	}
	fake.page = &rxBot.ExecutionEventPageV2{SchemaVersion: 2, ExecutionID: admission.ExecutionID, NextAfterSeq: 3, Items: []rxBot.ExecutionEventV2{
		{SchemaVersion: 2, ExecutionID: admission.ExecutionID, EventID: "event-chunk-2", Seq: 2, Type: "message.completed", Status: "succeeded", OccurredAt: time.Now().UTC().Format(time.RFC3339Nano), Source: "message", SpanID: "root", Attempt: 1, PublicPayload: func() map[string]any {
			payload := messageContentPayload(messageID, lastChunk, 1, int64(len([]rune(firstChunk))), totalLength, 1, 2, digest)
			payload["references"] = []any{map[string]any{"title": "Drought epigenetics", "di": "10.1000/safe-doi", "pm": "12345"}}
			return payload
		}()},
		{SchemaVersion: 2, ExecutionID: admission.ExecutionID, EventID: "event-terminal", Seq: 3, Type: "execution.succeeded", Status: "succeeded", OccurredAt: time.Now().UTC().Format(time.RFC3339Nano), Source: "runtime", SpanID: "root", Attempt: 1, PublicPayload: map[string]any{}},
	}}
	fake.snapshot = &rxBot.ExecutionProjectionV2{SchemaVersion: 2, ExecutionID: admission.ExecutionID, Status: "succeeded", LatestSeq: 3, OutputRevision: 1, OutputOffset: totalLength, TrackingHealth: "healthy", Terminal: &rxBot.ExecutionTerminalV2{Status: "succeeded", EventID: "event-terminal", ResultRevision: 1}}
	stats, err = service.ProjectExecutionsOnce(ctx)
	if err != nil || stats.Projected != 1 {
		t.Fatalf("terminal projection stats=%#v err=%v", stats, err)
	}
	var completed model.ConversationMessageV2
	if err := model.DB(ctx).Where("message_id = ?", messageID).Take(&completed).Error; err != nil {
		t.Fatal(err)
	}
	if completed.Content != answer || completed.ContentOffset != totalLength || completed.ContentLength != totalLength || completed.ContentSHA256 != digest || completed.Status != "succeeded" {
		t.Fatalf("completed assistant=%#v", completed)
	}
	if len(completed.References) != 1 || completed.References[0].Title != "Drought epigenetics" || completed.References[0].DOI != "10.1000/safe-doi" {
		t.Fatalf("completed assistant references=%#v", completed.References)
	}
	var canonicalMessageCount int64
	if err := model.DB(ctx).Model(&model.ConversationMessageV2{}).Where("execution_id = ? AND message_type IN ?", admission.ExecutionID, []string{"user", "assistant"}).Count(&canonicalMessageCount).Error; err != nil {
		t.Fatal(err)
	}
	if canonicalMessageCount != 2 {
		t.Fatalf("projection created duplicate canonical message items: %d", canonicalMessageCount)
	}
	var activity model.ConversationMessageV2
	if err := model.DB(ctx).Where("execution_id = ? AND source_event_id = ?", admission.ExecutionID, "event-terminal").Take(&activity).Error; err != nil {
		t.Fatalf("terminal activity fact not materialized: %v", err)
	}
	if activity.MessageType != "activity" || activity.Visibility != "collapsed" || activity.ParentMessageID == nil || *activity.ParentMessageID != messageID {
		t.Fatalf("activity timeline item=%#v", activity)
	}

	// History hydration is database-only: once the projector commits, a Bot
	// outage must not erase the ordered messages or the last verified cursor.
	fake.pageErr = errors.New("bot unavailable")
	history, err := service.ConversationHistoryV2(ctx, admission.UserName, *admission.DialogueID)
	if err != nil {
		t.Fatal(err)
	}
	if history.SchemaVersion != 2 || len(history.Messages) != 3 || len(history.Executions) != 1 {
		t.Fatalf("history envelope=%#v", history)
	}
	if history.Messages[1].MessageID != messageID || history.Messages[1].Content != answer || len(history.Messages[1].References) != 1 {
		t.Fatalf("history assistant=%#v", history.Messages[1])
	}
	if history.Executions[0].ExecutionID != admission.ExecutionID || history.Executions[0].EventCursor != 3 || history.Executions[0].Projection == nil {
		t.Fatalf("history execution=%#v", history.Executions[0])
	}
	if len(history.Executions[0].Events) != 3 {
		t.Fatalf("history did not retain execution facts: %#v", history.Executions[0].Events)
	}
}

func TestExecutionProjectionLeaseHasSingleClaimant(t *testing.T) {
	service, _, _ := admittedExecutionForWorker(t, "turn-worker-lease")
	if _, err := service.DispatchExecutionOutboxOnce(context.Background(), "dispatcher"); err != nil {
		t.Fatal(err)
	}
	first, err := service.claimProjectionAdmission(context.Background(), "projector-1")
	if err != nil || first == nil {
		t.Fatalf("first=%#v err=%v", first, err)
	}
	if second, err := service.claimProjectionAdmission(context.Background(), "projector-2"); !errors.Is(err, gorm.ErrRecordNotFound) || second != nil {
		t.Fatalf("second=%#v err=%v", second, err)
	}
}

func TestExecutionProjectorCommitsMessageBeforeContextAcknowledgment(t *testing.T) {
	service, fake, _ := admittedExecutionForWorker(t, "turn-worker-context")
	ctx := context.Background()
	var outbox model.QuestionAgentExecutionOutbox
	if err := model.DB(ctx).Where("execution_id = ?", "turn-worker-context").Take(&outbox).Error; err != nil {
		t.Fatal(err)
	}
	var command canonicalMessageExecutionCommand
	if err := json.Unmarshal([]byte(outbox.CommandJSON), &command); err != nil {
		t.Fatal(err)
	}
	if command.ExecutionID == "" {
		t.Fatalf("empty decoded command raw=%q outbox=%#v", outbox.CommandJSON, outbox)
	}
	command.Conversation = &rxBot.ConversationEnvelopeV1{
		SchemaVersion: 1, ConversationKey: "11111111-1111-4111-8111-111111111111", DialogueID: "11111111-1111-4111-8111-111111111111",
		TurnID: "1", RequestID: "request-context", Operation: "append", Mode: "expert",
		CurrentMessage:  rxBot.CurrentMessageV1{Content: "hello", Locale: "en-US"},
		AllowedAgentIDs: []string{"ChatAgent"}, LedgerVersion: strings.Repeat("a", 64),
	}
	encoded, marshalErr := json.Marshal(command)
	if marshalErr != nil {
		t.Fatal(marshalErr)
	}
	if err := model.DB(ctx).Exec(
		"UPDATE question_agent_execution_outbox SET command_json = ? WHERE execution_id = ?",
		string(encoded), command.ExecutionID,
	).Error; err != nil {
		t.Fatal(err)
	}
	var persistedCommand string
	if err := model.DB(ctx).Raw(
		"SELECT command_json FROM question_agent_execution_outbox WHERE execution_id = ?", command.ExecutionID,
	).Row().Scan(&persistedCommand); err != nil {
		t.Fatal(err)
	}
	var roundTrip canonicalMessageExecutionCommand
	if err := json.Unmarshal([]byte(persistedCommand), &roundTrip); err != nil || roundTrip.ExecutionID != command.ExecutionID || roundTrip.OwnerRef != command.OwnerRef {
		t.Fatalf("persisted command invalid raw=%q value=%#v err=%v", persistedCommand, roundTrip, err)
	}
	dispatchStats, err := service.DispatchExecutionOutboxOnce(ctx, "dispatcher-context")
	if err != nil || dispatchStats.Acknowledged != 1 {
		var failed model.QuestionAgentExecutionOutbox
		lookupErr := model.DB(ctx).Where("execution_id = ?", command.ExecutionID).Take(&failed).Error
		code := ""
		if failed.LastErrorCode != nil {
			code = *failed.LastErrorCode
		}
		t.Fatalf("dispatch stats=%#v code=%q lookup=%v outbox=%#v err=%v", dispatchStats, code, lookupErr, failed, err)
	}
	if err := model.DB(ctx).Model(&model.QuestionAgentExecutionAdmission{}).
		Where("execution_id = ?", command.ExecutionID).
		Update("next_projection_at", time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)).Error; err != nil {
		t.Fatal(err)
	}
	fake.page = &rxBot.ExecutionEventPageV2{SchemaVersion: 2, ExecutionID: command.ExecutionID, NextAfterSeq: 1, Items: []rxBot.ExecutionEventV2{
		{SchemaVersion: 2, ExecutionID: command.ExecutionID, EventID: "event-context", Seq: 1, Type: "message.completed", Status: "succeeded", OccurredAt: time.Now().UTC().Format(time.RFC3339Nano), Source: "message", SpanID: "root", Attempt: 1, PublicPayload: map[string]any{"text": "context answer", "output_revision": float64(1), "offset": float64(14)}},
	}}
	fake.snapshot = &rxBot.ExecutionProjectionV2{
		SchemaVersion: 2, ExecutionID: command.ExecutionID, Status: "succeeded", LatestSeq: 1,
		OutputRevision: 1, OutputOffset: 14, TrackingHealth: "healthy",
		ContextStage: &rxBot.ExecutionContextStageV2{SchemaVersion: 1, TurnID: "1", SelectedAgentID: "ChatAgent", RouteSource: "router", RouteReasonCode: "ROUTER_SELECTED", ProposedBusinessContextVersion: 1},
		Terminal:     &rxBot.ExecutionTerminalV2{Status: "succeeded", EventID: "event-context", ResultRevision: 1},
	}
	fake.settleObserve = func() {
		var message model.ConversationMessageV2
		if err := model.DB(ctx).Where("execution_id = ? AND message_type = ?", command.ExecutionID, "assistant").Take(&message).Error; err != nil || message.Content != "context answer" {
			t.Fatalf("context acknowledged before message commit: message=%#v err=%v", message, err)
		}
	}
	fake.settleErr = errors.New("context ack unavailable")
	stats, err := service.ProjectExecutionsOnce(ctx)
	if err == nil || stats.Projected != 0 || len(fake.settled) != 1 {
		t.Fatalf("failed ack stats=%#v settled=%#v err=%v", stats, fake.settled, err)
	}
	var pending model.QuestionAgentExecutionAdmission
	if err := model.DB(ctx).Where("execution_id = ?", command.ExecutionID).Take(&pending).Error; err != nil {
		t.Fatal(err)
	}
	if pending.ContextRevision != 0 || pending.TerminalStatus != nil {
		t.Fatalf("failed ack prematurely settled admission=%#v", pending)
	}
	fake.settleErr = nil
	if err := model.DB(ctx).Model(&model.QuestionAgentExecutionAdmission{}).
		Where("execution_id = ?", command.ExecutionID).
		Update("next_projection_at", time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)).Error; err != nil {
		t.Fatal(err)
	}
	stats, err = service.ProjectExecutionsOnce(ctx)
	if err != nil || stats.Projected != 1 || len(fake.settled) != 2 {
		t.Fatalf("stats=%#v settled=%#v err=%v", stats, fake.settled, err)
	}
	var admission model.QuestionAgentExecutionAdmission
	if err := model.DB(ctx).Where("execution_id = ?", command.ExecutionID).Take(&admission).Error; err != nil {
		t.Fatal(err)
	}
	if admission.ContextRevision != 1 || admission.TerminalStatus == nil || *admission.TerminalStatus != "succeeded" {
		t.Fatalf("admission=%#v", admission)
	}
	var turn model.ConversationTurnV2
	if err := model.DB(ctx).Where("user_name = ? AND execution_id = ?", "alice", command.ExecutionID).Take(&turn).Error; err != nil {
		t.Fatal(err)
	}
	private, err := decodeConversationTurnContext(turn.ContextJSON)
	if err != nil || private == nil || private.Stage == nil {
		t.Fatalf("persisted context=%#v err=%v", private, err)
	}
	if private.SettlementState != conversationSettlementAcked || private.ModeLockState != "locked" || private.Stage.ProposedBusinessContextVersion != 1 || private.Stage.SelectedAgentID != "ChatAgent" {
		t.Fatalf("persisted context=%#v", private)
	}
}
