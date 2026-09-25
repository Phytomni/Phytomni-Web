package api_handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"phytomni-server/common/i18n"
	"phytomni-server/db"
	"phytomni-server/middleware"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/spf13/viper"
	"gorm.io/gorm"
)

func TestConversationArtifactDownloadURLSignsOnlyAuthorizedClick(t *testing.T) {
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
		f_id INTEGER,
		user_name TEXT,
		status TEXT,
		bot_projection_json TEXT,
		bot_report_revision INTEGER,
		delete_at DATETIME
	)`).Error; err != nil {
		t.Fatal(err)
	}
	db.Set("phytomni-server", gdb)
	previousSecret := viper.GetString("jwt.secret_key")
	viper.Set("jwt.secret_key", "conversation-artifact-test-secret")
	t.Cleanup(func() { viper.Set("jwt.secret_key", previousSecret) })
	projection := `{"artifacts":{"directories":["obs://bucket/alice/run-1"],"paths":["obs://bucket/alice/run-1/report.pdf"]},"report_revision":1}`
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, user_name, status, bot_projection_json, bot_report_revision)
		VALUES (120, 'dlg-artifact', 'alice', 'SUCCEEDED', ?, 1)`, projection).Error; err != nil {
		t.Fatal(err)
	}

	// Derive the opaque ID from the same public identity contract without
	// placing the underlying object path in the request.
	const artifactID = "918fec8b00c0d0bf9514cccd985e29894656a221f03aebe5d4bc20b288693568"
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/conversations/dlg-artifact/messages/120/artifacts/"+artifactID+"/download-url", nil)
	c.Params = gin.Params{
		{Key: "id", Value: "dlg-artifact"},
		{Key: "message_id", Value: "120"},
		{Key: "artifact_id", Value: artifactID},
	}
	c.Set("username", "alice")
	i18n.Localize()(c)
	NewHandler().ConversationArtifactDownloadURL(c)
	if w.Code != http.StatusOK {
		t.Fatalf("unexpected status for authorized click: %d body=%s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "obs://") {
		t.Fatalf("response exposed storage path: %s", w.Body.String())
	}
	var response struct {
		Code int    `json:"code"`
		Data string `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || !strings.Contains(response.Data, "/api/v1/downloads/relay-file?token=") {
		t.Fatalf("unexpected click response: %#v", response)
	}
	if _, err := middleware.ParseDownloadToken(strings.TrimPrefix(response.Data, "/api/v1/downloads/relay-file?token=")); err != nil {
		t.Fatalf("click response did not contain a valid relay token: %v", err)
	}

	// A caller cannot replace the authenticated owner with another identity.
	foreign := httptest.NewRecorder()
	foreignCtx, _ := gin.CreateTestContext(foreign)
	foreignCtx.Request = c.Request
	foreignCtx.Params = c.Params
	foreignCtx.Set("username", "bob")
	i18n.Localize()(foreignCtx)
	NewHandler().ConversationArtifactDownloadURL(foreignCtx)
	if foreign.Code != http.StatusNotFound {
		t.Fatalf("foreign click status = %d, want 404", foreign.Code)
	}
}
