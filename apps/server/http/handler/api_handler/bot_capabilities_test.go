package api_handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"phytomni-server/common/i18n"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/service/api_service"

	"github.com/gin-gonic/gin"
)

func handlerCapabilityBody(t *testing.T) string {
	t.Helper()
	descriptors := make([]rxBot.AgentDescriptor, 0, len(rxBot.WebAgentDefinitions))
	for _, definition := range rxBot.WebAgentDefinitions {
		descriptor := rxBot.AgentDescriptor{Slug: definition.Slug, Tool: definition.Tool}
		if definition.Slug == "research" {
			descriptor.Capabilities.Attachments.Datasets = &rxBot.AgentDescriptorDatasetCapability{
				Formats:       api_service.RequiredResearchDatasetFormats(),
				MaxFiles:      64,
				MaxFileBytes:  10 << 30,
				MaxTotalBytes: (10 << 30) * 64,
			}
		}
		descriptors = append(descriptors, descriptor)
	}
	body, err := json.Marshal(rxBot.AgentsListResponse{
		Object: "list",
		Data:   descriptors,
		Protocols: map[string][]int{
			rxBot.ResumableUploadProtocol: {rxBot.ResumableUploadProtocolVersion},
			rxBot.ResultArchiveProtocol:   {rxBot.ResultArchiveProtocolVersion},
			rxBot.ResearchInputProtocol:   {rxBot.ResearchInputProtocolVersion},
		},
		ResearchInputResolution: &rxBot.ResearchInputResolutionDescriptor{
			MaxUserQueryChars: 262_144,
			MaxAttachments:    64,
			MaxDatasetPaths:   64,
			MaxReferences:     128,
		},
	})
	if err != nil {
		t.Fatalf("marshal capability response: %v", err)
	}
	return string(body)
}

func serveHandlerResearchCatalog(t *testing.T, w http.ResponseWriter, r *http.Request) bool {
	t.Helper()
	if r.Method != http.MethodGet || r.URL.Path != "/v1/agents" {
		return false
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(handlerCapabilityBody(t)))
	return true
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
		BaseURL:            server.URL,
		ProxyEnabled:       true,
		UploadPublicOrigin: "http://upload.example/",
		ResearchEnabled:    true,
		MaxQueryChars:      131_072,
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
	if len(envelope.Data) != 3 {
		t.Fatalf("manifest keys=%v, want exactly agents, upload, and research_input", mapKeys(envelope.Data))
	}
	if _, ok := envelope.Data["agents"]; !ok {
		t.Fatal("agents missing from manifest")
	}
	if _, ok := envelope.Data["upload"]; !ok {
		t.Fatal("upload missing from manifest")
	}
	var researchInput struct {
		Enabled         bool   `json:"enabled"`
		Protocol        string `json:"protocol"`
		MaxQueryChars   int    `json:"max_user_query_chars"`
		MaxAttachments  int    `json:"max_attachments_per_request"`
		MaxDatasetPaths int    `json:"max_research_dataset_paths"`
		MaxReferences   int    `json:"max_research_input_references"`
	}
	if err := json.Unmarshal(envelope.Data["research_input"], &researchInput); err != nil {
		t.Fatalf("decode Research input capability: %v", err)
	}
	if !researchInput.Enabled || researchInput.Protocol != rxBot.ResearchInputProtocol ||
		researchInput.MaxQueryChars != 131_072 || researchInput.MaxAttachments != 64 ||
		researchInput.MaxDatasetPaths != 64 || researchInput.MaxReferences != 128 {
		t.Fatalf("Research input capability = %#v", researchInput)
	}
	var agents []map[string]interface{}
	if err := json.Unmarshal(envelope.Data["agents"], &agents); err != nil {
		t.Fatalf("decode agent capabilities: %v", err)
	}
	for _, agent := range agents {
		if _, ok := agent["protocols"]; ok {
			t.Fatal("Bot protocol advertisement leaked to browser manifest")
		}
		if _, ok := agent["result_archive_v1"]; ok {
			t.Fatal("result archive protocol detail leaked to browser manifest")
		}
	}
}

func mapKeys(values map[string]json.RawMessage) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	return keys
}
