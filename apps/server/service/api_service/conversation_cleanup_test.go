package api_service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	rxBot "phytomni-server/external/bot"
)

func TestDrainPendingConversationTombstones_IsBoundedAndIsolatesFailures(t *testing.T) {
	gdb := setupTestDB(t)
	dialogues := []string{
		"44444444-4444-4444-8444-444444444444",
		"55555555-5555-4555-8555-555555555555",
		"66666666-6666-4666-8666-666666666666",
	}
	for index, dialogueID := range dialogues {
		if err := gdb.Exec(`INSERT INTO question_agent_logs
			(id, dialogue_id, f_id, user_name, log_status, status, created_at, delete_at) VALUES
			(?, ?, 0, 'alice', ?, 'SUCCEEDED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
			200+index, dialogueID, conversationDeletePending).Error; err != nil {
			t.Fatalf("seed tombstone %d: %v", index, err)
		}
	}

	var mu sync.Mutex
	failSecond := true
	calls := make([]string, 0, 4)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request rxBot.ContextTombstoneRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode tombstone: %v", err)
		}
		mu.Lock()
		calls = append(calls, request.ConversationKey)
		shouldFail := failSecond && request.ConversationKey == dialogues[1]
		mu.Unlock()
		if shouldFail {
			http.Error(w, "temporary", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"schema_version":1,"state":"tombstoned","context_version":0}`))
	}))
	t.Cleanup(srv.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, MultiturnV1Enabled: true, TimeoutSeconds: 2,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	result := NewService().DrainPendingConversationTombstones(context.Background(), 2)
	if result.Processed != 2 || result.Succeeded != 1 || result.Failed != 1 {
		t.Fatalf("first drain=%+v, want processed=2 succeeded=1 failed=1", result)
	}
	mu.Lock()
	firstCalls := append([]string(nil), calls...)
	failSecond = false
	mu.Unlock()
	if len(firstCalls) != 2 || firstCalls[0] != dialogues[0] || firstCalls[1] != dialogues[1] {
		t.Fatalf("first drain order=%v, want deterministic first two", firstCalls)
	}
	var thirdStatus string
	if err := gdb.Raw(`SELECT log_status FROM question_agent_logs WHERE id = 202`).
		Scan(&thirdStatus).Error; err != nil {
		t.Fatalf("read untouched third row: %v", err)
	}
	if thirdStatus != conversationDeletePending {
		t.Fatalf("third status=%q, want pending due to batch limit", thirdStatus)
	}

	result = NewService().DrainPendingConversationTombstones(context.Background(), 10)
	if result.Processed != 2 || result.Succeeded != 2 || result.Failed != 0 {
		t.Fatalf("second drain=%+v, want remaining two successes", result)
	}
	var pending int64
	if err := gdb.Raw(
		`SELECT COUNT(*) FROM question_agent_logs WHERE log_status = ?`,
		conversationDeletePending,
	).Scan(&pending).Error; err != nil {
		t.Fatalf("count pending: %v", err)
	}
	if pending != 0 {
		t.Fatalf("pending tombstones=%d, want 0", pending)
	}
}

func TestFailStaleConversationSubmissions_OnlyFailsBoundedSubmittingRows(t *testing.T) {
	gdb := setupTestDB(t)
	now := time.Now().UTC()
	rows := []struct {
		id      int
		status  string
		created time.Time
	}{
		{300, "SUBMITTING", now.Add(-10 * time.Minute)},
		{301, "SUBMITTING", now.Add(-9 * time.Minute)},
		{302, "SUBMITTING", now.Add(-10 * time.Second)},
		{303, "RUNNING", now.Add(-10 * time.Minute)},
		{304, "SUCCEEDED", now.Add(-10 * time.Minute)},
	}
	for _, row := range rows {
		if err := gdb.Exec(`INSERT INTO question_agent_logs
			(id, dialogue_id, f_id, user_name, log_status, status, created_at) VALUES
			(?, ?, 1, 'alice', '', ?, ?)`,
			row.id, "dialogue", row.status, row.created).Error; err != nil {
			t.Fatalf("seed row %d: %v", row.id, err)
		}
	}
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, log_status, status, created_at, delete_at) VALUES
		(305, 'deleted-dialogue', 0, 'alice', ?, 'SUBMITTING', ?, ?)`,
		conversationDeletePending,
		now.Add(-10*time.Minute),
		now.Add(-time.Minute),
	).Error; err != nil {
		t.Fatalf("seed deleted submission: %v", err)
	}

	result := NewService().FailStaleConversationSubmissions(
		context.Background(),
		now.Add(-2*time.Minute),
		1,
	)
	if result.Processed != 1 || result.Succeeded != 1 || result.Failed != 0 {
		t.Fatalf("first stale cleanup=%+v", result)
	}

	var firstStatus, firstReason, secondStatus string
	if err := gdb.Raw(`SELECT status, log_status FROM question_agent_logs WHERE id = 300`).
		Row().Scan(&firstStatus, &firstReason); err != nil {
		t.Fatalf("read first stale row: %v", err)
	}
	if err := gdb.Raw(`SELECT status FROM question_agent_logs WHERE id = 301`).
		Scan(&secondStatus).Error; err != nil {
		t.Fatalf("read second stale row: %v", err)
	}
	if firstStatus != "FAILED" || firstReason != staleSubmissionReason {
		t.Fatalf("first stale row status=%q reason=%q", firstStatus, firstReason)
	}
	if len(firstReason) > 30 {
		t.Fatalf("stale reason length=%d, want <=30", len(firstReason))
	}
	if secondStatus != "SUBMITTING" {
		t.Fatalf("second stale status=%q, want bounded cleanup to leave SUBMITTING", secondStatus)
	}

	result = NewService().FailStaleConversationSubmissions(
		context.Background(),
		now.Add(-2*time.Minute),
		10,
	)
	if result.Processed != 1 || result.Succeeded != 1 || result.Failed != 0 {
		t.Fatalf("second stale cleanup=%+v", result)
	}
	for _, id := range []int{302, 303, 304} {
		var status string
		if err := gdb.Raw(`SELECT status FROM question_agent_logs WHERE id = ?`, id).
			Scan(&status).Error; err != nil {
			t.Fatalf("read row %d: %v", id, err)
		}
		if status != rows[id-300].status {
			t.Fatalf("row %d status=%q, want %q", id, status, rows[id-300].status)
		}
	}
	var deletedStatus, deletedReason string
	if err := gdb.Raw(
		`SELECT status, log_status FROM question_agent_logs WHERE id = 305`,
	).Row().Scan(&deletedStatus, &deletedReason); err != nil {
		t.Fatalf("read deleted submission: %v", err)
	}
	if deletedStatus != "SUBMITTING" || deletedReason != conversationDeletePending {
		t.Fatalf(
			"deleted submission status=%q reason=%q, want SUBMITTING/%s",
			deletedStatus,
			deletedReason,
			conversationDeletePending,
		)
	}
}
