package api_handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	rxBot "phytomni-server/external/bot"
)

func TestQueryErrorStatus_BotTimeout(t *testing.T) {
	wrapped := fmt.Errorf("%w: context deadline exceeded", rxBot.ErrBotTimeout)
	status, msg := queryErrorStatus(wrapped)
	if status != http.StatusGatewayTimeout {
		t.Errorf("status = %d, want 504", status)
	}
	if msg == "" || msg == "request failed" {
		t.Errorf("msg = %q, want a specific timeout message", msg)
	}
}

func TestQueryTimeoutMapsTo504WithWebRequestID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("x-request-id", "web-timeout-13")
	writeQueryError(c, http.StatusGatewayTimeout, "request timed out")

	if w.Code != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, want 504; body=%s", w.Code, w.Body.String())
	}
	var body struct {
		Code      int    `json:"code"`
		Message   string `json:"message"`
		RequestID string `json:"request_id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode timeout body %s: %v", w.Body.String(), err)
	}
	if body.Code != http.StatusGatewayTimeout || body.Message == "" {
		t.Fatalf("unexpected timeout body: %+v", body)
	}
	if body.RequestID != "web-timeout-13" {
		t.Fatalf("request_id = %q, want Web request id", body.RequestID)
	}
}
