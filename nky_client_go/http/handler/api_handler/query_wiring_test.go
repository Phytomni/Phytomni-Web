package api_handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	rxBot "nky_client_go/external/bot"

	"github.com/gin-gonic/gin"
)

// newQueryRequest builds a /query multipart POST carrying just a query field,
// mirroring what chat-ai sends, on a gin test context.
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
	c.Request = httptest.NewRequest(http.MethodPost, "/query", &buf)
	c.Request.Header.Set("Content-Type", mw.FormDataContentType())
	return c, w
}

// TestApiQuery_DisabledGatewayWiring exercises queryErrorStatus through the real
// ApiQuery handler glue (not just the pure helper): a disabled gateway must come
// back as a 503 whose body `code` matches the HTTP status. This pins the wiring
// the helper unit test cannot reach — that the helper is actually invoked and
// the status is not mis-mapped onto the response code. With the gateway off the
// service returns ErrGatewayDisabled before any DB access, so no DB is needed.
func TestApiQuery_DisabledGatewayWiring(t *testing.T) {
	rxBot.BotConfig = nil // gateway disabled
	ph := NewApiHandler()
	c, w := newQueryRequest(t, "hi")
	c.Set("username", "alice")

	ph.ApiQuery(c)

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
