package api_service

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

func TestExecutionAdmissionIsIdempotentAndFingerprintBound(t *testing.T) {
	setupTestDB(t)
	service := NewService()
	ctx := context.Background()

	first, err := service.reserveExecutionAdmission(ctx, "alice", "turn-12345678", "fingerprint-a", "dialogue-1", 42)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := service.reserveExecutionAdmission(ctx, "alice", "turn-12345678", "fingerprint-a", "dialogue-ignored", 99)
	if err != nil {
		t.Fatal(err)
	}
	if first.ExecutionID != retry.ExecutionID || retry.DialogueID == nil || *retry.DialogueID != "dialogue-1" || retry.MessageID == nil || *retry.MessageID != 42 {
		t.Fatalf("retry mutated admission: first=%#v retry=%#v", first, retry)
	}
	if _, err := service.reserveExecutionAdmission(ctx, "alice", "turn-12345678", "fingerprint-b", "dialogue-2", 100); !errors.Is(err, ErrDuplicateClientTurn) {
		t.Fatalf("changed fingerprint err=%v, want conflict", err)
	}
	stored, err := loadExecutionAdmission(ctx, "alice", "turn-12345678")
	if err != nil || stored.RequestFingerprint != "fingerprint-a" || stored.DialogueID == nil || *stored.DialogueID != "dialogue-1" {
		t.Fatalf("stored=%#v err=%v", stored, err)
	}
}

func TestExecutionAdmissionOwnerIsolationAndAtomicEnrichment(t *testing.T) {
	setupTestDB(t)
	service := NewService()
	ctx := context.Background()
	if _, err := service.reserveExecutionAdmission(ctx, "alice", "turn-abcdefgh", "fingerprint", "", 0); err != nil {
		t.Fatal(err)
	}
	if _, err := loadExecutionAdmission(ctx, "mallory", "turn-abcdefgh"); !errors.Is(err, ErrExecutionRunOwnership) {
		t.Fatalf("foreign lookup err=%v", err)
	}
	if err := enrichExecutionAdmission(ctx, "alice", "turn-abcdefgh", "fingerprint", "dialogue-1", 7, "run-1", "succeeded"); err != nil {
		t.Fatal(err)
	}
	stored, err := loadExecutionAdmission(ctx, "alice", "turn-abcdefgh")
	if err != nil || stored.DialogueID == nil || *stored.DialogueID != "dialogue-1" || stored.MessageID == nil || *stored.MessageID != 7 || stored.RunID == nil || *stored.RunID != "run-1" || stored.Status != "succeeded" {
		t.Fatalf("enriched=%#v err=%v", stored, err)
	}
	if err := enrichExecutionAdmission(ctx, "alice", "turn-abcdefgh", "wrong", "changed", 8, "run-2", "failed"); !errors.Is(err, ErrDuplicateClientTurn) {
		t.Fatalf("mismatched enrichment err=%v", err)
	}
}

type fakeExecutionEventClient struct {
	calls     []string
	pageItems []rxBot.ExecutionEventV1
	pageErr   error
	streamErr error
}

func (f *fakeExecutionEventClient) GetRunEvents(_ context.Context, runID string, after int64, limit int) (*rxBot.ExecutionEventPageV1, error) {
	f.calls = append(f.calls, "page:"+runID)
	next := after
	if len(f.pageItems) > 0 {
		next = f.pageItems[len(f.pageItems)-1].Seq
	}
	return &rxBot.ExecutionEventPageV1{SchemaVersion: 1, RunID: runID, Items: append([]rxBot.ExecutionEventV1(nil), f.pageItems...), NextAfterSeq: next, HasMore: limit == 1}, nil
}

