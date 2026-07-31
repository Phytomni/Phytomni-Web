package api_handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"phytomni-server/common/i18n"
	rxBot "phytomni-server/external/bot"

	"github.com/gin-gonic/gin"
)

func handlerCapabilityBody(t *testing.T) string {
	t.Helper()
	descriptors := make([]rxBot.AgentDescriptor, 0, len(rxBot.WebAgentDefinitions))
	for _, definition := range rxBot.WebAgentDefinitions {
		descriptors = append(descriptors, rxBot.AgentDescriptor{Slug: definition.Slug, Tool: definition.Tool})
	}
	body, err := json.Marshal(rxBot.AgentsListResponse{
		Object:    "list",
		Data:      descriptors,
		Protocols: map[string][]int{rxBot.ResumableUploadProtocol: {rxBot.ResumableUploadProtocolVersion}},
	})
	if err != nil {
		t.Fatalf("marshal capability response: %v", err)
	}
	return string(body)
}

func TestBotCapabilitiesRequiresAuthentication(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/bot/capabilities", nil)
	i18n.Localize()(ctx)

	NewHandler().BotCapabilities(ctx)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestBotCapabilitiesResponseHasBoundedManifest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v1/agents" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(handlerCapabilityBody(t)))
	}))
	t.Cleanup(server.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL:                server.URL,
		ProxyEnabled:           true,
		ResumableUploadEnabled: true,
		UploadPublicOrigin:     "http://upload.example/",
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/bot/capabilities", nil)
	ctx.Set("username", "alice@example.com")

	NewHandler().BotCapabilities(ctx)

	if w.Code != http.StatusOK {
		t.Fatalf("status=%d, want %d; body=%s", w.Code, http.StatusOK, w.Body.String())
	}
	var envelope struct {
		Data map[string]json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(envelope.Data) != 2 {
		t.Fatalf("manifest keys=%v, want exactly agents and upload", mapKeys(envelope.Data))
	}
	if _, ok := envelope.Data["agents"]; !ok {
		t.Fatal("agents missing from manifest")
	}
	if _, ok := envelope.Data["upload"]; !ok {
		t.Fatal("upload missing from manifest")
	}
}

func mapKeys(values map[string]json.RawMessage) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	return keys
}
