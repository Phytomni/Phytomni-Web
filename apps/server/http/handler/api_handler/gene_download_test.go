package api_handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"phytomni-server/common/i18n"

	"github.com/gin-gonic/gin"
)

func TestGetDownloadObsFileDisabled(t *testing.T) {
	setupGeneUploadHandlerDB(t)
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/downloads/obs-file?username=alice&obs_path=/obs/p/r1", nil)
	i18n.Localize()(c)

	NewHandler().GetDownloadObsFile(c)

	if w.Code != http.StatusGone {
		t.Fatalf("expected 410, got %d body=%s", w.Code, w.Body.String())
	}
	var parsed struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if parsed.Code != http.StatusGone {
		t.Fatalf("body code = %d, want 410", parsed.Code)
	}
	if !strings.Contains(parsed.Message, "email download links are currently unavailable") {
		t.Fatalf("message = %q", parsed.Message)
	}
}
