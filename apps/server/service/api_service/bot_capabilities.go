package api_service

import (
	"context"
	"strings"
	"sync"

	"github.com/spf13/viper"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

// HistoryReadMode controls which history source the Web service uses. Legacy
// remains the default so the reversible cutover can be disabled without a
// caller or schema change.
type HistoryReadMode string

const (
	HistoryReadModeLegacy     HistoryReadMode = "legacy"
	HistoryReadModeDual       HistoryReadMode = "dual"
	HistoryReadModeProjection HistoryReadMode = "projection"
)

// HistoryReadResult keeps source metadata out of QuestionAgentLog rows while
// giving service callers a bounded outcome for observation and tests. Rows are
// always owner-scoped and remain the only data that the existing HTTP handler
// serializes.
type HistoryReadResult struct {
	Rows           []*model.QuestionAgentLog
	Source         string
	FallbackReason string
	Sources        []string
}

const (
	historySourceProjection = "projection"
	historySourceLegacy     = "legacy"

	historyObservationProjectionHit    = "projection_hit"
	historyObservationLegacyFallback   = "legacy_fallback"
	historyObservationCountMismatch    = "count_mismatch"
	historyObservationStatusMismatch   = "status_mismatch"
	historyObservationRevisionMismatch = "revision_mismatch"
	historyObservationBotUnavailable   = "bot_read_unavailable"
)

// HistoryReadObservation is deliberately limited to a finite source label and
// an aggregate count. It must never grow dimensions from a dialogue, user,
// run, query, answer, or upstream error.
type HistoryReadObservation struct {
	Source string `json:"source"`
	Count  uint64 `json:"count"`
}

var historyReadObservationState = struct {
	sync.Mutex
	counts map[string]uint64
}{
	counts: map[string]uint64{
		historyObservationProjectionHit:    0,
		historyObservationLegacyFallback:   0,
		historyObservationCountMismatch:    0,
		historyObservationStatusMismatch:   0,
		historyObservationRevisionMismatch: 0,
		historyObservationBotUnavailable:   0,
	},
}

func observeHistoryRead(source string) {
	historyReadObservationState.Lock()
	if _, ok := historyReadObservationState.counts[source]; ok {
		historyReadObservationState.counts[source]++
	}
	historyReadObservationState.Unlock()
}

// HistoryReadObservations returns a stable, fixed-label snapshot for local
// diagnostics. The returned slice is detached from the in-process counters.
func HistoryReadObservations() []HistoryReadObservation {
	historyReadObservationState.Lock()
	defer historyReadObservationState.Unlock()
	labels := []string{
		historyObservationProjectionHit,
		historyObservationLegacyFallback,
		historyObservationCountMismatch,
		historyObservationStatusMismatch,
		historyObservationRevisionMismatch,
		historyObservationBotUnavailable,
	}
	result := make([]HistoryReadObservation, 0, len(labels))
	for _, label := range labels {
		result = append(result, HistoryReadObservation{Source: label, Count: historyReadObservationState.counts[label]})
	}
	return result
}

// ResetHistoryReadObservations is test-only hygiene for the process-local,
// bounded counters. It does not affect persisted rows or feature flags.
func ResetHistoryReadObservations() {
	historyReadObservationState.Lock()
	for label := range historyReadObservationState.counts {
		historyReadObservationState.counts[label] = 0
	}
	historyReadObservationState.Unlock()
}

// HistoryReadModeFromConfig is the Web-owned switch. The key intentionally is
// read directly through Viper so Bot's typed config and deployment files do
// not need a new field for this reversible Web cutover.
func HistoryReadModeFromConfig() HistoryReadMode {
	if viper.GetBool("bot.history_dual_read") {
		return HistoryReadModeDual
	}
	return HistoryReadModeLegacy
}

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
