package api_service

import (
	"context"
	"net/url"
	"strconv"
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
	Tool               string   `json:"tool"`
	Slug               string   `json:"slug"`
	Execution          string   `json:"execution"`
	Stream             bool     `json:"stream"`
	A2UI               bool     `json:"a2ui"`
	Resolver           bool     `json:"resolver"`
	Attachments        bool     `json:"attachments"`
	AttachmentPurposes []string `json:"attachment_purposes"`
	Artifacts          bool     `json:"artifacts"`
	Enabled            bool     `json:"enabled"`
}

const (
	resumableUploadMaxFileBytes   int64 = 10 << 30
	resumableUploadMaxAttachments       = 10
)

// BotUploadCapability is the bounded browser-facing upload contract. The
// origin is copied only from the explicitly configured public origin; it is
// never derived from the internal Bot BaseURL.
type BotUploadCapability struct {
	Enabled        bool   `json:"enabled"`
	Protocol       string `json:"protocol"`
	UploadOrigin   string `json:"upload_origin"`
	MaxFileBytes   int64  `json:"max_file_bytes"`
	MaxAttachments int    `json:"max_attachments"`
}

// BotCapabilityManifest keeps the existing agent capability list and the
// negotiated upload contract under one bounded response object.
type BotCapabilityManifest struct {
	Agents []BotCapability     `json:"agents"`
	Upload BotUploadCapability `json:"upload"`
}

// BotCapabilities returns the Web capability manifest. Bot /v1/agents is only
// an advisory presence check: local gates and the Web-owned release table
// remain authoritative. Any Bot/config/listing failure returns the same
// bounded all-disabled shape so callers never receive private upstream data.
func (ps *Service) BotCapabilities(ctx context.Context, _ string) (BotCapabilityManifest, error) {
	manifest := BotCapabilityManifest{
		Agents: disabledBotCapabilities(),
		Upload: disabledBotUploadCapability(),
	}
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
	uploadOrigin, validOrigin := validUploadPublicOrigin(cfg.UploadPublicOrigin)
	uploadEnabled := cfg.ResumableUploadEnabled && validOrigin && rxBot.SupportsProtocol(
		response,
		rxBot.ResumableUploadProtocol,
		rxBot.ResumableUploadProtocolVersion,
	)
	if uploadEnabled {
		manifest.Upload = BotUploadCapability{
			Enabled:        true,
			Protocol:       rxBot.ResumableUploadProtocol,
			UploadOrigin:   uploadOrigin,
			MaxFileBytes:   resumableUploadMaxFileBytes,
			MaxAttachments: resumableUploadMaxAttachments,
		}
	}

	for index, definition := range rxBot.WebAgentDefinitions {
		agentPresence, ok := presence[definition.Slug]
		if !ok || !agentPresence.Present {
			continue
		}
		if !localCapabilityEnabled(definition.Slug, cfg) {
			continue
		}
		attachmentPurposes := attachmentPurposesFor(definition.Slug, agentPresence, uploadEnabled)
		if productAttachmentCapability(definition.Slug) && len(attachmentPurposes) == 0 {
			// Analyst and Research are attachment-enabled product surfaces. Their
			// browser records remain dark until local product, upload negotiation,
			// and Bot channel evidence all agree.
			continue
		}

		manifest.Agents[index].Enabled = true
		manifest.Agents[index].AttachmentPurposes = attachmentPurposes
		manifest.Agents[index].Attachments = len(attachmentPurposes) > 0
		manifest.Agents[index].Artifacts = artifactsFor(response, definition.Slug, cfg)
		if cfg.StreamEnabled && streamEligible(definition.Slug) {
			manifest.Agents[index].Stream = true
		}
		if cfg.A2uiActionsEnabled && definition.Slug == "review" {
			manifest.Agents[index].A2UI = true
		}
		if cfg.ExpertEnabled && definition.Slug == "chat" {
			manifest.Agents[index].Resolver = true
		}
	}
	return manifest, nil
}

func disabledBotUploadCapability() BotUploadCapability {
	return BotUploadCapability{
		Protocol:       rxBot.ResumableUploadProtocol,
		MaxFileBytes:   resumableUploadMaxFileBytes,
		MaxAttachments: resumableUploadMaxAttachments,
	}
}

func validUploadPublicOrigin(raw string) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", false
	}
	u, err := url.ParseRequestURI(trimmed)
	if err != nil || u == nil || u.Opaque != "" || u.Host == "" || u.Hostname() == "" {
		return "", false
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", false
	}
	if u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.ForceQuery || u.RawPath != "" {
		return "", false
	}
	if u.Path != "" && u.Path != "/" {
		return "", false
	}
	if port := u.Port(); port != "" {
		value, err := strconv.Atoi(port)
		if err != nil || value < 1 || value > 65535 {
			return "", false
		}
	}
	return strings.ToLower(u.Scheme) + "://" + u.Host, true
}

func disabledBotCapabilities() []BotCapability {
	manifest := make([]BotCapability, len(rxBot.WebAgentDefinitions))
	for index, definition := range rxBot.WebAgentDefinitions {
		manifest[index] = BotCapability{
			Tool:               definition.Tool,
			Slug:               definition.Slug,
			Execution:          definition.Execution,
			AttachmentPurposes: []string{},
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

func localCapabilityEnabled(slug string, cfg *rxBot.Config) bool {
	switch slug {
	case "analyst":
		return cfg != nil && cfg.AnalystEnabled
	case "research":
		return cfg != nil && cfg.ResearchEnabled
	case "design":
		return cfg != nil && cfg.DesignEnabled
	case "network":
		return cfg != nil && cfg.NetworkEnabled
	default:
		return stableWebAgent(slug)
	}
}

func productAttachmentCapability(slug string) bool {
	return slug == "analyst" || slug == "research"
}

func streamEligible(slug string) bool {
	switch slug {
	case "chat", "knowledge", "brief_gene":
		return true
	default:
		return false
	}
}

func attachmentPurposesFor(
	slug string,
	presence rxBot.WebAgentPresence,
	uploadEnabled bool,
) []string {
	if !uploadEnabled {
		return []string{}
	}
	purposes := make([]string, 0, 2)
	if presence.Documents {
		purposes = append(purposes, "document")
	}
	if presence.Datasets && (slug == "analyst" || slug == "research") {
		purposes = append(purposes, "dataset")
	}
	return purposes
}

func resultArchiveAgent(slug string) bool {
	switch slug {
	case "analyst", "research", "network", "design":
		return true
	default:
		return false
	}
}

func resultArchiveV1Effective(resp *rxBot.AgentsListResponse, slug string, cfg *rxBot.Config) bool {
	if !resultArchiveAgent(slug) || !localCapabilityEnabled(slug, cfg) {
		return false
	}
	descriptor, ok := rxBot.FindAgentCapability(resp, slug)
	if !ok || !descriptor.Artifacts {
		return false
	}
	return rxBot.SupportsProtocol(resp, rxBot.ResultArchiveProtocol, rxBot.ResultArchiveProtocolVersion)
}

func artifactsFor(resp *rxBot.AgentsListResponse, slug string, cfg *rxBot.Config) bool {
	if resultArchiveAgent(slug) {
		return resultArchiveV1Effective(resp, slug, cfg)
	}
	return slug == "data" || slug == "brief_gene"
}
