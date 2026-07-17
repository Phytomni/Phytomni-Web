package api_service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	rxBot "phytomni-server/external/bot"
)

func capabilityDescriptors() []rxBot.AgentDescriptor {
	descriptors := make([]rxBot.AgentDescriptor, 0, len(rxBot.WebAgentDefinitions))
	for _, definition := range rxBot.WebAgentDefinitions {
		descriptors = append(descriptors, rxBot.AgentDescriptor{
			Slug: definition.Slug,
			Tool: definition.Tool,
		})
	}
	return descriptors
}

func capabilityServer(t *testing.T, status int, body string, delay time.Duration) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v1/agents" {
			http.NotFound(w, r)
			return
		}
		if delay > 0 {
			time.Sleep(delay)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
}

func useCapabilityBotConfig(t *testing.T, baseURL string, cfg rxBot.Config) {
	t.Helper()
	previous := rxBot.BotConfig
	cfg.BaseURL = baseURL
	if cfg.TimeoutSeconds <= 0 {
		cfg.TimeoutSeconds = 1
	}
	rxBot.BotConfig = &cfg
	t.Cleanup(func() { rxBot.BotConfig = previous })
}

func capabilityManifestResponse(t *testing.T, descriptors []rxBot.AgentDescriptor) string {
	t.Helper()
	body, err := json.Marshal(rxBot.AgentsListResponse{Object: "list", Data: descriptors})
	if err != nil {
		t.Fatalf("marshal agent response: %v", err)
	}
	return string(body)
}

func capabilityBySlug(rows []BotCapability, slug string) BotCapability {
	for _, row := range rows {
		if row.Slug == slug {
			return row
		}
	}
	return BotCapability{}
}

func disabledManifest(t *testing.T, rows []BotCapability) {
	t.Helper()
	if len(rows) != len(rxBot.WebAgentDefinitions) {
		t.Fatalf("manifest length = %d, want %d", len(rows), len(rxBot.WebAgentDefinitions))
	}
	for _, row := range rows {
		if row.Enabled || row.Stream || row.A2UI || row.Resolver || row.Attachments || row.Artifacts {
			t.Fatalf("row %q was not disabled: %#v", row.Slug, row)
		}
	}
}

func TestBotCapabilitiesDoNotExposeUpstreamPrivateFields(t *testing.T) {
	srv := capabilityServer(t, http.StatusOK, capabilityManifestResponse(t, capabilityDescriptors()), 0)
	t.Cleanup(srv.Close)
	useCapabilityBotConfig(t, srv.URL, rxBot.Config{ProxyEnabled: true})

	rows, err := NewService().BotCapabilities(context.Background(), "alice@example.com")
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(rows)
	if err != nil {
		t.Fatal(err)
	}
	var public []map[string]interface{}
	if err := json.Unmarshal(encoded, &public); err != nil {
		t.Fatal(err)
	}
	allowed := map[string]bool{
		"tool": true, "slug": true, "execution": true, "stream": true,
		"a2ui": true, "resolver": true, "attachments": true,
		"artifacts": true, "enabled": true,
	}
	for _, row := range public {
		for key := range row {
			if !allowed[key] {
				t.Fatalf("private or unknown manifest field %q leaked", key)
			}
		}
		if _, ok := row["api_key"]; ok {
			t.Fatal("api_key leaked")
		}
		if _, ok := row["base_url"]; ok {
			t.Fatal("base_url leaked")
		}
		if _, ok := row["legacy_aliases"]; ok {
			t.Fatal("legacy aliases leaked")
		}
	}
	if got := capabilityBySlug(rows, "research"); got.Enabled {
		t.Fatal("new remote research capability must stay dark")
	}
}

func TestBotCapabilitiesStablePairsAndAbsentAgentsDisabled(t *testing.T) {
	descriptors := capabilityDescriptors()[:2]
	srv := capabilityServer(t, http.StatusOK, capabilityManifestResponse(t, descriptors), 0)
	t.Cleanup(srv.Close)
	useCapabilityBotConfig(t, srv.URL, rxBot.Config{ProxyEnabled: true})

	rows, err := NewService().BotCapabilities(context.Background(), "alice@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != len(rxBot.WebAgentDefinitions) {
		t.Fatalf("manifest length = %d, want %d", len(rows), len(rxBot.WebAgentDefinitions))
	}
	for _, definition := range rxBot.WebAgentDefinitions {
		row := capabilityBySlug(rows, definition.Slug)
		if row.Tool != definition.Tool || row.Slug != definition.Slug || row.Execution != definition.Execution {
			t.Fatalf("stable pair mismatch for %s: %#v", definition.Slug, row)
		}
		wantEnabled := definition.Slug == "chat" || definition.Slug == "knowledge"
		if row.Enabled != wantEnabled {
			t.Fatalf("%s enabled=%v want=%v", definition.Slug, row.Enabled, wantEnabled)
		}
	}
}

