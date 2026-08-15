package api_handler

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"phytomni-server/db"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
	"phytomni-server/service/api_service"

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
	if err := gdb.Exec(`CREATE TABLE users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT,
		code TEXT
	)`).Error; err != nil {
		t.Fatalf("create users: %v", err)
	}
	if err := gdb.Exec(`INSERT INTO users (email, code) VALUES
		('alice@example.com', 'admin'),
		('headers@example.com', 'admin')`).Error; err != nil {
		t.Fatalf("seed stream users: %v", err)
	}
	db.Set("phytomni-server", gdb)
	return gdb
}

// newStreamTestRequest builds a multipart /query request with a NON-empty
// query field: the handler 400s on empty query (query.go:82-85) BEFORE the
// SSE branch point, so an empty body could never discriminate the flag/mode
// gates (mutation-weak). mode="" omits the field (handler defaults instant).
func newStreamTestRequest(t *testing.T, mode string) *http.Request {
	return newStreamTestRequestWithTurn(t, mode, "")
}

func newStreamTestRequestWithTurn(
	t *testing.T,
	mode string,
	clientTurnID string,
) *http.Request {
	return newStreamTestRequestWithQueryAndTurn(t, "hello", mode, clientTurnID)
}

func newStreamTestRequestWithQueryAndTurn(
	t *testing.T,
	query string,
	mode string,
	clientTurnID string,
) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("query", query)
	if mode != "" {
		_ = mw.WriteField("mode", mode)
	}
	if clientTurnID != "" {
		_ = mw.WriteField("client_turn_id", clientTurnID)
	}
	_ = mw.Close()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/conversations/0/messages", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Accept", "text/event-stream")
	return req
}

func newForcedExpertStreamTestRequest(t *testing.T, tool string) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("query", "forced report")
	_ = mw.WriteField("mode", "expert")
	_ = mw.WriteField("tool", tool)
	_ = mw.Close()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/conversations/0/messages", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Accept", "text/event-stream")
	return req
}

func TestQuery_FlagOffSkipsStream(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupStreamHandlerTestDB(t)
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

func TestQuery_AutonomousExpertModeSkipsStream(t *testing.T) {
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

func TestQuery_ForcedExpertChatFamilyUsesStreamBranch(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupStreamHandlerTestDB(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("path = %q, want /v1/chat/completions", r.URL.Path)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(strings.Join([]string{
			`event: RunStarted` + "\n" + `data: {"type":"RunStarted","run_id":"run-handler-expert"}` + "\n",
			`event: TextMessageContent` + "\n" + `data: {"type":"TextMessageContent","delta":"# report"}` + "\n",
			`event: RunFinished` + "\n" + `data: {"type":"RunFinished","run_id":"run-handler-expert"}` + "\n",
		}, "\n")))
	}))
	t.Cleanup(srv.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, ExpertEnabled: true,
		StreamEnabled: true, TimeoutSeconds: 5,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("username", "alice@example.com")
	c.Request = newForcedExpertStreamTestRequest(t, "KnowledgeAgent")
	c.Params = gin.Params{{Key: "id", Value: "0"}}

	NewHandler().Query(c)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", w.Code, w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("Content-Type = %q, want text/event-stream", ct)
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

func TestQuery_SettledKeyedStreamRetryReplaysTerminalSnapshot(t *testing.T) {
	gin.SetMode(gin.TestMode)
	gdb := setupStreamHandlerTestDB(t)
	var botCalls atomic.Int64
	const streamBody = "event: RunStarted\ndata: {\"type\":\"RunStarted\",\"run_id\":\"run-handler-replay\"}\n\n" +
		"event: TextMessageContent\ndata: {\"type\":\"TextMessageContent\",\"delta\":\"stored answer\"}\n\n" +
		"event: Custom\ndata: {\"type\":\"Custom\",\"name\":\"phyto.follow_up\",\"value\":[\"next question\"]}\n\n" +
		"event: RunFinished\ndata: {\"type\":\"RunFinished\",\"run_id\":\"run-handler-replay\"}\n\n"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		botCalls.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(streamBody))
	}))
	t.Cleanup(server.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true, StreamEnabled: true,
		MultiturnV1Enabled: false, TimeoutSeconds: 2,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	run := func() *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(w)
		ctx.Set("username", "headers@example.com")
		ctx.Request = newStreamTestRequestWithTurn(t, "instant", "handler-replay-key")
		ctx.Params = gin.Params{{Key: "id", Value: "0"}}
		NewHandler().Query(ctx)
		return w
	}
	first := run()
	second := run()
	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("stream statuses=%d/%d, retry body=%q", first.Code, second.Code, second.Body.String())
	}
	if contentType := second.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "text/event-stream") {
		t.Fatalf("retry Content-Type=%q, want text/event-stream", contentType)
	}
	if first.Header().Get("X-Phyto-Message-Id") == "" ||
		first.Header().Get("X-Phyto-Message-Id") != second.Header().Get("X-Phyto-Message-Id") ||
		first.Header().Get("X-Phyto-Dialogue-Id") != second.Header().Get("X-Phyto-Dialogue-Id") {
		t.Fatalf("retry identity changed: first=%v second=%v", first.Header(), second.Header())
	}
	for _, marker := range []string{"TextMessageContent", "phyto.follow_up", "RunFinished"} {
		if !strings.Contains(second.Body.String(), marker) {
			t.Fatalf("retry body missing %q: %q", marker, second.Body.String())
		}
	}
	if botCalls.Load() != 1 {
		t.Fatalf("Bot stream calls=%d, want 1", botCalls.Load())
	}
	var rows int64
	if err := gdb.Model(&model.QuestionAgentLog{}).Count(&rows).Error; err != nil || rows != 1 {
		t.Fatalf("persisted rows=%d error=%v, want 1", rows, err)
	}
}

