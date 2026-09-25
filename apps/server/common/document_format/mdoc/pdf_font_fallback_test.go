package mdoc

import (
	"errors"
	"math"
	"strings"
	"testing"
)

func TestPDFFontFallbackKeepsCitedDownloadsAlive(t *testing.T) {
	complete := requireAcademicFonts(t)
	for _, tc := range []struct {
		name  string
		text  string
		fonts AcademicFonts
	}{
		{name: "unicode scripts", text: "GA₂₀ GA₁ 10⁻⁶", fonts: complete},
		{name: "missing regular TNR", fonts: AcademicFonts{}},
		{name: "unknown BMP rune", text: "rare ͸", fonts: complete},
		{name: "supplementary rune", text: "rare 😀", fonts: complete},
	} {
		t.Run(tc.name, func(t *testing.T) {
			text := tc.text
			if text == "" {
				text = "ASCII"
			}
			doc := Document{blocks: []block{{kind: blockParagraph, role: roleLead, inlines: []inline{{text: text}}}}}
			data, err := RenderCitedPDF(doc, tc.fonts)
			if err != nil || len(data) == 0 || errors.Is(err, errAcademicPDFGlyph) {
				t.Fatalf("RenderCitedPDF: data=%d err=%v", len(data), err)
			}
			items := academicPDFText(t, data)
			switch tc.name {
			case "unicode scripts":
				size := academicLayout(roleLead).sizePt
				base := findPDFText(t, items, "GA")
				down := findPDFText(t, items, "20")
				up := findPDFText(t, items, "-6")
				if base.size != size || math.Abs(down.size-size*2/3) > .02 || math.Abs(up.size-size*2/3) > .02 || math.Abs(down.y-base.y+size/4) > .02 || math.Abs(up.y-base.y-size/4) > .02 {
					t.Fatalf("ASCII script digits lost raised/lowered geometry: base=%+v down=%+v up=%+v", base, down, up)
				}
			case "unknown BMP rune":
				if !pdfPaintedContains(items, `\u{0378}`) {
					t.Fatalf("missing lossless escape: %+v", items)
				}
			case "supplementary rune":
				if !pdfPaintedContains(items, `\u{1F600}`) {
					t.Fatalf("missing lossless escape: %+v", items)
				}
			default:
				findPDFText(t, items, text)
			}
		})
	}
}

func TestPDFFontFallbackInvalidUTF8RemainsControlled(t *testing.T) {
	bad := string([]byte{255})
	data, err := RenderCitedPDF(Document{blocks: []block{{kind: blockParagraph, inlines: []inline{{text: bad}}}}}, requireAcademicFonts(t))
	if err == nil || data != nil || !errors.Is(err, errAcademicPDFGlyph) || strings.Contains(err.Error(), bad) {
		t.Fatal("invalid UTF-8 did not produce safe error")
	}
}
