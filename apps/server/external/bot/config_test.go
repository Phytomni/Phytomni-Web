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

func TestInitFromViper_MultiturnV1Enabled(t *testing.T) {
	viper.Reset()
	t.Cleanup(func() {
		viper.Reset()
		BotConfig = nil
	})

	if err := InitFromViper(); err != nil {
		t.Fatalf("InitFromViper defaults: %v", err)
	}
	if BotConfig.MultiturnV1Enabled {
		t.Fatal("MultiturnV1Enabled must default false")
	}

	viper.Set("bot.multiturn_v1_enabled", true)
	if err := InitFromViper(); err != nil {
		t.Fatalf("InitFromViper explicit flag: %v", err)
	}
	if !BotConfig.MultiturnV1Enabled {
		t.Fatal("MultiturnV1Enabled must be true when bot.multiturn_v1_enabled=true")
	}
}

func TestInitFromViper_ResumableUploadDefaultsAndExplicitConfig(t *testing.T) {
	viper.Reset()
	t.Cleanup(func() {
		viper.Reset()
		BotConfig = nil
	})

	if err := InitFromViper(); err != nil {
		t.Fatalf("InitFromViper defaults: %v", err)
	}
	if BotConfig.ResumableUploadEnabled || BotConfig.UploadPublicOrigin != "" {
		t.Fatalf("upload capability must default off and unset: %#v", BotConfig)
	}

	viper.Set("bot.resumable_upload_enabled", true)
	viper.Set("bot.upload_public_origin", "https://upload.example/")
	if err := InitFromViper(); err != nil {
		t.Fatalf("InitFromViper explicit config: %v", err)
	}
	if !BotConfig.ResumableUploadEnabled || BotConfig.UploadPublicOrigin != "https://upload.example/" {
		t.Fatalf("upload capability config was not decoded: %#v", BotConfig)
	}
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

func TestInteropEnabledDefaultsFalse(t *testing.T) {
	viper.Reset()
	t.Cleanup(func() {
		viper.Reset()
		BotConfig = nil
	})
	if err := InitFromViper(); err != nil {
		t.Fatalf("InitFromViper defaults: %v", err)
	}
	if BotConfig.InteropEnabled {
		t.Fatal("InteropEnabled must default false")
	}
}

func TestInteropEnabledTrueWhenSet(t *testing.T) {
	viper.Reset()
	t.Cleanup(func() {
		viper.Reset()
		BotConfig = nil
	})
	viper.Set("bot.interop_enabled", true)
	if err := InitFromViper(); err != nil {
		t.Fatalf("InitFromViper explicit flag: %v", err)
	}
	if !BotConfig.InteropEnabled {
		t.Fatal("InteropEnabled must be true when bot.interop_enabled=true")
	}
}

func TestRemoteProductFlagsDefaultOff(t *testing.T) {
	cfg := Config{}
	if cfg.AnalystEnabled || cfg.ResearchEnabled || cfg.DesignEnabled || cfg.NetworkEnabled {
		t.Fatal("remote product flags must default off")
	}
}

func TestAnalystProductDefaultsOff(t *testing.T) {
	cfg := &Config{}
	if cfg.AnalystEnabled {
		t.Fatal("Analyst must default off")
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
	if BotConfig.AnalystEnabled || BotConfig.ResearchEnabled || BotConfig.DesignEnabled || BotConfig.NetworkEnabled {
		t.Fatal("remote product flags must remain disabled when keys are absent")
	}

	viper.Set("bot.analyst_enabled", true)
	viper.Set("bot.research_enabled", true)
	viper.Set("bot.design_enabled", true)
	viper.Set("bot.network_enabled", true)
	if err := InitFromViper(); err != nil {
		t.Fatalf("InitFromViper explicit flags: %v", err)
	}
	if !BotConfig.AnalystEnabled || !BotConfig.ResearchEnabled || !BotConfig.DesignEnabled || !BotConfig.NetworkEnabled {
		t.Fatalf("explicit remote product flags were not decoded: %#v", BotConfig)
	}
}

func TestInitFromViperAgentTimeoutDefaults(t *testing.T) {
	viper.Reset()
	t.Cleanup(func() {
		viper.Reset()
		BotConfig = nil
	})

	if err := InitFromViper(); err != nil {
		t.Fatalf("InitFromViper: %v", err)
	}
	want := map[string]int{
		"chat": 3000, "knowledge": 15000, "data": 9000,
		"review": 30000, "brief_gene": 30000,
	}
	for slug, seconds := range want {
		if got := BotConfig.TimeoutForAgent(slug); got != seconds {
			t.Fatalf("TimeoutForAgent(%q)=%d, want %d", slug, got, seconds)
		}
	}
	if got := BotConfig.TimeoutForAgent("analyst"); got != 60 {
		t.Fatalf("background fallback=%d, want global default 60", got)
	}
}

func TestInitFromViperAgentTimeoutPartialOverride(t *testing.T) {
	viper.Reset()
	t.Cleanup(func() {
		viper.Reset()
		BotConfig = nil
	})
	viper.Set("bot.timeout_seconds", 17)
	viper.Set("bot.agent_timeout_seconds", map[string]int{
		"chat":      41,
		"knowledge": -5,
		"review":    0,
		"unknown":   999,
	})

	if err := InitFromViper(); err != nil {
		t.Fatalf("InitFromViper: %v", err)
	}
	if got := BotConfig.TimeoutForAgent("chat"); got != 41 {
		t.Fatalf("chat override=%d, want 41", got)
	}
	if got := BotConfig.TimeoutForAgent("review"); got != 30000 {
		t.Fatalf("invalid review override=%d, want built-in 30000", got)
	}
	if got := BotConfig.TimeoutForAgent("knowledge"); got != 15000 {
		t.Fatalf("negative knowledge override=%d, want built-in 15000", got)
	}
	if _, present := BotConfig.AgentTimeoutSeconds["unknown"]; present {
		t.Fatal("unknown timeout key survived normalization")
	}
	if got := BotConfig.TimeoutForAgent("research"); got != 17 {
		t.Fatalf("research fallback=%d, want global 17", got)
	}
}
