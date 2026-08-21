package api_service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"

	"gorm.io/gorm"
)

func TestQueryDataReturnsRunningWithoutWaiting(t *testing.T) {
	testQueryDetachReturnsRunningWithoutWaiting(t, queryDetachCase{
		tool:         "DataAgent",
		botPath:      "/v1/agents/data/runs",
		clientTurnID: "data-detach-turn-1",
		useV1:        true,
	})
}

func TestQueryReviewReturnsRunningWithoutWaiting(t *testing.T) {
	testQueryDetachReturnsRunningWithoutWaiting(t, queryDetachCase{
		tool:         "ReviewAgent",
		botPath:      "/v1/chat/completions",
		clientTurnID: "review-detach-turn-1",
	})
}

type queryDetachCase struct {
	tool         string
	botPath      string
	clientTurnID string
	useV1        bool
}

func testQueryDetachReturnsRunningWithoutWaiting(t *testing.T, tc queryDetachCase) {
	t.Helper()
	if tc.useV1 {
		useConversationV1(t)
	}
	gdb := setupExpertTestDB(t)

	botEntered := make(chan struct{})
	botRelease := make(chan struct{})
	var releaseOnce sync.Once
	releaseBot := func() { releaseOnce.Do(func() { close(botRelease) }) }

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != tc.botPath {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		close(botEntered)
		select {
		case <-botRelease:
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(func() {
		releaseBot()
		srv.Close()
		rxBot.BotConfig = nil
	})
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	started := time.Now()
	out, err := NewService().Query(ctx, "alice", QueryInput{
		Query:        "durable detach " + tc.tool,
		Mode:         "expert",
		Tool:         tc.tool,
		ClientTurnID: tc.clientTurnID,
		Surface:      QuerySurfaceChat,
	})
	elapsed := time.Since(started)
	cancel()

	if elapsed >= 200*time.Millisecond {
		t.Fatalf("Query blocked for %s (err=%v out=%#v), want RUNNING in <200ms", elapsed, err, out)
	}
	if err != nil {
		t.Fatalf("Query: %v (elapsed %s)", err, elapsed)
	}
	if out == nil || out.Status != "RUNNING" || out.Id <= 0 || strings.TrimSpace(out.DialogueId) == "" {
		t.Fatalf("Query = %#v, want RUNNING with Id and DialogueId in %s", out, elapsed)
	}
	if strings.TrimSpace(out.BotRunID) == "" || !isDurablePendingRunID(out.BotRunID) {
		t.Fatalf("Query BotRunID = %q, want web-pending placeholder", out.BotRunID)
	}

	select {
	case <-botEntered:
	case <-time.After(2 * time.Second):
		t.Fatal("Bot call was not started after Query returned RUNNING")
	}

	var row model.QuestionAgentLog
	if err := gdb.First(&row, out.Id).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != "RUNNING" {
		t.Fatalf("row status = %q, want RUNNING while Bot is blocked", row.Status)
	}

	releaseBot()
	row = waitForQuestionRowTerminal(t, gdb, out.Id)
	if row.Status == "SUBMITTING" || row.Status == "RUNNING" {
		t.Fatalf("row stayed pollable after Bot error: %#v", row)
	}
	if row.Status != "FAILED" {
		t.Fatalf("row status = %q, want FAILED after Bot I/O error", row.Status)
	}
}

func waitForQuestionRowTerminal(t *testing.T, gdb *gorm.DB, id int64) model.QuestionAgentLog {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	var row model.QuestionAgentLog
	for time.Now().Before(deadline) {
		if err := gdb.First(&row, id).Error; err != nil {
			t.Fatal(err)
		}
		switch strings.ToUpper(strings.TrimSpace(row.Status)) {
		case "SUCCEEDED", "FAILED", "INPUT_REQUIRED", "CANCELLED", "TIMED_OUT":
			return row
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("row %d still %q after 5s", id, row.Status)
	return row
}
