package api_service

import (
	"testing"

	rxBot "phytomni-server/external/bot"
)

// TestSlugRoutingDecision pins the chat-vs-remote dispatch decision and the
// empty-tool default, which drive which Bot endpoint Query calls.
func TestSlugRoutingDecision(t *testing.T) {
	cases := []struct {
		tool     string
		wantSlug string
		isChat   bool
	}{
		{"", "chat", true},
		{"ChatAgent", "chat", true},
		{"KnowledgeAgent", "knowledge", true},
		{"ReviewAgent", "review", true},
		{"AnalystAgent", "analyst", false},
		{"DeepGenomeAgent", "deep_genome", false},
		{"BriefGeneAgent", "brief_gene", false},
	}
	for _, c := range cases {
		slug, ok := rxBot.SlugFor(c.tool)
		if !ok || slug != c.wantSlug {
			t.Errorf("SlugFor(%q) = %q,%v; want %q", c.tool, slug, ok, c.wantSlug)
		}
		if _, isChat := rxBot.ChatModelFor(slug); isChat != c.isChat {
			t.Errorf("ChatModelFor(%q) isChat = %v; want %v", slug, isChat, c.isChat)
		}
	}
	if _, ok := rxBot.SlugFor("NoSuchAgent"); ok {
		t.Error("SlugFor of unknown tool should not resolve")
	}
}

// TestToolNameMapCoversAgents ensures every renderable tool_name the Web app needs
// has a slug mapping, so persisted rows carry a tool_name the Web app can branch on.
func TestToolNameMapCoversAgents(t *testing.T) {
	want := []string{"ChatAgent", "KnowledgeAgent", "DataAgent", "AnalystAgent", "ReviewAgent", "DeepGenomeAgent", "BriefGeneAgent"}
	have := make(map[string]bool)
	for _, v := range slugToToolName {
		have[v] = true
	}
	for _, w := range want {
		if !have[w] {
			t.Errorf("slugToToolName missing tool_name %q the Web app renders by", w)
		}
	}
}
