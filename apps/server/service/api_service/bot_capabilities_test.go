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
			Capabilities: rxBot.AgentDescriptorCapabilities{
				Artifacts:   resultArchiveAgent(definition.Slug),
				Attachments: rxBot.AgentDescriptorAttachments{DocumentContext: &struct{}{}},
			},
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
		Object: "list",
		Data:   descriptors,
		Protocols: map[string][]int{
			rxBot.ResumableUploadProtocol: {rxBot.ResumableUploadProtocolVersion},
			rxBot.ResultArchiveProtocol:   {rxBot.ResultArchiveProtocolVersion},
		},
	})
	if err != nil {
		t.Fatalf("marshal agent response: %v", err)
	}
	return string(body)
}

func validResearchCapabilityCatalog() *rxBot.AgentsListResponse {
	descriptors := capabilityDescriptors()
	for index := range descriptors {
		if descriptors[index].Slug != "research" {
			continue
		}
		descriptors[index].Capabilities.Attachments.Datasets = &rxBot.AgentDescriptorDatasetCapability{
			Formats:       RequiredResearchDatasetFormats(),
			MaxFiles:      64,
			MaxFileBytes:  10 << 30,
			MaxTotalBytes: (10 << 30) * 64,
		}
	}
	return &rxBot.AgentsListResponse{
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
	}
}

func TestBotCapabilitiesResearchFormatMatrixFailsClosedOnlyForResearch(t *testing.T) {
	for _, missing := range []string{"gz", "tsv", "mtx", "tar"} {
		t.Run("missing "+missing, func(t *testing.T) {
			response := validResearchCapabilityCatalog()
			for index := range response.Data {
				if response.Data[index].Slug != "research" {
					continue
				}
				dataset := response.Data[index].Capabilities.Attachments.Datasets
				formats := make([]string, 0, len(dataset.Formats)-1)
				for _, format := range dataset.Formats {
					if format != missing {
						formats = append(formats, format)
					}
				}
				dataset.Formats = formats
			}

			srv := capabilityServer(t, http.StatusOK, researchCapabilityResponse(t, response), 0)
			t.Cleanup(srv.Close)
			useCapabilityBotConfig(t, srv.URL, rxBot.Config{
				ProxyEnabled:           true,
				ResumableUploadEnabled: true,
				UploadPublicOrigin:     "https://upload.example",
				ResearchEnabled:        true,
				MaxQueryChars:          131_072,
			})

			manifest, err := NewService().BotCapabilities(context.Background(), "alice@example.com")
			if err != nil {
				t.Fatal(err)
			}
			if manifest.ResearchInput.Enabled || capabilityBySlug(manifest.Agents, "research").Enabled {
				t.Fatalf("Research remained enabled without %q: %#v", missing, manifest)
			}
			if !capabilityBySlug(manifest.Agents, "chat").Enabled || !manifest.Upload.Enabled {
				t.Fatalf("unrelated capabilities were disabled without %q: %#v", missing, manifest)
			}
		})
	}
}

func researchCapabilityResponse(t *testing.T, response *rxBot.AgentsListResponse) string {
	t.Helper()
	body, err := json.Marshal(response)
	if err != nil {
		t.Fatalf("marshal Research capability response: %v", err)
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
		if row.AttachmentPurposes == nil || len(row.AttachmentPurposes) != 0 {
			t.Fatalf("row %q attachment purposes = %#v, want non-nil empty slice", row.Slug, row.AttachmentPurposes)
		}
	}
}

