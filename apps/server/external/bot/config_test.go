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

// TestInitFromViper_StreamEnabled pins the streaming dark-launch flag end to
// end through viper (mapstructure tag included): absent key -> false
// (dormant), explicit true -> true. Mirrors TestInitFromViper_ExpertEnabled.
func TestInitFromViper_StreamEnabled(t *testing.T) {
	viper.Reset()
	viper.Set("bot.base_url", "http://localhost:8000")
	if err := InitFromViper(); err != nil {
		t.Fatalf("InitFromViper: %v", err)
	}
	if BotConfig.StreamEnabled {
		t.Error("StreamEnabled must default to false (dark launch) when key absent")
	}

	viper.Reset()
	viper.Set("bot.base_url", "http://localhost:8000")
	viper.Set("bot.stream_enabled", true)
	if err := InitFromViper(); err != nil {
		t.Fatalf("InitFromViper: %v", err)
	}
	if !BotConfig.StreamEnabled {
		t.Error("StreamEnabled must be true when bot.stream_enabled=true")
	}
	BotConfig = nil
}
