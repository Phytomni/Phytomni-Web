package api_service

import (
	"testing"

	rxBot "phytomni-server/external/bot"
)

func TestSlugToToolNameIsCanonical(t *testing.T) {
	for slug, tool := range slugToToolName {
		want, ok := rxBot.CanonicalAgentTool[slug]
		if !ok {
			t.Errorf("slugToToolName has unknown slug %q", slug)
			continue
		}
		if tool != want {
			t.Errorf("slugToToolName[%q]=%q; want canonical %q", slug, tool, want)
		}
	}
}
