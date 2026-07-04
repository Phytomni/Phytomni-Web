package api_handler

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	rxBot "phytomni-server/external/bot"

	"github.com/gin-gonic/gin"
)

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
