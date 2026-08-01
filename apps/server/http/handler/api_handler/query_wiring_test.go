package api_handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"phytomni-server/common/i18n"
	rxBot "phytomni-server/external/bot"
	api_service "phytomni-server/service/api_service"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
)

// newQueryRequest builds a /query multipart POST carrying just a query field,
// mirroring what the Web app sends, on a gin test context.
func newQueryRequest(t *testing.T, query string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if err := mw.WriteField("query", query); err != nil {
		t.Fatalf("write field: %v", err)
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/conversations/0/messages", &buf)
	c.Request.Header.Set("Content-Type", mw.FormDataContentType())
	c.Params = gin.Params{{Key: "id", Value: "0"}}
	i18n.Localize()(c)
	return c, w
}

// TestApiQuery_DisabledGatewayWiring exercises queryErrorStatus through the real
// Query handler glue (not just the pure helper): a disabled gateway must come
// back as a 503 whose body `code` matches the HTTP status. This pins the wiring
// the helper unit test cannot reach — that the helper is actually invoked and
// the status is not mis-mapped onto the response code. With the gateway off the
// service returns ErrGatewayDisabled before any DB access, so no DB is needed.
func TestApiQuery_DisabledGatewayWiring(t *testing.T) {
	rxBot.BotConfig = nil // gateway disabled
	ph := NewHandler()
	c, w := newQueryRequest(t, "hi")
	c.Set("username", "alice")

	ph.Query(c)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d (body=%s)", w.Code, w.Body.String())
	}
	var parsed struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("decode body %s: %v", w.Body.String(), err)
	}
	if parsed.Code != http.StatusServiceUnavailable {
		t.Errorf("body code should match HTTP status 503, got %d", parsed.Code)
	}
	if parsed.Message == "" {
		t.Errorf("expected a non-empty user message, got empty")
	}
}

func TestParseAssetAttachmentsStrictContract(t *testing.T) {
	validTen := make([]string, rxBot.MaxAssetAttachmentRefs)
	for i := range validTen {
		validTen[i] = `{"asset_id":"file_` + strconv.Itoa(i) + `"}`
	}
	tests := []struct {
		name string
		raw  string
		ok   bool
		want int
	}{
		{name: "missing field", raw: "", ok: true, want: 0},
		{name: "empty array", raw: "[]", ok: true, want: 0},
		{name: "one", raw: `[{"asset_id":"file_one"}]`, ok: true, want: 1},
		{name: "ten", raw: "[" + strings.Join(validTen, ",") + "]", ok: true, want: rxBot.MaxAssetAttachmentRefs},
		{name: "eleven", raw: "[" + strings.Join(append(validTen, `{"asset_id":"file_extra"}`), ",") + "]", ok: false},
		{name: "duplicate", raw: `[{"asset_id":"file_one"},{"asset_id":"file_one"}]`, ok: false},
		{name: "malformed json", raw: `[{"asset_id":"file_one"}`, ok: false},
		{name: "unknown field", raw: `[{"asset_id":"file_one","name":"reads.fastq"}]`, ok: false},
		{name: "invalid prefix", raw: `[{"asset_id":"asset_one"}]`, ok: false},
		{name: "overlong id", raw: `[{"asset_id":"file_` + strings.Repeat("a", 124) + `"}]`, ok: false},
		{name: "trailing value", raw: `[{"asset_id":"file_one"}] {}`, ok: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := parseAssetAttachments(tt.raw)
			if ok != tt.ok || len(got) != tt.want {
				t.Fatalf("parseAssetAttachments(%q)=(%#v,%v), want len=%d ok=%v", tt.raw, got, ok, tt.want, tt.ok)
			}
		})
	}
}

func TestApiQueryRejectsAnyMultipartFilePartBeforeDispatch(t *testing.T) {
	previousConfig := rxBot.BotConfig
	previousQuota := viper.Get("chatlimit.enforce")
	t.Cleanup(func() {
		rxBot.BotConfig = previousConfig
		viper.Set("chatlimit.enforce", previousQuota)
	})
	viper.Set("chatlimit.enforce", false)
	rxBot.BotConfig = &rxBot.Config{ProxyEnabled: true}

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if err := mw.WriteField("query", "valid query"); err != nil {
		t.Fatal(err)
	}
	part, err := mw.CreateFormFile("payload", "reads.fastq")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte("not a relay")); err != nil {
		t.Fatal(err)
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/conversations/0/messages", &body)
	c.Request.Header.Set("Content-Type", mw.FormDataContentType())
	c.Params = gin.Params{{Key: "id", Value: "0"}}
	c.Set("username", "alice@example.com")
	i18n.Localize()(c)

	NewHandler().Query(c)
	if w.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("status=%d body=%s, want 415", w.Code, w.Body.String())
	}
}

