package api_service

import (
	"testing"

	rxBot "phytomni-server/external/bot"
)

func TestResolveExecutionTimeoutSeconds(t *testing.T) {
	cfg := &rxBot.Config{
		TimeoutSeconds: 17,
		AgentTimeoutSeconds: map[string]int{
			"chat": 3000, "knowledge": 15000, "data": 9000,
			"review": 30000, "brief_gene": 30000,
		},
	}
	tests := []struct {
		name         string
		mode         string
		forcedTool   string
		directSlug   string
		allowedTools []string
		want         int
	}{
		{name: "instant chat", mode: "instant", directSlug: "chat", want: 3000},
		{name: "direct background", mode: "instant", directSlug: "research", want: 17},
		{name: "forced brief gene", mode: "expert", forcedTool: "BriefGeneAgent", want: 30000},
		{name: "forced analyst", mode: "expert", forcedTool: "AnalystAgent", want: 17},
		{
			name: "autonomous maximum synchronous", mode: "expert",
			allowedTools: []string{"ChatAgent", "DataAgent", "AnalystAgent"},
			want:         9000,
		},
		{
			name: "autonomous review maximum", mode: "expert",
			allowedTools: []string{"ChatAgent", "ReviewAgent", "DigitalDesignAgent"},
			want:         30000,
		},
		{
			name: "autonomous background only", mode: "expert",
			allowedTools: []string{"AnalystAgent", "DeepGenomeAgent", "GeneNetworkAgent"},
			want:         17,
		},
		{
			name: "unknown allowed identity ignored", mode: "expert",
			allowedTools: []string{"UnknownAgent", "ChatAgent"},
			want:         3000,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolveExecutionTimeoutSeconds(
				cfg, tt.mode, tt.forcedTool, tt.directSlug, tt.allowedTools,
			)
			if got != tt.want {
				t.Fatalf("timeout=%d, want %d", got, tt.want)
			}
		})
	}
}
