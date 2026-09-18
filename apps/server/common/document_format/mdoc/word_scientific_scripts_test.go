package mdoc

import (
	"strings"
	"testing"
)

const wordScientificSource = "# Plant hormones\n\nGibberellin GA₂₀ and GA₁ act at 10⁻⁶ M. Water is H<sub>2</sub>O and iron is Fe<sup>3+</sup>. The *OsD18* gene remains italic [1]."

type wordScientificWant struct {
	before   string
	text     string
	vertical string
	italic   bool
}

func TestWordScientificScriptsUseNativeVertAlign(t *testing.T) {
	rows := citedRows(t, `[{"title":"A plant study"}]`)
	source := wordScientificSource
	doc, err := BuildCited(source, rows, Options{})
	if err != nil {
		t.Fatal(err)
	}
	data, err := RenderCitedWord(doc)
	if err != nil {
		t.Fatal(err)
	}
	xmlBody := wordDocumentXML(t, data)
	if !strings.Contains(xmlBody, "vertAlign") {
		t.Fatal("DOCX omitted w:vertAlign")
	}
	for _, keep := range []string{"GA₂₀", "GA₁", "10⁻⁶"} {
		if strings.Contains(xmlBody, keep) {
			t.Fatalf("DOCX kept Unicode %q instead of native vertical runs", keep)
		}
	}

	parts := wordParts(t, data)
	tree := readWordNode(t, parts["word/document.xml"])
	styles := readWordNode(t, parts["word/styles.xml"])
	wants := []wordScientificWant{
		{before: "Gibberellin GA", text: "20", vertical: "subscript"},
		{before: " and GA", text: "1", vertical: "subscript"},
		{before: " act at 10", text: "-6", vertical: "superscript"},
		{before: "Water is H", text: "2", vertical: "subscript"},
		{before: "iron is Fe", text: "3+", vertical: "superscript"},
		{before: "The ", text: "OsD18", italic: true},
	}
	matched := make([]bool, len(wants))
	var visible strings.Builder
	for _, p := range tree.all(testWordNS, "p") {
		for _, r := range p.all(testWordNS, "r") {
			value := r.content()
			if value == "" {
				continue
			}
			props := resolvedWordProps(t, styles, p, r, "rPr")
			if props["rFonts/ascii"] != "Times New Roman" {
				t.Fatalf("body run %q omitted Times New Roman: %v", value, props)
			}
			before := visible.String()
			for i, want := range wants {
				if matched[i] || !strings.HasSuffix(before, want.before) || value != want.text {
					continue
				}
				if want.vertical != "" {
					direct := r.child("rPr").child("vertAlign")
					if direct == nil || direct.attr(testWordNS, "val") != want.vertical {
						t.Fatalf("DOCX run %q missing native w:vertAlign=%s", want.text, want.vertical)
					}
					if props["vertAlign/val"] != want.vertical {
						t.Fatalf("DOCX run %q vertical=%q want %q", want.text, props["vertAlign/val"], want.vertical)
					}
				}
				if want.italic && props["i/val"] != "true" {
					t.Fatalf("italic gene lost: %v", props)
				}
				matched[i] = true
			}
			visible.WriteString(value)
		}
	}
	for i, want := range wants {
		if !matched[i] {
			t.Fatalf("missing Word run %q after %q in %q", want.text, want.before, visible.String())
		}
	}

	md, err := CitedMarkdown(source, rows)
	if err != nil {
		t.Fatal(err)
	}
	if source != wordScientificSource {
		t.Fatal("source string was rewritten")
	}
	for _, keep := range []string{"GA₂₀", "GA₁", "10⁻⁶", "H<sub>2</sub>O", "Fe<sup>3+</sup>", "*OsD18*"} {
		if !strings.Contains(md, keep) || !strings.Contains(source, keep) {
			t.Fatalf("Markdown or source lost Unicode/HTML %q", keep)
		}
	}
	for _, sub := range []string{"GA20", "10-6"} {
		if strings.Contains(md, sub) || strings.Contains(source, sub) {
			t.Fatalf("Markdown substituted ASCII %q", sub)
		}
	}
}
