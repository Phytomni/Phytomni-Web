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

func TestA2uiActionsEnabledDefaultsFalse(t *testing.T) {
	viper.Reset()
	t.Cleanup(viper.Reset)
	viper.Set("bot.base_url", "http://localhost:8000")
	if err := InitFromViper(); err != nil {
		t.Fatalf("InitFromViper: %v", err)
	}
	if BotConfig.A2uiActionsEnabled {
		t.Fatal("A2uiActionsEnabled must default false")
	}
}

func TestA2uiActionsEnabledTrueWhenSet(t *testing.T) {
	viper.Reset()
	t.Cleanup(viper.Reset)
	viper.Set("bot.base_url", "http://localhost:8000")
	viper.Set("bot.a2ui_actions_enabled", true)
	if err := InitFromViper(); err != nil {
		t.Fatalf("InitFromViper: %v", err)
	}
	if !BotConfig.A2uiActionsEnabled {
		t.Fatal("A2uiActionsEnabled must be true when set")
	}
}

func TestRemoteProductFlagsDefaultOff(t *testing.T) {
	cfg := Config{}
	if cfg.ResearchEnabled || cfg.DesignEnabled || cfg.NetworkEnabled {
		t.Fatal("remote product flags must default off")
	}
}

func TestInitFromViper_RemoteProductFlags(t *testing.T) {
	viper.Reset()
	t.Cleanup(func() {
		viper.Reset()
		BotConfig = nil
	})

	if err := InitFromViper(); err != nil {
		t.Fatalf("InitFromViper defaults: %v", err)
	}
	if BotConfig.ResearchEnabled || BotConfig.DesignEnabled || BotConfig.NetworkEnabled {
		t.Fatal("remote product flags must remain disabled when keys are absent")
	}

	viper.Set("bot.research_enabled", true)
	viper.Set("bot.design_enabled", true)
	viper.Set("bot.network_enabled", true)
	if err := InitFromViper(); err != nil {
		t.Fatalf("InitFromViper explicit flags: %v", err)
	}
	if !BotConfig.ResearchEnabled || !BotConfig.DesignEnabled || !BotConfig.NetworkEnabled {
		t.Fatalf("explicit remote product flags were not decoded: %#v", BotConfig)
	}
}
