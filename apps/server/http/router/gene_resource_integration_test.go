package router

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
	"phytomni-server/common"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/middleware"
)

const geneResourceFixtureName = "Os01g0107900_result.md"
const geneResourceFixtureImage = "Os01g0107900_tree.png"

func geneResourceRouteRequest(engine *gin.Engine, route, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, route, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	engine.ServeHTTP(rec, req)
	return rec
}

func TestGeneResourceRealRouter(t *testing.T) {
	engine, gdb := buildRealApiEnv(t)
	if err := gdb.Exec(`INSERT INTO users (email, first_login_status) VALUES ('gene-reader@example.test', '1')`).Error; err != nil {
		t.Fatal(err)
	}
	token, err := middleware.GenerateToken("gene-reader@example.test")
	if err != nil {
		t.Fatal(err)
	}
	mount := t.TempDir()
	for _, dir := range []string{"md", "img/Os01g0107900"} {
		if err := os.MkdirAll(filepath.Join(mount, dir), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	body := "# Gene\n\n![tree](/api/v1/gene-images/Os01g0107900/" + geneResourceFixtureImage + ")\n"
	reportPath := filepath.Join(mount, "md", geneResourceFixtureName)
	if err := os.WriteFile(reportPath, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	imageBytes := []byte("\x89PNG\r\n\x1a\nIMAGE")
	if err := os.WriteFile(filepath.Join(mount, "img/Os01g0107900", geneResourceFixtureImage), imageBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	oldMount := viper.Get("gene_obsfs_path")
	viper.Set("gene_obsfs_path", mount)
	t.Cleanup(func() { viper.Set("gene_obsfs_path", oldMount) })

	rec := geneResourceRouteRequest(engine, "/api/v1/genes/"+geneResourceFixtureName, token)
	if rec.Code != http.StatusOK {
		t.Fatalf("report status=%d body=%s", rec.Code, rec.Body.String())
	}
	var envelope struct {
		Data common.GeneDetailResponse `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if len(envelope.Data.Resources) != 1 {
		t.Fatalf("missing registered PNG: %s", rec.Body.String())
	}
	resourceRoute := "/api/v1/genes/" + geneResourceFixtureName + "/resources/" + envelope.Data.Resources[0].ID
	t.Run("authenticated raw bytes and headers", func(t *testing.T) {
		got := geneResourceRouteRequest(engine, resourceRoute, token)
		if got.Code != http.StatusOK || !bytes.Equal(got.Body.Bytes(), imageBytes) {
			t.Fatalf("resource status=%d body=%q", got.Code, got.Body.String())
		}
		if got.Header().Get("Content-Type") != "image/png" || got.Header().Get("X-Content-Type-Options") != "nosniff" || !strings.Contains(got.Header().Get("Content-Security-Policy"), "sandbox") {
			t.Fatal("resource response lacks PNG hardening")
		}
	})
	t.Run("unknown identity", func(t *testing.T) {
		got := geneResourceRouteRequest(engine, "/api/v1/genes/"+geneResourceFixtureName+"/resources/gene-"+strings.Repeat("0", 64), token)
		if got.Code != http.StatusNotFound {
			t.Fatalf("unknown resource status=%d", got.Code)
		}
	})
	t.Run("stale identity", func(t *testing.T) {
		if err := os.WriteFile(reportPath, []byte(body+"\nRevised report.\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		got := geneResourceRouteRequest(engine, resourceRoute, token)
		if got.Code != http.StatusNotFound || bytes.Contains(got.Body.Bytes(), imageBytes) {
			t.Fatalf("stale resource status=%d", got.Code)
		}
	})
}

func TestGeneResourceAuthRejectsBeforeStorage(t *testing.T) {
	engine, gdb := buildRealApiEnv(t)
	if err := gdb.Exec(`INSERT INTO users (email, first_login_status) VALUES ('new-gene-reader@example.test', '0')`).Error; err != nil {
		t.Fatal(err)
	}
	firstLoginToken, err := middleware.GenerateToken("new-gene-reader@example.test")
	if err != nil {
		t.Fatal(err)
	}
	var reads atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reads.Add(1)
		http.Error(w, "must not read", http.StatusInternalServerError)
	}))
	oldBot, oldMount := rxBot.BotConfig, viper.Get("gene_obsfs_path")
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	viper.Set("gene_obsfs_path", "")
	t.Cleanup(func() { srv.Close(); rxBot.BotConfig = oldBot; viper.Set("gene_obsfs_path", oldMount) })
	for _, tc := range []struct {
		name, token string
		status      int
	}{
		{name: "no token", status: http.StatusUnauthorized},
		{name: "invalid token", token: "invalid", status: http.StatusUnauthorized},
		{name: "first login denied", token: firstLoginToken, status: http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := geneResourceRouteRequest(engine, "/api/v1/genes/"+geneResourceFixtureName+"/resources/gene-"+strings.Repeat("1", 64), tc.token)
			if got.Code != tc.status || reads.Load() != 0 {
				t.Fatalf("authorization failed: status=%d reads=%d", got.Code, reads.Load())
			}
		})
	}
}

func TestGeneImageCanceledRequestDoesNotReadStorage(t *testing.T) {
	// This real handler route deliberately has ContextWithFallback=false, like
	// the application. The HTTP request context must reach the service directly.
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	Api(engine.Group("/"))
	var reads atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reads.Add(1); _, _ = w.Write([]byte("# Unexpected")) }))
	oldBot, oldMount := rxBot.BotConfig, viper.Get("gene_obsfs_path")
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	viper.Set("gene_obsfs_path", "")
	t.Cleanup(func() { srv.Close(); rxBot.BotConfig = oldBot; viper.Set("gene_obsfs_path", oldMount) })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	// The public image route reaches the same context-aware gene object reader
	// without auth short-circuiting the observation.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/gene-images/Os01g0107900/"+geneResourceFixtureImage, nil).WithContext(ctx)
	rec := httptest.NewRecorder()
	engine.ServeHTTP(rec, req)
	if rec.Code == http.StatusOK || reads.Load() != 0 {
		t.Fatalf("canceled request read source: status=%d reads=%d", rec.Code, reads.Load())
	}
}
