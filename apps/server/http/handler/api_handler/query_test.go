package api_handler

import (
	"fmt"
	"net/http"
	"testing"

	rxBot "phytomni-server/external/bot"
)

func TestQueryErrorStatus_BotTimeout(t *testing.T) {
	wrapped := fmt.Errorf("%w: context deadline exceeded", rxBot.ErrBotTimeout)
	status, msg := queryErrorStatus(wrapped)
	if status != http.StatusGatewayTimeout {
		t.Errorf("status = %d, want 504", status)
	}
	if msg == "" || msg == "请求处理失败" {
		t.Errorf("msg = %q, want a specific timeout message", msg)
	}
}
