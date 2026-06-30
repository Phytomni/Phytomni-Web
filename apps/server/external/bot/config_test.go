package bot

import (
	"testing"

	"github.com/spf13/viper"
)

// TestInitFromViper_ExpertEnabled pins the dark-launch flag: absent key -> false
// (dormant), explicit true -> true. Mirrors the ProxyEnabled zero-value default.
func TestInitFromViper_ExpertEnabled(t *testing.T) {
	viper.Reset()
	viper.Set("bot.base_url", "http://localhost:8000")
	if err := InitFromViper(); err != nil {
		t.Fatalf("InitFromViper: %v", err)
	}
	if BotConfig.ExpertEnabled {
		t.Error("ExpertEnabled must default to false (dark launch) when key absent")
	}

	viper.Reset()
	viper.Set("bot.base_url", "http://localhost:8000")
	viper.Set("bot.expert_enabled", true)
	if err := InitFromViper(); err != nil {
		t.Fatalf("InitFromViper: %v", err)
	}
	if !BotConfig.ExpertEnabled {
		t.Error("ExpertEnabled must be true when bot.expert_enabled=true")
	}
	BotConfig = nil
}
