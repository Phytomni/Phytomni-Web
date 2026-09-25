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
	// MaxQueryChars limits a user query before it is forwarded to Bot. A missing
	// value uses DefaultMaxUserQueryChars; invalid values fail configuration load.
	MaxQueryChars int `json:"max_query_chars" yaml:"max_query_chars" mapstructure:"max_query_chars"`
	// AgentTimeoutSeconds bounds one synchronous Agent execution request by
	// canonical Bot slug. Missing/invalid entries use compiled defaults.
	AgentTimeoutSeconds map[string]int `json:"agent_timeout_seconds" yaml:"agent_timeout_seconds" mapstructure:"agent_timeout_seconds"`
	// ProxyEnabled is the master switch for the /query gateway. While false the
	// gateway stays dormant and /query keeps flowing to the Python service.
	ProxyEnabled bool `json:"proxy_enabled" yaml:"proxy_enabled" mapstructure:"proxy_enabled"`
	// UploadPublicOrigin is the exact browser-reachable Bot origin used by the
	// direct upload data plane. It must never be inferred from BaseURL, which
	// may be an internal service address. Upload enablement is negotiated from
	// this origin plus the Bot-advertised obs-multipart-v2 protocol.
	UploadPublicOrigin string `json:"upload_public_origin" yaml:"upload_public_origin" mapstructure:"upload_public_origin"`
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
	maxQueryChars, err := NormalizeMaxUserQueryChars(cfg.MaxQueryChars)
	if err != nil {
		return err
	}
	cfg.MaxQueryChars = maxQueryChars
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