func TestBotCapabilitiesLocalGatesAndRemoteDefaults(t *testing.T) {
	srv := capabilityServer(t, http.StatusOK, capabilityManifestResponse(t, capabilityDescriptors()), 0)
	t.Cleanup(srv.Close)
	useCapabilityBotConfig(t, srv.URL, rxBot.Config{
		ProxyEnabled:       true,
		StreamEnabled:      true,
		A2uiActionsEnabled: true,
		ExpertEnabled:      true,
	})

	rows, err := NewService().BotCapabilities(context.Background(), "alice@example.com")
	if err != nil {
		t.Fatal(err)
	}
	for _, slug := range []string{"chat", "knowledge", "brief_gene"} {
		if !capabilityBySlug(rows, slug).Stream {
			t.Fatalf("%s stream capability should be enabled by the local gate", slug)
		}
	}
	if !capabilityBySlug(rows, "review").A2UI {
		t.Fatal("Review A2UI should follow the explicit local gate")
	}
	if !capabilityBySlug(rows, "chat").Resolver {
		t.Fatal("Chat resolver should follow the explicit Expert gate")
	}
	for _, slug := range []string{"analyst", "deep_genome", "research", "design", "network"} {
		row := capabilityBySlug(rows, slug)
		if row.Enabled || row.Stream || row.A2UI || row.Resolver || row.Attachments || row.Artifacts {
			t.Fatalf("new remote %s was enabled unexpectedly: %#v", slug, row)
		}
	}
}

func TestBotCapabilitiesListingFailuresFailClosed(t *testing.T) {
	tests := []struct {
		name   string
		status int
		body   string
		delay  time.Duration
	}{
		{name: "401", status: http.StatusUnauthorized, body: `{}`, delay: 0},
		{name: "404", status: http.StatusNotFound, body: `{}`, delay: 0},
		{name: "malformed json", status: http.StatusOK, body: `{"data":`, delay: 0},
		{name: "timeout", status: http.StatusOK, body: `{}`, delay: 100 * time.Millisecond},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := capabilityServer(t, tt.status, tt.body, tt.delay)
			t.Cleanup(srv.Close)
			useCapabilityBotConfig(t, srv.URL, rxBot.Config{ProxyEnabled: true, TimeoutSeconds: 1})

			ctx := context.Background()
			if tt.name == "timeout" {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, 5*time.Millisecond)
				t.Cleanup(cancel)
			}
			rows, err := NewService().BotCapabilities(ctx, "alice@example.com")
			if err != nil {
				t.Fatal(err)
			}
			disabledManifest(t, rows)
		})
	}
}

func TestBotCapabilitiesMalformedDescriptorsFailClosed(t *testing.T) {
	for _, descriptor := range []rxBot.AgentDescriptor{
		{Slug: "chat"},
		{Slug: "unknown", Tool: "UnknownAgent"},
		{Slug: "chat", Tool: "ChatAgent"},
	} {
		t.Run(strings.ReplaceAll(descriptor.Slug+descriptor.Tool, " ", "_"), func(t *testing.T) {
			descriptors := []rxBot.AgentDescriptor{descriptor}
			if descriptor.Slug == "chat" && descriptor.Tool == "ChatAgent" {
				descriptors = append(descriptors, descriptor)
			}
			srv := capabilityServer(t, http.StatusOK, capabilityManifestResponse(t, descriptors), 0)
			t.Cleanup(srv.Close)
			useCapabilityBotConfig(t, srv.URL, rxBot.Config{ProxyEnabled: true})

			rows, err := NewService().BotCapabilities(context.Background(), "alice@example.com")
			if err != nil {
				t.Fatal(err)
			}
			disabledManifest(t, rows)
		})
	}
}

func TestBotCapabilitiesWithoutLocalGateSkipsBotAndStaysDisabled(t *testing.T) {
	called := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	}))
	t.Cleanup(srv.Close)
	useCapabilityBotConfig(t, srv.URL, rxBot.Config{ProxyEnabled: false, StreamEnabled: true})

	rows, err := NewService().BotCapabilities(context.Background(), "alice@example.com")
	if err != nil {
		t.Fatal(err)
	}
	disabledManifest(t, rows)
	if called {
		t.Fatal("Bot listing must not be called while the local proxy gate is off")
	}
}
