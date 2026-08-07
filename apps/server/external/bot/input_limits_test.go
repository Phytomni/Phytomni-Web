package bot

import "testing"

func TestNormalizeMaxUserQueryChars(t *testing.T) {
	tests := []struct {
		in      int
		want    int
		wantErr bool
	}{
		{0, 131_072, false},
		{131_072, 131_072, false},
		{1_048_576, 1_048_576, false},
		{-1, 0, true},
		{1_048_577, 0, true},
	}
	for _, tt := range tests {
		got, err := NormalizeMaxUserQueryChars(tt.in)
		if (err != nil) != tt.wantErr || got != tt.want {
			t.Fatalf("got=%d err=%v", got, err)
		}
	}
}

func TestConfiguredMaxUserQueryChars(t *testing.T) {
	previous := BotConfig
	t.Cleanup(func() { BotConfig = previous })

	BotConfig = nil
	if got := ConfiguredMaxUserQueryChars(); got != DefaultMaxUserQueryChars {
		t.Fatalf("nil BotConfig limit=%d, want %d", got, DefaultMaxUserQueryChars)
	}

	BotConfig = &Config{MaxQueryChars: 7}
	if got := ConfiguredMaxUserQueryChars(); got != 7 {
		t.Fatalf("configured limit=%d, want 7", got)
	}
}