func TestApiQueryRejectsOverlongInteropModeBeforeServiceDispatch(t *testing.T) {
	previousConfig := rxBot.BotConfig
	rxBot.BotConfig = nil
	t.Cleanup(func() { rxBot.BotConfig = previousConfig })

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if err := mw.WriteField("query", "research query"); err != nil {
		t.Fatal(err)
	}
	if err := mw.WriteField("tool", "InSilicoResearchAgent"); err != nil {
		t.Fatal(err)
	}
	if err := mw.WriteField("interop_mode", strings.Repeat("x", rxBot.MaxInteropModeLength+1)); err != nil {
		t.Fatal(err)
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/conversations/0/messages", &body)
	c.Request.Header.Set("Content-Type", mw.FormDataContentType())
	c.Params = gin.Params{{Key: "id", Value: "0"}}
	c.Set("username", "alice")
	i18n.Localize()(c)

	NewHandler().Query(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("overlong interop_mode status=%d body=%s, want 400", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), strings.Repeat("x", rxBot.MaxInteropModeLength)) {
		t.Fatalf("overlong mode echoed in response: %s", w.Body.String())
	}
}

// unreadablePreparsedMultipartForm leaves a real disk-backed FileHeader in an
// already-parsed form, then removes its backing file. The handler must reject
// invalid routing before it can open or read this attachment.
func unreadablePreparsedMultipartForm(t *testing.T, mode, tool string) *multipart.Form {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for key, value := range map[string]string{
		"query": "route safely",
		"mode":  mode,
		"tool":  tool,
	} {
		if err := writer.WriteField(key, value); err != nil {
			t.Fatalf("write %s: %v", key, err)
		}
	}
	file, err := writer.CreateFormFile("files", "must-not-open.txt")
	if err != nil {
		t.Fatalf("create attachment: %v", err)
	}
	if _, err := file.Write([]byte("attachment content must remain unread")); err != nil {
		t.Fatalf("write attachment: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	form, err := multipart.NewReader(bytes.NewReader(body.Bytes()), writer.Boundary()).ReadForm(0)
	if err != nil {
		t.Fatalf("pre-parse multipart form: %v", err)
	}
	files := form.File["files"]
	if len(files) != 1 || files[0].Size == 0 {
		t.Fatalf("pre-parsed attachment = %#v, want one non-empty file", files)
	}
	if err := form.RemoveAll(); err != nil {
		t.Fatalf("remove attachment backing file: %v", err)
	}
	opened, err := files[0].Open()
	if err == nil {
		_ = opened.Close()
		t.Fatal("removed attachment backing file remained readable")
	}
	return form
}

// TestQueryRejectsInvalidChatRouting proves malformed Chat routing fails before
// the handler opens attachment data, dispatches to Bot, or persists a row.
func TestQueryRejectsInvalidChatRouting(t *testing.T) {
	invalid := []struct {
		name string
		mode string
		tool string
	}{
		{name: "instant direct tool", mode: "instant", tool: "DataAgent"},
		{name: "unknown mode", mode: "fast", tool: ""},
		{name: "unknown expert tool", mode: "expert", tool: "MissingAgent"},
		{name: "padded expert tool", mode: "expert", tool: " DataAgent"},
		{name: "joined expert tools", mode: "expert", tool: "DataAgent,AnalystAgent"},
	}
	for _, tc := range invalid {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupRemoteProductHandlerDB(t)
			previousConfig := rxBot.BotConfig
			hits := 0
			srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				hits++
			}))
			t.Cleanup(srv.Close)
			rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true}
			t.Cleanup(func() { rxBot.BotConfig = previousConfig })
			previousQuota := viper.Get("chatlimit.enforce")
			viper.Set("chatlimit.enforce", false)
			t.Cleanup(func() { viper.Set("chatlimit.enforce", previousQuota) })

			gin.SetMode(gin.TestMode)
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			tracked := &trackingReadCloser{reader: strings.NewReader("must not be read")}
			form := unreadablePreparsedMultipartForm(t, tc.mode, tc.tool)
			c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/conversations/0/messages", nil)
			c.Request.Body = tracked
			c.Request.Header.Set("Content-Type", "multipart/form-data; boundary=already-parsed")
			c.Request.PostForm = form.Value
			c.Request.MultipartForm = form
			c.Params = gin.Params{{Key: "id", Value: "0"}}
			c.Set("username", "alice@example.com")
			i18n.Localize()(c)

			NewHandler().Query(c)

			if w.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body=%s; want 400", w.Code, w.Body.String())
			}
			var body struct {
				Code    int    `json:"code"`
				Message string `json:"message"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if body.Code != http.StatusBadRequest || body.Message != "invalid chat routing" {
				t.Fatalf("response = %#v, want 400 invalid chat routing", body)
			}
			if tracked.reads != 0 || tracked.bytes != 0 {
				t.Fatalf("invalid Chat routing read attachment body %d time(s), %d byte(s)", tracked.reads, tracked.bytes)
			}
			if hits != 0 {
				t.Fatalf("invalid Chat routing reached Bot %d time(s)", hits)
			}
			var rows int64
			if err := gdb.Table("question_agent_logs").Count(&rows).Error; err != nil {
				t.Fatalf("count rows: %v", err)
			}
			if rows != 0 {
				t.Fatalf("invalid Chat routing persisted %d row(s)", rows)
			}
		})
	}
}

func newUpdateLogRequest(t *testing.T, fields map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for key, value := range fields {
		if err := mw.WriteField(key, value); err != nil {
			t.Fatalf("write %s: %v", key, err)
		}
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPatch, "/api/v1/async-tasks/analyst-log", &buf)
	c.Request.Header.Set("Content-Type", mw.FormDataContentType())
	c.Set("username", "alice")
	i18n.Localize()(c)
	return c, w
}

func TestApiQueryAnalystUpdateLogRejectsBlankTaskID(t *testing.T) {
	ph := NewHandler()
	c, w := newUpdateLogRequest(t, map[string]string{"task_id": "   ", "compute_resource": "cr-1"})

	ph.QueryAnalystUpdateLog(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", w.Code, w.Body.String())
	}
	var parsed struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if parsed.Code != http.StatusBadRequest || parsed.Message != "task_id is required" {
		t.Fatalf("unexpected body: %+v", parsed)
	}
}

func TestQueryErrorStatusMissingBotRunID(t *testing.T) {
	status, msg := queryErrorStatus(api_service.ErrMissingBotRunID)
	if status != http.StatusConflict {
		t.Fatalf("status = %d, want 409", status)
	}
	if msg != "task is not syncable through bot run state" {
		t.Fatalf("message = %q", msg)
	}
}
