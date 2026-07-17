package api_service

import (
	"context"
	"strings"

	rxBot "phytomni-server/external/bot"
)

// BotCapability is the bounded, Web-owned capability record returned to the
// browser. It intentionally contains no Bot descriptor, URL, credential, or
// upstream diagnostic field.
type BotCapability struct {
	Tool        string `json:"tool"`
	Slug        string `json:"slug"`
	Execution   string `json:"execution"`
	Stream      bool   `json:"stream"`
	A2UI        bool   `json:"a2ui"`
	Resolver    bool   `json:"resolver"`
	Attachments bool   `json:"attachments"`
	Artifacts   bool   `json:"artifacts"`
	Enabled     bool   `json:"enabled"`
}

// BotCapabilities returns the Web capability manifest. Bot /v1/agents is only
// an advisory presence check: local gates and the Web-owned release table
// remain authoritative. Any Bot/config/listing failure returns the same
// bounded all-disabled shape so callers never receive private upstream data.
func (ps *Service) BotCapabilities(ctx context.Context, _ string) ([]BotCapability, error) {
	manifest := disabledBotCapabilities()
	cfg := rxBot.BotConfig
	if cfg == nil || !cfg.ProxyEnabled || strings.TrimSpace(cfg.BaseURL) == "" {
		return manifest, nil
	}

	if ctx == nil {
		ctx = context.Background()
	}
	response, err := rxBot.NewClient().GetAgents(ctx)
	if err != nil {
		return manifest, nil
	}
	presence, err := rxBot.ValidateWebAgentDescriptors(response)
	if err != nil {
		return manifest, nil
	}

	for index, definition := range rxBot.WebAgentDefinitions {
		if _, ok := presence[definition.Slug]; !ok {
			continue
		}
		if !stableWebAgent(definition.Slug) {
			// New remote product surfaces stay dark until their separate
			// capability and acceptance gates land.
			continue
		}

		manifest[index].Enabled = true
		manifest[index].Attachments = attachmentsFor(definition.Slug)
		manifest[index].Artifacts = artifactsFor(definition.Slug)
		if cfg.StreamEnabled && streamEligible(definition.Slug) {
			manifest[index].Stream = true
		}
		if cfg.A2uiActionsEnabled && definition.Slug == "review" {
			manifest[index].A2UI = true
		}
		if cfg.ExpertEnabled && definition.Slug == "chat" {
			manifest[index].Resolver = true
		}
	}
	return manifest, nil
}

func disabledBotCapabilities() []BotCapability {
	manifest := make([]BotCapability, len(rxBot.WebAgentDefinitions))
	for index, definition := range rxBot.WebAgentDefinitions {
		manifest[index] = BotCapability{
			Tool:      definition.Tool,
			Slug:      definition.Slug,
			Execution: definition.Execution,
		}
	}
	return manifest
}

func stableWebAgent(slug string) bool {
	switch slug {
	case "chat", "knowledge", "data", "review", "brief_gene":
		return true
	default:
		return false
	}
}

func streamEligible(slug string) bool {
	switch slug {
	case "chat", "knowledge", "brief_gene":
		return true
	default:
		return false
	}
}

func attachmentsFor(slug string) bool {
	switch slug {
	case "chat", "knowledge", "data", "review", "brief_gene":
		return true
	default:
		return false
	}
}

func artifactsFor(slug string) bool {
	switch slug {
	case "data", "brief_gene":
		return true
	default:
		return false
	}
}
