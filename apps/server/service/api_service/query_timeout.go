package api_service

import (
	"time"

	rxBot "phytomni-server/external/bot"
)

var synchronousAgentTimeoutSlugs = map[string]struct{}{
	"chat":       {},
	"knowledge":  {},
	"data":       {},
	"review":     {},
	"brief_gene": {},
}

func resolveExecutionTimeoutSeconds(
	cfg *rxBot.Config,
	mode string,
	forcedTool string,
	directSlug string,
	allowedTools []string,
) int {
	if mode != "expert" {
		return cfg.TimeoutForAgent(directSlug)
	}
	if forcedTool != "" {
		if slug, ok := rxBot.SlugFor(forcedTool); ok {
			return cfg.TimeoutForAgent(slug)
		}
		return cfg.TimeoutSeconds
	}

	maxSeconds := 0
	for _, tool := range allowedTools {
		slug, ok := rxBot.SlugFor(tool)
		if !ok {
			continue
		}
		if _, synchronous := synchronousAgentTimeoutSlugs[slug]; !synchronous {
			continue
		}
		if seconds := cfg.TimeoutForAgent(slug); seconds > maxSeconds {
			maxSeconds = seconds
		}
	}
	if maxSeconds == 0 {
		return cfg.TimeoutSeconds
	}
	return maxSeconds
}

func newExecutionBotClient(
	cfg *rxBot.Config,
	mode string,
	forcedTool string,
	directSlug string,
	allowedTools []string,
) *rxBot.Client {
	seconds := resolveExecutionTimeoutSeconds(
		cfg, mode, forcedTool, directSlug, allowedTools,
	)
	return rxBot.NewClientWithTimeout(time.Duration(seconds) * time.Second)
}
