package mdoc

import (
	"bytes"
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"

	"phytomni-server/common/citation"
)

func TestScientificCanonicalReferenceRunsReachAcademicWriters(t *testing.T) {
	rows, err := citation.DecodeRows(json.RawMessage(`[{"formatted_citation":"BASE<sup>UP</sup> BODY<sub>DOWN</sub> <sup>***BOTH***</sup>."}]`))
	if err != nil {
		t.Fatal(err)
	}
	doc, err := BuildCited("A plain report body.", rows, Options{})
	if err != nil {
		t.Fatal(err)
	}
	word, err := RenderCitedWord(doc)
	if err != nil {
		t.Fatal(err)
	}
	parts := wordParts(t, word)
	tree, styles := readWordNode(t, parts["word/document.xml"]), readWordNode(t, parts["word/styles.xml"])
	want := map[string]string{"UP": "superscript", "DOWN": "subscript", "BOTH": "superscript"}
	seen := map[string]string{}
	for _, paragraph := range tree.all(testWordNS, "p") {
		for _, run := range paragraph.all(testWordNS, "r") {
			value := run.content()
			vertical, exists := want[value]
			if !exists {
				continue
			}
			props := resolvedWordProps(t, styles, paragraph, run, "rPr")
			if props["sz/val"] != "24" || props["vertAlign/val"] != vertical || props["rFonts/ascii"] != "Times New Roman" {
				t.Fatalf("canonical reference script lost native base/position/font: %s %v", value, props)
			}
			if value == "BOTH" && (props["b/val"] != "true" || props["i/val"] != "true") {
				t.Fatalf("canonical reference composed emphasis lost: %v", props)
			}
			seen[value] = vertical
		}
	}
	if !reflect.DeepEqual(seen, want) || bytes.Contains(parts["word/document.xml"], []byte("w:anchor=")) {
		t.Fatalf("reference scripts lost or inferred as citation links: %v", seen)
	}
	pdf, err := RenderCitedPDF(doc, requireAcademicFonts(t))
	if err != nil {
		t.Fatal(err)
	}
	items := academicPDFText(t, pdf)
	base, up, down, both := findPDFText(t, items, "BASE"), findPDFText(t, items, "UP"), findPDFText(t, items, "DOWN"), findPDFText(t, items, "BOTH")
	if base.size != 12 || up.size != 8 || down.size != 8 || both.size != 8 || math.Abs(up.y-base.y-3) > .02 || math.Abs(down.y-base.y+3) > .02 {
		t.Fatalf("reference PDF script geometry: base=%+v up=%+v down=%+v both=%+v", base, up, down, both)
	}
	if bytes.Contains(pdf, []byte("/Subtype /Link")) {
		t.Fatal("ordinary reference scripts became internal citation links")
	}
}

func TestScientificCanonicalReferenceMarkdownRetainsDecodedLineEndings(t *testing.T) {
	for _, tag := range []string{"sup", "sub"} {
		for _, entity := range []string{"&#10;", "&#13;", "&#13;&#10;"} {
			t.Run(tag+entity, func(t *testing.T) {
				source := citation.Source{Formatted: "BASE<" + tag + ">***FIRST" + entity + "SECOND***</" + tag + ">END"}
				presentation := citation.Format(source)
				raw := citation.Markdown(presentation)
				if strings.ContainsAny(raw, "\r\n") || !strings.Contains(raw, entity) {
					t.Fatalf("canonical script became an invalid cross-line wrapper: %q", raw)
				}
				// Exercise both canonical IR projection and a fresh Markdown parse;
				// equality alone would miss a common producer/consumer formatting loss.
				for _, canonical := range []bool{true, false} {
					var doc Document
					var err error
					if canonical {
						doc, err = BuildCited("Report body.", []citation.Row{{Source: source, Citation: presentation}}, Options{})
					} else {
						doc, err = BuildCited(raw, nil, Options{})
					}
					if err != nil {
						t.Fatal(err)
					}
					word, err := RenderCitedWord(doc)
					if err != nil {
						t.Fatal(err)
					}
					xml := wordDocumentXML(t, word)
					if strings.Count(xml, "<w:br") != 1 || !strings.Contains(xml, "FIRST") || !strings.Contains(xml, "SECOND") {
						t.Fatalf("Word canonical=%t lost line/text: %s", canonical, xml)
					}
					pdf, err := RenderCitedPDF(doc, requireAcademicFonts(t))
					if err != nil {
						t.Fatal(err)
					}
					items := academicPDFText(t, pdf)
					first, second := findPDFText(t, items, "FIRST"), findPDFText(t, items, "SECOND")
					if first.size != 8 || second.size != 8 || first.y <= second.y || first.page != second.page {
						t.Fatalf("PDF canonical=%t lost script/line flow: %+v %+v", canonical, first, second)
					}
				}
			})
		}
	}
}

func TestScientificCanonicalReferenceMarkdownDoesNotDecodeLiteralEntitiesTwice(t *testing.T) {
	for _, value := range []string{"&lt;sup&gt;", "&amp;lt;sup&amp;gt;", "&#10;", "<sup>2</sup>", "[2]"} {
		presentation := citation.Presentation{Runs: []citation.Run{{Text: "BASE"}, {Text: value, Italic: true, Vertical: citation.VerticalSuperscript}, {Text: "END"}}}
		raw := citation.Markdown(presentation)
		doc, err := BuildCited(raw, nil, Options{})
		if err != nil {
			t.Fatal(err)
		}
		var script strings.Builder
		for _, paragraph := range doc.blocks {
			for _, run := range paragraph.inlines {
				if run.style.vertical == verticalSuperscript {
					script.WriteString(run.text)
					if !run.style.italic || run.citation != nil {
						t.Fatalf("canonical script emphasis/identity lost: %+v", run)
					}
				}
			}
		}
		if script.String() != value {
			t.Errorf("literal reference value %q became %q through Markdown %q", value, script.String(), raw)
		}
	}
}
