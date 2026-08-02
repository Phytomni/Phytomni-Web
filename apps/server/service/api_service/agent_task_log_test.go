package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"unicode/utf8"

	rxBot "phytomni-server/external/bot"
)

const testAgentTaskLogTextLimit = 512 << 10

type agentTaskLogFakeReader struct {
	logs     *rxBot.RunLogsResponse
	logsErr  error
	logCalls int
	runIDs   []string
}

func (f *agentTaskLogFakeReader) GetRunWithMeta(context.Context, string) (*rxBot.RunRecord, rxBot.ResponseMeta, error) {
	return nil, rxBot.ResponseMeta{}, errors.New("unexpected run request")
}

func (f *agentTaskLogFakeReader) GetRunLogs(_ context.Context, runID string) (*rxBot.RunLogsResponse, error) {
	f.logCalls++
	f.runIDs = append(f.runIDs, runID)
	return f.logs, f.logsErr
}

type agentTaskLogResponse struct {
	State                   string  `json:"state"`
	Source                  string  `json:"source"`
	Text                    string  `json:"text"`
	Revision                int64   `json:"revision"`
	Truncated               bool    `json:"truncated"`
	CanRequestLegacyRefresh bool    `json:"can_request_legacy_refresh"`
	ErrorCode               *string `json:"error_code"`
}

func decodeAgentTaskLogResponse(t *testing.T, value interface{}) agentTaskLogResponse {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal log response: %v", err)
	}
	var got agentTaskLogResponse
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("log response must be a DTO: %v (raw %s)", err, raw)
	}
	return got
}

func seedAgentTaskLogRow(t *testing.T, id int64, username, runID, taskID, taskLog, status string, revision int64) {
	t.Helper()
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, bot_run_id, task_id, task_log, status, bot_report_revision)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, id, username, runID, taskID, taskLog, status, revision).Error; err != nil {
		t.Fatalf("seed log row: %v", err)
	}
}

func TestAgentTaskLogModernRunReturnsAllowlistedText(t *testing.T) {
	seedAgentTaskLogRow(t, 81, "alice", "run-81", "", "", "RUNNING", 7)
	fake := &agentTaskLogFakeReader{logs: &rxBot.RunLogsResponse{TaskLogs: []map[string]interface{}{
		{"status": "queued", "message": "safe message", "log": "safe log", "text": "safe text", "formatted": map[string]interface{}{"answer": "safe answer"}},
	}}}

	value, err := (&Service{runReader: fake}).AnalystAgentGetLog(context.Background(), 81, "alice")
	if err != nil {
		t.Fatalf("AnalystAgentGetLog: %v", err)
	}
	got := decodeAgentTaskLogResponse(t, value)
	if got.State != "AVAILABLE" || got.Source != "BOT_RUN" || got.Text != "queued\nsafe message\nsafe log\nsafe text\nsafe answer" || got.Revision != 7 || got.Truncated || got.CanRequestLegacyRefresh || got.ErrorCode != nil {
		t.Fatalf("log DTO = %+v", got)
	}
	if fake.logCalls != 1 || len(fake.runIDs) != 1 || fake.runIDs[0] != "run-81" {
		t.Fatalf("run log calls = %d %v, want one run-81 call", fake.logCalls, fake.runIDs)
	}
}

func TestAgentTaskLogModernEmptyLogsReflectStoredLifecycle(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status string
		state  string
	}{
		{name: "nonterminal", status: "RUNNING", state: "PENDING"},
		{name: "terminal", status: "SUCCEEDED", state: "TERMINAL_EMPTY"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			seedAgentTaskLogRow(t, 82, "alice", "run-82", "", "", tc.status, 0)
			fake := &agentTaskLogFakeReader{logs: &rxBot.RunLogsResponse{}}
			value, err := (&Service{runReader: fake}).AnalystAgentGetLog(context.Background(), 82, "alice")
			if err != nil {
				t.Fatalf("AnalystAgentGetLog: %v", err)
			}
			got := decodeAgentTaskLogResponse(t, value)
			if got.State != tc.state || got.Source != "BOT_RUN" || got.Text != "" || got.ErrorCode != nil || fake.logCalls != 1 {
				t.Fatalf("log DTO = %+v, calls=%d", got, fake.logCalls)
			}
		})
	}
}

func TestAgentTaskLogModernFailureIsDegradedWithoutRawError(t *testing.T) {
	seedAgentTaskLogRow(t, 83, "alice", "run-83", "", "", "RUNNING", 1)
	fake := &agentTaskLogFakeReader{logsErr: errors.New("credentials and /private/path must not escape")}

	value, err := (&Service{runReader: fake}).AnalystAgentGetLog(context.Background(), 83, "alice")
	if err != nil {
		t.Fatalf("AnalystAgentGetLog: %v", err)
	}
	got := decodeAgentTaskLogResponse(t, value)
	if got.State != "DEGRADED" || got.Source != "BOT_RUN" || got.Text != "" || got.ErrorCode == nil || *got.ErrorCode != "log_refresh_unavailable" || strings.Contains(got.Text, "private") {
		t.Fatalf("log DTO = %+v", got)
	}
}