func TestConversationExecutionTargetRequiresOwnedCommittedTypedTarget(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Create(&model.QuestionAgentLog{
		UserName: "alice", DialogueId: "dialogue-1", BotRunId: "run-1", Status: "RUNNING",
	}).Error; err != nil {
		t.Fatal(err)
	}
	fake := &fakeExecutionEventClient{pageItems: []rxBot.ExecutionEventV1{{
		SchemaVersion: 1,
		EventID:       "evt-artifact",
		RunID:         "run-1",
		Seq:           1,
		Kind:          "artifact.published",
		Status:        "succeeded",
		Payload:       map[string]any{"name": "result.csv", "media_type": "text/csv", "size_bytes": float64(128)},
		Target:        &rxBot.PublicExecutionTarget{Kind: "artifact", ID: "artifact-opaque"},
	}}}
	service := &Service{eventClient: fake}

	target, err := service.ConversationRunExecutionTarget(context.Background(), "alice", "dialogue-1", "run-1", "artifact", "artifact-opaque")
	if err != nil || target.Name != "result.csv" || target.SizeBytes != 128 || target.EventID != "evt-artifact" {
		t.Fatalf("target=%#v err=%v", target, err)
	}
	if target.Event == nil || target.Event.EventID != "evt-artifact" {
		t.Fatalf("target must carry its bounded committed event: %#v", target)
	}
	if target.ArtifactID != "" || target.PreviewAvailable {
		t.Fatalf("unmapped target exposed preview=%#v", target)
	}
	for _, tc := range []struct{ user, kind, id string }{
		{user: "mallory", kind: "artifact", id: "artifact-opaque"},
		{user: "alice", kind: "direct_url", id: "artifact-opaque"},
		{user: "alice", kind: "artifact", id: "unknown"},
	} {
		if _, err := service.ConversationRunExecutionTarget(context.Background(), tc.user, "dialogue-1", "run-1", tc.kind, tc.id); !errors.Is(err, ErrExecutionRunOwnership) {
			t.Fatalf("case=%+v err=%v", tc, err)
		}
	}
}

func (f *fakeExecutionEventClient) GetRunEventProjection(_ context.Context, runID string) (*rxBot.RunEventProjectionV1, error) {
	f.calls = append(f.calls, "projection:"+runID)
	return &rxBot.RunEventProjectionV1{SchemaVersion: 1, RunID: runID, LatestSeq: 9, Status: "running"}, nil
}

func (f *fakeExecutionEventClient) GetRunEvent(_ context.Context, runID, eventID string) (*rxBot.ExecutionEventV1, error) {
	f.calls = append(f.calls, "event:"+runID+":"+eventID)
	return &rxBot.ExecutionEventV1{SchemaVersion: 1, RunID: runID, EventID: eventID, Seq: 1}, nil
}

func (f *fakeExecutionEventClient) OpenRunEventStream(_ context.Context, runID string, _ int64) (io.ReadCloser, rxBot.ResponseMeta, error) {
	f.calls = append(f.calls, "stream:"+runID)
	return io.NopCloser(strings.NewReader("event: execution_event\n\n")), rxBot.ResponseMeta{}, nil
}

func (f *fakeExecutionEventClient) GetExecutionEvents(_ context.Context, executionID string, after int64, limit int) (*rxBot.ExecutionEventPageV1, error) {
	f.calls = append(f.calls, "execution-page:"+executionID)
	if f.pageErr != nil {
		return nil, f.pageErr
	}
	next := after
	if len(f.pageItems) > 0 {
		next = f.pageItems[len(f.pageItems)-1].Seq
	}
	return &rxBot.ExecutionEventPageV1{SchemaVersion: 1, RunID: "run-early", Items: append([]rxBot.ExecutionEventV1(nil), f.pageItems...), NextAfterSeq: next, HasMore: limit == 1}, nil
}

func (f *fakeExecutionEventClient) GetExecutionEventProjection(_ context.Context, executionID string) (*rxBot.RunEventProjectionV1, error) {
	f.calls = append(f.calls, "execution-projection:"+executionID)
	return &rxBot.RunEventProjectionV1{SchemaVersion: 1, RunID: "run-early", LatestSeq: 1, Status: "running"}, nil
}

