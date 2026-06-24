package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// TestReadyzHandler_IncludesRateLimitBlocked asserts that /readyz JSON exposes
// the ratelimit_blocked field alongside redis and failopen_count, machine-locking
// the observability contract (Step 2 of Phase 2 Task 3).
func TestReadyzHandler_IncludesRateLimitBlocked(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/readyz", readyzHandler)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("readyz must be 200, got %d", w.Code)
	}
	var body map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("json: %v", err)
	}
	for _, k := range []string{"redis", "failopen_count", "ratelimit_blocked"} {
		if _, ok := body[k]; !ok {
			t.Errorf("readyz must expose %q", k)
		}
	}
}

// readyzHandler is the extracted handler (see http.go) so it can be tested
// without standing up the full server.
func TestReadyzReportsRedisStatusAndCount(t *testing.T) {
	gin.SetMode(gin.TestMode)
	g := gin.New()
	g.GET("/readyz", readyzHandler)

	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	w := httptest.NewRecorder()
	g.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (readyz is fail-open: app is ready even if Redis is down)", w.Code)
	}
	var body struct {
		Status        string `json:"status"`
		Redis         string `json:"redis"`
		FailOpenCount int64  `json:"failopen_count"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("body: %v", err)
	}
	if body.Status != "ok" {
		t.Errorf("status = %q, want ok", body.Status)
	}
	// No Redis initialized in this test → redis must report "down", not crash.
	if body.Redis != "down" {
		t.Errorf("redis = %q, want down (no client registered in test)", body.Redis)
	}
}
