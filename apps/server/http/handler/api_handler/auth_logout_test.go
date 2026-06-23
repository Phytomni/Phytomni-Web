package api_handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"

	rxCache "phytomni-server/cache"
	"phytomni-server/middleware"
)

func startCacheForHandler(t *testing.T) *miniredis.Miniredis {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	viper.Set("jwt.secret_key", "test-secret")
	viper.Set("redis.default", "web")
	viper.Set("redis.clients", map[string]interface{}{
		"web": map[string]interface{}{"type": "single-node", "addrs": []string{mr.Addr()}, "db": 0},
	})
	t.Cleanup(func() {
		viper.Set("redis.clients", nil)
		viper.Set("redis.default", "")
		viper.Set("jwt.secret_key", "")
	})
	if err := rxCache.InitFromViper(); err != nil {
		t.Fatalf("cache init: %v", err)
	}
	return mr
}

// Logout blocklists the presented token.
func TestLogout_BlocklistsCurrentToken(t *testing.T) {
	startCacheForHandler(t)
	gin.SetMode(gin.TestMode)
	tok, _ := middleware.GenerateToken("alice@x.com")

	g := gin.New()
	g.POST("/logout", func(c *gin.Context) {
		c.Set("token", tok)
		c.Set("username", "alice@x.com")
		(&Handler{}).Logout(c)
	})
	w := httptest.NewRecorder()
	g.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/logout", nil))
	if w.Code != 200 {
		t.Fatalf("logout: want 200, got %d", w.Code)
	}
	if !rxCache.IsBlocked(context.Background(), rxCache.HashToken(tok)) {
		t.Error("logout must blocklist the current token")
	}
}

// LogoutAll sets the per-user epoch (so AuthMiddleware will reject older tokens).
func TestLogoutAll_SetsUserEpoch(t *testing.T) {
	startCacheForHandler(t)
	gin.SetMode(gin.TestMode)

	g := gin.New()
	g.POST("/logout-all", func(c *gin.Context) {
		c.Set("username", "alice@x.com")
		(&Handler{}).LogoutAll(c)
	})
	before := time.Now().Unix()
	w := httptest.NewRecorder()
	g.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/logout-all", nil))
	if w.Code != 200 {
		t.Fatalf("logout-all: want 200, got %d", w.Code)
	}
	if epoch := rxCache.GetUserEpoch(context.Background(), "alice@x.com"); epoch < before {
		t.Errorf("logout-all must set epoch >= now (%d), got %d", before, epoch)
	}
}

// Logout is fail-open: even with Redis down it returns 200 (best-effort).
func TestLogout_FailOpenWhenRedisDown(t *testing.T) {
	mr := startCacheForHandler(t)
	gin.SetMode(gin.TestMode)
	tok, _ := middleware.GenerateToken("alice@x.com")
	mr.Close()

	g := gin.New()
	g.POST("/logout", func(c *gin.Context) {
		c.Set("token", tok)
		c.Set("username", "alice@x.com")
		(&Handler{}).Logout(c)
	})
	w := httptest.NewRecorder()
	g.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/logout", nil))
	if w.Code != 200 {
		t.Fatalf("logout must fail-open to 200 when Redis is down, got %d", w.Code)
	}
}

// LogoutAll is fail-open: even with Redis down it returns 200 (the epoch write
// degrades and is logged, but the request still succeeds).
func TestLogoutAll_FailOpenWhenRedisDown(t *testing.T) {
	mr := startCacheForHandler(t)
	gin.SetMode(gin.TestMode)
	mr.Close()

	g := gin.New()
	g.POST("/logout-all", func(c *gin.Context) {
		c.Set("username", "alice@x.com")
		(&Handler{}).LogoutAll(c)
	})
	w := httptest.NewRecorder()
	g.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/logout-all", nil))
	if w.Code != 200 {
		t.Fatalf("logout-all must fail-open to 200 when Redis is down, got %d", w.Code)
	}
}
