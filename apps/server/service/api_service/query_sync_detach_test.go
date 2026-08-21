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
	successBody  string
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

func testQueryPendingRunOwnerCancelStaysCancelled(t *testing.T, tc queryDetachCase) {
	t.Helper()
	gdb := setupExpertTestDB(t)
	fake := &cancelFakeRunCanceller{}

	botEntered := make(chan struct{})
	botRelease := make(chan struct{})
	botDone := make(chan struct{})
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
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(tc.successBody))
		close(botDone)
	}))
	t.Cleanup(func() {
		releaseBot()
		srv.Close()
		rxBot.BotConfig = nil
	})
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5,
	}

	out, err := (&Service{runCanceller: fake}).Query(context.Background(), "alice", QueryInput{
		Query:   "cancel while waiting " + tc.tool,
		Mode:    "expert",
		Tool:    tc.tool,
		Surface: QuerySurfaceChat,
	})
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	if out.Status != "RUNNING" || out.Id <= 0 || !isDurablePendingRunID(out.BotRunID) {
		t.Fatalf("Query = %#v, want RUNNING with pending run id", out)
	}
	select {
	case <-botEntered:
	case <-time.After(2 * time.Second):
		t.Fatal("Bot call was not started")
	}

	got, cancelErr := (&Service{runCanceller: fake}).AgentTaskCancel(context.Background(), out.Id, "alice")
	if cancelErr != nil {
		t.Fatalf("AgentTaskCancel: %v", cancelErr)
	}
	if got.Phase != "CANCELLED" {
		t.Fatalf("cancel lifecycle=%+v", got)
	}
	for _, runID := range fake.calls {
		if isDurablePendingRunID(runID) {
			t.Fatalf("Stop called Bot with pending placeholder %q", runID)
		}
	}

	releaseBot()
	select {
	case <-botDone:
	case <-time.After(2 * time.Second):
		t.Fatal("Bot success body was not written after release")
	}
	deadline := time.Now().Add(2 * time.Second)
	var row model.QuestionAgentLog
	for time.Now().Before(deadline) {
		if err := gdb.First(&row, out.Id).Error; err != nil {
			t.Fatal(err)
		}
		if row.Status == statusSucceeded {
			t.Fatalf("cancelled row flipped to SUCCEEDED after Bot finished: %#v", row)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if err := gdb.First(&row, out.Id).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != "CANCELLED" {
		t.Fatalf("row status=%q, want CANCELLED after Bot success", row.Status)
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

func TestQueryDataPendingRunOwnerCancelStaysCancelled(t *testing.T) {
	testQueryPendingRunOwnerCancelStaysCancelled(t, queryDetachCase{
		tool:        "DataAgent",
		botPath:     "/v1/agents/data/runs",
		successBody: `{"id":"run-data-late","object":"agent.run","agent":"data","status":"succeeded","task_ids":[],"result":{"formatted":{"answer":"late table"}}}`,
	})
}

func TestQueryReviewPendingRunOwnerCancelStaysCancelled(t *testing.T) {
	testQueryPendingRunOwnerCancelStaysCancelled(t, queryDetachCase{
		tool:        "ReviewAgent",
		botPath:     "/v1/chat/completions",
		successBody: `{"id":"run-review-late","run_id":"run-review-late","object":"chat.completion","status":"succeeded","choices":[{"index":0,"message":{"role":"assistant","content":"late review"}}],"formatted":{"answer":"late review"}}`,
	})
}

func TestQueryDataReplacementDetachErrorClearsRunningCandidate(t *testing.T) {
	useConversationV1(t)
	gdb := setupExpertTestDB(t)
	seed := seedResearchReplacementTarget(t, gdb)

	botEntered := make(chan struct{})
	botRelease := make(chan struct{})
	var releaseOnce sync.Once
	releaseBot := func() { releaseOnce.Do(func() { close(botRelease) }) }

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/agents/data/runs" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		close(botEntered)
		<-botRelease
	}))
	t.Cleanup(func() {
		releaseBot()
		srv.Close()
		rxBot.BotConfig = nil
	})
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5,
	}

	out, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query:        "replace with a table",
		Mode:         "expert",
		Tool:         "DataAgent",
		ClientTurnID: "data-replace-detach-1",
		RefreshId:    seed.Id,
		Surface:      QuerySurfaceChat,
	})
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	if out.Id != seed.Id || out.Status != "RUNNING" || !isDurablePendingRunID(out.BotRunID) {
		t.Fatalf("replacement Query = %#v, want RUNNING on seed id %d", out, seed.Id)
	}
	staged, err := LoadBotConversationContext(context.Background(), "alice", seed.Id)
	if err != nil {
		t.Fatal(err)
	}
	if staged.Replacement == nil || staged.Replacement.ActiveStatus != "RUNNING" ||
		!isDurablePendingRunID(staged.Replacement.ActiveBotRunID) {
		t.Fatalf("replacement not staged as RUNNING pending: %#v", staged.Replacement)
	}
	select {
	case <-botEntered:
	case <-time.After(2 * time.Second):
		t.Fatal("Bot replacement run was not started")
	}
	releaseBot()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		private, loadErr := LoadBotConversationContext(context.Background(), "alice", seed.Id)
		if loadErr != nil {
			t.Fatal(loadErr)
		}
		if private.Replacement == nil {
			break
		}
		if private.Replacement.TerminalResult != nil {
			if private.Replacement.TerminalResult.Status != "FAILED" {
				t.Fatalf("replacement terminal=%#v, want FAILED", private.Replacement.TerminalResult)
			}
			break
		}
		if private.Replacement.ActiveStatus == "RUNNING" || isDurablePendingRunID(private.Replacement.ActiveBotRunID) {
			time.Sleep(10 * time.Millisecond)
			continue
		}
		break
	}
	private, err := LoadBotConversationContext(context.Background(), "alice", seed.Id)
	if err != nil {
		t.Fatal(err)
	}
	if private.Replacement != nil &&
		(private.Replacement.ActiveStatus == "RUNNING" || isDurablePendingRunID(private.Replacement.ActiveBotRunID)) {
		t.Fatalf("unpollable replacement still running: %#v", private.Replacement)
	}
	var row model.QuestionAgentLog
	if err := gdb.First(&row, seed.Id).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != statusSucceeded || row.Answer != seed.Answer {
		t.Fatalf("public replacement row=%#v, want preserved SUCCEEDED", row)
	}
}
