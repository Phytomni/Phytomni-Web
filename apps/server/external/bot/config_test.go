package bot

import (
	"testing"

	"github.com/spf13/viper"
)

func TestInitFromViper_UploadPublicOriginDefaultsAndExplicitConfig(t *testing.T) {
	viper.Reset()
	t.Cleanup(func() {
		viper.Reset()
		BotConfig = nil
	})

	if err := InitFromViper(); err != nil {
		t.Fatalf("InitFromViper defaults: %v", err)
	}
	if BotConfig.UploadPublicOrigin != "" {
		t.Fatalf("upload origin must default unset: %#v", BotConfig)
	}

	viper.Set("bot.upload_public_origin", "https://upload.example/")
	if err := InitFromViper(); err != nil {
		t.Fatalf("InitFromViper explicit config: %v", err)
	}
	if BotConfig.UploadPublicOrigin != "https://upload.example/" {
		t.Fatalf("upload origin config was not decoded: %#v", BotConfig)
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

func TestInitFromViperNormalizesMaxQueryChars(t *testing.T) {
	viper.Reset()
	t.Cleanup(func() {
		viper.Reset()
		BotConfig = nil
	})

	if err := InitFromViper(); err != nil {
		t.Fatalf("InitFromViper defaults: %v", err)
	}
	if got := BotConfig.MaxQueryChars; got != DefaultMaxUserQueryChars {
		t.Fatalf("default MaxQueryChars=%d, want %d", got, DefaultMaxUserQueryChars)
	}

	viper.Set("bot.max_query_chars", 7)
	if err := InitFromViper(); err != nil {
		t.Fatalf("InitFromViper explicit max query chars: %v", err)
	}
	if got := BotConfig.MaxQueryChars; got != 7 {
		t.Fatalf("explicit MaxQueryChars=%d, want 7", got)
	}
}

func TestInitFromViperRejectsInvalidMaxQueryChars(t *testing.T) {
	viper.Reset()
	previous := BotConfig
	sentinel := &Config{MaxQueryChars: DefaultMaxUserQueryChars}
	BotConfig = sentinel
	t.Cleanup(func() {
		viper.Reset()
		BotConfig = previous
	})
	viper.Set("bot.max_query_chars", HardMaxUserQueryChars+1)

	if err := InitFromViper(); err == nil {
		t.Fatal("InitFromViper must reject max_query_chars above the hard limit")
	}
	if BotConfig != sentinel {
		t.Fatal("InitFromViper must not assign BotConfig when max_query_chars is invalid")
	}
}
