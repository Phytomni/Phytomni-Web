package api_handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"phytomni-server/common/i18n"
	"phytomni-server/db"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestConversationArtifactRetryReturnsOnlyBoundedPendingDelivery(t *testing.T) {
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if sqlDB, err := gdb.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	if err := gdb.Exec(`CREATE TABLE question_agent_logs (
		id INTEGER PRIMARY KEY,
		dialogue_id TEXT,
		user_name TEXT,
		bot_run_id TEXT,
		status TEXT,
		bot_projection_json TEXT,
		bot_report_revision INTEGER,
		delete_at DATETIME
	)`).Error; err != nil {
		t.Fatal(err)
	}
	db.Set("phytomni-server", gdb)
	projection := `{"run_id":"run-retry","status":"SUCCEEDED","report_revision":3,"result_archive_v1":true,"delivery":{"schema_version":1,"required":true,"status":"pending","revision":3,"inventory_digest":"sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","retryable":false}}`
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, user_name, bot_run_id, status, bot_projection_json, bot_report_revision)
		VALUES (701, 'dlg-retry', 'alice', 'run-retry', 'RUNNING', ?, 3)`, projection).Error; err != nil {
		t.Fatal(err)
	}

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/conversations/dlg-retry/messages/701/artifacts/archive/retry", strings.NewReader(`{"ignored":"body is not accepted"}`))
	c.Params = gin.Params{{Key: "id", Value: "dlg-retry"}, {Key: "message_id", Value: "701"}}
	c.Set("username", "alice")
	i18n.Localize()(c)
	NewHandler().ConversationArtifactRetry(c)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "sha256:") || strings.Contains(w.Body.String(), "obs://") || strings.Contains(w.Body.String(), "download_ref") || strings.Contains(w.Body.String(), "token") {
		t.Fatalf("retry response leaked internal delivery data: %s", w.Body.String())
	}
	var response struct {
		Code int `json:"code"`
		Data struct {
			Status   string `json:"status"`
			Revision int64  `json:"revision"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || response.Data.Status != "pending" || response.Data.Revision != 3 {
		t.Fatalf("response=%+v", response)
	}

	for _, username := range []string{"bob", "alice"} {
		foreign := httptest.NewRecorder()
		foreignCtx, _ := gin.CreateTestContext(foreign)
		foreignCtx.Request = c.Request
		foreignCtx.Params = gin.Params{{Key: "id", Value: "other-dialogue"}, {Key: "message_id", Value: "701"}}
		if username == "bob" {
			foreignCtx.Params = c.Params
		}
		foreignCtx.Set("username", username)
		i18n.Localize()(foreignCtx)
		NewHandler().ConversationArtifactRetry(foreignCtx)
		if foreign.Code != http.StatusNotFound {
			t.Fatalf("username=%s status=%d body=%s", username, foreign.Code, foreign.Body.String())
		}
	}
}