func TestBotCapabilitiesProjectsResearchInputContract(t *testing.T) {
	srv := capabilityServer(t, http.StatusOK, researchCapabilityResponse(t, validResearchCapabilityCatalog()), 0)
	t.Cleanup(srv.Close)
	useCapabilityBotConfig(t, srv.URL, rxBot.Config{
		ProxyEnabled:           true,
		ResumableUploadEnabled: true,
		UploadPublicOrigin:     "https://upload.example",
		ResearchEnabled:        true,
		MaxQueryChars:          131_072,
	})

	manifest, err := NewService().BotCapabilities(context.Background(), "alice@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if !manifest.ResearchInput.Enabled ||
		manifest.ResearchInput.Protocol != rxBot.ResearchInputProtocol ||
		manifest.ResearchInput.MaxQueryChars != 131_072 ||
		manifest.ResearchInput.MaxAttachments != 64 ||
		manifest.ResearchInput.MaxDatasetPaths != 64 ||
		manifest.ResearchInput.MaxReferences != 128 {
		t.Fatalf("Research input capability = %#v", manifest.ResearchInput)
	}
	if manifest.Upload.MaxAttachments != 64 {
		t.Fatalf("upload max attachments = %d, want 64", manifest.Upload.MaxAttachments)
	}
	if !capabilityBySlug(manifest.Agents, "research").Enabled {
		t.Fatal("validated Research capability remained disabled")
	}
}

func TestBotCapabilitiesProjectsLowerAttachmentAdvertisement(t *testing.T) {
	tests := []struct {
		name                  string
		descriptorAttachments int
		datasetFiles          int
	}{
		{name: "descriptor higher", descriptorAttachments: 128, datasetFiles: 64},
		{name: "dataset channel higher", descriptorAttachments: 64, datasetFiles: 128},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			response := validResearchCapabilityCatalog()
			response.ResearchInputResolution.MaxAttachments = tc.descriptorAttachments
			for index := range response.Data {
				if response.Data[index].Slug == "research" {
					response.Data[index].Capabilities.Attachments.Datasets.MaxFiles = tc.datasetFiles
					break
				}
			}
			server := capabilityServer(t, http.StatusOK, researchCapabilityResponse(t, response), 0)
			t.Cleanup(server.Close)
			useCapabilityBotConfig(t, server.URL, rxBot.Config{
				ProxyEnabled: true, ResumableUploadEnabled: true,
				UploadPublicOrigin: "https://upload.example", ResearchEnabled: true,
			})

			manifest, err := NewService().BotCapabilities(context.Background(), "alice@example.com")
			if err != nil {
				t.Fatal(err)
			}
			if manifest.ResearchInput.MaxAttachments != 64 {
				t.Fatalf("Research input max attachments=%d, want 64", manifest.ResearchInput.MaxAttachments)
			}
			if manifest.Upload.MaxAttachments != 64 {
				t.Fatalf("upload max attachments=%d, want 64", manifest.Upload.MaxAttachments)
			}
		})
	}
}

func TestBotCapabilitiesMalformedResearchInputDisablesOnlyResearch(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*rxBot.AgentsListResponse)
	}{
		{
			name: "missing protocol",
			mutate: func(response *rxBot.AgentsListResponse) {
				delete(response.Protocols, rxBot.ResearchInputProtocol)
			},
		},
		{
			name: "malformed limits",
			mutate: func(response *rxBot.AgentsListResponse) {
				response.ResearchInputResolution.MaxAttachments = 257
			},
		},
		{
			name: "incompatible formats",
			mutate: func(response *rxBot.AgentsListResponse) {
				for index := range response.Data {
					if response.Data[index].Slug == "research" {
						response.Data[index].Capabilities.Attachments.Datasets.Formats = []string{"csv"}
					}
				}
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			response := validResearchCapabilityCatalog()
			tt.mutate(response)
			response.Data[0].Origin = "private-upstream-diagnostic"
			srv := capabilityServer(t, http.StatusOK, researchCapabilityResponse(t, response), 0)
			t.Cleanup(srv.Close)
			useCapabilityBotConfig(t, srv.URL, rxBot.Config{
				ProxyEnabled:           true,
				ResumableUploadEnabled: true,
				UploadPublicOrigin:     "https://upload.example",
				ResearchEnabled:        true,
				MaxQueryChars:          131_072,
			})

			manifest, err := NewService().BotCapabilities(context.Background(), "alice@example.com")
			if err != nil {
				t.Fatal(err)
			}
			if manifest.ResearchInput.Enabled || capabilityBySlug(manifest.Agents, "research").Enabled {
				t.Fatalf("incompatible Research remained enabled: %#v", manifest)
			}
			if !capabilityBySlug(manifest.Agents, "chat").Enabled || !manifest.Upload.Enabled {
				t.Fatalf("unrelated capabilities were disabled: %#v", manifest)
			}
			encoded, err := json.Marshal(manifest)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(encoded), "private-upstream-diagnostic") {
				t.Fatalf("upstream diagnostics leaked: %s", encoded)
			}
		})
	}
}

