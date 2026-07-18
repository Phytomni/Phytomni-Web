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

func TestAliasMapContainsEveryCanonicalTool(t *testing.T) {
	for slug, tool := range CanonicalAgentTool {
		if got, ok := aliasToSlug[tool]; !ok || got != slug {
			t.Errorf("%s -> %q want %q", tool, got, slug)
		}
	}
}
