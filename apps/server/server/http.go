package server

import (
	"context"
	"log"
	"net/http"
	"time"

	rxRedis "phytomni-server/cache"
	"phytomni-server/server/httpmw"
	"phytomni-server/utils"

	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
)

func NewHttp(options ...HttpOption) *Http {

	viper.SetDefault("app.trusted_proxies", []string{"192.0.0.0/8", "172.16.0.0/12"})

	gin.SetMode(gin.ReleaseMode)
	g := gin.New()
	if utils.Debug() {
		gin.SetMode(gin.DebugMode)
		g.Use(gin.Logger())
	}

	g.SetTrustedProxies(viper.GetStringSlice("app.trusted_proxies"))
	if viper.GetBool("http.gzip") {
		g.Use(gzip.Gzip(
			gzip.BestSpeed,
			gzip.WithExcludedPathsRegexs([]string{
				`^/api/v1/conversations/[^/]+/messages`,
			}),
		))
	}

	g.Use(httpmw.RequestID(), httpmw.Recovery())

	if viper.GetBool("http.maintenance") {
		g.Use(httpmw.UnderMaintenance())
	}

	g.GET("/ping", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"message": "pong",
		})
	})

	// /readyz always returns 200 (fail-open: Redis down does not make the app unready);
	// redis field and fail-open counter let ops detect "enabled but unreachable" Redis.
	g.GET("/readyz", readyzHandler)

	srv := &Http{
		Server: http.Server{
			Handler: g,
		},
		gin: g,
	}
	for _, f := range options {
		f(srv)
	}

	return srv
}

// readyzHandler reports readiness. It always returns 200 (the app is ready to
// serve even when Redis is down — every Redis feature is fail-open); the redis
// field ("up"/"down") and the running fail-open counter let monitoring catch an
// "enabled-but-unreachable" Redis and watch how often features degraded.
func readyzHandler(c *gin.Context) {
	redisStatus := "down"
	if rxRedis.Available(c.Request.Context()) {
		redisStatus = "up"
	}
	c.JSON(200, gin.H{
		"status":            "ok",
		"redis":             redisStatus,
		"failopen_count":    rxRedis.FailOpenCount(),
		"ratelimit_blocked": rxRedis.RateLimitBlockedCount(),
		"obs_cache_hit":     rxRedis.ObsCacheHitCount(),
	})
}

type Http struct {
	gin *gin.Engine
	http.Server
}

func (h *Http) GracefulStart(ctx context.Context) {
	go func() {
		log.Printf("Http server listen at %s", h.Addr)
		if err := h.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal("Http server forced to shutdown:", err)
		}
	}()

	<-ctx.Done()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := h.Shutdown(ctx); err != nil {
		log.Fatal("Http server forced to shutdown:", err)
	}
	log.Println("Http server stopped")
}
