package api_handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"phytomni-server/common/i18n"
	"phytomni-server/middleware"

	"github.com/gin-gonic/gin"
)

func TestGetDownloadObsFileDisabled(t *testing.T) {
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
	if w.Header().Get("Location") != "" ||
		strings.Contains(w.Body.String(), "/obs/") ||
		strings.Contains(w.Body.String(), "relay-file") ||
		strings.Contains(w.Body.String(), "alice") {
		t.Fatalf("disabled email route returned authenticated download data: %s", w.Body.String())
	}
}

func TestRelayFileDownloadRejectsLegacyTokenAlias(t *testing.T) {
	gin.SetMode(gin.TestMode)
	token, err := middleware.GenerateDownloadToken("synthetic/report.pdf", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(
		http.MethodGet,
		"/api/v1/downloads/relay-file?t="+token,
		nil,
	)
	i18n.Localize()(c)

	NewHandler().RelayFileDownload(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("legacy token alias status = %d, want 401", w.Code)
	}
}
