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
	body, err := json.Marshal(rxBot.AgentsListResponse{
		Object:    "list",
		Data:      descriptors,
		Protocols: map[string][]int{rxBot.ResumableUploadProtocol: {rxBot.ResumableUploadProtocolVersion}},
	})
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

func disabledManifest(t *testing.T, manifest BotCapabilityManifest) {
	t.Helper()
	rows := manifest.Agents
	if len(rows) != len(rxBot.WebAgentDefinitions) {
		t.Fatalf("manifest length = %d, want %d", len(rows), len(rxBot.WebAgentDefinitions))
	}
	if manifest.Upload.Enabled || manifest.Upload.UploadOrigin != "" {
		t.Fatalf("upload capability was not disabled: %#v", manifest.Upload)
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
	var public struct {
		Agents []map[string]interface{} `json:"agents"`
		Upload map[string]interface{}   `json:"upload"`
	}
	if err := json.Unmarshal(encoded, &public); err != nil {
		t.Fatal(err)
	}
	allowed := map[string]bool{
		"tool": true, "slug": true, "execution": true, "stream": true,
		"a2ui": true, "resolver": true, "attachments": true,
		"artifacts": true, "enabled": true,
	}
	if len(public.Upload) == 0 {
		t.Fatal("upload capability missing")
	}
	for _, row := range public.Agents {
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
	for key := range public.Upload {
		switch key {
		case "enabled", "protocol", "upload_origin", "max_file_bytes", "max_attachments":
		default:
			t.Fatalf("private or unknown upload field %q leaked", key)
		}
	}
	if got := capabilityBySlug(rows.Agents, "research"); got.Enabled {
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
	if len(rows.Agents) != len(rxBot.WebAgentDefinitions) {
		t.Fatalf("manifest length = %d, want %d", len(rows.Agents), len(rxBot.WebAgentDefinitions))
	}
	for _, definition := range rxBot.WebAgentDefinitions {
		row := capabilityBySlug(rows.Agents, definition.Slug)
		if row.Tool != definition.Tool || row.Slug != definition.Slug || row.Execution != definition.Execution {
			t.Fatalf("stable pair mismatch for %s: %#v", definition.Slug, row)
		}
		wantEnabled := definition.Slug == "chat" || definition.Slug == "knowledge"
		if row.Enabled != wantEnabled {
			t.Fatalf("%s enabled=%v want=%v", definition.Slug, row.Enabled, wantEnabled)
		}
	}
}

func TestBotCapabilitiesUploadNegotiation(t *testing.T) {
	withProtocol := capabilityManifestResponse(t, capabilityDescriptors())
	withoutProtocol, err := json.Marshal(rxBot.AgentsListResponse{
		Object: "list",
		Data:   capabilityDescriptors(),
	})
	if err != nil {
		t.Fatalf("marshal missing protocol response: %v", err)
	}
	wrongVersion, err := json.Marshal(rxBot.AgentsListResponse{
		Object:    "list",
		Data:      capabilityDescriptors(),
		Protocols: map[string][]int{rxBot.ResumableUploadProtocol: {1}},
	})
	if err != nil {
		t.Fatalf("marshal wrong protocol response: %v", err)
	}

	tests := []struct {
		name            string
		config          rxBot.Config
		status          int
		body            string
		wantUpload      bool
		wantAgents      bool
		wantAttachments bool
	}{
		{name: "switch off", config: rxBot.Config{ProxyEnabled: true}, status: http.StatusOK, body: withProtocol, wantAgents: true},
		{name: "proxy off", config: rxBot.Config{ResumableUploadEnabled: true, UploadPublicOrigin: "http://upload.example"}, status: http.StatusOK, body: withProtocol},
		{name: "absent protocol", config: rxBot.Config{ProxyEnabled: true, ResumableUploadEnabled: true, UploadPublicOrigin: "http://upload.example"}, status: http.StatusOK, body: string(withoutProtocol), wantAgents: true},
		{name: "wrong protocol version", config: rxBot.Config{ProxyEnabled: true, ResumableUploadEnabled: true, UploadPublicOrigin: "http://upload.example"}, status: http.StatusOK, body: string(wrongVersion), wantAgents: true},
		{name: "invalid public origin", config: rxBot.Config{ProxyEnabled: true, ResumableUploadEnabled: true, UploadPublicOrigin: "http://upload.example/path"}, status: http.StatusOK, body: withProtocol, wantAgents: true},
		{name: "discovery error", config: rxBot.Config{ProxyEnabled: true, ResumableUploadEnabled: true, UploadPublicOrigin: "http://upload.example"}, status: http.StatusBadGateway, body: `{}`, wantAgents: false},
		{name: "fully enabled", config: rxBot.Config{ProxyEnabled: true, ResumableUploadEnabled: true, UploadPublicOrigin: "http://upload.example/"}, status: http.StatusOK, body: withProtocol, wantUpload: true, wantAgents: true, wantAttachments: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := capabilityServer(t, tt.status, tt.body, 0)
			t.Cleanup(srv.Close)
			tt.config.BaseURL = srv.URL
			useCapabilityBotConfig(t, srv.URL, tt.config)

			manifest, err := NewService().BotCapabilities(context.Background(), "alice@example.com")
			if err != nil {
				t.Fatal(err)
			}
			if manifest.Upload.Enabled != tt.wantUpload {
				t.Fatalf("upload enabled=%v want=%v: %#v", manifest.Upload.Enabled, tt.wantUpload, manifest.Upload)
			}
			if manifest.Upload.Enabled {
				if manifest.Upload.UploadOrigin != "http://upload.example" || manifest.Upload.MaxFileBytes != 10<<30 || manifest.Upload.MaxAttachments != 10 {
					t.Fatalf("unexpected upload manifest: %#v", manifest.Upload)
				}
			}
			chat := capabilityBySlug(manifest.Agents, "chat")
			if chat.Enabled != tt.wantAgents {
				t.Fatalf("chat enabled=%v want=%v: %#v", chat.Enabled, tt.wantAgents, chat)
			}
			if chat.Attachments != tt.wantAttachments {
				t.Fatalf("chat attachments=%v want=%v: %#v", chat.Attachments, tt.wantAttachments, chat)
			}
		})
	}

	t.Run("nil config", func(t *testing.T) {
		previous := rxBot.BotConfig
		rxBot.BotConfig = nil
		t.Cleanup(func() { rxBot.BotConfig = previous })
		manifest, err := NewService().BotCapabilities(context.Background(), "alice@example.com")
		if err != nil {
			t.Fatal(err)
		}
		disabledManifest(t, manifest)
	})
}

func TestValidUploadPublicOrigin(t *testing.T) {
	tests := []struct {
		input string
		want  string
		ok    bool
	}{
		{input: "http://localhost:8000", want: "http://localhost:8000", ok: true},
		{input: "https://UPLOAD.example/", want: "https://UPLOAD.example", ok: true},
		{input: "", ok: false},
		{input: "ftp://upload.example", ok: false},
		{input: "http://user:pass@upload.example", ok: false},
		{input: "http://upload.example/path", ok: false},
		{input: "http://upload.example?token=secret", ok: false},
		{input: "http://upload.example#fragment", ok: false},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, ok := validUploadPublicOrigin(tt.input)
			if got != tt.want || ok != tt.ok {
				t.Fatalf("validUploadPublicOrigin(%q)=(%q,%v), want (%q,%v)", tt.input, got, ok, tt.want, tt.ok)
			}
		})
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
		if !capabilityBySlug(rows.Agents, slug).Stream {
			t.Fatalf("%s stream capability should be enabled by the local gate", slug)
		}
	}
	if !capabilityBySlug(rows.Agents, "review").A2UI {
		t.Fatal("Review A2UI should follow the explicit local gate")
	}
	if !capabilityBySlug(rows.Agents, "chat").Resolver {
		t.Fatal("Chat resolver should follow the explicit Expert gate")
	}
	for _, slug := range []string{"analyst", "deep_genome", "research", "design", "network"} {
		row := capabilityBySlug(rows.Agents, slug)
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
