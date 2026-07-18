package api_handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"phytomni-server/common/i18n"
	rxBot "phytomni-server/external/bot"
	api_service "phytomni-server/service/api_service"

	"github.com/gin-gonic/gin"
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
