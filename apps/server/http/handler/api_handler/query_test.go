package api_handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
	"phytomni-server/common/i18n"
	rxBot "phytomni-server/external/bot"
	rxLog "phytomni-server/log"
	"phytomni-server/service/api_service"
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
	if w.Header().Get("X-Phyto-Dispatch-State") != "" {
		t.Fatalf("5xx must not carry a pre-dispatch marker; got %q", w.Header().Get("X-Phyto-Dispatch-State"))
	}
}

func TestWriteQueryError_PreDispatch4xxMarksNotStarted(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	writeQueryError(c, http.StatusBadRequest, "Uploaded attachments exceed the allowed limit.")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", w.Code, w.Body.String())
	}
	if got := w.Header().Get("X-Phyto-Dispatch-State"); got != "not-started" {
		t.Fatalf("X-Phyto-Dispatch-State = %q, want not-started", got)
	}
	var body struct {
		Code        int    `json:"code"`
		Message     string `json:"message"`
		PreDispatch bool   `json:"pre_dispatch"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body %s: %v", w.Body.String(), err)
	}
	if !body.PreDispatch || body.Message != "Uploaded attachments exceed the allowed limit." {
		t.Fatalf("unexpected pre-dispatch body: %+v", body)
	}
}

func newChatQueryHandlerRequest(t *testing.T, fields map[string]string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if _, supplied := fields["query"]; !supplied {
		fields = maps.Clone(fields)
		fields["query"] = "Analyze counts"
	}
	for name, value := range fields {
		if err := mw.WriteField(name, value); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close form: %v", err)
	}
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/conversations/0/messages", &body)
	c.Request.Header.Set("Content-Type", mw.FormDataContentType())
	c.Params = gin.Params{{Key: "id", Value: "0"}}
	i18n.Localize()(c)
	return c, w
}

func TestQueryInputForSurfaceIgnoresDatasetDescription(t *testing.T) {
	c, _ := newChatQueryHandlerRequest(t, map[string]string{
		"query":               "Analyze counts exactly as authored",
		"dataset_description": "obsolete independent context",
	})

	in := queryInputForSurface(c, api_service.QuerySurfaceChat, "")
	if in.Query != "Analyze counts exactly as authored" {
		t.Fatalf("query=%q, want authored query unchanged", in.Query)
	}
	if _, exists := reflect.TypeOf(in).FieldByName("DatasetDescription"); exists {
		t.Fatal("query input still exposes dataset description")
	}
}

func TestQueryRejectsForbiddenAttachmentFields(t *testing.T) {
	for _, key := range []string{"data_list", "obs_file_list", "obs_path", "object_key", "owner_subject"} {
		t.Run(key, func(t *testing.T) {
			gdb := setupRemoteProductHandlerDB(t)
			if err := gdb.Exec(`INSERT INTO users (email, code, chat_limit) VALUES (?, ?, ?)`, "forbidden@example.com", "admin", 5).Error; err != nil {
				t.Fatal(err)
			}
			botCalls := 0
			srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { botCalls++ }))
			t.Cleanup(srv.Close)
			previousConfig := rxBot.BotConfig
			rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
			t.Cleanup(func() { rxBot.BotConfig = previousConfig })
			previousQuota := viper.Get("chatlimit.enforce")
			viper.Set("chatlimit.enforce", false)
			t.Cleanup(func() { viper.Set("chatlimit.enforce", previousQuota) })

			c, w := newChatQueryHandlerRequest(t, map[string]string{key: "browser assertion"})
			c.Set("username", "forbidden@example.com")
			NewHandler().Query(c)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("status=%d, body=%s, want 400", w.Code, w.Body.String())
			}
			if botCalls != 0 {
				t.Fatalf("forbidden field %q reached Bot %d time(s)", key, botCalls)
			}
		})
	}
}

func TestQueryFailureLogFieldsIncludeRequestAndDialogueIDs(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/conversations/dialogue-7/messages", nil)
	c.Params = gin.Params{{Key: "id", Value: "dialogue-7"}}
	c.Set("x-request-id", "87b85d0d-3c3d-4282-b646-c3c28032979e")

	fields := queryFailureLogFields(c, "ops@example.com", errors.New("bot request failed"))
	got := logFieldMap(t, fields)
	if got["user"] != "ops@example.com" {
		t.Fatalf("user = %#v", got["user"])
	}
	if fmt.Sprint(got["err"]) != "bot request failed" {
		t.Fatalf("err = %#v", got["err"])
	}
	if got["request_id"] != "87b85d0d-3c3d-4282-b646-c3c28032979e" {
		t.Fatalf("request_id = %#v", got["request_id"])
	}
	if got["dialogue_id"] != "dialogue-7" {
		t.Fatalf("dialogue_id = %#v", got["dialogue_id"])
	}
}

func TestQueryFailureLogFieldsOmitBlankCorrelation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/conversations/0/messages", nil)
	c.Params = gin.Params{{Key: "id", Value: "  "}}

	fields := queryFailureLogFields(c, "ops@example.com", errors.New("invalid chat routing"), "status", 400)
	got := logFieldMap(t, fields)
	if _, ok := got["request_id"]; ok {
		t.Fatalf("blank request_id still logged: %#v", got["request_id"])
	}
	if _, ok := got["dialogue_id"]; ok {
		t.Fatalf("blank dialogue_id still logged: %#v", got["dialogue_id"])
	}
	if got["status"] != 400 {
		t.Fatalf("status extra = %#v", got["status"])
	}
}

func TestQueryFailedLogsRequestAndDialogueIDs(t *testing.T) {
	core, observed := observer.New(zap.InfoLevel)
	restore := rxLog.ReplaceLoggerForTest(zap.New(core))
	t.Cleanup(restore)

	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{ProxyEnabled: false}
	rxBot.SetConversationContextV1Advertised(false)
	t.Cleanup(func() {
		rxBot.BotConfig = previous
		rxBot.SetConversationContextV1Advertised(false)
	})
	previousQuota := viper.Get("chatlimit.enforce")
	viper.Set("chatlimit.enforce", false)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", previousQuota) })

	c, w := newChatQueryHandlerRequest(t, map[string]string{"query": "ping"})
	c.Set("username", "ops@example.com")
	c.Set("x-request-id", "87b85d0d-3c3d-4282-b646-c3c28032979e")
	c.Params = gin.Params{{Key: "id", Value: "0"}}

	NewHandler().Query(c)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s, want 503", w.Code, w.Body.String())
	}

	var found bool
	for _, entry := range observed.All() {
		if entry.Message != "ApiQuery failed" {
			continue
		}
		found = true
		got := entry.ContextMap()
		if got["request_id"] != "87b85d0d-3c3d-4282-b646-c3c28032979e" {
			t.Fatalf("request_id = %#v", got["request_id"])
		}
		if got["dialogue_id"] != "0" {
			t.Fatalf("dialogue_id = %#v", got["dialogue_id"])
		}
		if fmt.Sprint(got["user"]) != "ops@example.com" {
			t.Fatalf("user = %#v", got["user"])
		}
		if _, ok := got["err"]; !ok {
			t.Fatal("missing err field")
		}
	}
	if !found {
		t.Fatal("ApiQuery failed was not logged")
	}
}

func logFieldMap(t *testing.T, fields []any) map[string]any {
	t.Helper()
	if len(fields)%2 != 0 {
		t.Fatalf("odd log field count: %#v", fields)
	}
	got := make(map[string]any, len(fields)/2)
	for i := 0; i < len(fields); i += 2 {
		key, ok := fields[i].(string)
		if !ok {
			t.Fatalf("log key %d is %T, want string", i, fields[i])
		}
		got[key] = fields[i+1]
	}
	return got
}
