package bot

import (
	rxLog "phytomni-server/log"

	"github.com/spf13/viper"
)

var defaultAgentTimeoutSeconds = map[string]int{
	"chat":       3000,
	"knowledge":  15000,
	"data":       9000,
	"review":     30000,
	"brief_gene": 30000,
}

func normalizeAgentTimeoutSeconds(overrides map[string]int) map[string]int {
	normalized := make(map[string]int, len(defaultAgentTimeoutSeconds))
	for slug, seconds := range defaultAgentTimeoutSeconds {
		normalized[slug] = seconds
	}
	for slug, seconds := range overrides {
		if _, known := defaultAgentTimeoutSeconds[slug]; !known || seconds <= 0 {
			continue
		}
		normalized[slug] = seconds
	}
	return normalized
}

// Config maps the app.yml `bot:` section into a typed struct.
//
// Only the per-app user key (ptm_…) lives here. The Bot *service* token is
// deliberately absent: it is an ops-only credential used to mint/revoke user
// keys via curl and must never enter any config file or source tree.
type Config struct {
	// BaseURL is the Bot phytomni-api HTTP root (production: internal VPC URL).
	BaseURL string `json:"base_url" yaml:"base_url" mapstructure:"base_url"`
	// UserAPIKey is the single ptm_<web> key representing the whole Web app;
	// Bot sees user_id="web" and real-user isolation stays in Web Go MySQL.
	UserAPIKey string `json:"user_api_key" yaml:"user_api_key" mapstructure:"user_api_key"`
	// TimeoutSeconds is the global fallback for Web→Bot calls not covered by the
	// per-Agent map. Long-running agents return 202 immediately, so this only
	// caps the synchronous request itself.
	TimeoutSeconds int `json:"timeout_seconds" yaml:"timeout_seconds" mapstructure:"timeout_seconds"`
	// AgentTimeoutSeconds bounds one synchronous Agent execution request by
	// canonical Bot slug. Missing/invalid entries use compiled defaults.
	AgentTimeoutSeconds map[string]int `json:"agent_timeout_seconds" yaml:"agent_timeout_seconds" mapstructure:"agent_timeout_seconds"`
	// ProxyEnabled is the master switch for the /query gateway. While false the
	// gateway stays dormant and /query keeps flowing to the Python service.
	ProxyEnabled bool `json:"proxy_enabled" yaml:"proxy_enabled" mapstructure:"proxy_enabled"`
	// ExpertEnabled is the dark-launch master switch for the Expert routing
	// mode. While false the gateway returns ErrExpertDisabled for mode=expert
	// (no Bot call). Zero value false = safe dormant default, like ProxyEnabled.
	ExpertEnabled bool `json:"expert_enabled" yaml:"expert_enabled" mapstructure:"expert_enabled"`
	// StreamEnabled is the dark-launch switch for AG-UI SSE streaming on /query.
	// While false the gateway keeps using the blocking ChatCompletion path; flip
	// to true (per deploy) to serve text/event-stream for chat-family slugs.
	// Zero value false = safe dormant default, like ProxyEnabled.
	StreamEnabled bool `json:"stream_enabled" yaml:"stream_enabled" mapstructure:"stream_enabled"`
	// A2uiActionsEnabled is the dark-launch switch for POST
	// /api/v1/conversations/:id/a2ui-actions → Bot
	// /v1/runs/{run_id}/a2ui-actions. While false the gateway returns a local
	// 503 after ownership checks (no Bot call). Zero value false = safe dormant
	// default, like StreamEnabled.
	A2uiActionsEnabled bool `json:"a2ui_actions_enabled" yaml:"a2ui_actions_enabled" mapstructure:"a2ui_actions_enabled"`
	// InteropEnabled is the Web-owned dark-launch switch for the optional
	// /v1/interop/capabilities discovery call. It deliberately defaults false:
	// a missing key must never expose Bot registry metadata to the browser.
	InteropEnabled bool `json:"interop_enabled" yaml:"interop_enabled" mapstructure:"interop_enabled"`
	// MultiturnV1Enabled enables the server-to-server conversation-context
	// envelope. It stays false unless Bot capability negotiation succeeds.
	MultiturnV1Enabled bool `json:"multiturn_v1_enabled" yaml:"multiturn_v1_enabled" mapstructure:"multiturn_v1_enabled"`
	// ResumableUploadEnabled is the Web-owned dark-launch switch for the
	// metadata-only upload control plane. It remains false until the Bot
	// advertises the exact resumable protocol and the public upload origin is
	// explicitly configured.
	ResumableUploadEnabled bool `json:"resumable_upload_enabled" yaml:"resumable_upload_enabled" mapstructure:"resumable_upload_enabled"`
	// UploadPublicOrigin is the exact browser-reachable Bot origin used by the
	// direct upload data plane. It must never be inferred from BaseURL, which
	// may be an internal service address.
	UploadPublicOrigin string `json:"upload_public_origin" yaml:"upload_public_origin" mapstructure:"upload_public_origin"`
	// AnalystEnabled, ResearchEnabled, DesignEnabled, and NetworkEnabled are
	// independent product gates for the remote agent surfaces. They intentionally
	// default false so a missing config key cannot activate a Bot-backed product.
	AnalystEnabled  bool `json:"analyst_enabled" yaml:"analyst_enabled" mapstructure:"analyst_enabled"`
	ResearchEnabled bool `json:"research_enabled" yaml:"research_enabled" mapstructure:"research_enabled"`
	DesignEnabled   bool `json:"design_enabled" yaml:"design_enabled" mapstructure:"design_enabled"`
	NetworkEnabled  bool `json:"network_enabled" yaml:"network_enabled" mapstructure:"network_enabled"`
	// KeyAuditRedact, when true, requires loggers to emit only the key prefix.
	KeyAuditRedact bool `json:"key_audit_redact" yaml:"key_audit_redact" mapstructure:"key_audit_redact"`
}

// BotConfig is the process-wide singleton populated by InitFromViper.
var BotConfig *Config

func (c *Config) TimeoutForAgent(slug string) int {
	if c != nil {
		if seconds, ok := c.AgentTimeoutSeconds[slug]; ok && seconds > 0 {
			return seconds
		}
		if seconds, ok := defaultAgentTimeoutSeconds[slug]; ok {
			return seconds
		}
		if c.TimeoutSeconds > 0 {
			return c.TimeoutSeconds
		}
	}
	return 60
}

// InitFromViper deserializes the `bot` section from the already-loaded viper
// singleton. main.initConfig calls this after utils.LoadConfigInFile, so the
// config is in memory by the time this runs. A missing section yields a
// zero-value Config (ProxyEnabled=false), which is the safe dormant default.
func InitFromViper() error {
	var cfg Config
	if err := viper.UnmarshalKey("bot", &cfg); err != nil {
		return err
	}
	if cfg.TimeoutSeconds <= 0 {
		cfg.TimeoutSeconds = 60
	}
	for slug, seconds := range cfg.AgentTimeoutSeconds {
		_, known := defaultAgentTimeoutSeconds[slug]
		if !known || seconds <= 0 {
			rxLog.Sugar().Warnw(
				"ignoring invalid Bot agent timeout",
				"agent", slug,
				"seconds", seconds,
			)
		}
	}
	cfg.AgentTimeoutSeconds = normalizeAgentTimeoutSeconds(cfg.AgentTimeoutSeconds)
	BotConfig = &cfg
	return nil
}