func TestQuery_SettledKeyedStreamRetryReplaysLargeStructuredAnswerForBrowser(t *testing.T) {
	gin.SetMode(gin.TestMode)
	gdb := setupStreamHandlerTestDB(t)
	answer := `{"payload":"` + strings.Repeat("界", 100000) + `","kind":"structured"}`
	content, err := json.Marshal(map[string]interface{}{
		"type": "TextMessageContent", "delta": answer,
	})
	if err != nil {
		t.Fatal(err)
	}
	streamBody := "event: RunStarted\ndata: {\"type\":\"RunStarted\",\"run_id\":\"run-handler-large\"}\n\n" +
		"event: TextMessageContent\ndata: " + string(content) + "\n\n" +
		"event: RunFinished\ndata: {\"type\":\"RunFinished\",\"run_id\":\"run-handler-large\"}\n\n"
	var botCalls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		botCalls.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(streamBody))
	}))
	t.Cleanup(server.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true, StreamEnabled: true,
		MultiturnV1Enabled: false, TimeoutSeconds: 2,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	run := func() *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(w)
		ctx.Set("username", "headers@example.com")
		ctx.Request = newStreamTestRequestWithTurn(t, "instant", "handler-large-replay-key")
		ctx.Params = gin.Params{{Key: "id", Value: "0"}}
		NewHandler().Query(ctx)
		return w
	}
	first := run()
	second := run()
	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("large replay statuses=%d/%d body=%q", first.Code, second.Code, second.Body.String())
	}
	if contentType := second.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "text/event-stream") {
		t.Fatalf("large retry Content-Type=%q, want text/event-stream", contentType)
	}
	if first.Header().Get("X-Phyto-Message-Id") == "" ||
		first.Header().Get("X-Phyto-Message-Id") != second.Header().Get("X-Phyto-Message-Id") ||
		first.Header().Get("X-Phyto-Dialogue-Id") != second.Header().Get("X-Phyto-Dialogue-Id") {
		t.Fatalf("large retry identity changed: first=%v second=%v", first.Header(), second.Header())
	}
	var replayed strings.Builder
	contentFrames := 0
	var eventTypes []string
	for _, frame := range strings.Split(second.Body.String(), "\n\n") {
		event, ok := rxBot.ParseAGUIFrame([]byte(frame))
		if !ok {
			if strings.TrimSpace(frame) == "" {
				continue
			}
			t.Fatalf("browser received invalid AG-UI frame: %q", frame)
		}
		eventTypes = append(eventTypes, event.Type)
		if event.Type != "TextMessageContent" {
			continue
		}
		contentFrames++
		var delta string
		if err := json.Unmarshal(event.Data["delta"], &delta); err != nil {
			t.Fatalf("decode browser delta: %v", err)
		}
		replayed.WriteString(delta)
	}
	if contentFrames < 2 || replayed.String() != answer {
		t.Fatalf("browser replay frames=%d bytes=%d, want multi-frame exact %d bytes", contentFrames, replayed.Len(), len(answer))
	}
	if len(eventTypes) == 0 || eventTypes[len(eventTypes)-1] != "RunFinished" {
		t.Fatalf("browser replay event sequence=%v, want terminal RunFinished", eventTypes)
	}
	if botCalls.Load() != 1 {
		t.Fatalf("large replay Bot calls=%d, want 1", botCalls.Load())
	}
	var rows int64
	if err := gdb.Model(&model.QuestionAgentLog{}).Count(&rows).Error; err != nil || rows != 1 {
		t.Fatalf("large replay rows=%d error=%v, want 1", rows, err)
	}
}

