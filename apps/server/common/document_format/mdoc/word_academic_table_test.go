package mdoc

import (
	"errors"
	"math"
	"strconv"
	"strings"
	"testing"
)

func TestWordTableExceptionalHeaderUsesSplittableSourceRow(t *testing.T) {
	for _, tc := range []struct {
		name    string
		columns int
		cell    []inline
	}{
		{"long text", 2, []inline{{text: strings.Repeat("HEADER ", 1500)}}},
		{"explicit line breaks", 2, []inline{{text: strings.Repeat("LINE\n", 80)}}},
		{"wide glyphs", 2, []inline{{text: strings.Repeat("Ｗ", 1500)}}},
		{"narrow columns", 8, []inline{{text: strings.Repeat("HEADER ", 180)}}},
		{"linked styled text", 2, []inline{{text: strings.Repeat("LINKED ", 1500), href: "https://example.org/header", style: style{bold: true, italic: true}}}},
		{"tall image", 2, []inline{{kind: inlineImage, image: tableTestImage(t, 100, 2000), text: "HEADERIMAGE"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			header := make([][]inline, tc.columns)
			header[0] = tc.cell
			body := make([][]inline, tc.columns)
			body[0] = []inline{{text: "BODYTOKEN"}}
			data, err := RenderCitedWord(Document{blocks: []block{{kind: blockTable, rows: [][][]inline{header, body}}}})
			if err != nil {
				t.Fatal(err)
			}
			parts := wordParts(t, data)
			tree := readWordNode(t, parts["word/document.xml"])
			tables := tree.all(testWordNS, "tbl")
			if len(tables) != 1 {
				t.Fatalf("tables = %d, want one lossless table", len(tables))
			}
			rows := tables[0].all(testWordNS, "tr")
			if len(rows) != 3 {
				t.Fatalf("rows = %d, want compact header + full source header + body", len(rows))
			}
			if rows[0].child("trPr").child("tblHeader") == nil ||
				rows[1].child("trPr").child("tblHeader") != nil ||
				len(tables[0].all(testWordNS, "tblHeader")) != 1 || len(tables[0].all(testWordNS, "cantSplit")) != 0 {
				t.Fatal("only the compact header may repeat; source rows must split")
			}
			if !strings.Contains(rows[0].content(), "Column 1") || !strings.Contains(tree.content(), "Full header follows once") {
				t.Fatal("exceptional header lacks column mapping")
			}
			for _, in := range tc.cell {
				if in.kind != inlineImage && rows[1].content() != in.text {
					t.Fatal("source header text was changed, dropped or duplicated")
				}
			}
			if rows[2].content() != "BODYTOKEN" {
				t.Fatal("body row content changed")
			}
			if tc.name == "linked styled text" {
				links := rows[1].all(testWordNS, "hyperlink")
				if len(links) != 1 || links[0].content() != tc.cell[0].text {
					t.Fatal("full header hyperlink range changed")
				}
				if !strings.Contains(string(parts["word/_rels/document.xml.rels"]), "https://example.org/header") ||
					len(links[0].all(testWordNS, "b")) == 0 || len(links[0].all(testWordNS, "i")) == 0 {
					t.Fatal("full header link target or emphasis changed")
				}
			}
			if tc.name == "tall image" {
				if len(rows[1].all(testWordNS, "drawing")) != 1 {
					t.Fatal("full header image was dropped")
				}
				extents := rows[1].all("http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing", "extent")
				if len(extents) != 1 {
					t.Fatal("full header image extent missing")
				}
				cx, _ := strconv.ParseFloat(extents[0].attr("", "cx"), 64)
				cy, _ := strconv.ParseFloat(extents[0].attr("", "cy"), 64)
				if math.Abs(cx/cy-0.05) > 1e-6 {
					t.Fatal("full header image aspect ratio changed")
				}
				pageHeight := (academicPageHeightMM - 2*academicPageMarginMM) * 72 / 25.4
				if cy/12700*academicLayout(roleCaption).lineMultiple+2*academicWordTableLineHeightPt() > pageHeight {
					t.Fatal("source image leaves no space for repeated compact header and baseline")
				}
			}
		})
	}
}

func TestWordTableOrdinaryMultilineHeaderStillRepeats(t *testing.T) {
	header := []inline{{text: "Ordinary\nmultiline\nheader", style: style{bold: true}}}
	sourceRows := [][][]inline{
		{header, {{text: "Other column"}}},
		{{{text: "BODYTOKEN"}}},
	}
	data, err := RenderCitedWord(Document{blocks: []block{{kind: blockTable, rows: sourceRows}}})
	if err != nil {
		t.Fatal(err)
	}
	tree := readWordNode(t, wordParts(t, data)["word/document.xml"])
	rows := tree.all(testWordNS, "tr")
	if len(rows) != 2 || rows[0].content() != "Ordinary\nmultiline\nheaderOther column" ||
		rows[0].child("trPr").child("tblHeader") == nil || strings.Contains(tree.content(), "Column 1") {
		t.Fatal("ordinary multiline header was replaced or stopped repeating")
	}
}

func TestWordTableHeaderBudgetReservesBodyLine(t *testing.T) {
	pageHeight := (academicPageHeightMM - 2*academicPageMarginMM) * 72 / 25.4
	maxLines := int(math.Floor(pageHeight/academicWordTableLineHeightPt())) - 2
	for _, lines := range []int{maxLines, maxLines + 1} {
		header := [][]inline{{{text: strings.Repeat("LINE\n", lines-1) + "END"}}}
		rows, height, compact, err := academicWordTableRows([][][]inline{header, {{{text: "BODY"}}}}, 1)
		if err != nil {
			t.Fatal(err)
		}
		if compact != (lines > maxLines) {
			t.Fatalf("lines=%d compact=%v: usable height must reserve a body line", lines, compact)
		}
		if height+2*academicWordTableLineHeightPt() > pageHeight || len(rows) != 2+boolWordInt(compact) {
			t.Fatal("repeatable header consumes reserved body capacity")
		}
	}
}

func TestWordTableHeaderBudgetUsesWidthFontAndRunBoundaries(t *testing.T) {
	header := [][]inline{{{text: strings.Repeat("HEADER ", 100)}}}
	if _, _, compact, err := academicWordTableRows([][][]inline{header}, 1); compact || err != nil {
		t.Fatal("wide table header unnecessarily replaced")
	}
	if _, _, compact, err := academicWordTableRows([][][]inline{header}, 8); !compact || err != nil {
		t.Fatal("narrow table ignored actual cell width")
	}
	plain := academicWordCellHeightPt([]inline{{text: "WWWW WWWW"}}, 90)
	wide := academicWordCellHeightPt([]inline{{text: "ＷＷＷＷ ＷＷＷＷ"}}, 90)
	if wide <= plain {
		t.Fatal("wide glyph advance was ignored")
	}
	code := academicWordCellHeightPt([]inline{{text: "WWWW WWWW", style: style{code: true}}}, 85)
	if code >= academicWordCellHeightPt([]inline{{text: "WWWW WWWW"}}, 85) {
		t.Fatal("code font size was ignored")
	}
	unsplit := academicWordCellHeightPt([]inline{{text: "LONGWORD LONGWORD"}}, 100)
	split := academicWordCellHeightPt([]inline{{text: "LONG"}, {text: "WORD LONG", href: "https://example.org/header"}, {text: "WORD", style: style{italic: true}}}, 100)
	if split != unsplit {
		t.Fatal("style/link boundaries changed the same word's width budget")
	}
}

func TestWordTableRejectsImpossibleCompactHeaderGeometry(t *testing.T) {
	for _, columns := range []int{38, 43} {
		header := make([][]inline, columns)
		header[0] = []inline{{text: strings.Repeat("HEADER ", 1500)}}
		data, err := RenderCitedWord(Document{blocks: []block{{kind: blockTable, rows: [][][]inline{header}}}})
		if !errors.Is(err, errAcademicWordTableGeometry) || data != nil {
			t.Fatalf("columns=%d: impossible repeating header produced data=%d err=%v", columns, len(data), err)
		}
	}
}
