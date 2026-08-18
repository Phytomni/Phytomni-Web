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

// CanonicalAgentDisplayOrder is the fixed product order for presenting and
// evaluating Web-owned agent capabilities. Keep this separate from the Bot
// manifest order: product display is intentionally chat, knowledge, data,
// analyst, review, research, network, brief-gene, deep-genome, design.
var CanonicalAgentDisplayOrder = []string{
	"ChatAgent",
	"KnowledgeAgent",
	"DataAgent",
	"AnalystAgent",
	"ReviewAgent",
	"InSilicoResearchAgent",
	"GeneNetworkAgent",
	"BriefGeneAgent",
	"DeepGenomeAgent",
	"DigitalDesignAgent",
}

// CanonicalAgentDisplayTools returns a copy so callers cannot mutate the
// process-wide display order.
func CanonicalAgentDisplayTools() []string {
	return append([]string(nil), CanonicalAgentDisplayOrder...)
}

// DefaultRoleToolGrants is the product default for user_tool_names.
// Admin and super_admin are not listed: they receive every canonical tool
// in ResolveAgentPermissions without grant rows.
var DefaultRoleToolGrants = map[string][]string{
	"guest": {
		"ChatAgent",
		"KnowledgeAgent",
		"DataAgent",
	},
	"user": {
		"ChatAgent",
		"KnowledgeAgent",
		"DataAgent",
		"ReviewAgent",
		"BriefGeneAgent",
	},
	"vip_user": {
		"ChatAgent",
		"KnowledgeAgent",
		"DataAgent",
		"AnalystAgent",
		"ReviewAgent",
		"InSilicoResearchAgent",
		"GeneNetworkAgent",
		"BriefGeneAgent",
		"DeepGenomeAgent",
		"DigitalDesignAgent",
	},
}

const maxBotAgentDescriptors = 32

// WebAgentPresence is the finite descriptor projection consumed by the Web
// capability manifest. It deliberately excludes raw Bot descriptor metadata.
type WebAgentPresence struct {
	Present   bool
	Documents bool
	Datasets  bool
}

func supportsProtocol(resp *AgentsListResponse, protocol string, version int) bool {
	if resp == nil || version < 1 {
		return false
	}
	for _, advertised := range resp.Protocols[protocol] {
		if advertised == version {
			return true
		}
	}
	return false
}

func supportsExactProtocol(resp *AgentsListResponse, protocol string, version int) bool {
	if resp == nil {
		return false
	}
	versions, ok := resp.Protocols[protocol]
	return ok && len(versions) == 1 && versions[0] == version
}

// SupportsProtocol reports whether the authenticated Bot catalog advertises a
// specific server-to-server protocol version.
func SupportsProtocol(resp *AgentsListResponse, protocol string, version int) bool {
	return supportsProtocol(resp, protocol, version)
}

// FindAgentCapability returns the bounded capability projection for one
// canonical Bot descriptor. Missing, blank, or duplicate descriptors fail
// closed so callers cannot accidentally select an arbitrary upstream row.
func FindAgentCapability(resp *AgentsListResponse, slug string) (AgentDescriptorCapabilities, bool) {
	if resp == nil || strings.TrimSpace(slug) == "" {
		return AgentDescriptorCapabilities{}, false
	}
	var capability AgentDescriptorCapabilities
	found := false
	for _, descriptor := range resp.Data {
		if descriptor.Slug != slug {
			continue
		}
		if found {
			return AgentDescriptorCapabilities{}, false
		}
		capability = descriptor.Capabilities
		found = true
	}
	return capability, found
}

// ValidateWebAgentDescriptors validates only the public shape needed by the
// Web capability manifest. It returns finite presence by canonical slug and
// never returns the original descriptor, legacy aliases, or any other Bot
// metadata.
// A missing canonical slug is valid (the caller marks that capability off),
// but an unknown, duplicate, or malformed descriptor fails the complete
// manifest closed.
func ValidateWebAgentDescriptors(resp *AgentsListResponse) (map[string]WebAgentPresence, error) {
	if resp == nil || len(resp.Data) > maxBotAgentDescriptors {
		return nil, fmt.Errorf("invalid bot agent listing")
	}

	present := make(map[string]WebAgentPresence, len(resp.Data))
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
		present[slug] = WebAgentPresence{
			Present:   true,
			Documents: descriptor.Capabilities.Attachments.DocumentContext != nil,
			Datasets:  descriptor.Capabilities.Attachments.Datasets != nil,
		}
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

// slugToChatModel maps the chat-family slugs to their /v1/chat/completions
// model id. It mirrors Bot's MODEL_TO_TOOL exactly (phyto-chat, phyto-knowledge,
// phyto-review, phyto-brief-gene) so every chat-family agent — including a forced
// Expert selection — dispatches through the direct chat-completions entry rather
// than the LLM router. BriefGene carries resolve_gene_id on that path (see
// ChatCompletionRequest); the flag is Bot-rejected for the other three models.
var slugToChatModel = map[string]string{
	"chat":       "phyto-chat",
	"knowledge":  "phyto-knowledge",
	"review":     "phyto-review",
	"brief_gene": "phyto-brief-gene",
}

// slugToStreamModel is the Web-owned allowlist for the AG-UI chat-completion
// models that may be opened by QueryStream. It mirrors slugToChatModel minus
// review (review's A2UI pause is served over the blocking chat-completions path,
// not the stream), keeping the stream surface a strict subset of the chat models.
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
	NoteConversationContextV1(resp)
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
// This lookup only enforces the canonical model/slug pair and fails closed for
// all other agents.
func StreamModelFor(slug string) (string, bool) {
	model, ok := slugToStreamModel[slug]
	return model, ok
}
