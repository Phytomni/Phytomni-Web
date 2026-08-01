package api_handler

import (
	"errors"
	"fmt"
	"net/http"
	"testing"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/service/api_service"

	"gorm.io/gorm"
)

// TestQueryErrorStatus pins the /query error contract: a disabled gateway is a
// 503, an unknown tool is a 400, a client-correctable Bot 4xx surfaces its
// message as a 400, Bot gateway failures retain a safe upstream status, and
// Web-internal/auth-misconfiguration errors stay opaque 500s.
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
			wantMsg:    "service temporarily unavailable",
		},
		{
			name:       "conversation ledger ownership miss -> uniform 404",
			err:        fmt.Errorf("resolve conversation: %w", api_service.ErrConversationLedgerNotFound),
			wantStatus: http.StatusNotFound,
			wantMsg:    "conversation not found",
		},
		{
			name:       "raw owner lookup miss -> uniform 404",
			err:        fmt.Errorf("resolve parent: %w", gorm.ErrRecordNotFound),
			wantStatus: http.StatusNotFound,
			wantMsg:    "conversation not found",
		},
		{
			name:       "unknown tool (wrapped) -> 400",
			err:        fmt.Errorf("%w %q", api_service.ErrUnknownTool, "BogusAgent"),
			wantStatus: http.StatusBadRequest,
			wantMsg:    "unknown tool type",
		},
		{
			name:       "invalid chat routing -> 400",
			err:        api_service.ErrInvalidChatRouting,
			wantStatus: http.StatusBadRequest,
			wantMsg:    "invalid chat routing",
		},
		{
			name:       "agent tool forbidden -> 404",
			err:        api_service.ErrAgentToolForbidden,
			wantStatus: http.StatusNotFound,
			wantMsg:    "agent tool not found",
		},
		{
			name:       "no executable agent tools -> 404",
			err:        api_service.ErrNoExecutableAgentTools,
			wantStatus: http.StatusNotFound,
			wantMsg:    "no executable agent tools",
		},
		{
			name:       "granted agent tools unavailable -> 503",
			err:        api_service.ErrAgentToolsUnavailable,
			wantStatus: http.StatusServiceUnavailable,
			wantMsg:    "agent tools temporarily unavailable",
		},
		{
			name:       "expert route contract -> 502",
			err:        fmt.Errorf("expert route: %w", api_service.ErrExpertRouteContract),
			wantStatus: http.StatusBadGateway,
			wantMsg:    "upstream routing contract failed",
		},
		{
			name:       "surfaceable bot 4xx -> 400 with bot message",
			err:        &rxBot.APIError{Status: 400, Message: "cannot parse gene"},
			wantStatus: http.StatusBadRequest,
			wantMsg:    "cannot parse gene",
		},
		{
			name:       "auth misconfig 401 is NOT surfaced -> 500",
			err:        &rxBot.APIError{Status: 401, Message: "unauthorized"},
			wantStatus: http.StatusInternalServerError,
			wantMsg:    "request failed",
		},
		{
			name:       "bot 500 -> opaque 502",
			err:        &rxBot.APIError{Status: 500, Message: "database detail"},
			wantStatus: http.StatusBadGateway,
			wantMsg:    "upstream service failed",
		},
		{
			name:       "bot 502 -> opaque 502",
			err:        &rxBot.APIError{Status: 502, Message: "upstream down"},
			wantStatus: http.StatusBadGateway,
			wantMsg:    "upstream service failed",
		},
		{
			name:       "bot 503 -> opaque 502",
			err:        &rxBot.APIError{Status: 503, Message: "provider unavailable"},
			wantStatus: http.StatusBadGateway,
			wantMsg:    "upstream service failed",
		},
		{
			name:       "bot 504 -> safe 504",
			err:        fmt.Errorf("route: %w", &rxBot.APIError{Status: 504, Message: "provider detail"}),
			wantStatus: http.StatusGatewayTimeout,
			wantMsg:    "request timed out, please narrow your query or try again later",
		},
		{
			name:       "plain error -> opaque 500",
			err:        errors.New("context deadline exceeded"),
			wantStatus: http.StatusInternalServerError,
			wantMsg:    "request failed",
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
