package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	rxCache "phytomni-server/cache"
	"phytomni-server/common/i18n"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
)

func setupRLRedis(t *testing.T) *miniredis.Miniredis {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	viper.Set("redis.default", "web")
	viper.Set("redis.clients", map[string]interface{}{
		"web": map[string]interface{}{"type": "single-node", "addrs": []string{mr.Addr()}, "db": 0},
	})
	t.Cleanup(func() {
		viper.Set("redis.clients", nil)
		viper.Set("redis.default", "")
	})
	if err := rxCache.InitFromViper(); err != nil {
		t.Fatalf("InitFromViper: %v", err)
	}
	return mr
}

func setRLConfig(t *testing.T, name string, enabled bool, limit int64, window time.Duration) {
	t.Helper()
	viper.Set("ratelimit.enabled", enabled)
	viper.Set("ratelimit."+name+".limit", limit)
	viper.Set("ratelimit."+name+".window", window)
	t.Cleanup(func() {
		viper.Set("ratelimit.enabled", false)
		viper.Set("ratelimit."+name+".limit", 0)
		viper.Set("ratelimit."+name+".window", 0)
	})
}

func newRLEngine(mw ...gin.HandlerFunc) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	// i18n.Localize() binds the localizer so i18n.T in the 429 path doesn't
	// panic (the real router mounts i18n.Localize() ahead of this middleware).
	chain := make([]gin.HandlerFunc, 0, len(mw)+2)
	chain = append(chain, i18n.Localize())
	chain = append(chain, mw...)
	chain = append(chain, func(c *gin.Context) { c.String(http.StatusOK, "ok") })
	r.GET("/probe", chain...)
	return r
}

func TestPerIPRateLimit_OverLimit429(t *testing.T) {
	setupRLRedis(t)
	setRLConfig(t, "login", true, 2, time.Minute)
	r := newRLEngine(PerIPRateLimit("login"))
	hit := func() *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/probe", nil)
		req.RemoteAddr = "1.2.3.4:5555"
		r.ServeHTTP(w, req)
		return w
	}
	if hit().Code != http.StatusOK || hit().Code != http.StatusOK {
		t.Fatal("first 2 within limit must be 200")
	}
	beforeBlocked := rxCache.RateLimitBlockedCount()
	w := hit()
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("3rd over-limit must be 429, got %d", w.Code)
	}
	if w.Header().Get("Retry-After") == "" {
		t.Error("429 must carry Retry-After")
	}
	if rxCache.RateLimitBlockedCount() <= beforeBlocked {
		t.Error("429 must increment RateLimitBlockedCount")
	}
}

func TestPerIPRateLimit_DistinctIPsIndependent(t *testing.T) {
	setupRLRedis(t)
	setRLConfig(t, "login", true, 1, time.Minute)
	r := newRLEngine(PerIPRateLimit("login"))
	hit := func(ip string) int {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/probe", nil)
		req.RemoteAddr = ip + ":5555"
		r.ServeHTTP(w, req)
		return w.Code
	}
	if hit("1.1.1.1") != http.StatusOK {
		t.Fatal("ip1 first must pass")
	}
	if hit("1.1.1.1") != http.StatusTooManyRequests {
		t.Fatal("ip1 second must 429")
	}
	if hit("2.2.2.2") != http.StatusOK {
		t.Fatal("ip2 must have its own bucket")
	}
}

// Encodes the rejected Option-C trap: a down Redis must NEVER 429/503 — auth
// stays available. Delete the fail-open return in cache.Allow and this goes RED.
func TestPerIPRateLimit_FailOpenWhenRedisDown(t *testing.T) {
	mr := setupRLRedis(t)
	setRLConfig(t, "login", true, 1, time.Minute)
	r := newRLEngine(PerIPRateLimit("login"))
	mr.Close()
	beforeFO := rxCache.FailOpenCount()
	for i := 0; i < 5; i++ {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/probe", nil)
		req.RemoteAddr = "9.9.9.9:1"
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("Redis-down request %d must fail-open (200), got %d", i, w.Code)
		}
	}
	if rxCache.FailOpenCount() <= beforeFO {
		t.Error("Redis-down requests must increment FailOpenCount")
	}
}

func TestRateLimit_DisabledPassThrough(t *testing.T) {
	setupRLRedis(t)
	setRLConfig(t, "login", false, 1, time.Minute) // explicitly disabled
	r := newRLEngine(PerIPRateLimit("login"))
	for i := 0; i < 5; i++ {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/probe", nil)
		req.RemoteAddr = "8.8.8.8:1"
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("disabled limiter must pass through (200), got %d", w.Code)
		}
	}
}

func TestPerUserRateLimit_KeysOnUsername(t *testing.T) {
	setupRLRedis(t)
	setRLConfig(t, "query", true, 1, time.Minute)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/probe", i18n.Localize(), func(c *gin.Context) {
		if u := c.Query("u"); u != "" {
			c.Set("username", u)
		}
		c.Next()
	}, PerUserRateLimit("query"), func(c *gin.Context) { c.String(http.StatusOK, "ok") })
	hit := func(u string) int {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/probe?u="+u, nil)
		r.ServeHTTP(w, req)
		return w.Code
	}
	if hit("alice@x.com") != http.StatusOK {
		t.Fatal("alice first must pass")
	}
	if hit("alice@x.com") != http.StatusTooManyRequests {
		t.Fatal("alice second must 429")
	}
	if hit("bob@x.com") != http.StatusOK {
		t.Fatal("bob must have own bucket")
	}
	// empty username → not throttled (fail-open on identity)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/probe", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("empty username must pass through, got %d", w.Code)
	}
}
