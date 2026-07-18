package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
)

const messagesPathRegex = `^/api/v1/conversations/[^/]+/messages`

func newGzipEngine(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(gzip.Gzip(gzip.BestSpeed, gzip.WithExcludedPathsRegexs([]string{messagesPathRegex})))
	r.GET("/api/v1/conversations/:id/messages", func(c *gin.Context) {
		c.String(200, strings.Repeat("m", 2048))
	})
	r.GET("/api/v1/ping-gzip", func(c *gin.Context) {
		c.String(200, strings.Repeat("p", 2048))
	})
	return r
}

func TestGzip_ExcludesConversationMessages(t *testing.T) {
	r := newGzipEngine(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/conversations/42/messages", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if ce := w.Header().Get("Content-Encoding"); ce == "gzip" {
		t.Fatalf("messages path must not be gzip-encoded, got Content-Encoding=%q", ce)
	}
	body, _ := io.ReadAll(w.Body)
	if !strings.HasPrefix(string(body), "mm") {
		t.Fatalf("expected plain body, got %q", string(body[:8]))
	}
}

func TestGzip_StillCompressesOtherPaths(t *testing.T) {
	r := newGzipEngine(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/ping-gzip", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if ce := w.Header().Get("Content-Encoding"); ce != "gzip" {
		t.Fatalf("other path should be gzip-encoded, got %q", ce)
	}
}