func (f *fakeExecutionEventClient) GetExecutionEvent(_ context.Context, executionID, eventID string) (*rxBot.ExecutionEventV1, error) {
	f.calls = append(f.calls, "execution-event:"+executionID+":"+eventID)
	return &rxBot.ExecutionEventV1{SchemaVersion: 1, RunID: "run-early", EventID: eventID, Seq: 1}, nil
}

func (f *fakeExecutionEventClient) OpenExecutionEventStream(_ context.Context, executionID string, _ int64) (io.ReadCloser, rxBot.ResponseMeta, error) {
	f.calls = append(f.calls, "execution-stream:"+executionID)
	if f.streamErr != nil {
		return nil, rxBot.ResponseMeta{}, f.streamErr
	}
	return io.NopCloser(strings.NewReader(": attached\n\n")), rxBot.ResponseMeta{}, nil
}

func TestExecutionAddressedAccessUsesEarlyOwnerAdmission(t *testing.T) {
	setupTestDB(t)
	service := &Service{eventClient: &fakeExecutionEventClient{}}
	ctx := context.Background()
	if _, err := service.reserveExecutionAdmission(ctx, "alice", "turn-early", "fingerprint", "", 0); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ExecutionEvents(ctx, "alice", "turn-early", 0, 50); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ExecutionEventProjection(ctx, "alice", "turn-early"); err != nil {
		t.Fatal(err)
	}
	admission, err := loadExecutionAdmission(ctx, "alice", "turn-early")
	if err != nil || admission.LatestCursor != 0 || admission.ProjectionJSON != "" {
		t.Fatalf("read endpoint mutated admission=%#v err=%v", admission, err)
	}
	if _, err := service.ExecutionEvent(ctx, "alice", "turn-early", "evt-1"); err != nil {
		t.Fatal(err)
	}
	body, _, err := service.ExecutionEventStream(ctx, "alice", "turn-early", 0)
	if err != nil {
		t.Fatal(err)
	}
	body.Close()
	for _, user := range []string{"mallory", ""} {
		if _, err := service.ExecutionEvents(ctx, user, "turn-early", 0, 50); !errors.Is(err, ErrExecutionRunOwnership) {
			t.Fatalf("foreign user %q err=%v", user, err)
		}
	}
}

func TestExecutionEventStreamWaitsThroughDelayedAdmission(t *testing.T) {
	setupTestDB(t)
	service := &Service{eventClient: &fakeExecutionEventClient{}}
	reserved := make(chan error, 1)

	go func() {
		time.Sleep(900 * time.Millisecond)
		_, err := service.reserveExecutionAdmission(
			context.Background(),
			"alice",
			"turn-delayed-admission",
			"fingerprint",
			"",
			0,
		)
		reserved <- err
	}()

	body, _, streamErr := service.ExecutionEventStream(
		context.Background(),
		"alice",
		"turn-delayed-admission",
		0,
	)
	if reserveErr := <-reserved; reserveErr != nil {
		t.Fatalf("reserve delayed admission: %v", reserveErr)
	}
	if streamErr != nil {
		t.Fatalf("stream rejected delayed admission: %v", streamErr)
	}
	defer body.Close()
}

func TestExecutionStreamSnapshotWaitsThroughDelayedAdmission(t *testing.T) {
	setupTestDB(t)
	service := &Service{}
	reserved := make(chan error, 1)

	go func() {
		time.Sleep(40 * time.Millisecond)
		_, err := service.reserveExecutionAdmission(
			context.Background(),
			"alice",
			"turn-delayed-snapshot",
			"fingerprint",
			"",
			0,
		)
		reserved <- err
	}()

	snapshot, err := service.ExecutionStreamSnapshotV2(
		context.Background(),
		"alice",
		"turn-delayed-snapshot",
	)
	if reserveErr := <-reserved; reserveErr != nil {
		t.Fatalf("reserve delayed admission: %v", reserveErr)
	}
	if err != nil {
		t.Fatalf("stream snapshot rejected delayed admission: %v", err)
	}
	if snapshot.ExecutionID != "turn-delayed-snapshot" || snapshot.Status != "admitted" {
		t.Fatalf("snapshot=%#v", snapshot)
	}
}

