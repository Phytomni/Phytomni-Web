package mdoc

import (
	"bytes"
	"math"
	"strconv"
	"strings"
	"testing"
)

func scientificRoleDocument(role reportRole) Document {
	values := []inline{
		{text: "BASE", href: "https://example.org/scientific"},
		{text: "UP", href: "https://example.org/scientific", style: style{bold: true, italic: true, vertical: verticalSuperscript}},
		{text: "DOWN", href: "https://example.org/scientific", style: style{italic: true, vertical: verticalSubscript}},
	}
	return Document{blocks: []block{{kind: blockParagraph, role: role, inlines: values}}}
}

func TestScientificWordNativeScriptsInheritLinkedRole(t *testing.T) {
	for _, role := range []reportRole{roleTitle, roleSection, roleSubsection, roleBody, roleLead, roleReference, roleReferenceLinks, roleCaption} {
		t.Run(strconv.Itoa(int(role)), func(t *testing.T) {
			data, err := RenderCitedWord(scientificRoleDocument(role))
			if err != nil {
				t.Fatal(err)
			}
			parts := wordParts(t, data)
			tree, styles := readWordNode(t, parts["word/document.xml"]), readWordNode(t, parts["word/styles.xml"])
			seen := 0
			for _, p := range tree.all(testWordNS, "p") {
				for _, r := range p.all(testWordNS, "r") {
					text := r.content()
					if text != "BASE" && text != "UP" && text != "DOWN" {
						continue
					}
					seen++
					props := resolvedWordProps(t, styles, p, r, "rPr")
					wantSize := strconv.Itoa(int(academicLayout(role).sizePt * 2))
					if props["sz/val"] != wantSize || props["szCs/val"] != wantSize || props["rFonts/ascii"] != "Times New Roman" {
						t.Errorf("%s role base or font changed: %v, want %s", text, props, wantSize)
					}
					want := ""
					if text == "UP" {
						want = "superscript"
					}
					if text == "DOWN" {
						want = "subscript"
					}
					if props["vertAlign/val"] != want {
						t.Errorf("%s vertical = %s, want %s", text, props["vertAlign/val"], want)
					}
					if text != "BASE" && props["i/val"] != "true" {
						t.Errorf("italic script lost: %v", props)
					}
				}
			}
			if seen != 3 || !bytes.Contains(parts["word/_rels/document.xml.rels"], []byte("https://example.org/scientific")) {
				t.Fatal("linked script text or relationship lost")
			}
		})
	}
}

func TestScientificPDFScriptsUseRoleGeometryWithoutCitationTargets(t *testing.T) {
	fonts := requireAcademicFonts(t)
	for _, role := range []reportRole{roleTitle, roleSection, roleSubsection, roleBody, roleLead, roleReference, roleReferenceLinks, roleCaption} {
		t.Run(strconv.Itoa(int(role)), func(t *testing.T) {
			data, err := RenderCitedPDF(scientificRoleDocument(role), fonts)
			if err != nil {
				t.Fatal(err)
			}
			items := academicPDFText(t, data)
			base, up, down := findPDFText(t, items, "BASE"), findPDFText(t, items, "UP"), findPDFText(t, items, "DOWN")
			size := academicLayout(role).sizePt
			if base.size != size || math.Abs(up.size-size*2/3) > .02 || math.Abs(down.size-size*2/3) > .02 || math.Abs(up.y-base.y-size/4) > .02 || math.Abs(down.y-base.y+size/4) > .02 {
				t.Fatalf("ordinary scripts not role-relative: base=%+v up=%+v down=%+v", base, up, down)
			}
			if bytes.Contains(data, []byte("/Dest [")) || bytes.Count(data, []byte("/Subtype /Link")) != 3 {
				t.Fatal("script target identity differs from its authored outer link")
			}
		})
	}
}

func TestScientificPDFTableMeasuresSubscriptDescent(t *testing.T) {
	runs := []pdfFragment{{text: "BASE", sizePt: 10}, {text: "DOWN", sizePt: 10.0 * 2 / 3, risePt: -2.5}}
	rows, err := planPDFTableRows([][][]pdfFragment{{runs}}, nil, 160, runePDFMeasure)
	if err != nil {
		t.Fatal(err)
	}
	want := (10+10.0*2/3*.2+2.5)*pdfPtMM + 2*pdfTablePaddingMM
	if math.Abs(rows[0].heightMM-want) > 1e-9 {
		t.Fatalf("lowered glyph extends beyond fixed row: height %.5f, want %.5f", rows[0].heightMM, want)
	}
}