func TestQuery_NonterminalKeyedStreamRetryIsJSONConflictBeforeHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)
	gdb := setupStreamHandlerTestDB(t)
	row := model.QuestionAgentLog{
		DialogueId: "pending-dialogue", UserName: "headers@example.com",
		Query: "hello", ToolName: "ChatAgent", Mode: "instant",
		Status: "RUNNING", BotRunId: "run-pending",
		BotProjectionJSON: `{"run_id":"run-pending","status":"RUNNING","report_revision":-1,"conversation_context":{"client_turn_id":"handler-pending-key"}}`,
		BotReportRevision: -1,
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatalf("seed pending row: %v", err)
	}
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{ProxyEnabled: true, StreamEnabled: true, TimeoutSeconds: 2}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	ctx.Set("username", "headers@example.com")
	ctx.Request = newStreamTestRequestWithTurn(t, "instant", "handler-pending-key")
	ctx.Params = gin.Params{{Key: "id", Value: "0"}}
	NewHandler().Query(ctx)

	if w.Code != http.StatusConflict {
		t.Fatalf("pending retry status=%d body=%q, want 409", w.Code, w.Body.String())
	}
	if contentType := w.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
		t.Fatalf("pending retry Content-Type=%q, want JSON", contentType)
	}
	if strings.Contains(w.Body.String(), "event:") || w.Header().Get("X-Phyto-Message-Id") != "" {
		t.Fatalf("pending retry exposed SSE headers/body: headers=%v body=%q", w.Header(), w.Body.String())
	}
}

func TestQuery_SubmittingKeyedBlockingRetryPreservesIdentityHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)
	gdb := setupStreamHandlerTestDB(t)
	var botCalls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		botCalls.Add(1)
		hijacker, ok := w.(http.Hijacker)
		if !ok {
			t.Error("test server does not support connection hijacking")
			return
		}
		conn, _, err := hijacker.Hijack()
		if err != nil {
			t.Errorf("hijack ambiguous response: %v", err)
			return
		}
		_ = conn.Close()
	}))
	t.Cleanup(server.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true, StreamEnabled: false,
		MultiturnV1Enabled: false, TimeoutSeconds: 2,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })
	if out, err := api_service.NewService().Query(
		context.Background(),
		"headers@example.com",
		api_service.QueryInput{
			Query: "hello", Mode: "instant",
			ClientTurnID: "handler-blocking-submitting-key",
			Surface:      api_service.QuerySurfaceChat,
		},
	); out != nil || err == nil {
		t.Fatalf("ambiguous seed result=%+v error=%v, want transport error", out, err)
	}
	var row model.QuestionAgentLog
	if err := gdb.Where("user_name = ?", "headers@example.com").First(&row).Error; err != nil {
		t.Fatalf("read submitting row: %v", err)
	}

	run := func(query string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(w)
		ctx.Set("username", "headers@example.com")
		ctx.Request = newStreamTestRequestWithQueryAndTurn(
			t, query, "instant", "handler-blocking-submitting-key",
		)
		ctx.Params = gin.Params{{Key: "id", Value: "0"}}
		NewHandler().Query(ctx)
		return w
	}
	exact := run("hello")
	if exact.Code != http.StatusConflict ||
		exact.Header().Get("X-Phyto-Dialogue-Id") != row.DialogueId ||
		exact.Header().Get("X-Phyto-Message-Id") != strconv.FormatInt(row.Id, 10) {
		t.Fatalf("exact pending response status/headers=%d/%v body=%q", exact.Code, exact.Header(), exact.Body.String())
	}
	if contentType := exact.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
		t.Fatalf("exact pending Content-Type=%q, want JSON", contentType)
	}
	conflict := run("changed payload")
	if conflict.Code != http.StatusConflict ||
		conflict.Header().Get("X-Phyto-Dialogue-Id") != "" ||
		conflict.Header().Get("X-Phyto-Message-Id") != "" {
		t.Fatalf("conflicting retry leaked identity: status=%d headers=%v body=%q", conflict.Code, conflict.Header(), conflict.Body.String())
	}
	if botCalls.Load() != 1 {
		t.Fatalf("blocking retries dispatched Bot %d times, want only the ambiguous seed", botCalls.Load())
	}
}

