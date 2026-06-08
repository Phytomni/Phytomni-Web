package bot

import "github.com/spf13/viper"

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
	// TimeoutSeconds bounds each Web→Bot HTTP call. Long-running agents return
	// 202 immediately, so this only caps the synchronous request itself.
	TimeoutSeconds int `json:"timeout_seconds" yaml:"timeout_seconds" mapstructure:"timeout_seconds"`
	// ProxyEnabled is the master switch for the /query gateway. While false the
	// gateway stays dormant and /query keeps flowing to the Python service.
	ProxyEnabled bool `json:"proxy_enabled" yaml:"proxy_enabled" mapstructure:"proxy_enabled"`
	// KeyAuditRedact, when true, requires loggers to emit only the key prefix.
	KeyAuditRedact bool `json:"key_audit_redact" yaml:"key_audit_redact" mapstructure:"key_audit_redact"`
}

// BotConfig is the process-wide singleton populated by InitFromViper.
var BotConfig *Config

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
	BotConfig = &cfg
	return nil
}
