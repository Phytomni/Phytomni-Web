package api_handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"phytomni-server/common/i18n"
)

// TestUserFeedback_EmptyBody_Localized asserts the empty-body message
// localizes via Accept-Language. The judgment branch (empty type or content
// → 400) is unchanged; only the message text follows the locale.
func TestUserFeedback_EmptyBody_Localized(t *testing.T) {
	for _, tc := range []struct{ lang, want string }{
		{"en-US", "Feedback type and content cannot be empty"},
		{"zh-CN", "反馈类型或反馈内容不能为空"},
	} {
		gin.SetMode(gin.TestMode)
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/user/feedback", strings.NewReader(`{}`))
		req.Header.Set("Accept-Language", tc.lang)
		req.Header.Set("Content-Type", "application/json")
		c.Request = req
		c.Set("username", "tester@x.com")
		i18n.Localize()(c)

		ph := NewHandler()
		ph.UserFeedback(c)

		if w.Code != http.StatusBadRequest {
			t.Fatalf("lang=%s: expected 400, got %d (body=%s)", tc.lang, w.Code, w.Body.String())
		}
		var body map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatalf("lang=%s: decode body %s: %v", tc.lang, w.Body.String(), err)
		}
		msg, _ := body["message"].(string)
		if msg != tc.want {
			t.Errorf("lang=%s: message = %q, want %q", tc.lang, msg, tc.want)
		}
	}
}
