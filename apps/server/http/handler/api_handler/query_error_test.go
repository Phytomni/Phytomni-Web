package api_handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"phytomni-server/common/citation"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/service/api_service"

	"github.com/spf13/viper"
	"gorm.io/gorm"
)

func TestCitationProjectionQueryHandlerAdmitsBeforeBotProjection(t *testing.T) {
	gdb := setupRemoteProductHandlerDB(t)
	if err := gdb.Exec("INSERT INTO users (email, code) VALUES ('alice', 'admin')").Error; err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"run-citation","run_id":"run-citation","object":"agent.run","agent":"knowledge","status":"succeeded","result":{"formatted":{"answer":"body","references":{"bad":"private-source"}}}}`))
	}))
	t.Cleanup(server.Close)
	old := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{BaseURL: server.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = old })
	quota := viper.Get("chatlimit.enforce")
	viper.Set("chatlimit.enforce", false)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", quota) })
	ctx, recorder := newChatQueryHandlerRequest(t, map[string]string{"query": "q", "mode": "expert", "tool": "KnowledgeAgent"})
	ctx.Set("username", "alice")
	NewHandler().Query(ctx)
	if recorder.Code != http.StatusAccepted || strings.Contains(recorder.Body.String(), "private-source") {
		t.Fatalf("HTTP %d: %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Data api_service.QueryData `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode admission response: %v", err)
	}
	if response.Data.Status != "ADMITTED" || response.Data.ExecutionID == "" {
		t.Fatalf("admission response=%+v, want durable admitted execution", response.Data)
	}
	var count int64
	if err := gdb.Table("question_agent_logs").Where("status = ?", "SUCCEEDED").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("corrupt successful answer saved")
	}
}

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
			name:       "invalid references -> opaque 502",
			err:        fmt.Errorf("projection: %w", citation.ErrInvalidReferences),
			wantStatus: http.StatusBadGateway,
			wantMsg:    "upstream service failed",
		},
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
			name:       "ambiguous client turn remains pending -> 409",
			err:        fmt.Errorf("retry: %w", api_service.ErrClientTurnSubmissionPending),
			wantStatus: http.StatusConflict,
			wantMsg:    "client turn submission is pending",
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
