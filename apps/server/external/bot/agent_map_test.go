package bot

import "testing"

func TestSlugFor_BriefGene(t *testing.T) {
	slug, ok := SlugFor("BriefGeneAgent")
	if !ok {
		t.Fatalf("BriefGeneAgent should resolve to a slug, got ok=false")
	}
	if slug != "brief_gene" {
		t.Errorf("SlugFor(BriefGeneAgent) = %q, want brief_gene", slug)
	}
}
