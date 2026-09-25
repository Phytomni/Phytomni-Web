package api_handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
	"phytomni-server/common/i18n"
	rxBot "phytomni-server/external/bot"
)

func TestGeneHandlersUseRequestCancellation(t *testing.T) {
	var reads atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reads.Add(1)
		_, _ = w.Write([]byte("# Unwanted upstream read"))
	}))
	oldBot, oldMount := rxBot.BotConfig, viper.Get("gene_obsfs_path")
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	viper.Set("gene_obsfs_path", "")
	t.Cleanup(func() { srv.Close(); rxBot.BotConfig = oldBot; viper.Set("gene_obsfs_path", oldMount) })
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(i18n.Localize())
	// Real handlers, no Gin context fallback. Authentication is independently
	// verified on the full production router; this isolates context propagation.
	handler := &Handler{}
	engine.GET("/genes/:id", handler.GeneDetails)
	engine.GET("/genes/:id/resources/:resource_id", handler.GeneResource)
	for _, route := range []string{
		"/genes/Os01g0107900_result.md",
		"/genes/Os01g0107900_result.md/resources/gene-" + strings.Repeat("1", 64),
	} {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		req := httptest.NewRequest(http.MethodGet, route, nil).WithContext(ctx)
		rec := httptest.NewRecorder()
		engine.ServeHTTP(rec, req)
		if rec.Code == http.StatusOK || reads.Load() != 0 {
			t.Fatalf("canceled HTTP request reached storage: status=%d calls=%d", rec.Code, reads.Load())
		}
	}
}