func TestBotCapabilitiesResearchInputDoesNotEnableDisabledUpload(t *testing.T) {
	srv := capabilityServer(t, http.StatusOK, researchCapabilityResponse(t, validResearchCapabilityCatalog()), 0)
	t.Cleanup(srv.Close)
	useCapabilityBotConfig(t, srv.URL, rxBot.Config{
		ProxyEnabled:    true,
		ResearchEnabled: true,
		MaxQueryChars:   131_072,
	})

	manifest, err := NewService().BotCapabilities(context.Background(), "alice@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Upload.Enabled || capabilityBySlug(manifest.Agents, "research").Enabled {
		t.Fatalf("Research contract bypassed the upload gate: %#v", manifest)
	}
	if !manifest.ResearchInput.Enabled {
		t.Fatalf("validated input descriptor should remain finite and enabled: %#v", manifest.ResearchInput)
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
		"attachment_purposes": true, "artifacts": true, "enabled": true,
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

func TestBotCapabilitiesAnalystResearchAttachmentIntersection(t *testing.T) {
	response := validResearchCapabilityCatalog()
	descriptors := response.Data
	for index := range descriptors {
		if descriptors[index].Slug == "analyst" {
			descriptors[index].Capabilities.Attachments.Datasets = &rxBot.AgentDescriptorDatasetCapability{}
		}
	}
	response.Data = descriptors
	srv := capabilityServer(t, http.StatusOK, researchCapabilityResponse(t, response), 0)
	t.Cleanup(srv.Close)
	useCapabilityBotConfig(t, srv.URL, rxBot.Config{
		ProxyEnabled:           true,
		ResumableUploadEnabled: true,
		UploadPublicOrigin:     "https://upload.example",
		AnalystEnabled:         true,
		ResearchEnabled:        true,
	})

	manifest, err := NewService().BotCapabilities(context.Background(), "alice@example.com")
	if err != nil {
		t.Fatal(err)
	}
	for _, slug := range []string{"analyst", "research"} {
		row := capabilityBySlug(manifest.Agents, slug)
		if !row.Enabled || !row.Attachments || !row.Artifacts {
			t.Fatalf("%s capability = %#v", slug, row)
		}
		if got := strings.Join(row.AttachmentPurposes, ","); got != "document,dataset" {
			t.Fatalf("%s attachment purposes = %q, want document,dataset", slug, got)
		}
	}

	for index := range descriptors {
		if descriptors[index].Slug == "analyst" {
			descriptors[index].Capabilities.Attachments.Datasets = nil
		}
	}
	response.Data = descriptors
	srvNoDataset := capabilityServer(t, http.StatusOK, researchCapabilityResponse(t, response), 0)
	t.Cleanup(srvNoDataset.Close)
	useCapabilityBotConfig(t, srvNoDataset.URL, rxBot.Config{
		ProxyEnabled:           true,
		ResumableUploadEnabled: true,
		UploadPublicOrigin:     "https://upload.example",
		AnalystEnabled:         true,
		ResearchEnabled:        true,
	})
	manifest, err = NewService().BotCapabilities(context.Background(), "alice@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(capabilityBySlug(manifest.Agents, "analyst").AttachmentPurposes, ","); got != "document" {
		t.Fatalf("analyst attachment purposes = %q, want document", got)
	}
}

func TestBotCapabilitiesProjectsAdvertisedAttachmentChannelsForEveryEnabledAgent(t *testing.T) {
	descriptors := capabilityDescriptors()
	for index := range descriptors {
		if descriptors[index].Slug == "data" || descriptors[index].Slug == "design" {
			descriptors[index].Capabilities.Attachments.Datasets = &rxBot.AgentDescriptorDatasetCapability{}
		}
	}
	srv := capabilityServer(t, http.StatusOK, capabilityManifestResponse(t, descriptors), 0)
	t.Cleanup(srv.Close)
	useCapabilityBotConfig(t, srv.URL, rxBot.Config{
		ProxyEnabled:           true,
		ResumableUploadEnabled: true,
		UploadPublicOrigin:     "https://upload.example",
	})

	manifest, err := NewService().BotCapabilities(context.Background(), "alice@example.com")
	if err != nil {
		t.Fatal(err)
	}
	data := capabilityBySlug(manifest.Agents, "data")
	if !data.Enabled || !data.Attachments {
		t.Fatalf("data capability = %#v", data)
	}
	if got := strings.Join(data.AttachmentPurposes, ","); got != "document,dataset" {
		t.Fatalf("data attachment purposes = %q, want document,dataset", got)
	}
	design := capabilityBySlug(manifest.Agents, "design")
	if design.Enabled || design.Attachments || len(design.AttachmentPurposes) != 0 {
		t.Fatalf("disabled design capability = %#v", design)
	}
}

func TestResultArchiveV1Effective(t *testing.T) {
	configFor := func(slug string) *rxBot.Config {
		cfg := &rxBot.Config{}
		switch slug {
		case "analyst":
			cfg.AnalystEnabled = true
		case "research":
			cfg.ResearchEnabled = true
		case "network":
			cfg.NetworkEnabled = true
		case "design":
			cfg.DesignEnabled = true
		}
		return cfg
	}
	responseFor := func(slug string, artifacts bool, versions []int) *rxBot.AgentsListResponse {
		tool := rxBot.CanonicalAgentTool[slug]
		return &rxBot.AgentsListResponse{
			Data: []rxBot.AgentDescriptor{{
				Slug: slug, Tool: tool,
				Capabilities: rxBot.AgentDescriptorCapabilities{Artifacts: artifacts},
			}},
			Protocols: map[string][]int{rxBot.ResultArchiveProtocol: versions},
		}
	}
	tests := []struct {
		name string
		resp *rxBot.AgentsListResponse
		slug string
		cfg  *rxBot.Config
		want bool
	}{
		{name: "analyst full intersection", resp: responseFor("analyst", true, []int{1}), slug: "analyst", cfg: configFor("analyst"), want: true},
		{name: "research full intersection", resp: responseFor("research", true, []int{1}), slug: "research", cfg: configFor("research"), want: true},
		{name: "network full intersection", resp: responseFor("network", true, []int{1}), slug: "network", cfg: configFor("network"), want: true},
		{name: "design full intersection", resp: responseFor("design", true, []int{1}), slug: "design", cfg: configFor("design"), want: true},
		{name: "missing protocol", resp: responseFor("analyst", true, nil), slug: "analyst", cfg: configFor("analyst")},
		{name: "wrong protocol version", resp: responseFor("analyst", true, []int{2}), slug: "analyst", cfg: configFor("analyst")},
		{name: "product flag disabled", resp: responseFor("analyst", true, []int{1}), slug: "analyst", cfg: &rxBot.Config{}},
		{name: "descriptor without artifacts", resp: responseFor("analyst", false, []int{1}), slug: "analyst", cfg: configFor("analyst")},
		{name: "descriptor absent", resp: &rxBot.AgentsListResponse{Protocols: map[string][]int{rxBot.ResultArchiveProtocol: {1}}}, slug: "analyst", cfg: configFor("analyst")},
		{name: "unscoped data agent", resp: responseFor("data", true, []int{1}), slug: "data", cfg: &rxBot.Config{}},
		{name: "unknown slug", resp: responseFor("unknown", true, []int{1}), slug: "unknown", cfg: &rxBot.Config{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := resultArchiveV1Effective(tt.resp, tt.slug, tt.cfg); got != tt.want {
				t.Fatalf("resultArchiveV1Effective(%q)=%v, want %v", tt.slug, got, tt.want)
			}
		})
	}
}

func TestLocalCapabilityEnabledUsesDedicatedRemoteFlags(t *testing.T) {
	cfg := &rxBot.Config{DesignEnabled: true, NetworkEnabled: false}
	if !localCapabilityEnabled("design", cfg) {
		t.Fatal("design must use DesignEnabled")
	}
	if localCapabilityEnabled("network", cfg) {
		t.Fatal("network must use NetworkEnabled")
	}
	if localCapabilityEnabled("design", &rxBot.Config{}) || localCapabilityEnabled("network", &rxBot.Config{}) {
		t.Fatal("network and design must not fall through to stable Web agents")
	}
}

func TestBotCapabilitiesResultArchiveArtifactsRequireFullIntersection(t *testing.T) {
	researchCatalog := validResearchCapabilityCatalog()
	descriptors := researchCatalog.Data
	config := rxBot.Config{
		ProxyEnabled:           true,
		ResumableUploadEnabled: true,
		UploadPublicOrigin:     "https://upload.example",
		AnalystEnabled:         true,
		ResearchEnabled:        true,
		NetworkEnabled:         true,
		DesignEnabled:          true,
	}
	protocols := func(resultArchive bool) map[string][]int {
		values := map[string][]int{
			rxBot.ResumableUploadProtocol: {rxBot.ResumableUploadProtocolVersion},
			rxBot.ResearchInputProtocol:   {rxBot.ResearchInputProtocolVersion},
		}
		if resultArchive {
			values[rxBot.ResultArchiveProtocol] = []int{rxBot.ResultArchiveProtocolVersion}
		}
		return values
	}
	tests := []struct {
		name        string
		descriptors []rxBot.AgentDescriptor
		protocols   map[string][]int
		config      rxBot.Config
		want        map[string]bool
	}{
		{
			name:        "all factors present",
			descriptors: descriptors,
			protocols:   protocols(true),
			config:      config,
			want:        map[string]bool{"analyst": true, "research": true, "network": true, "design": true},
		},
		{
			name:        "missing protocol",
			descriptors: descriptors,
			protocols:   protocols(false),
			config:      config,
			want:        map[string]bool{"analyst": false, "research": false, "network": false, "design": false},
		},
		{
			name: "descriptor support absent",
			descriptors: func() []rxBot.AgentDescriptor {
				rows := append([]rxBot.AgentDescriptor(nil), descriptors...)
				for index := range rows {
					if rows[index].Slug == "network" {
						rows[index].Capabilities.Artifacts = false
					}
				}
				return rows
			}(),
			protocols: protocols(true),
			config:    config,
			want:      map[string]bool{"analyst": true, "research": true, "network": false, "design": true},
		},
		{
			name:        "dedicated release flag disabled",
			descriptors: descriptors,
			protocols:   protocols(true),
			config:      func() rxBot.Config { cfg := config; cfg.DesignEnabled = false; return cfg }(),
			want:        map[string]bool{"analyst": true, "research": true, "network": true, "design": false},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, err := json.Marshal(rxBot.AgentsListResponse{
				Object:                  "list",
				Data:                    tt.descriptors,
				Protocols:               tt.protocols,
				ResearchInputResolution: researchCatalog.ResearchInputResolution,
			})
			if err != nil {
				t.Fatalf("marshal agent response: %v", err)
			}
			srv := capabilityServer(t, http.StatusOK, string(body), 0)
			t.Cleanup(srv.Close)
			useCapabilityBotConfig(t, srv.URL, tt.config)

			manifest, err := NewService().BotCapabilities(context.Background(), "alice@example.com")
			if err != nil {
				t.Fatal(err)
			}
			for slug, want := range tt.want {
				if got := capabilityBySlug(manifest.Agents, slug).Artifacts; got != want {
					t.Fatalf("%s artifacts=%v, want %v", slug, got, want)
				}
			}
			for _, slug := range []string{"data", "brief_gene"} {
				if !capabilityBySlug(manifest.Agents, slug).Artifacts {
					t.Fatalf("%s must retain its unrelated artifact capability", slug)
				}
			}
		})
	}
}

func TestBotCapabilitiesAnalystResearchRequireIndependentLocalFlags(t *testing.T) {
	descriptors := capabilityDescriptors()
	for index := range descriptors {
		if descriptors[index].Slug == "analyst" || descriptors[index].Slug == "research" {
			descriptors[index].Capabilities.Attachments.Datasets = &rxBot.AgentDescriptorDatasetCapability{}
		}
	}
	srv := capabilityServer(t, http.StatusOK, capabilityManifestResponse(t, descriptors), 0)
	t.Cleanup(srv.Close)
	useCapabilityBotConfig(t, srv.URL, rxBot.Config{
		ProxyEnabled:   true,
		AnalystEnabled: true,
	})

	manifest, err := NewService().BotCapabilities(context.Background(), "alice@example.com")
	if err != nil {
		t.Fatal(err)
	}
	analyst := capabilityBySlug(manifest.Agents, "analyst")
	if analyst.Enabled || analyst.Attachments || analyst.Artifacts || analyst.AttachmentPurposes == nil || len(analyst.AttachmentPurposes) != 0 {
		t.Fatalf("unnegotiated Analyst capability = %#v", analyst)
	}

	useCapabilityBotConfig(t, srv.URL, rxBot.Config{
		ProxyEnabled:           true,
		ResumableUploadEnabled: true,
		UploadPublicOrigin:     "https://upload.example",
		AnalystEnabled:         true,
	})

	manifest, err = NewService().BotCapabilities(context.Background(), "alice@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if !capabilityBySlug(manifest.Agents, "analyst").Enabled {
		t.Fatal("enabled Analyst must be present in the manifest")
	}
	research := capabilityBySlug(manifest.Agents, "research")
	if research.Enabled || research.Attachments || research.Artifacts || research.AttachmentPurposes == nil || len(research.AttachmentPurposes) != 0 {
		t.Fatalf("disabled Research capability = %#v", research)
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
