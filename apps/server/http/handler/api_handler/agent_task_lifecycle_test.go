package api_handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"phytomni-server/common/i18n"
	"phytomni-server/db"
	rxBot "phytomni-server/external/bot"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupAgentTaskLifecycleHandlerDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if sqlDB, err := gdb.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	if err := gdb.Exec(`CREATE TABLE question_agent_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_name TEXT NOT NULL,
		bot_run_id TEXT,
		task_id TEXT,
		task_log TEXT,
		status TEXT,
		answer TEXT,
		download_path TEXT,
		image_paths TEXT,
		bot_projection_json TEXT,
		bot_report_revision INTEGER NOT NULL DEFAULT -1
	)`).Error; err != nil {
		t.Fatalf("create question_agent_logs: %v", err)
	}
	db.Set("phytomni-server", gdb)
	return gdb
}

func lifecycleHandlerRequest(t *testing.T, handler *Handler, id, username string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/async-tasks/"+id+"/lifecycle?username=browser-owner&run_id=browser-run&child_id=browser-child", nil)
	ctx.Params = gin.Params{{Key: "id", Value: id}}
	ctx.Set("username", username)
	i18n.Localize()(ctx)
	handler.AgentTaskLifecycle(ctx)
	return recorder
}

func TestAgentTaskLifecycleRejectsInvalidID(t *testing.T) {
	setupAgentTaskLifecycleHandlerDB(t)
	handler := NewHandler()

	for _, id := range []string{"0", "-1", "abc", "9223372036854775808"} {
		t.Run(id, func(t *testing.T) {
			recorder := lifecycleHandlerRequest(t, handler, id, "alice")
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status for id %q = %d, want %d", id, recorder.Code, http.StatusBadRequest)
			}
		})
	}
}

func TestAgentTaskLifecycleUsesAuthenticatedOwnerOnly(t *testing.T) {
	gdb := setupAgentTaskLifecycleHandlerDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, status, answer, bot_report_revision) VALUES
		(41, 'alice', 'SUCCEEDED', 'final report', 3)`).Error; err != nil {
		t.Fatalf("seed task: %v", err)
	}

	recorder := lifecycleHandlerRequest(t, NewHandler(), "41", "alice")
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	var envelope struct {
		Code int `json:"code"`
		Data struct {
			ID             int64   `json:"id"`
			Reconciliation string  `json:"reconciliation"`
			ErrorCode      *string `json:"error_code"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if envelope.Code != http.StatusOK || envelope.Data.ID != 41 || envelope.Data.Reconciliation != "CACHED" || envelope.Data.ErrorCode != nil {
		t.Fatalf("unexpected lifecycle envelope: %+v", envelope)
	}
}

func TestAgentTaskLifecycleMissingAndCrossOwnerShareNotFoundResponse(t *testing.T) {
	gdb := setupAgentTaskLifecycleHandlerDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs (id, user_name, status, bot_report_revision) VALUES (42, 'bob', 'SUCCEEDED', 0)`).Error; err != nil {
		t.Fatalf("seed foreign task: %v", err)
	}
	handler := NewHandler()

	missing := lifecycleHandlerRequest(t, handler, "404", "alice")
	foreign := lifecycleHandlerRequest(t, handler, "42", "alice")
	if missing.Code != http.StatusNotFound || foreign.Code != http.StatusNotFound {
		t.Fatalf("missing=%d foreign=%d, both must be 404", missing.Code, foreign.Code)
	}
	if missing.Body.String() != foreign.Body.String() {
		t.Fatalf("missing and cross-owner responses differ: missing=%s foreign=%s", missing.Body.String(), foreign.Body.String())
	}
}

func TestAgentTaskLifecycleReturnsDegradedStateSuccessfully(t *testing.T) {
	previousConfig := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{BaseURL: "http://127.0.0.1:1", TimeoutSeconds: 1}
	t.Cleanup(func() { rxBot.BotConfig = previousConfig })
	gdb := setupAgentTaskLifecycleHandlerDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, bot_run_id, status, bot_projection_json, bot_report_revision) VALUES
		(43, 'alice', 'run-43', 'RUNNING', '{"status":"RUNNING","tracking_degraded":true}', 1)`).Error; err != nil {
		t.Fatalf("seed task: %v", err)
	}

	recorder := lifecycleHandlerRequest(t, NewHandler(), "43", "alice")
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	var envelope struct {
		Data struct {
			Reconciliation   string  `json:"reconciliation"`
			TrackingDegraded bool    `json:"tracking_degraded"`
			ErrorCode        *string `json:"error_code"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if envelope.Data.Reconciliation != "DEGRADED" || !envelope.Data.TrackingDegraded || envelope.Data.ErrorCode == nil || *envelope.Data.ErrorCode != "bot_transport_failed" {
		t.Fatalf("unexpected degraded lifecycle data: %+v", envelope.Data)
	}
}

func analystLogHandlerRequest(t *testing.T, handler *Handler, id, username string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/async-tasks/"+id+"/analyst-log", nil)
	ctx.Params = gin.Params{{Key: "id", Value: id}}
	ctx.Set("username", username)
	i18n.Localize()(ctx)
	handler.AnalystAgentGetLog(ctx)
	return recorder
}

func TestAgentTaskLogHandlerReturnsBoundedDTOAndSharedNotFound(t *testing.T) {
	gdb := setupAgentTaskLifecycleHandlerDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, task_id, task_log, status, bot_report_revision) VALUES
		(51, 'alice', 'task-51', 'persisted legacy log', 'RUNNING', 0),
		(52, 'bob', 'task-52', 'private log', 'RUNNING', 0)`).Error; err != nil {
		t.Fatalf("seed task logs: %v", err)
	}
	handler := NewHandler()

	ok := analystLogHandlerRequest(t, handler, "51", "alice")
	if ok.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", ok.Code, http.StatusOK, ok.Body.String())
	}
	var envelope struct {
		Code int `json:"code"`
		Data struct {
			State                   string  `json:"state"`
			Source                  string  `json:"source"`
			Text                    string  `json:"text"`
			CanRequestLegacyRefresh bool    `json:"can_request_legacy_refresh"`
			ErrorCode               *string `json:"error_code"`
		} `json:"data"`
	}
	if err := json.Unmarshal(ok.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if envelope.Code != http.StatusOK || envelope.Data.State != "AVAILABLE" || envelope.Data.Source != "LEGACY_TASK" || envelope.Data.Text != "persisted legacy log" || !envelope.Data.CanRequestLegacyRefresh || envelope.Data.ErrorCode != nil {
		t.Fatalf("unexpected log envelope: %+v", envelope)
	}

	missing := analystLogHandlerRequest(t, handler, "404", "alice")
	foreign := analystLogHandlerRequest(t, handler, "52", "alice")
	if missing.Code != http.StatusNotFound || foreign.Code != http.StatusNotFound || missing.Body.String() != foreign.Body.String() {
		t.Fatalf("missing=%d/%s foreign=%d/%s, want same 404", missing.Code, missing.Body.String(), foreign.Code, foreign.Body.String())
	}
}