func TestScientificDecodedLineEndingsRenderInBothWriters(t *testing.T) {
	for _, entity := range []string{"&#10;", "&#13;", "&#13;&#10;"} {
		doc, err := BuildCited("H<sub>FIRST"+entity+"SECOND</sub>O", nil, Options{})
		if err != nil {
			t.Fatal(err)
		}
		word, err := RenderCitedWord(doc)
		if err != nil {
			t.Fatal(err)
		}
		xml := wordDocumentXML(t, word)
		if strings.Count(xml, "<w:br") != 1 {
			t.Errorf("%s must make one Word break: %s", entity, xml)
		}
		pdf, err := RenderCitedPDF(doc, requireAcademicFonts(t))
		if err != nil {
			t.Fatalf("%s: %v", entity, err)
		}
		items := academicPDFText(t, pdf)
		first, second := findPDFText(t, items, "FIRST"), findPDFText(t, items, "SECOND")
		if first.page != second.page || first.y <= second.y {
			t.Errorf("%s line endings did not flow: %+v %+v", entity, first, second)
		}
	}
}

func TestScientificTableSplitConsumesMeasuredHeights(t *testing.T) {
	runs := []pdfFragment{{text: "BASE", sizePt: 10}, {text: "DOWN\n", sizePt: 10.0 * 2 / 3, risePt: -2.5}, {text: "BASE", sizePt: 10}, {text: "DOWN", sizePt: 10.0 * 2 / 3, risePt: -2.5}}
	rows, err := planPDFTableRows([][][]pdfFragment{{runs}}, nil, 160, runePDFMeasure)
	if err != nil {
		t.Fatal(err)
	}
	budget := 2*pdfTableLineHeight() + 2*pdfTablePaddingMM
	head, tail := splitPDFTableRow(rows[0], budget)
	if len(head.cells[0].lines) != 1 || len(tail.cells[0].lines) != 1 || head.heightMM > budget {
		t.Fatalf("fixed line-count budget clipped a lowered row: head=%+v tail=%+v", head, tail)
	}
}

func TestScientificActualTableScriptsRemainCompleteAcrossPages(t *testing.T) {
	source := "| Head | Other |\n|--|--|\n| " + strings.Repeat("BASE<sub>LOW</sub><sup>UP</sup> ", 1000) + " | [H<sub>2</sub>O](https://example.org/cell) |"
	doc, err := BuildCited(source, nil, Options{})
	if err != nil {
		t.Fatal(err)
	}
	data, err := RenderCitedPDF(doc, requireAcademicFonts(t))
	if err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	pages := map[int]bool{}
	for _, item := range academicPDFText(t, data) {
		counts[item.text]++
		if item.text == "LOW" || item.text == "UP" {
			pages[item.page] = true
			if math.Abs(item.size-10.0*2/3) > .02 || item.y-item.size*.2 < 25*72/25.4-.02 || item.y+item.size > 272*72/25.4+.02 {
				t.Fatalf("script out of printable area: %+v", item)
			}
		}
	}
	if counts["BASE"] != 1000 || counts["LOW"] != 1000 || counts["UP"] != 1000 || len(pages) < 2 {
		t.Fatalf("scientific table text lost or clipped: %v pages %v", counts, pages)
	}
	assertPDFTableRectangles(t, data, 25)
	word, err := RenderCitedWord(doc)
	if err != nil {
		t.Fatal(err)
	}
	parts := wordParts(t, word)
	tree, styles := readWordNode(t, parts["word/document.xml"]), readWordNode(t, parts["word/styles.xml"])
	for _, table := range tree.all(testWordNS, "tbl") {
		for _, p := range table.all(testWordNS, "p") {
			for _, r := range p.all(testWordNS, "r") {
				if r.content() != "LOW" && r.content() != "UP" && r.content() != "2" {
					continue
				}
				props := resolvedWordProps(t, styles, p, r, "rPr")
				if props["sz/val"] != "20" || props["vertAlign/val"] == "" {
					t.Fatalf("native table script base lost: %v", props)
				}
			}
		}
	}
}
