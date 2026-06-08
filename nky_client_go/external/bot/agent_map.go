package bot

import (
	"context"
	"fmt"
)

// aliasToSlug maps the tool names chat-ai historically sends (singular and
// plural forms) to Bot canonical agent slugs. This table is Web-owned and
// deliberately decoupled from Bot's advisory legacy_aliases metadata.
var aliasToSlug = map[string]string{
	"ChatAgent": "chat", "ChatAgents": "chat",
	"KnowledgeAgent": "knowledge", "KnowledgeAgents": "knowledge",
	"DataAgent": "data", "DatabaseAgents": "data",
	"AnalystAgent": "analyst", "AnalysisAgents": "analyst",
	"ReviewAgent": "review", "ReviewAgents": "review",
	"DeepGenomeAgent": "deep_genome",
}

// slugToChatModel maps the sync chat-family slugs to their /v1/chat/completions
// model id. Remote agents (analyst, deep_genome) are absent here and run via
// /v1/agents/{slug}/runs instead. Whether data is a chat model or an agent run
// is confirmed against the live Bot at wiring time.
var slugToChatModel = map[string]string{
	"chat":      "phyto-chat",
	"knowledge": "phyto-knowledge",
	"review":    "phyto-review",
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

// SlugFor translates a chat-ai tool name into a Bot slug. An empty tool
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
