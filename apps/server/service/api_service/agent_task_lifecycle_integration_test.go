package api_service

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

// Mutation coverage: bypassing the persisted projection, polling terminal rows,
// or dropping the owner predicate makes one of the lifecycle reads below wrong.
func TestAnalystRunLifecycleProgressesFromSubmissionToCachedTerminal(t *testing.T) {
	gdb := setupExpertTestDB(t)

	runCalls := 0
	logCalls := 0
	bot := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/agents/analyst/runs":
			_, _ = w.Write([]byte(`{"id":"run-b5-1","object":"agent.run","agent":"analyst","status":"running","task_ids":[],"result":{}}`))
		case "/v1/runs/run-b5-1":
			runCalls++
			responses := []string{
				`{"run_id":"run-b5-1","agent":"analyst","status":"running","task_ids":[],"result":{}}`,
				`{"run_id":"run-b5-1","agent":"analyst","status":"running","task_ids":["child-b5-1"],"result":{}}`,
				`{"run_id":"run-b5-1","agent":"analyst","status":"running","task_ids":["child-b5-1"],"result":{"report_stage":"intermediate","report_revision":1,"intermediate_report":"Synthetic revision one"}}`,
				`{"run_id":"run-b5-1","agent":"analyst","status":"succeeded","task_ids":["child-b5-1"],"result":{"report_stage":"final","report_revision":2,"final_report":"Synthetic revision two"}}`,
			}
			if runCalls > len(responses) {
				t.Errorf("unexpected terminal Bot poll %d", runCalls)
				return
			}
			_, _ = w.Write([]byte(responses[runCalls-1]))
		case "/v1/runs/run-b5-1/logs":
			logCalls++
			if logCalls == 1 {
				_, _ = w.Write([]byte(`{"run_id":"run-b5-1","task_ids":["child-b5-1"],"task_logs":[]}`))
				return
			}
			_, _ = w.Write([]byte(`{"run_id":"run-b5-1","task_ids":["child-b5-1"],"task_logs":[{"status":"running","message":"Synthetic log materialized"}]}`))
		default:
			t.Errorf("unexpected Bot request %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(bot.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: bot.URL, ProxyEnabled: true, ExpertEnabled: true, TimeoutSeconds: 1,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	submission, err := rxBot.NewClient().InvokeAgent(context.Background(), "analyst", rxBot.AgentRunRequest{
		Arguments: map[string]interface{}{},
	})
	if err != nil {
		t.Fatalf("submit analyst run: %v", err)
	}
	if submission.ID == nil || *submission.ID != "run-b5-1" || submission.Status != "running" {
		t.Fatalf("submission=%+v", submission)
	}
	row := model.QuestionAgentLog{UserName: "owner-b5", BotRunId: *submission.ID, Status: "RUNNING", ToolName: "AnalystAgent", BotReportRevision: -1}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatalf("persist submitted run: %v", err)
	}
	service := NewService()

	assertLifecycle := func(wantPhase string, wantChildren int, wantRevision int64, wantTerminal bool) {
		t.Helper()
		got, lifecycleErr := service.AgentTaskLifecycle(context.Background(), row.Id, "owner-b5")
		if lifecycleErr != nil {
			t.Fatalf("read lifecycle: %v", lifecycleErr)
		}
		if got.Phase != wantPhase || got.ChildTaskCount != wantChildren || got.ReportRevision != wantRevision || got.Terminal != wantTerminal {
			t.Fatalf("lifecycle=%+v, want %s/%d/revision %d/terminal %v", got, wantPhase, wantChildren, wantRevision, wantTerminal)
		}
	}

	assertLifecycle("RUNNING", 0, 0, false)
	assertLifecycle("RUNNING", 1, 0, false)

	pending, err := service.AnalystAgentGetLog(context.Background(), int(row.Id), "owner-b5")
	if err != nil || pending.State != "PENDING" || pending.Text != "" {
		t.Fatalf("pending log=%+v err=%v", pending, err)
	}

	assertLifecycle("RUNNING", 1, 1, false)
	available, err := service.AnalystAgentGetLog(context.Background(), int(row.Id), "owner-b5")
	if err != nil || available.State != "AVAILABLE" || available.Text != "running\nSynthetic log materialized" {
		t.Fatalf("available log=%+v err=%v", available, err)
	}

	assertLifecycle("SUCCEEDED", 1, 2, true)
	if runCalls != 4 || logCalls != 2 {
		t.Fatalf("Bot calls before cache check = runs:%d logs:%d", runCalls, logCalls)
	}

	assertLifecycle("SUCCEEDED", 1, 2, true)
	if runCalls != 4 {
		t.Fatalf("terminal lifecycle polled Bot %d times", runCalls)
	}

	beforeForeignReads := runCalls + logCalls
	_, lifecycleErr := service.AgentTaskLifecycle(context.Background(), row.Id, "owner-b5-other")
	_, logErr := service.AnalystAgentGetLog(context.Background(), int(row.Id), "owner-b5-other")
	if !errors.Is(lifecycleErr, ErrAgentTaskLifecycleNotFound) || !errors.Is(logErr, ErrAgentTaskLogNotFound) {
		t.Fatalf("foreign errors = %v / %v", lifecycleErr, logErr)
	}
	if runCalls+logCalls != beforeForeignReads {
		t.Fatalf("foreign lifecycle/log reads made Bot calls: runs:%d logs:%d", runCalls, logCalls)
	}
}
