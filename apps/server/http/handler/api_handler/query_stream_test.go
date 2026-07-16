package api_handler

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"phytomni-server/db"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupStreamHandlerTestDB(t *testing.T) *gorm.DB {
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
		dialogue_id TEXT, f_id INTEGER DEFAULT 0, server_id TEXT, bot_run_id TEXT, bot_projection_json TEXT, bot_report_revision INTEGER NOT NULL DEFAULT -1,
		user_name TEXT, query TEXT, title_query TEXT, answer TEXT,
		follow_up_questions TEXT, task_id TEXT, task_log TEXT, file_name TEXT,
		upload_path TEXT, download_path TEXT, image_paths TEXT, compute_resource TEXT,
		server_file_path TEXT, tool_name TEXT, status TEXT, log_status TEXT, mode TEXT,
		reaction_type TEXT, collect_type TEXT, created_at DATETIME, updated_at DATETIME, delete_at DATETIME
	)`).Error; err != nil {
		t.Fatalf("create question_agent_logs: %v", err)
	}
	db.Set("phytomni-server", gdb)
	return gdb
}

// newStreamTestRequest builds a multipart /query request with a NON-empty
// query field: the handler 400s on empty query (query.go:82-85) BEFORE the
// SSE branch point, so an empty body could never discriminate the flag/mode
// gates (mutation-weak). mode="" omits the field (handler defaults instant).
func newStreamTestRequest(t *testing.T, mode string) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("query", "hello")
	if mode != "" {
		_ = mw.WriteField("mode", mode)
	}
	_ = mw.Close()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/conversations/0/messages", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Accept", "text/event-stream")
	return req
}

func TestQuery_FlagOffSkipsStream(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rxBot.BotConfig = &rxBot.Config{ProxyEnabled: true, StreamEnabled: false}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("username", "alice@example.com")
	c.Request = newStreamTestRequest(t, "")
	c.Params = gin.Params{{Key: "id", Value: "0"}}

	ph := NewHandler()
	ph.Query(c)
	// Flag OFF ⇒ must NOT switch to event-stream content type.
	if ct := w.Header().Get("Content-Type"); strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("flag OFF must not produce an SSE response; got Content-Type %q", ct)
	}
}

func TestQuery_ExpertModeSkipsStream(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rxBot.BotConfig = &rxBot.Config{ProxyEnabled: true, StreamEnabled: true}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("username", "alice@example.com")
	c.Request = newStreamTestRequest(t, "expert")
	c.Params = gin.Params{{Key: "id", Value: "0"}}

	ph := NewHandler()
	ph.Query(c)
	// Flag ON + Accept SSE + mode=expert ⇒ must fall through to the blocking
	// path (which owns RouteQuery dispatch and the expert_enabled dark gate;
	// with ExpertEnabled unset it answers 503 JSON, never an SSE stream).
	if ct := w.Header().Get("Content-Type"); strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("expert mode must never stream; got Content-Type %q", ct)
	}
}

func TestWantsStream(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/x", nil)
	c.Request.Header.Set("Accept", "text/event-stream")
	if !wantsStream(c) {
		t.Fatal("wantsStream must be true for Accept: text/event-stream")
	}
	c.Request.Header.Set("Accept", "application/json")
	if wantsStream(c) {
		t.Fatal("wantsStream must be false for Accept: application/json")
	}
}

func TestQuery_StreamPreFirstByteErrorIsJSON(t *testing.T) {
	gin.SetMode(gin.TestMode)
	// Flag ON so the SSE branch is entered, but ProxyEnabled false so
	// QueryStream returns ErrGatewayDisabled BEFORE forwarding any frame.
	rxBot.BotConfig = &rxBot.Config{ProxyEnabled: false, StreamEnabled: true}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("username", "alice@example.com")
	c.Request = newStreamTestRequest(t, "instant")
	c.Params = gin.Params{{Key: "id", Value: "0"}}

	ph := NewHandler()
	ph.Query(c)
	// A pre-first-byte failure must ship as a normal JSON error, NOT an SSE
	// response: the lazy-header pattern keeps Content-Type unset until the
	// first frame, so ctx.JSON can label the body application/json.
	if ct := w.Header().Get("Content-Type"); strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("pre-first-byte error must not carry an SSE content type; got %q", ct)
	}
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 (ErrGatewayDisabled)", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("error body must be application/json; got %q", ct)
	}
}

func TestQuery_StreamExposesDurableIdentityHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)
	gdb := setupStreamHandlerTestDB(t)
	body := strings.Join([]string{
		"event: RunStarted\ndata: {\"type\":\"RunStarted\",\"run_id\":\"run_headers\"}\n",
		"event: TextMessageContent\ndata: {\"type\":\"TextMessageContent\",\"delta\":\"hello\"}\n",
		"event: RunFinished\ndata: {\"type\":\"RunFinished\",\"run_id\":\"run_headers\"}\n",
	}, "\n")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, StreamEnabled: true, TimeoutSeconds: 5,
	}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("username", "headers@example.com")
	c.Request = newStreamTestRequest(t, "instant")
	c.Params = gin.Params{{Key: "id", Value: "0"}}

	NewHandler().Query(c)
	if w.Code != http.StatusOK {
		t.Fatalf("stream status = %d, body = %q", w.Code, w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("Content-Type = %q, want text/event-stream", ct)
	}
	dialogueID := w.Header().Get("X-Phyto-Dialogue-Id")
	messageID := w.Header().Get("X-Phyto-Message-Id")
	if dialogueID == "" || messageID == "" || messageID == "0" {
		t.Fatalf("missing stream identity headers: dialogue=%q message=%q", dialogueID, messageID)
	}
	var row model.QuestionAgentLog
	if err := gdb.Where("id = ?", messageID).First(&row).Error; err != nil {
		t.Fatalf("identity header does not reference a durable row: %v", err)
	}
	if row.DialogueId != dialogueID || row.BotRunId != "run_headers" || row.Status != "SUCCEEDED" {
		t.Fatalf("header row = dialogue %q run %q status %q", row.DialogueId, row.BotRunId, row.Status)
	}
	if !strings.Contains(w.Body.String(), "TextMessageContent") {
		t.Fatalf("stream body missing content frame: %q", w.Body.String())
	}
}
