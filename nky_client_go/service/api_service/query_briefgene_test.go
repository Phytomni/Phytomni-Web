package api_service

import "testing"

// brief_gene must round-trip back to the chat-ai-facing name BriefReviewAgent
// (NOT Bot's BriefGeneAgent), because chat-ai keys rendering/avatar on tool_name.
func TestSlugToToolName_BriefGene(t *testing.T) {
	if got := slugToToolName["brief_gene"]; got != "BriefReviewAgent" {
		t.Errorf("slugToToolName[brief_gene] = %q, want BriefReviewAgent", got)
	}
}
