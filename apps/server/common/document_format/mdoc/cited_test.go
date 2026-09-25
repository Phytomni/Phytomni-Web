package mdoc

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/text"
	"phytomni-server/common/citation"
)

func citedRows(t *testing.T, raw string) []citation.Row {
	t.Helper()
	rows, err := citation.DecodeRows(json.RawMessage(raw))
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func TestCitedOwnsOnlyMatchingTerminalBibliography(t *testing.T) {
	rows := citedRows(t, `[{"title":"A plant study"}]`)
	src := "### Title: Plant adaptation\n\n### Abstract\n\nEvidence [1].\n\n## References\n\n1. A plant study\n"
	body, matched, err := SplitOwnedReferences(src, rows)
	if err != nil || !matched || body != "### Title: Plant adaptation\n\n### Abstract\n\nEvidence [1].\n\n" {
		t.Fatalf("matching source bibliography: %q %v %v", body, matched, err)
	}
	doc, err := BuildCited(src, rows, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if doc.blocks[0].role != roleTitle || plainText(doc.blocks[0].inlines) != "Plant adaptation" {
		t.Fatal("explicit leading title was not recognized")
	}
	count := 0
	for _, b := range doc.blocks {
		if b.kind == blockHeading && plainText(b.inlines) == "References" {
			count++
		}
	}
	md, _ := CitedMarkdown(src, rows)
	if count != 1 || strings.Count(md, "## References") != 1 {
		t.Fatal("owned bibliography duplicated")
	}
	for _, source := range []string{
		"## References\n\n1. Different authored content\n",
		"## References\n\n2. A plant study\n",
		"## References\n\n1. A plant study\n2. A plant study\n",
		"## References\n\n1. A plant study\n\nAfterword\n",
		"## References\n\n1. A plant study\n\n## Appendix\n",
		"```\n## References\n\n1. A plant study\n```\n",
		"## References::\n\n1. A plant study\n",
	} {
		got, matched, err := SplitOwnedReferences(source, rows)
		if err != nil || matched || got != source {
			t.Fatalf("authored content removed: %q", source)
		}
	}
	for _, heading := range []string{"References\n----------", "References\n==========", "## References ###"} {
		source := "Body\n\n" + heading + "\n\n1. A plant study\n"
		got, matched, _ := SplitOwnedReferences(source, rows)
		if !matched || got != "Body\n\n" {
			t.Fatalf("valid terminal heading not separated: %q (%q)", source, got)
		}
	}
}

func TestCitedMarkdownKeepsLongBibliographyLinksInsideTheirEntry(t *testing.T) {
	row := citedRows(t, `[{"title":"Study"}]`)[0]
	rows := make([]citation.Row, 100)
	for i := range rows {
		rows[i] = row
	}
	md, err := CitedMarkdown("Body.", rows)
	if err != nil {
		t.Fatal(err)
	}
	tree := reportMarkdown().Parser().Parse(text.NewReader([]byte(md)))
	list, ok := tree.LastChild().(*ast.List)
	if !ok || list.ChildCount() != 100 {
		t.Fatal("link continuation split bibliography list")
	}
	for entry := list.FirstChild(); entry != nil; entry = entry.NextSibling() {
		if entry.ChildCount() != 2 {
			t.Fatal("entry does not own its link row")
		}
	}
}

func TestCitedOwnershipExplicitPositionsAndDecodedText(t *testing.T) {
	rows := citedRows(t, `[{"title":"A & B"},{"title":"A & B"}]`)
	for _, source := range []string{"## Reference:\n\n[1] A &amp; B\n[2] A & B\n", "## 参考文献：\n\n1. **A** &amp; B\n2. A & B\n"} {
		_, matched, err := SplitOwnedReferences(source, rows)
		if err != nil || !matched {
			t.Fatalf("exact duplicate-position match rejected: %q %v", source, err)
		}
	}
	source := "## References\n\n1. A & B\n1. A & B\n"
	got, matched, _ := SplitOwnedReferences(source, rows)
	if matched || got != source {
		t.Fatal("auto incremented source numbering")
	}
	for _, source := range []string{
		"## References\n\n[2] A & B\n[1] A & B\n",
		"## References\n\n[1] A & B\n[2] A & B\nProse\n",
		"## References\n\n[1] A & B\n[2] Different\n",
		"## References\n\n[1] A & B\n\n```\n[2] A & B\n```\n",
		"## References\n\n[1] A & B\n[2] A & B\n\n[hidden]: https://example.org\n",
	} {
		got, matched, _ := SplitOwnedReferences(source, rows)
		if matched || got != source {
			t.Fatalf("ambiguous bracket section removed: %q", source)
		}
	}
}

func TestCitedTitleAndRelativeRoles(t *testing.T) {
	for _, tt := range []struct {
		source string
		title  bool
	}{
		{"# Plant adaptation\n\n## Abstract\n\nLead", true},
		{"### Plant adaptation\n\n### Abstract\n\nLead", true},
		{"### 标题：植物适应\n\n### 摘要\n\nLead", true},
		{"# Abstract\n\nLead", false},
		{"# Introduction\n\nLead", false},
		{"# References\n\nLead", false},
		{"### Unidentified\n\n#### Nested\n\nLead", false},
		{"Prose\n\n# Not a title", false},
	} {
		doc, err := BuildCited(tt.source, nil, Options{})
		if err != nil {
			t.Fatal(err)
		}
		if (doc.blocks[0].role == roleTitle) != tt.title {
			t.Fatalf("title decision %q", tt.source)
		}
	}
	doc, _ := BuildCited("# Title: Report\n\n## Abstract\n\nOne\n\nTwo\n\n## Results\n\nFirst\n\nSecond\n\n### Nested\n\nThird", nil, Options{})
	want := []reportRole{roleTitle, roleSection, roleLead, roleLead, roleSection, roleLead, roleBody, roleSubsection, roleLead}
	for i, role := range want {
		if doc.blocks[i].role != role {
			t.Fatalf("block %d role %v want %v", i, doc.blocks[i].role, role)
		}
	}
}

func TestCitedLeadingHTMLDoesNotPromoteLaterHeadingOrPanic(t *testing.T) {
	for _, leading := range []string{"<!-- authored comment -->", "<div>Authored HTML</div>"} {
		src := leading + "\n\n# Title: Report\n\nBody.\n"
		md, err := CitedMarkdown(src, nil)
		if err != nil || md != src {
			t.Fatalf("source changed: %q %v", md, err)
		}
		doc, err := BuildCited(src, nil, Options{})
		if err != nil {
			t.Fatal(err)
		}
		if len(doc.blocks) == 0 || doc.blocks[0].role == roleTitle || plainText(doc.blocks[0].inlines) != "Title: Report" {
			t.Fatal("later heading incorrectly promoted")
		}
	}
}

func TestCitedCanonicalRunsAndMarkdown(t *testing.T) {
	rows := citedRows(t, `[{"ti":"Study","so":"Journal","vl":"2","py":"2024","di":"10.1000/example"},null]`)
	doc, err := BuildCited("# Title: Report\n\nBody [1,2].", rows, Options{})
	if err != nil {
		t.Fatal(err)
	}
	references := 0
	for _, b := range doc.blocks {
		if b.role == roleReference {
			references++
			if b.referenceIndex != references {
				t.Fatal("position lost")
			}
			for i, run := range rows[references-1].Citation.Runs {
				if b.inlines[i].text != run.Text || b.inlines[i].style.bold != run.Bold || b.inlines[i].style.italic != run.Italic {
					t.Fatal("canonical run lost")
				}
			}
		}
	}
	if references != 2 {
		t.Fatal("missing references")
	}
	md, err := CitedMarkdown("# Title: Report\n\nBody [1,2].", rows)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(md, "# Report\n\nBody [1,2].") || strings.Count(md, "## References") != 1 || !strings.Contains(md, "2. Reference details unavailable.") || !strings.Contains(md, "\n   [Article]") {
		t.Fatalf("markdown: %q", md)
	}
	empty, _ := CitedMarkdown("unchanged\n", nil)
	if empty != "unchanged\n" {
		t.Fatal("empty reference mutation")
	}
	doc, _ = BuildCited("| A | B | C |\n| :-- | :-: | --: |\n| x | y | z |", nil, Options{})
	if len(doc.blocks[0].alignments) != 3 || doc.blocks[0].alignments[1] != alignCenter || doc.blocks[0].alignments[2] != alignRight {
		t.Fatal("table alignments lost")
	}
}
