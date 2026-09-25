package mdoc

import (
	"math"
	"strings"
	"testing"
	"unicode/utf8"
)

func runePDFMeasure(s string, _ style, _ float64) float64 { return float64(utf8.RuneCountInString(s)) }

// These tests catch text loss, byte splitting, and wrap loops with no progress.
func TestPDFWrapConsumesLongTokens(t *testing.T) {
	text := strings.Repeat("A", 1000)
	lines, err := wrapPDFRuns([]pdfFragment{{text: text, sizePt: 12}}, 20, 20, runePDFMeasure)
	if err != nil {
		t.Fatal(err)
	}
	var got strings.Builder
	for _, l := range lines {
		if l.widthMM > 20.001 {
			t.Fatal("overflow")
		}
		for _, f := range l.fragments {
			got.WriteString(f.fragment.text)
		}
	}
	if got.String() != text || len(lines) != 50 {
		t.Fatal("lost or repeated source")
	}
}

func TestPDFWrapPreservesRunsWhitespaceAndBreaks(t *testing.T) {
	runs := []pdfFragment{{text: "ab ", sizePt: 12}, {text: "中é", style: style{italic: true}, sizePt: 8, risePt: 3, href: "https://example.org", target: 2}, {text: "  xy\n\nZ", sizePt: 12}}
	lines, err := wrapPDFRuns(runs, 4, 5, runePDFMeasure)
	if err != nil {
		t.Fatal(err)
	}
	var got strings.Builder
	for _, l := range lines {
		for _, p := range l.fragments {
			got.WriteString(p.fragment.text)
			if strings.ContainsAny(p.fragment.text, "中é") && (p.fragment.style != runs[1].style || p.fragment.sizePt != 8 || p.fragment.risePt != 3 || p.fragment.href != runs[1].href || p.fragment.target != 2) {
				t.Fatal("split metadata lost")
			}
		}
	}
	if got.String() != "ab 中é  xy\n\nZ" {
		t.Fatalf("source changed: %q", got.String())
	}
	if lines[0].widthMM != 3 || !lines[len(lines)-1].last {
		t.Fatal("word boundaries or final line lost")
	}
}

func TestPDFWrapRejectsInvalidWidthsAndOversizedGlyph(t *testing.T) {
	for _, width := range []float64{0, -1, math.NaN(), math.Inf(1)} {
		if _, err := wrapPDFRuns(nil, width, 10, runePDFMeasure); err == nil {
			t.Fatal("invalid width accepted")
		}
	}
	if _, err := wrapPDFRuns([]pdfFragment{{text: "中"}}, 0.5, 0.5, runePDFMeasure); err == nil {
		t.Fatal("oversized glyph accepted")
	}
	if _, err := wrapPDFRuns([]pdfFragment{{text: "x"}}, 1, 1, func(string, style, float64) float64 { return math.NaN() }); err == nil {
		t.Fatal("invalid measure accepted")
	}
}

func TestPDFWrapKeepsWordsAcrossStyleBoundaries(t *testing.T) {
	lines, err := wrapPDFRuns([]pdfFragment{{text: "abc "}, {text: "de"}, {text: "fg", style: style{bold: true}}}, 6, 6, runePDFMeasure)
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != 2 || lines[0].widthMM != 4 || lines[1].widthMM != 4 {
		t.Fatalf("styled word split: %+v", lines)
	}
}

func TestPDFWrapJustificationDoesNotStretchInlineCodeSpaces(t *testing.T) {
	lines, err := wrapPDFRuns([]pdfFragment{{text: "a b", style: style{code: true}}, {text: " tail end"}}, 8, 8, runePDFMeasure)
	if err != nil {
		t.Fatal(err)
	}
	line := justifyPDFLine(lines[0], 12)
	for _, p := range line.fragments {
		if p.fragment.style.code && p.fragment.text == " " && p.widthMM != 1 {
			t.Fatal("inline code whitespace stretched")
		}
	}
}

func TestPDFWrapUsesContinuationWidthWithoutTextLoss(t *testing.T) {
	for _, source := range []string{"甲乙éα xyz  abc\nend", "a\n\n", strings.Repeat("中", 70), " ", ""} {
		lines, err := wrapPDFRuns([]pdfFragment{{text: source, sizePt: 12}}, 3, 7, runePDFMeasure)
		if err != nil {
			t.Fatal(err)
		}
		var got strings.Builder
		for i, line := range lines {
			limit := 7.0
			if i == 0 {
				limit = 3
			}
			if line.widthMM > limit {
				t.Fatal("continuation width ignored")
			}
			for _, p := range line.fragments {
				got.WriteString(p.fragment.text)
			}
		}
		if got.String() != source {
			t.Fatalf("source changed: %q", source)
		}
	}
}

func TestPDFWrapLongTokenMeasurementIsBounded(t *testing.T) {
	source := strings.Repeat("A", 10000)
	measured := 0
	_, err := wrapPDFRuns([]pdfFragment{{text: source}}, 20, 20, func(s string, _ style, _ float64) float64 {
		n := utf8.RuneCountInString(s)
		measured += n
		return float64(n)
	})
	if err != nil {
		t.Fatal(err)
	}
	if measured > 20*len(source) {
		t.Fatalf("repeatedly measured entire unconsumed tail: %d", measured)
	}
}
