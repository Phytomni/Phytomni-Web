package api_service

import "testing"

// brief_gene must round-trip back to the Bot canonical Web-facing name.
func TestSlugToToolName_BriefGene(t *testing.T) {
	if got := slugToToolName["brief_gene"]; got != "BriefGeneAgent" {
		t.Errorf("slugToToolName[brief_gene] = %q, want BriefGeneAgent", got)
	}
}
