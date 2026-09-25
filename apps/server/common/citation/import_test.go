package citation

import (
	"reflect"
	"strings"
	"testing"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/text"
)

func TestPartialMetadataPreservesWholeCitation(t *testing.T) {
	p := Format(Source{Title: "Short title", TI: "Short title",
		Formatted: "Author, A. Full title. *Full Journal* **8**, 10–12 (2023)."})
	if got := PlainText(p); got != "Author, A. Full title. Full Journal 8, 10–12 (2023)." {
		t.Fatalf("preformatted details lost: %q", got)
	}
}

func TestImportedCitationPreservesSupportedMarkupAndLiteralCode(t *testing.T) {
	p := importCitation("Author. `a_*_b`. <i>Journal</i> <b>8</b>. <script>alert(1)</script>")
	want := []Run{
		{Text: "Author. a_*_b. "},
		{Text: "Journal", Italic: true},
		{Text: " "},
		{Text: "8", Bold: true},
		{Text: ". alert(1)"},
	}
	if !reflect.DeepEqual(p.Runs, want) {
		t.Fatalf("runs = %#v, want %#v", p.Runs, want)
	}
}

func TestRawHTMLSourcePreservesEverySegment(t *testing.T) {
	source := []byte("<i\n>tail")
	node := ast.NewRawHTML()
	node.Segments.Append(text.NewSegment(0, 2))
	node.Segments.Append(text.NewSegment(2, 4))

	if got, want := rawHTMLSource(node, source), "<i\n>"; got != want {
		t.Fatalf("rawHTMLSource(node, source) = %q, want %q", got, want)
	}
}

func TestHTMLBlockSourceIncludesClosureLine(t *testing.T) {
	source := []byte("<script>\nbody\n</script>\nignored")
	closureStart := strings.Index(string(source), "</script>")
	closureEnd := closureStart + len("</script>\n")
	node := ast.NewHTMLBlock(ast.HTMLBlockType1)
	node.Lines().Append(text.NewSegment(0, closureStart))
	node.ClosureLine = text.NewSegment(closureStart, closureEnd)

	if got, want := htmlBlockSource(node, source), string(source[:closureEnd]); got != want {
		t.Fatalf("htmlBlockSource(node, source) = %q, want %q", got, want)
	}
}

func TestImportedCitationKeepsCodeEscapesAndRejectsAttributedHTMLStyling(t *testing.T) {
	p := importCitation("`a\\*b` <i class=\"journal\">Journal</i>")
	if got, want := PlainText(p), `a\*b Journal`; got != want {
		t.Fatalf("PlainText(importCitation(raw)) = %q, want %q", got, want)
	}
	if hasStyledText(p.Runs, "Journal", false, true) {
		t.Fatalf("attributed HTML was imported as emphasis: %#v", p.Runs)
	}
}

func TestImportedCitationDoesNotTurnLinkLabelMarkupIntoRuns(t *testing.T) {
	p := importCitation("See [a_*_b](https://example.org/a_(b)).")
	if got := PlainText(p); got != "See a_*_b." {
		t.Fatalf("PlainText(importCitation(raw)) = %q", got)
	}
	if !reflect.DeepEqual(p.Runs, []Run{{Text: "See a_*_b."}}) {
		t.Fatalf("link label markup affected runs: %#v", p.Runs)
	}
	if want := []Link{{Label: "Article", Href: "https://example.org/a_(b)"}}; !reflect.DeepEqual(p.Links, want) {
		t.Fatalf("links = %#v, want %#v", p.Links, want)
	}
}

func TestImportedCitationImagesNeverBecomeLinks(t *testing.T) {
	p := importCitation("Before ![figure](https://example.org/image.png) after.")
	if got := PlainText(p); got != "Before figure after." {
		t.Fatalf("image alt text was not retained safely: %q", got)
	}
	if len(p.Links) != 0 {
		t.Fatalf("image destination became a citation link: %#v", p.Links)
	}
}

