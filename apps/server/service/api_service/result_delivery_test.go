package api_service

import (
	"context"
	"errors"
	"testing"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

const resultDeliveryTestDigest = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

type resultDeliveryClientFake struct {
	calls  []string
	result *rxBot.RunDelivery
	err    error
}

func (f *resultDeliveryClientFake) RetryRunDelivery(_ context.Context, runID string) (*rxBot.RunDelivery, error) {
	f.calls = append(f.calls, runID)
	return f.result, f.err
}

func seedResultDeliveryRow(t *testing.T, rowID int64, username, dialogueID, status string, delivery *ProjectionDelivery) {
	t.Helper()
	projection, err := marshalPersistedProjection(BotRunProjection{
		RunID:           "run-result-delivery",
		Agent:           "analyst",
		Status:          "SUCCEEDED",
		ReportRevision:  3,
		ResultArchiveV1: true,
		Delivery:        delivery,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := model.DB(context.Background()).Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, bot_run_id, status, bot_projection_json, bot_report_revision, created_at)
		VALUES (?, ?, 0, ?, 'run-result-delivery', ?, ?, 3, '2026-08-06 00:00:00')`,
		rowID, dialogueID, username, status, projection,
	).Error; err != nil {
		t.Fatal(err)
	}
}

func TestRetryConversationResultArchiveRetriesOnlyOwnerScopedRetryableFailure(t *testing.T) {
	setupTestDB(t)
	seedResultDeliveryRow(t, 701, "alice", "dlg-delivery", "SUCCEEDED", testFailedDelivery(2, resultDeliveryTestDigest, true))
	fake := &resultDeliveryClientFake{result: &rxBot.RunDelivery{
		SchemaVersion:   1,
		Required:        true,
		Status:          "pending",
		Revision:        3,
		InventoryDigest: resultDeliveryTestDigest,
	}}
	service := &Service{deliveryClient: fake}

	delivery, err := service.RetryConversationResultArchive(context.Background(), "alice", "dlg-delivery", 701)
	if err != nil {
		t.Fatalf("retry: %v", err)
	}
	if delivery.Status != "pending" || delivery.Revision != 3 || delivery.Name != nil || delivery.ErrorCode != nil || delivery.Retryable {
		t.Fatalf("delivery=%+v", delivery)
	}
	if len(fake.calls) != 1 || fake.calls[0] != "run-result-delivery" {
		t.Fatalf("Bot retry calls=%q", fake.calls)
	}
	projection, err := LoadBotRunProjection(context.Background(), "alice", 701)
	if err != nil {
		t.Fatal(err)
	}
	if projection.Delivery == nil || projection.Delivery.Status != "pending" || projection.Delivery.Revision != 3 || projection.Delivery.InventoryDigest != resultDeliveryTestDigest {
		t.Fatalf("stored delivery=%+v", projection.Delivery)
	}
	var status string
	if err := model.DB(context.Background()).Raw("SELECT status FROM question_agent_logs WHERE id = ?", 701).Scan(&status).Error; err != nil {
		t.Fatal(err)
	}
	if status != "RUNNING" {
		t.Fatalf("status=%q, want RUNNING", status)
	}
}

func TestRetryConversationResultArchiveReturnsPendingWithoutBotCall(t *testing.T) {
	setupTestDB(t)
	seedResultDeliveryRow(t, 702, "alice", "dlg-pending", "RUNNING", testPendingDelivery(3, resultDeliveryTestDigest))
	fake := &resultDeliveryClientFake{}

	delivery, err := (&Service{deliveryClient: fake}).RetryConversationResultArchive(context.Background(), "alice", "dlg-pending", 702)
	if err != nil {
		t.Fatalf("retry pending: %v", err)
	}
	if delivery.Status != "pending" || delivery.Revision != 3 {
		t.Fatalf("delivery=%+v", delivery)
	}
	if len(fake.calls) != 0 {
		t.Fatalf("pending retry called Bot: %q", fake.calls)
	}
}

func TestRetryConversationResultArchiveRejectsUnauthorizedAndUnretryableStates(t *testing.T) {
	setupTestDB(t)
	seedResultDeliveryRow(t, 703, "alice", "dlg-retry", "SUCCEEDED", testFailedDelivery(2, resultDeliveryTestDigest, false))
	seedResultDeliveryRow(t, 704, "alice", "dlg-retry", "SUCCEEDED", testReadyDelivery(2, resultDeliveryTestDigest))
	service := &Service{deliveryClient: &resultDeliveryClientFake{}}

	for _, attempt := range []struct {
		username string
		dialogue string
		rowID    int64
		want     error
	}{
		{"alice", "dlg-retry", 702, ErrConversationResultArchiveNotFound},
		{"bob", "dlg-retry", 703, ErrConversationResultArchiveNotFound},
		{"alice", "other-dialogue", 703, ErrConversationResultArchiveNotFound},
		{"alice", "dlg-retry", 703, ErrConversationResultArchiveRetryConflict},
		{"alice", "dlg-retry", 704, ErrConversationResultArchiveRetryConflict},
	} {
		_, err := service.RetryConversationResultArchive(context.Background(), attempt.username, attempt.dialogue, attempt.rowID)
		if !errors.Is(err, attempt.want) {
			t.Fatalf("attempt=%+v err=%v, want %v", attempt, err, attempt.want)
		}
	}
}

func TestRetryConversationResultArchiveRejectsChangedDigestAndStaleRevision(t *testing.T) {
	for _, returned := range []*rxBot.RunDelivery{
		{SchemaVersion: 1, Required: true, Status: "pending", Revision: 2, InventoryDigest: resultDeliveryTestDigest},
		{SchemaVersion: 1, Required: true, Status: "pending", Revision: 3, InventoryDigest: "sha256:abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd"},
	} {
		t.Run(returned.InventoryDigest, func(t *testing.T) {
			setupTestDB(t)
			seedResultDeliveryRow(t, 705, "alice", "dlg-invalid-retry", "SUCCEEDED", testFailedDelivery(2, resultDeliveryTestDigest, true))
			fake := &resultDeliveryClientFake{result: returned}
			_, err := (&Service{deliveryClient: fake}).RetryConversationResultArchive(context.Background(), "alice", "dlg-invalid-retry", 705)
			if !errors.Is(err, ErrConversationResultArchiveRetryConflict) {
				t.Fatalf("err=%v", err)
			}
			if len(fake.calls) != 1 {
				t.Fatalf("Bot calls=%q", fake.calls)
			}
			projection, err := LoadBotRunProjection(context.Background(), "alice", 705)
			if err != nil {
				t.Fatal(err)
			}
			if projection.Delivery == nil || projection.Delivery.Status != "failed" || projection.Delivery.Revision != 2 {
				t.Fatalf("delivery changed: %+v", projection.Delivery)
			}
		})
	}
}
