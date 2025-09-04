package server

import (
	"context"
	"log"
	"net/http"
	"time"

	"nky_client_go/server/middleware"
	"nky_client_go/utils"

	"github.com/getsentry/sentry-go"
	sentrygin "github.com/getsentry/sentry-go/gin"
	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
)

func NewHttp(options ...HttpOption) *Http {

	// 默认设置
	viper.SetDefault("app.trusted_proxies", []string{"192.0.0.0/8", "172.16.0.0/12"})

	// 初始化gin
	gin.SetMode(gin.ReleaseMode)
	g := gin.New()
	if utils.Debug() {
		gin.SetMode(gin.DebugMode)
		g.Use(gin.Logger())
	}

	g.SetTrustedProxies(viper.GetStringSlice("app.trusted_proxies"))
	if viper.GetBool("http.gzip") {
		g.Use(gzip.Gzip(gzip.BestSpeed))
	}

	// 默认中间件
	g.Use(middleware.RequestID(), middleware.Recovery())
	g.Use(sentrygin.New(sentrygin.Options{Repanic: true, WaitForDelivery: true, Timeout: 10 * time.Second}))

	// 开启维护模式，维护模式请求全部禁止
	if viper.GetBool("http.maintenance") {
		g.Use(middleware.UnderMaintenance())
	}

	// 健康检查
	g.GET("/ping", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"message": "pong",
		})
	})

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

type Http struct {
	TracesSampler sentry.TracesSampler
	gin           *gin.Engine
	http.Server
}

func (h *Http) GracefulStart(ctx context.Context) {
	go func() {
		log.Printf("Http server listen at %s", h.Addr)
		if err := h.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal("Http server forced to shutdown:", err)
		}
	}()

	select {
	case <-ctx.Done():
		sentry.Flush(2 * time.Second)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := h.Shutdown(ctx); err != nil {
			log.Fatal("Http server forced to shutdown:", err)
		}
		log.Println("Http server stopped")

		// todo:: 这里并没有平滑重启pprof 和 gops，目前看没必要
	}
}
