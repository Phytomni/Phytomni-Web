package common

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestNewA2uiHTTPErrorUsesStableShapeAndBoundsRequestID(t *testing.T) {
	id := strings.Repeat("界", A2uiRequestIDMaxChars+1)
	envelope := NewA2uiHTTPError("a2ui_invalid_action", "safe copy", id, false, false)

	if envelope.Error.Type != A2uiGatewayErrorType {
		t.Fatalf("error.type = %q, want %q", envelope.Error.Type, A2uiGatewayErrorType)
	}
	if envelope.Error.Code != "a2ui_invalid_action" || envelope.Error.Message != "safe copy" {
		t.Fatalf("error fields = %+v", envelope.Error)
	}
	if got := len([]rune(envelope.Error.RequestID)); got != A2uiRequestIDMaxChars {
		t.Fatalf("request_id rune length = %d, want %d", got, A2uiRequestIDMaxChars)
	}
	if envelope.Forwarded || envelope.Retryable {
		t.Fatalf("forwarded/retryable = %v/%v, want false/false", envelope.Forwarded, envelope.Retryable)
	}

	raw, err := json.Marshal(envelope)
	if err != nil {
		t.Fatalf("marshal envelope: %v", err)
	}
	if !strings.Contains(string(raw), `"type":"gateway_error"`) {
		t.Fatalf("marshaled envelope missing stable type: %s", raw)
	}
}

func TestA2uiRequestIDUsesContextInsteadOfRawHeader(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/a2ui", nil)
	c.Request.Header.Set("x-request-id", strings.Repeat("header-", 100))
	c.Set("x-request-id", "context-request")

	if got := A2uiRequestID(c); got != "context-request" {
		t.Fatalf("A2uiRequestID = %q, want context value", got)
	}

	c.Set("x-request-id", strings.Repeat("x", A2uiRequestIDMaxChars+1))
	if got := A2uiRequestID(c); len([]rune(got)) != A2uiRequestIDMaxChars {
		t.Fatalf("bounded context request id length = %d, want %d", len([]rune(got)), A2uiRequestIDMaxChars)
	}

	c.Set("x-request-id", 42)
	if got := A2uiRequestID(c); got != "" {
		t.Fatalf("non-string context request id = %q, want empty", got)
	}
}

func TestWriteA2uiHTTPErrorWritesEnvelope(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("x-request-id", "req-7")

	WriteA2uiHTTPError(c, http.StatusServiceUnavailable, "a2ui_gateway_disabled", "暂不可用", false, true)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", w.Code)
	}
	var envelope A2uiHTTPError
	if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if envelope.Error.RequestID != "req-7" || envelope.Error.Code != "a2ui_gateway_disabled" {
		t.Fatalf("envelope = %+v", envelope)
	}
	if envelope.Forwarded || !envelope.Retryable {
		t.Fatalf("forwarded/retryable = %v/%v, want false/true", envelope.Forwarded, envelope.Retryable)
	}
}
