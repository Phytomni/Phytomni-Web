package api_service

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

func TestExecutionTargetV2UsesExecutionOwnedDeliveryWithoutLegacyMessage(t *testing.T) {
	setupExecutionRuntimeV2DB(t)
	ctx := context.Background()
	dialogueID := "dialogue-target-v2"
	runID := "bot-run-target-v2"
	now := time.Now().UTC()
	if err := model.DB(ctx).Create(&model.QuestionAgentExecutionAdmission{
		UserName: "alice", ExecutionID: "turn-target-v2", RequestFingerprint: strings.Repeat("a", 64),
		FingerprintVersion: 1, DialogueID: &dialogueID, BotRunID: &runID,
		Status: "running", TrackingHealth: "healthy", CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	fake := &fakeExecutionRuntimeV2{
		target: &rxBot.ExecutionTargetResolutionV2{
			SchemaVersion: 2, ExecutionID: "turn-target-v2",
			Target:     rxBot.ExecutionTargetV2{Kind: "artifact", ID: "artifact-report"},
			Resolution: "authorized", DeliveryAvailable: true,
			Name: "report.md", MediaType: "text/markdown", SizeBytes: 12,
		},
		targetBody: "hello report",
		targetMeta: rxBot.ExecutionTargetContentMetadataV2{MediaType: "text/markdown", FileName: "report.md"},
	}
	service := &Service{runtimeClient: fake}

	resolution, err := service.ExecutionTargetResolutionV2(ctx, "alice", "turn-target-v2", "artifact", "artifact-report")
	if err != nil {
		t.Fatal(err)
	}
	if !resolution.PreviewAvailable || resolution.DeliveryURL != "/api/v1/executions/turn-target-v2/targets/artifact/artifact-report/content" || resolution.MessageID != nil || resolution.Name != "report.md" || resolution.MediaType != "text/markdown" || resolution.SizeBytes != 12 {
		t.Fatalf("resolution=%#v", resolution)
	}
	body, metadata, err := service.OpenExecutionTargetContentV2(ctx, "alice", "turn-target-v2", "artifact", "artifact-report")
	if err != nil {
		t.Fatal(err)
	}
	defer body.Close()
	raw, err := io.ReadAll(body)
	if err != nil || string(raw) != "hello report" || metadata.FileName != "report.md" {
		t.Fatalf("raw=%q metadata=%#v err=%v", raw, metadata, err)
	}
	if _, _, err := service.OpenExecutionTargetContentV2(ctx, "other", "turn-target-v2", "artifact", "artifact-report"); !errors.Is(err, ErrExecutionRunOwnership) {
		t.Fatalf("foreign err=%v", err)
	}

	fake.target = &rxBot.ExecutionTargetResolutionV2{
		SchemaVersion: 2, ExecutionID: "turn-target-v2",
		Target:     rxBot.ExecutionTargetV2{Kind: "artifact", ID: "log-redacted"},
		Resolution: "authorized", DeliveryAvailable: true,
	}
	fake.targetBody = `{"schema_version":1,"records":[]}`
	fake.targetMeta = rxBot.ExecutionTargetContentMetadataV2{MediaType: "application/json", FileName: "execution-log.json"}
	logBody, logMetadata, err := service.OpenExecutionTargetContentV2(ctx, "alice", "turn-target-v2", "artifact", "log-redacted")
	if err != nil {
		t.Fatal(err)
	}
	logRaw, readErr := io.ReadAll(logBody)
	logBody.Close()
	if readErr != nil || string(logRaw) != fake.targetBody || logMetadata.FileName != "execution-log.json" {
		t.Fatalf("log raw=%q metadata=%#v err=%v", logRaw, logMetadata, readErr)
	}
	if _, _, err := service.OpenExecutionTargetContentV2(ctx, "other", "turn-target-v2", "artifact", "log-redacted"); !errors.Is(err, ErrExecutionRunOwnership) {
		t.Fatalf("foreign execution log err=%v", err)
	}

	fake.operation = &rxBot.ExecutionOperationRecordV2{
		SchemaVersion: 1, OperationID: "operation-1", WorkUnitID: "work-1",
		OperationKey: "knowledge.search", LabelKey: "execution.operation.knowledge.search",
		FallbackLabel: "Search knowledge", Status: "running",
	}
	operation, err := service.ExecutionOperationDetailV2(ctx, "alice", "turn-target-v2", "operation-1")
	if err != nil || operation.OperationKey != "knowledge.search" {
		t.Fatalf("operation=%#v err=%v", operation, err)
	}
	if _, err := service.ExecutionOperationDetailV2(ctx, "other", "turn-target-v2", "operation-1"); !errors.Is(err, ErrExecutionRunOwnership) {
		t.Fatalf("foreign operation err=%v", err)
	}
}

func setupExecutionRuntimeV2DB(t *testing.T) {
	t.Helper()
	gdb := setupTestDB(t)
	if err := gdb.AutoMigrate(&model.QuestionAgentExecutionAdmission{}); err != nil {
		t.Fatalf("migrate execution admission: %v", err)
	}
	if err := gdb.AutoMigrate(&model.ConversationTurnV2{}, &model.ConversationTurnSequenceV2{}); err != nil {
		t.Fatalf("migrate conversation turns: %v", err)
	}
	if err := gdb.AutoMigrate(&model.ConversationMessageV2{}); err != nil {
		t.Fatalf("migrate conversation timeline: %v", err)
	}
	if err := gdb.AutoMigrate(&model.QuestionAgentExecutionOutbox{}); err != nil {
		t.Fatalf("migrate execution outbox: %v", err)
	}
	if err := gdb.AutoMigrate(&model.QuestionAgentExecutionEventV2{}); err != nil {
		t.Fatalf("migrate execution event cache: %v", err)
	}
}

func TestExecutionAdmissionCreatesDistinctOrderedTimelineItems(t *testing.T) {
	setupExecutionRuntimeV2DB(t)
	service := NewService()
	ctx := context.Background()
	in := QueryInput{Query: "hello", Mode: "instant", Tool: "ChatAgent", ClientTurnID: "turn-timeline", Locale: "en-US"}
	target := v1SubmissionTarget{dialogueID: "dialogue-timeline", mode: "instant", operation: "append"}
	permissions := AgentPermissionResolution{AllowedTools: []string{"ChatAgent"}}

	first, err := service.admitExecutionCommand(ctx, "alice", in, target, permissions, false, "chat")
	if err != nil {
		t.Fatal(err)
	}
	if first.userMessageID == "" || first.assistantMessageID == "" || first.userMessageID == first.assistantMessageID {
		t.Fatalf("timeline identities user=%q assistant=%q", first.userMessageID, first.assistantMessageID)
	}

	var items []model.ConversationMessageV2
	if err := model.DB(ctx).Where("user_name = ? AND dialogue_id = ?", "alice", target.dialogueID).
		Order("message_index ASC").Find(&items).Error; err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("timeline item count=%d items=%#v", len(items), items)
	}
	if items[0].MessageID != first.userMessageID || items[0].Role != "user" ||
		items[0].Content != in.Query || items[0].Status != "completed" ||
		items[0].MessageIndex >= items[1].MessageIndex {
		t.Fatalf("user timeline item=%#v assistant=%#v", items[0], items[1])
	}
	if items[1].MessageID != first.assistantMessageID || items[1].Role != "assistant" ||
		items[1].Content != "" || items[1].Status != "admitted" ||
		items[1].ParentMessageID == nil || *items[1].ParentMessageID != first.userMessageID ||
		items[1].SourceMessageID != first.assistantMessageID {
		t.Fatalf("assistant timeline item=%#v", items[1])
	}
	for _, item := range items {
		if item.ExecutionID != in.ClientTurnID || item.DialogueID != target.dialogueID || item.Visibility != "user" {
			t.Fatalf("timeline ownership/identity drift: %#v", item)
		}
	}

	replay, err := service.admitExecutionCommand(ctx, "alice", in, target, permissions, false, "chat")
	if err != nil {
		t.Fatal(err)
	}
	if replay.userMessageID != first.userMessageID || replay.assistantMessageID != first.assistantMessageID {
		t.Fatalf("replay rekeyed timeline first=%#v replay=%#v", first, replay)
	}
	var count int64
	model.DB(ctx).Model(&model.ConversationMessageV2{}).Count(&count)
	if count != 2 {
		t.Fatalf("idempotent replay created %d timeline items", count)
	}
}

func TestCanonicalExecutionCommandFingerprintIsStableAndBehaviorBound(t *testing.T) {
	in := QueryInput{
		Query: " inspect Os01g01010 ", Mode: "expert", Tool: "BriefGeneAgent",
		ClientTurnID: "turn-fingerprint", Locale: "zh-CN",
		Attachments: []rxBot.AssetAttachmentRef{{AssetID: "asset-b"}, {AssetID: "asset-a"}},
		InteropMode: "auto", InteropTargets: []string{"target-b", "target-a"},
	}
	target := v1SubmissionTarget{dialogueID: "dialogue-1", parentID: 4, mode: "expert", operation: "append"}
	first, err := canonicalExecutionCommand("alice", in, target, "brief_gene", []string{"BriefGeneAgent"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := canonicalExecutionCommand("alice", in, target, "brief_gene", []string{"BriefGeneAgent"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if first.Fingerprint != second.Fingerprint || first.FingerprintVersion != executionFingerprintVersion {
		t.Fatalf("unstable fingerprint first=%#v second=%#v", first, second)
	}
	changed := in
	changed.Query = "inspect Os01g01020"
	third, err := canonicalExecutionCommand("alice", changed, target, "brief_gene", []string{"BriefGeneAgent"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if first.Fingerprint == third.Fingerprint {
		t.Fatal("behavior-changing query reused fingerprint")
	}
}

func TestAutonomousExpertCommandUsesPrivateRouterWithoutPublicAgentDuplication(t *testing.T) {
	in := QueryInput{
		Query: "route this question", Mode: "expert", ClientTurnID: "turn-expert-router", Locale: "en-US",
	}
	target := v1SubmissionTarget{dialogueID: "dialogue-expert", mode: "expert", operation: "append"}
	command, err := canonicalExecutionCommand(
		"alice", in, target, expertRouterAgentSlug,
		[]string{"ChatAgent", "KnowledgeAgent"}, nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	args, err := botArgumentsForCommand(command)
	if err != nil {
		t.Fatal(err)
	}
	if command.AgentSlug != expertRouterAgentSlug || args["__query"] != in.Query {
		t.Fatalf("command=%#v args=%#v", command, args)
	}
	allowed, ok := args["__allowed_tools"].([]string)
	if !ok || len(allowed) != 2 || allowed[0] != "ChatAgent" {
		t.Fatalf("allowed tools=%#v", args["__allowed_tools"])
	}
}

func TestExecutionAdmissionAndOutboxCommitAtomicallyAndReplayIdempotently(t *testing.T) {
	setupExecutionRuntimeV2DB(t)
	service := NewService()
	ctx := context.Background()
	in := QueryInput{Query: "hello", Mode: "instant", Tool: "ChatAgent", ClientTurnID: "turn-atomic", Locale: "en-US"}
	target := v1SubmissionTarget{dialogueID: "dialogue-atomic", mode: "instant", operation: "append"}
	permissions := AgentPermissionResolution{AllowedTools: []string{"ChatAgent"}}

	first, err := service.admitExecutionCommand(ctx, "alice", in, target, permissions, false, "chat")
	if err != nil {
		t.Fatal(err)
	}
	if first.duplicate != nil || first.turn == nil || first.turn.ID == 0 || !strings.EqualFold(first.turn.Status, statusAdmitted) {
		t.Fatalf("first admission=%#v", first)
	}
	var admissions, commands, legacyRows, turns int64
	gdb := model.DB(ctx)
	gdb.Model(&model.QuestionAgentExecutionAdmission{}).Count(&admissions)
	gdb.Model(&model.QuestionAgentExecutionOutbox{}).Count(&commands)
	gdb.Model(&model.QuestionAgentLog{}).Count(&legacyRows)
	gdb.Model(&model.ConversationTurnV2{}).Count(&turns)
	if admissions != 1 || commands != 1 || legacyRows != 0 || turns != 1 {
		t.Fatalf("counts admission=%d outbox=%d legacy=%d turns=%d", admissions, commands, legacyRows, turns)
	}

	replay, err := service.admitExecutionCommand(ctx, "alice", in, target, permissions, false, "chat")
	if err != nil {
		t.Fatal(err)
	}
	if replay.duplicate == nil || replay.duplicate.Id != first.turn.ID {
		t.Fatalf("replay=%#v first=%#v", replay, first)
	}
	gdb.Model(&model.QuestionAgentExecutionOutbox{}).Count(&commands)
	if commands != 1 {
		t.Fatalf("replay created %d outbox rows", commands)
	}

	changed := in
	changed.Query = "different"
	if _, err := service.admitExecutionCommand(ctx, "alice", changed, target, permissions, false, "chat"); !errors.Is(err, ErrDuplicateClientTurn) {
		t.Fatalf("changed replay err=%v", err)
	}
}

func TestExecutionAdmissionAcceptsFirstTurnWhenGlobalMessageIDsHaveAdvanced(t *testing.T) {
	setupExecutionRuntimeV2DB(t)
	ctx := context.Background()
	gdb := model.DB(ctx)

	// Message ids are global, not scoped to a conversation. A first turn must
	// therefore remain a first turn even when another conversation already
	// consumed lower ids.
	unrelated := model.QuestionAgentLog{
		DialogueId: "unrelated-dialogue",
		UserName:   "someone-else",
		Query:      "older question",
		Status:     statusSucceeded,
	}
	if err := gdb.Create(&unrelated).Error; err != nil {
		t.Fatal(err)
	}

	in := QueryInput{
		Query: "hello", Mode: "instant", Tool: "ChatAgent",
		ClientTurnID: "turn-first-after-gap", Locale: "en-US",
	}
	target := v1SubmissionTarget{
		dialogueID: "8fdfe4d3-fdaa-49dd-b3d8-60cc333088ae",
		mode:       "instant",
		operation:  "append",
	}
	permissions := AgentPermissionResolution{AllowedTools: []string{"ChatAgent"}}

	admitted, err := NewService().admitExecutionCommand(
		ctx, "alice", in, target, permissions, true, "chat",
	)
	if err != nil {
		t.Fatalf("admit first turn after global id gap: %v", err)
	}
	if admitted.turn == nil || admitted.turn.ID <= unrelated.Id || admitted.turn.ParentID != 0 || admitted.envelope == nil {
		t.Fatalf("admission=%#v unrelated_id=%d", admitted, unrelated.Id)
	}
	if admitted.envelope.Operation != "append" || len(admitted.envelope.HistoryDelta) != 0 {
		t.Fatalf("first-turn envelope=%#v", admitted.envelope)
	}
}

func TestExecutionAdmissionRollbackLeavesNoPartialRows(t *testing.T) {
	setupExecutionRuntimeV2DB(t)
	service := NewService()
	ctx := context.Background()
	in := QueryInput{Query: "hello", Mode: "instant", Tool: "ChatAgent", ClientTurnID: "turn-rollback", Locale: "en-US"}
	target := v1SubmissionTarget{dialogueID: "dialogue-rollback", mode: "instant", operation: "append"}
	permissions := AgentPermissionResolution{AllowedTools: []string{"ChatAgent"}}

	executionAdmissionTestHook = func(stage string) error {
		if stage == "after_message" {
			return errors.New("injected failure")
		}
		return nil
	}
	t.Cleanup(func() { executionAdmissionTestHook = nil })
	if _, err := service.admitExecutionCommand(ctx, "alice", in, target, permissions, false, "chat"); err == nil {
		t.Fatal("expected injected failure")
	}
	var admissions, commands, legacyRows, turns int64
	gdb := model.DB(ctx)
	gdb.Model(&model.QuestionAgentExecutionAdmission{}).Count(&admissions)
	gdb.Model(&model.QuestionAgentExecutionOutbox{}).Count(&commands)
	gdb.Model(&model.QuestionAgentLog{}).Count(&legacyRows)
	gdb.Model(&model.ConversationTurnV2{}).Count(&turns)
	if admissions != 0 || commands != 0 || legacyRows != 0 || turns != 0 {
		t.Fatalf("rollback leaked admission=%d outbox=%d legacy=%d turns=%d", admissions, commands, legacyRows, turns)
	}
}

func TestExecutionTraceV1IsOwnerAuthorizedBeforeProxy(t *testing.T) {
	setupExecutionRuntimeV2DB(t)
	ctx := context.Background()
	runID := "bot-run-trace-v1"
	now := time.Now().UTC()
	if err := model.DB(ctx).Create(&model.QuestionAgentExecutionAdmission{
		UserName: "alice", ExecutionID: "turn-trace-v1", RequestFingerprint: strings.Repeat("b", 64),
		FingerprintVersion: 1, BotRunID: &runID, Status: "running",
		TrackingHealth: "healthy", CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	fake := &fakeExecutionRuntimeV2{trace: &rxBot.ExecutionTraceResolutionV1{
		SchemaVersion: 1,
		Target:        rxBot.ExecutionTargetV2{Kind: "trace", ID: "trc_A1b2C3d4E5f6G7h8"},
		Health:        "healthy",
		Operation: rxBot.ExecutionTraceOperationV1{
			OperationID: "op-analysis", OperationKey: "remote.analysis",
			LabelKey: "execution.operation.remote.analysis", FallbackLabel: "Run analysis",
			Status: "running", StartedAt: now.Format(time.RFC3339),
			LastObservationAt: now.Format(time.RFC3339), CurrentAttempt: 1,
			Attempts: []rxBot.ExecutionOperationAttemptV2{}, Detail: map[string]any{},
			Target: rxBot.ExecutionTargetV2{Kind: "trace", ID: "trc_A1b2C3d4E5f6G7h8"},
		},
		Items: []rxBot.ExecutionTraceFeedItemV1{},
	}}
	service := &Service{runtimeClient: fake}
	if _, err := service.ExecutionTraceResolutionV1(ctx, "other", "turn-trace-v1", "trc_A1b2C3d4E5f6G7h8", 0, 50); !errors.Is(err, ErrExecutionRunOwnership) {
		t.Fatalf("foreign trace err=%v", err)
	}
	trace, err := service.ExecutionTraceResolutionV1(ctx, "alice", "turn-trace-v1", "trc_A1b2C3d4E5f6G7h8", 0, 50)
	if err != nil || trace.Target.Kind != "trace" {
		t.Fatalf("trace=%#v err=%v", trace, err)
	}
}

func TestExecutionTraceV1MapsBotNotFoundToOwnershipNotFound(t *testing.T) {
	setupExecutionRuntimeV2DB(t)
	ctx := context.Background()
	runID := "bot-run-trace-missing"
	now := time.Now().UTC()
	if err := model.DB(ctx).Create(&model.QuestionAgentExecutionAdmission{
		UserName: "alice", ExecutionID: "turn-trace-missing", RequestFingerprint: strings.Repeat("d", 64),
		FingerprintVersion: 1, BotRunID: &runID, Status: "running",
		TrackingHealth: "healthy", CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	service := &Service{runtimeClient: &fakeExecutionRuntimeV2{
		traceErr: &rxBot.APIError{Status: http.StatusNotFound},
	}}

	_, err := service.ExecutionTraceResolutionV1(
		ctx, "alice", "turn-trace-missing", "trc_A1b2C3d4E5f6G7h8", 0, 50,
	)
	if !errors.Is(err, ErrExecutionRunOwnership) {
		t.Fatalf("missing trace err=%v", err)
	}
}

func TestTraceTargetsReuseCanonicalProjectionAndHistoryCache(t *testing.T) {
	setupExecutionRuntimeV2DB(t)
	ctx := context.Background()
	owner := "alice"
	executionID := "turn-trace-projection"
	runID := "bot-run-trace-projection"
	leaseOwner := "projection-worker"
	workUnitID := "work-analysis"
	now := time.Now().UTC()
	target := rxBot.ExecutionTargetV2{Kind: "trace", ID: "trc_A1b2C3d4E5f6G7h8"}
	admission := model.QuestionAgentExecutionAdmission{
		UserName: owner, ExecutionID: executionID, RequestFingerprint: strings.Repeat("c", 64),
		FingerprintVersion: 1, BotRunID: &runID, Status: "running", TrackingHealth: "healthy",
		ProjectionLeaseOwner: &leaseOwner, ProjectionAttempts: 1, CreatedAt: now, UpdatedAt: now,
	}
	if err := model.DB(ctx).Create(&admission).Error; err != nil {
		t.Fatal(err)
	}
	fake := &fakeExecutionRuntimeV2{
		page: &rxBot.ExecutionEventPageV2{
			SchemaVersion: 2, ExecutionID: executionID, NextAfterSeq: 1,
			Items: []rxBot.ExecutionEventV2{{
				SchemaVersion: 2, EventID: "evt-trace-target", ExecutionID: executionID,
				Seq: 1, Type: "work_unit.registered", Status: "queued", OccurredAt: now.Format(time.RFC3339),
				Source: "provider", SpanID: "span-analysis", WorkUnitID: &workUnitID, Attempt: 1,
				Summary:       rxBot.ExecutionSafeSummaryV2{Key: "remote.analysis", Text: "Run analysis"},
				PublicPayload: map[string]any{"operation_key": "remote.analysis"}, Target: &target,
			}},
		},
		snapshot: &rxBot.ExecutionProjectionV2{
			SchemaVersion: 2, ExecutionID: executionID, AgentSlug: "network", Status: "running",
			LatestSeq: 1, TrackingHealth: "healthy", Targets: []rxBot.ExecutionTargetV2{target},
			Operations: []rxBot.ExecutionOperationRecordV2{{
				SchemaVersion: 1, OperationID: "op-analysis", WorkUnitID: workUnitID,
				OperationKey: "remote.analysis", LabelKey: "execution.operation.remote.analysis",
				FallbackLabel: "Run analysis", Status: "running", StartedAt: now.Format(time.RFC3339),
				LastObservationAt: now.Format(time.RFC3339), CurrentAttempt: 1,
				Attempts: []rxBot.ExecutionOperationAttemptV2{}, Detail: map[string]any{}, Target: &target,
			}},
			ActiveSpanIDs: []string{}, Todos: []rxBot.ExecutionTodoItemV2{},
			Results: []rxBot.ExecutionResultItemV2{}, FailedWorkUnitIDs: []string{}, Warnings: []rxBot.ExecutionWarningV2{},
		},
	}
	service := &Service{runtimeClient: fake}
	if err := service.projectAdmission(ctx, admission); err != nil {
		t.Fatal(err)
	}
	fake.pageErr = errors.New("bot unavailable")
	snapshot, err := service.ExecutionSnapshotV2(ctx, owner, executionID)
	if err != nil || snapshot.Source != "web_cache" || len(snapshot.Operations) != 1 || snapshot.Operations[0].Target == nil || snapshot.Operations[0].Target.Kind != "trace" {
		t.Fatalf("snapshot=%#v err=%v", snapshot, err)
	}
	page, err := service.ExecutionEventsPageV2(ctx, owner, executionID, 0, 50)
	if err != nil || page.Source != "web_cache" || len(page.Items) != 1 || page.Items[0].Target == nil || page.Items[0].Target.Kind != "trace" {
		t.Fatalf("page=%#v err=%v", page, err)
	}
}