func TestQuery_SubmittingKeyedStreamRetryPreservesIdentityHeadersBeforeJSONConflict(t *testing.T) {
	gin.SetMode(gin.TestMode)
	gdb := setupStreamHandlerTestDB(t)
	var botCalls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		botCalls.Add(1)
		hijacker, ok := w.(http.Hijacker)
		if !ok {
			t.Error("test server does not support connection hijacking")
			return
		}
		conn, _, err := hijacker.Hijack()
		if err != nil {
			t.Errorf("hijack ambiguous response: %v", err)
			return
		}
		_ = conn.Close()
	}))
	t.Cleanup(server.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true, StreamEnabled: true,
		MultiturnV1Enabled: false, TimeoutSeconds: 2,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })
	if out, err := api_service.NewService().Query(
		context.Background(),
		"headers@example.com",
		api_service.QueryInput{
			Query: "hello", Mode: "instant",
			ClientTurnID: "handler-stream-submitting-key",
			Surface:      api_service.QuerySurfaceChat,
		},
	); out != nil || err == nil {
		t.Fatalf("ambiguous seed result=%+v error=%v, want transport error", out, err)
	}
	var row model.QuestionAgentLog
	if err := gdb.Where("user_name = ?", "headers@example.com").First(&row).Error; err != nil {
		t.Fatalf("read submitting row: %v", err)
	}

	run := func(query string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(w)
		ctx.Set("username", "headers@example.com")
		ctx.Request = newStreamTestRequestWithQueryAndTurn(
			t, query, "instant", "handler-stream-submitting-key",
		)
		ctx.Params = gin.Params{{Key: "id", Value: "0"}}
		NewHandler().Query(ctx)
		return w
	}
	exact := run("hello")
	if exact.Code != http.StatusConflict ||
		exact.Header().Get("X-Phyto-Dialogue-Id") != row.DialogueId ||
		exact.Header().Get("X-Phyto-Message-Id") != strconv.FormatInt(row.Id, 10) {
		t.Fatalf("exact stream pending status/headers=%d/%v body=%q", exact.Code, exact.Header(), exact.Body.String())
	}
	if contentType := exact.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
		t.Fatalf("exact stream pending Content-Type=%q, want JSON", contentType)
	}
	if strings.Contains(exact.Body.String(), "event:") {
		t.Fatalf("exact stream pending emitted SSE: %q", exact.Body.String())
	}
	conflict := run("changed payload")
	if conflict.Code != http.StatusConflict ||
		conflict.Header().Get("X-Phyto-Dialogue-Id") != "" ||
		conflict.Header().Get("X-Phyto-Message-Id") != "" {
		t.Fatalf("conflicting stream retry leaked identity: status=%d headers=%v body=%q", conflict.Code, conflict.Header(), conflict.Body.String())
	}
	if botCalls.Load() != 1 {
		t.Fatalf("stream retries dispatched Bot %d times, want only the ambiguous seed", botCalls.Load())
	}
}

