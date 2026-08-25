package api_handler

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	rxBot "phytomni-server/external/bot"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
)

func TestGeneListStopsAfterRelayFailure(t *testing.T) {
	gin.SetMode(gin.TestMode)
	relay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "relay unavailable", http.StatusInternalServerError)
	}))
	t.Cleanup(relay.Close)

	previousBotConfig := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL:        relay.URL,
		ProxyEnabled:   true,
		TimeoutSeconds: 5,
	}
	t.Cleanup(func() { rxBot.BotConfig = previousBotConfig })

	previousMount := viper.GetString("gene_obsfs_path")
	viper.Set("gene_obsfs_path", "")
	t.Cleanup(func() { viper.Set("gene_obsfs_path", previousMount) })

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/genes?current=1&size=20", nil)

	NewHandler().GeneList(ctx)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusInternalServerError)
	}
	decoder := json.NewDecoder(recorder.Body)
	var response map[string]any
	if err := decoder.Decode(&response); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if err := decoder.Decode(&map[string]any{}); err != io.EOF {
		t.Fatalf("handler wrote more than one JSON response: %q", recorder.Body.String())
	}
}