func TestAgentTaskLogLegacyRowsUsePersistedTextAndCanRefresh(t *testing.T) {
	for _, tc := range []struct {
		name  string
		log   string
		state string
	}{
		{name: "available", log: "legacy progress", state: "AVAILABLE"},
		{name: "blank", log: "", state: "PENDING"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			seedAgentTaskLogRow(t, 84, "alice", "", "task-84", tc.log, "RUNNING", -1)
			fake := &agentTaskLogFakeReader{}
			value, err := (&Service{runReader: fake}).AnalystAgentGetLog(context.Background(), 84, "alice")
			if err != nil {
				t.Fatalf("AnalystAgentGetLog: %v", err)
			}
			got := decodeAgentTaskLogResponse(t, value)
			if got.State != tc.state || got.Source != "LEGACY_TASK" || got.Text != tc.log || !got.CanRequestLegacyRefresh || got.ErrorCode != nil || fake.logCalls != 0 {
				t.Fatalf("log DTO = %+v, calls=%d", got, fake.logCalls)
			}
		})
	}
}

func TestAgentTaskLogDropsUnknownAndSensitiveMapValues(t *testing.T) {
	seedAgentTaskLogRow(t, 85, "alice", "run-85", "", "", "RUNNING", 0)
	fake := &agentTaskLogFakeReader{logs: &rxBot.RunLogsResponse{TaskLogs: []map[string]interface{}{
		{
			"status":        "safe status",
			"authorization": "Bearer secret-token",
			"headers":       map[string]interface{}{"X-Key": "secret"},
			"payload":       map[string]interface{}{"path": "/private/path"},
			"path":          "/private/path",
			"arbitrary":     "must not appear",
			"formatted":     map[string]interface{}{"answer": "safe answer", "credentials": "secret"},
		},
	}}}

	value, err := (&Service{runReader: fake}).AnalystAgentGetLog(context.Background(), 85, "alice")
	if err != nil {
		t.Fatalf("AnalystAgentGetLog: %v", err)
	}
	got := decodeAgentTaskLogResponse(t, value)
	if got.Text != "safe status\nsafe answer" {
		t.Fatalf("text = %q", got.Text)
	}
	for _, forbidden := range []string{"secret", "private", "arbitrary", "Bearer"} {
		if strings.Contains(got.Text, forbidden) {
			t.Fatalf("public text leaked %q: %q", forbidden, got.Text)
		}
	}
}

func TestAgentTaskLogKeepsBoundedValidUTF8Suffix(t *testing.T) {
	const runeText = "界"
	oversized := strings.Repeat(runeText, testAgentTaskLogTextLimit/len(runeText)+10)
	seedAgentTaskLogRow(t, 86, "alice", "run-86", "", "", "RUNNING", 0)
	fake := &agentTaskLogFakeReader{logs: &rxBot.RunLogsResponse{TaskLogs: []map[string]interface{}{{"text": oversized}}}}

	value, err := (&Service{runReader: fake}).AnalystAgentGetLog(context.Background(), 86, "alice")
	if err != nil {
		t.Fatalf("AnalystAgentGetLog: %v", err)
	}
	got := decodeAgentTaskLogResponse(t, value)
	wantLength := testAgentTaskLogTextLimit - testAgentTaskLogTextLimit%len(runeText)
	if !got.Truncated || !utf8.ValidString(got.Text) || len(got.Text) != wantLength || !strings.HasSuffix(oversized, got.Text) {
		t.Fatalf("bounded suffix: bytes=%d valid=%v suffix=%v truncated=%v", len(got.Text), utf8.ValidString(got.Text), strings.HasSuffix(oversized, got.Text), got.Truncated)
	}
}

func TestAgentTaskLogMissingAndCrossOwnerShareNotFoundWithoutBotCalls(t *testing.T) {
	seedAgentTaskLogRow(t, 87, "bob", "run-87", "task-87", "private", "RUNNING", 0)
	fake := &agentTaskLogFakeReader{}
	service := &Service{runReader: fake}

	_, missingErr := service.AnalystAgentGetLog(context.Background(), 404, "alice")
	_, foreignErr := service.AnalystAgentGetLog(context.Background(), 87, "alice")
	if missingErr == nil || foreignErr == nil || missingErr.Error() != "agent task log not found" || foreignErr.Error() != "agent task log not found" || missingErr.Error() != foreignErr.Error() {
		t.Fatalf("missing=%v foreign=%v, want same owner-scoped not found", missingErr, foreignErr)
	}
	if fake.logCalls != 0 {
		t.Fatalf("Bot calls = %d, want zero", fake.logCalls)
	}
}