func TestImportedHTMLBlockPreservesTextWithoutExecutingMarkup(t *testing.T) {
	p := Format(Source{
		TI:        "Short title",
		Formatted: `<div onclick="alert(1)">Author, A. Full title. <em>Full Journal</em> <strong>8</strong>, 10–12 (2023).</div>`,
	})
	if got, want := PlainText(p), "Author, A. Full title. Full Journal 8, 10–12 (2023)."; got != want {
		t.Fatalf("HTML-wrapped preformatted details lost: got %q, want %q", got, want)
	}
	if !hasStyledText(p.Runs, "Full Journal", false, true) || !hasStyledText(p.Runs, "8", true, false) {
		t.Fatalf("supported emphasis inside HTML block was lost: %#v", p.Runs)
	}
}

func TestImportedCitationCompleteStructuredMetadataRemainsAuthoritative(t *testing.T) {
	src := Source{
		AU: "Doe, JA", TI: "Right title", SO: "Right Journal", VL: "3", BP: "4", PY: "2024",
		Formatted: "Wrong author. Wrong title. *Wrong Journal* **9**, 1–2 (1999).",
	}
	if got, want := PlainText(Format(src)), "Doe, J. A. Right title. Right Journal 3, 4 (2024)."; got != want {
		t.Fatalf("PlainText(Format(src)) = %q, want %q", got, want)
	}
}

func TestImportedCitationTransfersOnlyExactTitleEmphasis(t *testing.T) {
	t.Run("exact title", func(t *testing.T) {
		src := Source{
			AU: "Doe, JA", TI: "Arabidopsis study", SO: "Plant Journal", VL: "3", BP: "4", PY: "2024",
			Formatted: "Doe, J. A. *Arabidopsis* study. Plant Journal 3, 4 (2024).",
		}
		p := Format(src)
		if !hasStyledText(p.Runs, "Arabidopsis", false, true) {
			t.Fatalf("exact title emphasis was not transferred: %#v", p.Runs)
		}
	})

	t.Run("conflicting title", func(t *testing.T) {
		src := Source{
			AU: "Doe, JA", TI: "Arabidopsis study", SO: "Plant Journal", VL: "3", BP: "4", PY: "2024",
			Formatted: "Doe, J. A. *Different* study. Plant Journal 3, 4 (2024).",
		}
		p := Format(src)
		if hasStyledText(p.Runs, "Arabidopsis", false, true) {
			t.Fatalf("conflicting title emphasis was transferred: %#v", p.Runs)
		}
	})
}

func TestImportedCitationRetainsSelectedTitleMarkup(t *testing.T) {
	p := Format(Source{TI: "*Arabidopsis* and <strong>rice</strong>"})
	if got, want := PlainText(p), "Arabidopsis and rice."; got != want {
		t.Fatalf("PlainText(Format(src)) = %q, want %q", got, want)
	}
	if !hasStyledText(p.Runs, "Arabidopsis", false, true) || !hasStyledText(p.Runs, "rice", true, false) {
		t.Fatalf("title emphasis was not retained: %#v", p.Runs)
	}
}

func TestImportedCitationUsesTitleFallbackForCompleteMetadata(t *testing.T) {
	src := Source{AU: "Doe, JA", Title: "Fallback title", SO: "Plant Journal", VL: "3", BP: "4", PY: "2024"}
	if !formatReady(src) {
		t.Fatal("complete metadata with Title fallback was not format-ready")
	}
	if got, want := PlainText(Format(src)), "Doe, J. A. Fallback title. Plant Journal 3, 4 (2024)."; got != want {
		t.Fatalf("PlainText(Format(src)) = %q, want %q", got, want)
	}
}

func hasStyledText(runs []Run, text string, bold, italic bool) bool {
	for _, run := range runs {
		if run.Text == text && run.Bold == bold && run.Italic == italic {
			return true
		}
	}
	return false
}
