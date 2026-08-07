package bot

import "testing"

func TestSlugFor_BriefGene(t *testing.T) {
	slug, ok := SlugFor("BriefGeneAgent")
	if !ok {
		t.Fatalf("BriefGeneAgent should resolve to a slug, got ok=false")
	}
	if slug != "brief_gene" {
		t.Errorf("SlugFor(BriefGeneAgent) = %q, want brief_gene", slug)
	}
}

func TestAliasMapContainsEveryCanonicalTool(t *testing.T) {
	for slug, tool := range CanonicalAgentTool {
		if got, ok := aliasToSlug[tool]; !ok || got != slug {
			t.Errorf("%s -> %q want %q", tool, got, slug)
		}
	}
}

func TestSupportsProtocol(t *testing.T) {
	resp := &AgentsListResponse{
		Protocols: map[string][]int{"conversation_context": {1, 2}},
	}
	if !SupportsProtocol(resp, "conversation_context", 1) {
		t.Fatal("conversation_context v1 should be supported")
	}
	if SupportsProtocol(resp, "conversation_context", 3) {
		t.Fatal("unsupported protocol version was accepted")
	}
	if SupportsProtocol(&AgentsListResponse{}, "conversation_context", 1) {
		t.Fatal("missing protocol advertisement was accepted")
	}
	if SupportsProtocol(nil, "conversation_context", 1) {
		t.Fatal("nil agent response was accepted")
	}
}

func TestFindAgentCapability(t *testing.T) {
	capability := AgentDescriptorCapabilities{Artifacts: true}
	tests := []struct {
		name string
		resp *AgentsListResponse
		slug string
		want bool
	}{
		{
			name: "one matching descriptor",
			resp: &AgentsListResponse{Data: []AgentDescriptor{{
				Slug: "analyst", Tool: "AnalystAgent", Capabilities: capability,
			}}},
			slug: "analyst",
			want: true,
		},
		{
			name: "descriptor absent",
			resp: &AgentsListResponse{Data: []AgentDescriptor{{
				Slug: "research", Tool: "InSilicoResearchAgent", Capabilities: capability,
			}}},
			slug: "analyst",
		},
		{
			name: "duplicate matching descriptor",
			resp: &AgentsListResponse{Data: []AgentDescriptor{
				{Slug: "analyst", Tool: "AnalystAgent", Capabilities: capability},
				{Slug: "analyst", Tool: "AnalystAgent", Capabilities: capability},
			}},
			slug: "analyst",
		},
		{name: "nil response", slug: "analyst"},
		{name: "blank slug", resp: &AgentsListResponse{}, slug: " "},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := FindAgentCapability(tt.resp, tt.slug)
			if ok != tt.want {
				t.Fatalf("FindAgentCapability() ok=%v, want %v", ok, tt.want)
			}
			if ok && !got.Artifacts {
				t.Fatalf("FindAgentCapability() = %#v, want artifacts support", got)
			}
		})
	}
}

func TestValidateWebAgentDescriptorsProjectsAttachmentChannels(t *testing.T) {
	presence, err := ValidateWebAgentDescriptors(&AgentsListResponse{
		Data: []AgentDescriptor{{
			Slug: "analyst",
			Tool: "AnalystAgent",
			Capabilities: AgentDescriptorCapabilities{
				Attachments: AgentDescriptorAttachments{
					DocumentContext: &struct{}{},
					Datasets:        &AgentDescriptorDatasetCapability{},
				},
			},
		}},
	})
	if err != nil {
		t.Fatalf("ValidateWebAgentDescriptors: %v", err)
	}
	if got := presence["analyst"]; got != (WebAgentPresence{Present: true, Documents: true, Datasets: true}) {
		t.Fatalf("analyst presence = %#v", got)
	}
}

func TestValidateWebAgentDescriptorsFailsClosedForMalformedAndDuplicate(t *testing.T) {
	tests := []struct {
		name string
		data []AgentDescriptor
	}{
		{name: "malformed", data: []AgentDescriptor{{Slug: "analyst"}}},
		{name: "duplicate", data: []AgentDescriptor{{Slug: "analyst", Tool: "AnalystAgent"}, {Slug: "analyst", Tool: "AnalystAgent"}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := ValidateWebAgentDescriptors(&AgentsListResponse{Data: tt.data}); err == nil {
				t.Fatal("ValidateWebAgentDescriptors accepted an invalid descriptor list")
			}
		})
	}
}
