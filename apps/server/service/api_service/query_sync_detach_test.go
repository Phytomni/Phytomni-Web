package api_service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"

	"gorm.io/gorm"
)

func TestQueryDataReturnsRunningWithoutWaiting(t *testing.T) {
	testQueryDetachReturnsRunningWithoutWaiting(t, queryDetachCase{
		tool:         "DataAgent",
		slug:         "data",
		runID:        "run-data-accepted",
		botPath:      "/v1/agents/data/runs",
		clientTurnID: "data-detach-turn-1",
		useV1:        true,
	})
}

func TestQueryReviewReturnsRunningWithoutWaiting(t *testing.T) {
	testQueryDetachReturnsRunningWithoutWaiting(t, queryDetachCase{
		tool:         "ReviewAgent",
		slug:         "review",
		runID:        "run-review-accepted",
		botPath:      "/v1/agents/review/runs",
		clientTurnID: "review-detach-turn-1",
	})
}

type queryDetachCase struct {
	tool         string
	slug         string
	runID        string
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

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != tc.botPath {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		response := map[string]interface{}{
			"id": tc.runID, "run_id": tc.runID,
			"object": "agent.run", "agent": tc.slug,
			"status": "running", "task_ids": []string{},
			"result": map[string]interface{}{},
		}
		if tc.useV1 {
			var request rxBot.AgentRunRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Errorf("decode agent request: %v", err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			if request.Conversation == nil {
				t.Error("missing conversation envelope")
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			response["conversation_context"] = rxBot.ContextStageMetadata{
				SchemaVersion:                  1,
				TurnID:                         request.Conversation.TurnID,
				SelectedAgentID:                tc.tool,
				RouteSource:                    "explicit_selection",
				RouteReasonCode:                "EXPLICIT_SELECTION",
				BaseBusinessContextVersion:     request.Conversation.BaseBusinessContextVersion,
				ProposedBusinessContextVersion: request.Conversation.BaseBusinessContextVersion + 1,
				LastAppliedLedgerCursor:        request.Conversation.LedgerCursor,
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(response)
	}))
	t.Cleanup(func() {
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
	if out.BotRunID != tc.runID || isDurablePendingRunID(out.BotRunID) {
		t.Fatalf("Query BotRunID = %q, want real run %q", out.BotRunID, tc.runID)
	}

	var row model.QuestionAgentLog
	if err := gdb.First(&row, out.Id).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != "RUNNING" || row.BotRunId != tc.runID {
		t.Fatalf("row = %#v, want RUNNING with real run %q", row, tc.runID)
	}
}

func testQueryPendingRunOwnerCancelStaysCancelled(t *testing.T, tc queryDetachCase) {
	t.Helper()
	testQueryStopUsesRealRunBeforeProducerRelease(t, queryRealRunCancelCase{
		tool: tc.tool, slug: tc.slug, runID: tc.runID, botPath: tc.botPath,
	})
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

func waitForDetachedQueryProgress(t *testing.T, gdb *gorm.DB, id int64) model.QuestionAgentLog {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	var row model.QuestionAgentLog
	for time.Now().Before(deadline) {
		if err := gdb.First(&row, id).Error; err != nil {
			t.Fatal(err)
		}
		status := strings.ToUpper(strings.TrimSpace(row.Status))
		switch status {
		case "SUCCEEDED", "FAILED", "INPUT_REQUIRED", "CANCELLED", "TIMED_OUT":
			return row
		}
		if strings.TrimSpace(row.ToolName) != "" {
			return row
		}
		if runID := strings.TrimSpace(row.BotRunId); runID != "" && !isDurablePendingRunID(runID) {
			return row
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("row %d still selecting after 5s: status=%q tool=%q run=%q", id, row.Status, row.ToolName, row.BotRunId)
	return row
}

func waitForReplacementResolved(t *testing.T, username string, rowID int64) persistedConversationContext {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	var private persistedConversationContext
	for time.Now().Before(deadline) {
		got, err := LoadBotConversationContext(context.Background(), username, rowID)
		if err != nil {
			t.Fatal(err)
		}
		private = got
		if private.Replacement == nil {
			time.Sleep(10 * time.Millisecond)
			continue
		}
		if private.Replacement.TerminalResult != nil {
			return private
		}
		if strings.TrimSpace(private.Replacement.ToolName) != "" &&
			!isDurablePendingRunID(private.Replacement.ActiveBotRunID) {
			return private
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("replacement still selecting after 5s: %#v", private.Replacement)
	return private
}

func TestQueryDataPendingRunOwnerCancelStaysCancelled(t *testing.T) {
	testQueryPendingRunOwnerCancelStaysCancelled(t, queryDetachCase{
		tool: "DataAgent", slug: "data", runID: "run-data-stays-cancelled",
		botPath: "/v1/agents/data/runs",
	})
}

func TestQueryReviewPendingRunOwnerCancelStaysCancelled(t *testing.T) {
	testQueryPendingRunOwnerCancelStaysCancelled(t, queryDetachCase{
		tool: "ReviewAgent", slug: "review", runID: "run-review-stays-cancelled",
		botPath: "/v1/agents/review/runs",
	})
}

func TestQueryDataStopUsesRealRunBeforeProducerRelease(t *testing.T) {
	testQueryStopUsesRealRunBeforeProducerRelease(t, queryRealRunCancelCase{
		tool:    "DataAgent",
		slug:    "data",
		runID:   "run-data-gated",
		botPath: "/v1/agents/data/runs",
	})
}

func TestQueryReviewStopUsesRealRunBeforeProducerRelease(t *testing.T) {
	testQueryStopUsesRealRunBeforeProducerRelease(t, queryRealRunCancelCase{
		tool:    "ReviewAgent",
		slug:    "review",
		runID:   "run-review-gated",
		botPath: "/v1/agents/review/runs",
	})
}

type queryRealRunCancelCase struct {
	tool    string
	slug    string
	runID   string
	botPath string
}

func testQueryStopUsesRealRunBeforeProducerRelease(t *testing.T, tc queryRealRunCancelCase) {
	t.Helper()
	gdb := setupExpertTestDB(t)
	producerRelease := make(chan struct{})
	cancelReachedBot := make(chan struct{})
	var cancelOnce sync.Once
	fake := &cancelFakeRunCanceller{
		record: cancelDraftRunRecord(tc.runID, ""),
		onCall: func() {
			select {
			case <-producerRelease:
				t.Error("Stop reached Bot only after the producer was released")
			default:
			}
			cancelOnce.Do(func() { close(cancelReachedBot) })
		},
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != tc.botPath {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"id":"` + tc.runID + `","run_id":"` + tc.runID + `","object":"agent.run","agent":"` + tc.slug + `","status":"running","task_ids":[],"result":{}}`))
	}))
	t.Cleanup(func() {
		select {
		case <-producerRelease:
		default:
			close(producerRelease)
		}
		srv.Close()
		rxBot.BotConfig = nil
	})
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5,
	}

	out, err := (&Service{runCanceller: fake}).Query(context.Background(), "alice", QueryInput{
		Query:   "cancel gated " + tc.tool,
		Mode:    "expert",
		Tool:    tc.tool,
		Surface: QuerySurfaceChat,
	})
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	if out.Status != "RUNNING" || out.BotRunID != tc.runID {
		t.Fatalf("Query = %#v, want RUNNING with real Bot run %q", out, tc.runID)
	}
	var row model.QuestionAgentLog
	if err := gdb.First(&row, out.Id).Error; err != nil {
		t.Fatal(err)
	}
	if row.BotRunId != tc.runID {
		t.Fatalf("persisted Bot run = %q, want %q", row.BotRunId, tc.runID)
	}

	got, err := (&Service{runCanceller: fake}).AgentTaskCancel(context.Background(), out.Id, "alice")
	if err != nil {
		t.Fatalf("AgentTaskCancel: %v", err)
	}
	if got.Phase != "CANCELLED" {
		t.Fatalf("cancel lifecycle = %+v", got)
	}
	select {
	case <-cancelReachedBot:
	case <-time.After(time.Second):
		t.Fatal("Stop did not reach Bot while the producer was gated")
	}
	if len(fake.calls) != 1 || fake.calls[0] != tc.runID {
		t.Fatalf("Bot cancel calls = %q, want [%q]", fake.calls, tc.runID)
	}
	close(producerRelease)
	if err := gdb.First(&row, out.Id).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != "CANCELLED" {
		t.Fatalf("row status = %q, want CANCELLED", row.Status)
	}
}

func TestQueryDataReplacementDetachErrorClearsRunningCandidate(t *testing.T) {
	useConversationV1(t)
	gdb := setupExpertTestDB(t)
	seed := seedResearchReplacementTarget(t, gdb)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/agents/data/runs" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"error":{"code":"invalid_request","message":"invalid request","retryable":false}}`))
	}))
	t.Cleanup(func() {
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
	if err == nil || out != nil {
		t.Fatalf("replacement Query = %#v error = %v, want rejected submission", out, err)
	}
	deadline := time.Now().Add(2 * time.Second)
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

func TestQueryDataReplacementDetachDefiniteFailureKeepsTerminal(t *testing.T) {
	useConversationV1(t)
	gdb := setupExpertTestDB(t)
	seed := seedResearchReplacementTarget(t, gdb)
	var botCalls atomic.Int64
	v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/agents/data/runs" {
			http.NotFound(w, r)
			return
		}
		botCalls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(
			`{"error":{"code":"invalid_request","message":"private upstream detail","retryable":false}}`,
		))
	})

	input := QueryInput{
		Query:        "replace with a table",
		Mode:         "expert",
		Tool:         "DataAgent",
		ClientTurnID: "data-replace-4xx-1",
		RefreshId:    seed.Id,
		Surface:      QuerySurfaceChat,
	}
	out, err := NewService().Query(context.Background(), "alice", input)
	if err == nil || out != nil {
		t.Fatalf("Query=%#v error=%v, want definite submission failure", out, err)
	}

	deadline := time.Now().Add(5 * time.Second)
	var private persistedConversationContext
	for time.Now().Before(deadline) {
		private, err = LoadBotConversationContext(context.Background(), "alice", seed.Id)
		if err != nil {
			t.Fatal(err)
		}
		if private.Replacement == nil {
			t.Fatalf("definite 4xx wiped the replacement envelope")
		}
		if private.Replacement.TerminalResult != nil {
			time.Sleep(50 * time.Millisecond)
			private, err = LoadBotConversationContext(context.Background(), "alice", seed.Id)
			if err != nil {
				t.Fatal(err)
			}
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if private.Replacement == nil || private.Replacement.TerminalResult == nil ||
		private.Replacement.TerminalResult.Status != "FAILED" {
		t.Fatalf("want FAILED replacement terminal, got %#v", private)
	}

	retry, err := NewService().Query(context.Background(), "alice", input)
	if err != nil || retry == nil || retry.Id != seed.Id || retry.Status != "FAILED" {
		t.Fatalf("retry=%+v error=%v", retry, err)
	}
	if got := botCalls.Load(); got != 1 {
		t.Fatalf("Bot calls=%d, want 1", got)
	}
	var row model.QuestionAgentLog
	if err := gdb.First(&row, seed.Id).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != statusSucceeded || row.Answer != seed.Answer {
		t.Fatalf("public replacement row=%#v, want preserved SUCCEEDED", row)
	}
}
