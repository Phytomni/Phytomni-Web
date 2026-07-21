package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestGracefulStartWaitsForCancellationAndShutsDownOnce(t *testing.T) {
	h := &Http{Server: http.Server{Addr: "127.0.0.1:0"}}
	var shutdownCalls int
	shutdownDone := make(chan struct{})
	h.RegisterOnShutdown(func() {
		shutdownCalls++
		close(shutdownDone)
	})

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		h.GracefulStart(ctx)
		close(done)
	}()
	t.Cleanup(func() { _ = h.Close() })

	select {
	case <-done:
		t.Fatal("GracefulStart returned before its context was canceled")
	case <-time.After(50 * time.Millisecond):
	}

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("GracefulStart did not return after context cancellation")
	}
	select {
	case <-shutdownDone:
	case <-time.After(2 * time.Second):
		t.Fatal("Shutdown callback did not run after context cancellation")
	}
	if shutdownCalls != 1 {
		t.Fatalf("Shutdown callbacks = %d, want exactly one", shutdownCalls)
	}
}

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

// TestReadyzHandler_IncludesObsCacheHit asserts /readyz JSON exposes the
// obs_cache_hit field alongside the existing redis/failopen/ratelimit fields.
func TestReadyzHandler_IncludesObsCacheHit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/readyz", readyzHandler)
	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("readyz must be 200, got %d", w.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("readyz body not JSON: %v", err)
	}
	for _, k := range []string{"redis", "failopen_count", "ratelimit_blocked", "obs_cache_hit"} {
		if _, ok := body[k]; !ok {
			t.Errorf("readyz JSON missing %q (got keys %v)", k, body)
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
