package api_handler

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"phytomni-server/common/i18n"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/service/api_service"
)

func TestA2uiAction_UpstreamErrorsMap502(t *testing.T) {
	tests := []struct {
		name string
		err  error
	}{
		{name: "invalid upstream protocol", err: api_service.ErrA2uiUpstreamProtocol},
		{name: "oversize upstream response", err: rxBot.ErrA2uiResponseTooLarge},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, ok := a2uiActionUpstreamStatus(tt.err)
			if !ok {
				t.Fatal("upstream error was not classified")
			}
			if status != http.StatusBadGateway {
				t.Fatalf("status = %d, want %d", status, http.StatusBadGateway)
			}
		})
	}

	if _, ok := a2uiActionUpstreamStatus(errors.New("unrelated")); ok {
		t.Fatal("unrelated error classified as upstream failure")
	}
}

func TestClassifyA2uiActionErrorMapping(t *testing.T) {
	tests := []struct {
		name                 string
		err                  error
		status               int
		code                 string
		forwarded, retryable bool
	}{
		{name: "invalid envelope", err: api_service.ErrA2uiActionBadRequest, status: http.StatusUnprocessableEntity, code: "a2ui_invalid_action"},
		{name: "owner miss", err: api_service.ErrA2uiActionNotFound, status: http.StatusNotFound, code: "a2ui_not_found"},
		{name: "gateway disabled", err: api_service.ErrGatewayDisabled, status: http.StatusServiceUnavailable, code: "a2ui_gateway_disabled", retryable: true},
		{name: "timeout", err: rxBot.ErrBotTimeout, status: http.StatusGatewayTimeout, code: "a2ui_upstream_timeout", forwarded: true},
		{name: "response too large", err: rxBot.ErrA2uiResponseTooLarge, status: http.StatusBadGateway, code: "a2ui_upstream_too_large", forwarded: true},
		{name: "invalid upstream", err: api_service.ErrA2uiUpstreamProtocol, status: http.StatusBadGateway, code: "a2ui_upstream_invalid", forwarded: true},
		{name: "internal", err: errors.New("database secret must not escape"), status: http.StatusInternalServerError, code: "a2ui_internal", retryable: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			failure := classifyA2uiActionError(tt.err)
			if failure.status != tt.status || failure.code != tt.code {
				t.Fatalf("failure = %+v, want status=%d code=%q", failure, tt.status, tt.code)
			}
			if failure.forwarded != tt.forwarded || failure.retryable != tt.retryable {
				t.Fatalf("forwarded/retryable = %v/%v, want %v/%v", failure.forwarded, failure.retryable, tt.forwarded, tt.retryable)
			}
			if failure.messageKey == "" {
				t.Fatal("message key is empty")
			}
		})
	}
}

func TestA2uiActionErrorMessagesResolveInBothLocales(t *testing.T) {
	tests := []struct {
		language string
		want     string
	}{
		{language: "en-US", want: "invalid JSON body"},
		{language: "zh-CN", want: "JSON 请求体无效"},
	}
	for _, tt := range tests {
		t.Run(tt.language, func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/a2ui", nil)
			c.Request.Header.Set("Accept-Language", tt.language)
			i18n.Localize()(c)
			if got := i18n.T(c, "a2ui.invalid_json"); got != tt.want {
				t.Fatalf("localized invalid_json = %q, want %q", got, tt.want)
			}
		})
	}
}
