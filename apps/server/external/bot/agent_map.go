package bot

import (
	"context"
	"fmt"
	"strings"
)

// WebAgentDefinition is the Web-owned identity and execution primitive for a
// Bot agent. The manifest endpoint deliberately starts from this table rather
// than copying Bot's descriptor (which may contain private or advisory fields).
type WebAgentDefinition struct {
	Tool      string
	Slug      string
	Execution string
}

// WebAgentDefinitions is the stable ten-agent release set. Keep the order
// deterministic because the capability manifest is a public, cacheable DTO.
var WebAgentDefinitions = []WebAgentDefinition{
	{Tool: "ChatAgent", Slug: "chat", Execution: "chat"},
	{Tool: "KnowledgeAgent", Slug: "knowledge", Execution: "chat"},
	{Tool: "DataAgent", Slug: "data", Execution: "blocking"},
	{Tool: "ReviewAgent", Slug: "review", Execution: "chat"},
	{Tool: "BriefGeneAgent", Slug: "brief_gene", Execution: "agent_run"},
	{Tool: "AnalystAgent", Slug: "analyst", Execution: "agent_run"},
	{Tool: "DeepGenomeAgent", Slug: "deep_genome", Execution: "agent_run"},
	{Tool: "InSilicoResearchAgent", Slug: "research", Execution: "agent_run"},
	{Tool: "DigitalDesignAgent", Slug: "design", Execution: "agent_run"},
	{Tool: "GeneNetworkAgent", Slug: "network", Execution: "agent_run"},
}

const maxBotAgentDescriptors = 32

// ValidateWebAgentDescriptors validates only the public shape needed by the
// Web capability manifest. It returns presence by canonical slug and never
// returns the original descriptor, legacy aliases, or any other Bot metadata.
// A missing canonical slug is valid (the caller marks that capability off),
// but an unknown, duplicate, or malformed descriptor fails the complete
// manifest closed.
func ValidateWebAgentDescriptors(resp *AgentsListResponse) (map[string]struct{}, error) {
	if resp == nil || len(resp.Data) > maxBotAgentDescriptors {
		return nil, fmt.Errorf("invalid bot agent listing")
	}

	present := make(map[string]struct{}, len(resp.Data))
	for _, descriptor := range resp.Data {
		slug := strings.TrimSpace(descriptor.Slug)
		tool := strings.TrimSpace(descriptor.Tool)
		if slug == "" || tool == "" {
			return nil, fmt.Errorf("malformed bot agent descriptor")
		}
		canonicalTool, ok := CanonicalAgentTool[slug]
		if !ok || canonicalTool != tool {
			return nil, fmt.Errorf("unknown bot agent descriptor")
		}
		if _, duplicate := present[slug]; duplicate {
			return nil, fmt.Errorf("duplicate bot agent descriptor")
		}
		present[slug] = struct{}{}
	}
	return present, nil
}

// aliasToSlug maps the canonical tool names the Web app sends to Bot agent
// slugs. This table is Web-owned and deliberately decoupled from Bot's advisory
// legacy_aliases metadata.
var aliasToSlug = map[string]string{
	"ChatAgent":             "chat",
	"KnowledgeAgent":        "knowledge",
	"DataAgent":             "data",
	"ReviewAgent":           "review",
	"BriefGeneAgent":        "brief_gene",
	"AnalystAgent":          "analyst",
	"DeepGenomeAgent":       "deep_genome",
	"InSilicoResearchAgent": "research",
	"DigitalDesignAgent":    "design",
	"GeneNetworkAgent":      "network",
}

// slugToChatModel maps the sync chat-family slugs to their
// /v1/chat/completions model id. BriefGene remains an agent_run for the
// blocking path, so its stream model lives in slugToStreamModel below instead
// of changing Query's established dispatch contract.
var slugToChatModel = map[string]string{
	"chat":      "phyto-chat",
	"knowledge": "phyto-knowledge",
	"review":    "phyto-review",
}

// slugToStreamModel is the Web-owned allowlist for the AG-UI chat-completion
// models that may be opened by QueryStream. Keep the stream-only BriefGene
// mapping separate from slugToChatModel: the blocking Query path still routes
// BriefGene through /v1/agents/{slug}/runs until its blocking contract changes.
var slugToStreamModel = map[string]string{
	"chat":       "phyto-chat",
	"knowledge":  "phyto-knowledge",
	"brief_gene": "phyto-brief-gene",
}

// ValidateAgents fetches Bot /v1/agents and asserts every slug the Web-owned
// table targets actually exists on the Bot side, failing fast otherwise. It
// does not build the alias table from the response; it only checks existence.
func ValidateAgents(ctx context.Context, c *Client) error {
	resp, err := c.GetAgents(ctx)
	if err != nil {
		return fmt.Errorf("fetch /v1/agents failed: %w", err)
	}
	have := make(map[string]bool, len(resp.Data))
	for _, a := range resp.Data {
		have[a.Slug] = true
	}
	var missing []string
	for _, slug := range aliasToSlug {
		if !have[slug] {
			missing = append(missing, slug)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("bot /v1/agents missing required slugs: %v", missing)
	}
	return nil
}

// SlugFor translates a Web app tool name into a Bot slug. An empty tool
// defaults to the chat agent.
func SlugFor(tool string) (string, bool) {
	if tool == "" {
		return "chat", true
	}
	slug, ok := aliasToSlug[tool]
	return slug, ok
}

// ChatModelFor returns the /v1/chat/completions model for a sync chat slug,
// and whether the slug is a chat-family (vs remote agent) slug.
func ChatModelFor(slug string) (string, bool) {
	model, ok := slugToChatModel[slug]
	return model, ok
}

// StreamModelFor returns the Web-owned AG-UI model for a stream-capable slug.
// The caller still has to pass the process-wide StreamEnabled gate; this
// lookup only enforces the canonical model/slug pair and fails closed for all
// other agents.
func StreamModelFor(slug string) (string, bool) {
	model, ok := slugToStreamModel[slug]
	return model, ok
}