func TestAdmissionSnapshotPreservesTerminalTrackingAndContentState(t *testing.T) {
	terminalStatus := "failed"
	lastContact := time.Date(2026, time.August, 21, 9, 31, 13, 0, time.UTC)
	admission := &executionAdmission{
		ExecutionID:      "turn-terminal-dispatch",
		Status:           terminalStatus,
		LatestCursor:     0,
		DispatchRevision: 12,
		ContentRevision:  3,
		ContentOffset:    57,
		TerminalStatus:   &terminalStatus,
		LastBotContactAt: &lastContact,
		TrackingHealth:   "degraded",
	}

	snapshot := admissionSnapshot(admission)
	if snapshot.Status != "failed" || snapshot.TrackingHealth != "degraded" {
		t.Fatalf("snapshot lost status/health: %#v", snapshot)
	}
	if snapshot.OutputRevision != 3 || snapshot.OutputOffset != 57 || snapshot.OperationRevision != 12 {
		t.Fatalf("snapshot lost revisions: %#v", snapshot)
	}
	if snapshot.Terminal == nil || snapshot.Terminal.Status != "failed" || snapshot.Terminal.EventID == "" {
		t.Fatalf("snapshot must expose a sticky terminal marker: %#v", snapshot)
	}
	if snapshot.LastContactAt == nil || !snapshot.LastContactAt.Equal(lastContact) {
		t.Fatalf("snapshot lost last contact: %#v", snapshot)
	}
}

func TestExecutionAddressedTargetRequiresEarlyOwnerAdmission(t *testing.T) {
	setupTestDB(t)
	fake := &fakeExecutionEventClient{pageItems: []rxBot.ExecutionEventV1{{
		SchemaVersion: 1,
		EventID:       "evt-early-artifact",
		RunID:         "run-early",
		Seq:           1,
		Kind:          "artifact.published",
		Status:        "succeeded",
		Payload:       map[string]any{"name": "early.csv", "media_type": "text/csv", "size_bytes": float64(12)},
		Target:        &rxBot.PublicExecutionTarget{Kind: "artifact", ID: "artifact-early"},
	}}}
	service := &Service{eventClient: fake}
	ctx := context.Background()
	if _, err := service.reserveExecutionAdmission(ctx, "alice", "turn-target", "fingerprint", "", 0); err != nil {
		t.Fatal(err)
	}
	target, err := service.ExecutionTarget(ctx, "alice", "turn-target", "artifact", "artifact-early")
	if err != nil || target.EventID != "evt-early-artifact" || target.Name != "early.csv" || target.MessageID != 0 {
		t.Fatalf("target=%#v err=%v", target, err)
	}
	for _, user := range []string{"mallory", ""} {
		if _, err := service.ExecutionTarget(ctx, user, "turn-target", "artifact", "artifact-early"); !errors.Is(err, ErrExecutionRunOwnership) {
			t.Fatalf("foreign user %q err=%v", user, err)
		}
	}
}

func TestExecutionStreamWaitsForBoundedPreAdmissionRace(t *testing.T) {
	setupTestDB(t)
	service := &Service{eventClient: &fakeExecutionEventClient{}}
	ctx := context.Background()
	committed := make(chan error, 1)
	go func() {
		time.Sleep(40 * time.Millisecond)
		_, err := service.reserveExecutionAdmission(ctx, "alice", "turn-race", "fingerprint", "", 0)
		committed <- err
	}()
	body, _, err := service.ExecutionEventStream(ctx, "alice", "turn-race", 0)
	if err != nil {
		t.Fatalf("stream did not attach after admission: %v", err)
	}
	body.Close()
	if err := <-committed; err != nil {
		t.Fatal(err)
	}
}

