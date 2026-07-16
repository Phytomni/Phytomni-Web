package bot

import (
	"slices"
	"testing"
)

func sortedKeys(values map[string]string) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	return keys
}

func TestCanonicalAgentSlugsAreExactlyTheReleaseSet(t *testing.T) {
	want := []string{
		"analyst",
		"brief_gene",
		"chat",
		"data",
		"deep_genome",
		"design",
		"knowledge",
		"network",
		"research",
		"review",
	}
	if got := sortedKeys(CanonicalAgentTool); !slices.Equal(got, want) {
		t.Fatalf("slugs=%v want=%v", got, want)
	}
}

func TestAliasToSlugIsCanonical(t *testing.T) {
	canonicalNames := map[string]bool{}
	for _, tool := range CanonicalAgentTool {
		canonicalNames[tool] = true
	}
	for key, slug := range aliasToSlug {
		if !canonicalNames[key] {
			t.Errorf("aliasToSlug key %q is not a canonical Bot tool name", key)
		}
		if _, ok := CanonicalAgentTool[slug]; !ok {
			t.Errorf("aliasToSlug[%q]=%q is not a known slug", key, slug)
		}
	}
}

func TestSlugForRejectsLegacyAliases(t *testing.T) {
	for _, legacy := range []string{
		"ChatAgents", "KnowledgeAgents", "DatabaseAgents", "ReviewAgents",
		"AnalysisAgents", "BriefReviewAgent", "GeneFunctionAgents",
	} {
		if _, ok := SlugFor(legacy); ok {
			t.Errorf("SlugFor(%q) should be rejected after clean break", legacy)
		}
	}
	if slug, ok := SlugFor("BriefGeneAgent"); !ok || slug != "brief_gene" {
		t.Errorf("SlugFor(BriefGeneAgent) = %q,%v; want brief_gene,true", slug, ok)
	}
}
