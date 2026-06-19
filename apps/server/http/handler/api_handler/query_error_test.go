package api_handler

import (
	"errors"
	"fmt"
	"net/http"
	"testing"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/service/api_service"
)

// TestQueryErrorStatus pins the /query error contract: a disabled gateway is a
// 503, an unknown tool is a 400, a client-correctable Bot 4xx surfaces its
// message as a 400, and everything else (5xx, auth misconfig, plain errors)
// stays an opaque 500. Before this mapping the first two collapsed into 500.
func TestQueryErrorStatus(t *testing.T) {
	cases := []struct {
		name       string
		err        error
		wantStatus int
		wantMsg    string
	}{
		{
			name:       "disabled gateway -> 503",
			err:        api_service.ErrGatewayDisabled,
			wantStatus: http.StatusServiceUnavailable,
			wantMsg:    "服务暂不可用",
		},
		{
			name:       "unknown tool (wrapped) -> 400",
			err:        fmt.Errorf("%w %q", api_service.ErrUnknownTool, "BogusAgent"),
			wantStatus: http.StatusBadRequest,
			wantMsg:    "未知的工具类型",
		},
		{
			name:       "surfaceable bot 4xx -> 400 with bot message",
			err:        &rxBot.APIError{Status: 400, Message: "无法解析基因"},
			wantStatus: http.StatusBadRequest,
			wantMsg:    "无法解析基因",
		},
		{
			name:       "auth misconfig 401 is NOT surfaced -> 500",
			err:        &rxBot.APIError{Status: 401, Message: "unauthorized"},
			wantStatus: http.StatusInternalServerError,
			wantMsg:    "请求处理失败",
		},
		{
			name:       "bot 5xx -> opaque 500",
			err:        &rxBot.APIError{Status: 502, Message: "upstream down"},
			wantStatus: http.StatusInternalServerError,
			wantMsg:    "请求处理失败",
		},
		{
			name:       "plain error -> opaque 500",
			err:        errors.New("context deadline exceeded"),
			wantStatus: http.StatusInternalServerError,
			wantMsg:    "请求处理失败",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotStatus, gotMsg := queryErrorStatus(tc.err)
			if gotStatus != tc.wantStatus {
				t.Errorf("status = %d, want %d", gotStatus, tc.wantStatus)
			}
			if gotMsg != tc.wantMsg {
				t.Errorf("msg = %q, want %q", gotMsg, tc.wantMsg)
			}
		})
	}
}
