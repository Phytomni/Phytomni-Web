package bot

import "testing"

func TestSlugFor_BriefReview(t *testing.T) {
	slug, ok := SlugFor("BriefReviewAgent")
	if !ok {
		t.Fatalf("BriefReviewAgent should resolve to a slug, got ok=false")
	}
	if slug != "brief_gene" {
		t.Errorf("SlugFor(BriefReviewAgent) = %q, want brief_gene", slug)
	}
}