func TestQuery_RejectsMalformedNegativeAndOverflowConversationIDs(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupStreamHandlerTestDB(t)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{ProxyEnabled: false, StreamEnabled: false}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	for _, tc := range []struct {
		name      string
		pathID    string
		refreshID string
	}{
		{name: "malformed path", pathID: "not-a-number"},
		{name: "negative path", pathID: "-1"},
		{name: "overflow path", pathID: "9223372036854775808"},
		{name: "signed path", pathID: "+1"},
		{name: "malformed refresh", pathID: "0", refreshID: "not-a-number"},
		{name: "negative refresh", pathID: "0", refreshID: "-1"},
		{name: "overflow refresh", pathID: "0", refreshID: "9223372036854775808"},
		{name: "spaced refresh", pathID: "0", refreshID: " 1"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			_ = writer.WriteField("query", "hello")
			if tc.refreshID != "" {
				_ = writer.WriteField("refresh_id", tc.refreshID)
			}
			_ = writer.Close()
			request := httptest.NewRequest(http.MethodPost, "/api/v1/conversations/"+tc.pathID+"/messages", &body)
			request.Header.Set("Content-Type", writer.FormDataContentType())
			w := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(w)
			ctx.Set("username", "headers@example.com")
			ctx.Request = request
			ctx.Params = gin.Params{{Key: "id", Value: tc.pathID}}
			NewHandler().Query(ctx)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("status=%d body=%q, want 400", w.Code, w.Body.String())
			}
		})
	}
}

func TestQuery_StreamV1ForwardsTypedContextFrameAndIdentity(t *testing.T) {
	gin.SetMode(gin.TestMode)
	gdb := setupStreamHandlerTestDB(t)
	const answer = "typed stream answer"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/chat/completions":
			var request rxBot.ChatCompletionRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Errorf("decode stream request: %v", err)
				return
			}
			if request.Conversation == nil {
				t.Error("missing V1 envelope")
				return
			}
			stage := rxBot.ContextStageMetadata{
				SchemaVersion:   1,
				TurnID:          request.Conversation.TurnID,
				SelectedAgentID: "ChatAgent",
				RouteSource:     "instant_lock",
				RouteReasonCode: "INSTANT_LOCK",
				BaseBusinessContextVersion: request.Conversation.
					BaseBusinessContextVersion,
				ProposedBusinessContextVersion: request.Conversation.
					BaseBusinessContextVersion + 1,
				LastAppliedLedgerCursor: request.Conversation.LedgerCursor,
			}
			encoded, err := json.Marshal(stage)
			if err != nil {
				t.Errorf("marshal context stage: %v", err)
				return
			}
			body := strings.Join([]string{
				`event: RunStarted` + "\n" +
					`data: {"type":"RunStarted","run_id":"run-v1-handler"}` +
					"\n",
				`event: TextMessageContent` + "\n" +
					`data: {"type":"TextMessageContent","delta":"` + answer +
					`"}` + "\n",
				`event: Custom` + "\n" +
					`data: {"type":"Custom","name":"phyto.context_staged","value":` +
					string(encoded) + "}" + "\n",
				`event: RunFinished` + "\n" +
					`data: {"type":"RunFinished","run_id":"run-v1-handler"}` +
					"\n",
			}, "\n")
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = w.Write([]byte(body))
		case "/v1/conversation-context/settle":
			_ = json.NewEncoder(w).Encode(rxBot.ContextMutationResponse{
				SchemaVersion:  1,
				State:          "committed",
				ContextVersion: 1,
			})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true, StreamEnabled: true,
		MultiturnV1Enabled: true, TimeoutSeconds: 2,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("username", "headers@example.com")
	c.Request = newStreamTestRequestWithTurn(t, "instant", "handler-stream-v1")
	c.Params = gin.Params{{Key: "id", Value: "0"}}

	NewHandler().Query(c)
	if w.Code != http.StatusOK {
		t.Fatalf("stream status = %d, body = %q", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"name":"phyto.context_staged"`) {
		t.Fatalf("typed context frame missing from raw stream: %q", w.Body.String())
	}
	messageID := w.Header().Get("X-Phyto-Message-Id")
	dialogueID := w.Header().Get("X-Phyto-Dialogue-Id")
	if messageID == "" || dialogueID == "" {
		t.Fatalf("missing identity headers: message=%q dialogue=%q", messageID, dialogueID)
	}
	var row model.QuestionAgentLog
	if err := gdb.Where("id = ?", messageID).First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.DialogueId != dialogueID || row.Status != "SUCCEEDED" ||
		row.Answer != answer {
		t.Fatalf("persisted V1 stream row = %#v", row)
	}
}