func TestExecutionGatewayPreservesBotDowntimeAndCallerCancellation(t *testing.T) {
	setupTestDB(t)
	botUnavailable := errors.New("bot unavailable")
	fake := &fakeExecutionEventClient{pageErr: botUnavailable}
	service := &Service{eventClient: fake}
	ctx := context.Background()
	if _, err := service.reserveExecutionAdmission(ctx, "alice", "turn-down", "fingerprint", "", 0); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ExecutionEvents(ctx, "alice", "turn-down", 0, 50); !errors.Is(err, botUnavailable) {
		t.Fatalf("downtime err=%v", err)
	}

	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := service.ExecutionEventStream(cancelled, "alice", "turn-missing", 0); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled stream err=%v", err)
	}
	if strings.Contains(strings.Join(fake.calls, ","), "execution-stream:turn-missing") {
		t.Fatalf("cancelled pre-admission request reached Bot: %v", fake.calls)
	}
}

func TestConversationExecutionEventsRequireOwnedDialogueRunBinding(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Create(&model.QuestionAgentLog{
		UserName:   "alice",
		DialogueId: "dialogue-1",
		BotRunId:   "run-1",
		Status:     "RUNNING",
	}).Error; err != nil {
		t.Fatal(err)
	}
	fake := &fakeExecutionEventClient{}
	service := &Service{eventClient: fake}

	page, err := service.ConversationRunEvents(context.Background(), "alice", "dialogue-1", "run-1", 7, 50)
	if err != nil || page == nil || page.RunID != "run-1" {
		t.Fatalf("page=%#v err=%v", page, err)
	}
	if _, err := service.ConversationRunEvents(context.Background(), "mallory", "dialogue-1", "run-1", 0, 50); err != ErrExecutionRunOwnership {
		t.Fatalf("foreign err=%v", err)
	}
	if _, err := service.ConversationRunEvents(context.Background(), "alice", "other-dialogue", "run-1", 0, 50); err != ErrExecutionRunOwnership {
		t.Fatalf("cross-dialogue err=%v", err)
	}
	if len(fake.calls) != 1 || fake.calls[0] != "page:run-1" {
		t.Fatalf("calls=%v", fake.calls)
	}
	var count int64
	if err := gdb.Table("question_agent_execution_states").Where("bot_run_id = ?", "run-1").Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("read endpoint wrote %d state rows: %v", count, err)
	}
}

func TestConversationExecutionProjectionDetailAndStreamUseAuthorizedRun(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Create(&model.QuestionAgentLog{
		UserName: "alice", DialogueId: "dialogue-1", BotRunId: "run-1", Status: "RUNNING",
	}).Error; err != nil {
		t.Fatal(err)
	}
	fake := &fakeExecutionEventClient{}
	service := &Service{eventClient: fake}
	ctx := context.Background()
	if _, err := service.ConversationRunEventProjection(ctx, "alice", "dialogue-1", "run-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ConversationRunEvent(ctx, "alice", "dialogue-1", "run-1", "evt-1"); err != nil {
		t.Fatal(err)
	}
	body, _, err := service.ConversationRunEventStream(ctx, "alice", "dialogue-1", "run-1", 1)
	if err != nil {
		t.Fatal(err)
	}
	body.Close()
	if strings.Join(fake.calls, ",") != "projection:run-1,event:run-1:evt-1,stream:run-1" {
		t.Fatalf("calls=%v", fake.calls)
	}
	var count int64
	if err := gdb.Table("question_agent_execution_states").Where("bot_run_id = ?", "run-1").Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("projection/detail/stream reads wrote %d state rows: %v", count, err)
	}
}
