package api_handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"maps"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
	"phytomni-server/common/i18n"
	rxBot "phytomni-server/external/bot"
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
