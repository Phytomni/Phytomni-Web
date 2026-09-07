package mdoc

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

type scientificTestRun struct {
	Text     string           `json:"text"`
	Bold     bool             `json:"bold,omitempty"`
	Italic   bool             `json:"italic,omitempty"`
	Vertical verticalPosition `json:"vertical,omitempty"`
	Href     string           `json:"href,omitempty"`
	Code     bool             `json:"code,omitempty"`
}

func TestScientificInlineSharedGrammar(t *testing.T) {
	raw, err := os.ReadFile("../testdata/scientific-inline-grammar.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name, Source    string
		Runs            []scientificTestRun
		CitationIndices [][]int `json:"citationIndices"`
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			for _, count := range []int{0, 3} {
				rows := citedRows(t, `[{"title":"First"},{"title":"Second"},{"title":"Third"}]`)[:count]
				doc, err := BuildCited(fixture.Source, rows, Options{})
				if err != nil {
					t.Fatal(err)
				}
				runs := []scientificTestRun{}
				for _, b := range doc.blocks {
					if b.role == roleReference || b.role == roleReferenceLinks || plainText(b.inlines) == "References" {
						break
					}
					for _, in := range b.inlines {
						run := scientificTestRun{in.text, in.style.bold, in.style.italic, in.style.vertical, in.href, in.style.code}
						if run.Text == "" {
							continue
						}
						if len(runs) > 0 {
							last := &runs[len(runs)-1]
							compare := *last
							compare.Text = run.Text
							if compare == run {
								last.Text += run.Text
								continue
							}
						}
						runs = append(runs, run)
					}
				}
				if !reflect.DeepEqual(runs, fixture.Runs) {
					t.Errorf("count %d runs: %#v want %#v", count, runs, fixture.Runs)
				}
				indices := [][]int{}
				for _, mark := range citationMarks(doc.blocks) {
					indices = append(indices, mark.indices)
				}
				if !reflect.DeepEqual(indices, fixture.CitationIndices) {
					t.Errorf("count %d citations: %v want %v", count, indices, fixture.CitationIndices)
				}
			}
		})
	}
}

func TestOrdinaryScientificScriptsDoNotInferCitations(t *testing.T) {
	doc, err := BuildCited("x<sup>2</sup> H<sub>2</sub>O <sup>[2]</sup> [2]", citedRows(t, `[{"title":"First"},{"title":"Second"}]`), Options{})
	if err != nil {
		t.Fatal(err)
	}
	marks := citationMarks(doc.blocks)
	if len(marks) != 1 || len(marks[0].indices) != 1 || marks[0].indices[0] != 2 {
		t.Fatalf("ordinary scripts acquired citation identity: %+v", marks)
	}
	if got := plainText(doc.blocks[0].inlines); got != "x2 H2O [2] 2" {
		t.Fatalf("scientific text changed: %q", got)
	}
}

func TestOrdinaryScientificScriptsAreCitedOnly(t *testing.T) {
	source := "x<sup>2</sup> H<sub>2</sub>O <i>FLC</i>"
	blocks, err := parse(source, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if got := plainText(blocks[0].inlines); got != "x2 H2O FLC" {
		t.Fatalf("ordinary Chat parsing changed: %q", got)
	}
	for _, in := range blocks[0].inlines {
		if in.citation != nil || in.style.italic {
			t.Fatal("ordinary Chat unexpectedly enabled scientific formatting")
		}
	}
}

func TestRejectedScientificBlockRetainsVisibleSource(t *testing.T) {
	source := "<sup>\n2\n</sup>"
	doc, err := BuildCited(source, nil, Options{})
	if err != nil {
		t.Fatal(err)
	}
	var got strings.Builder
	for _, b := range doc.blocks {
		got.WriteString(plainText(b.inlines))
	}
	if got.String() != source {
		t.Fatalf("rejected scientific block lost: %q", got.String())
	}
}

func TestScientificMalformedRecoveryAndContainerBoundaries(t *testing.T) {
	for _, tc := range []struct {
		source string
		marks  [][]int
	}{
		{"<sup>2 [2]\nOutside [3]", [][]int{{3}}},
		{"<sup>2</sub> [2]", [][]int{{2}}},
		{"<sup><sub>2</sub></sup> [3]", [][]int{{3}}},
		{"<sup class=\"x\">2</sup> [2]", [][]int{{2}}},
		{"<sup onmouseover=\"x\"onclick=\"y\">[2]</sup> [3]", [][]int{{3}}},
		{"<sup onmouseover=\"x\"class=\"y\">[2]</sup> [3]", [][]int{{3}}},
		{"<sup>*First [2]\nOutside [3]*", [][]int{{3}}},
		{"x<sup>2\n3</sup> [2]", [][]int{{2}}},
		{"<sup>*2</sup>* [3]", [][]int{{3}}},
		{"<sup>$[2]$</sup> [3]", [][]int{{3}}},
		{"<sup>[label](https://example.org)</sup> [3]", [][]int{{3}}},
		{"| First | Second |\n|--|--|\n| <sup>2 | 3</sup> [2] |", [][]int{{2}}},
	} {
		t.Run(tc.source, func(t *testing.T) {
			doc, err := BuildCited(tc.source, nil, Options{})
			if err != nil {
				t.Fatal(err)
			}
			indices := [][]int{}
			for _, mark := range citationMarks(doc.blocks) {
				indices = append(indices, mark.indices)
			}
			if !reflect.DeepEqual(indices, tc.marks) {
				t.Fatalf("recovery citations %v want %v", indices, tc.marks)
			}
			var visit func([]block)
			check := func(values []inline) {
				for _, in := range values {
					if in.style.vertical != verticalBaseline {
						t.Errorf("rejected candidate partly activated: %+v", in)
					}
				}
			}
			visit = func(blocks []block) {
				for _, b := range blocks {
					check(b.inlines)
					for _, row := range b.rows {
						for _, cell := range row {
							check(cell)
						}
					}
					visit(b.children)
					for _, item := range b.items {
						visit(item)
					}
				}
			}
			visit(doc.blocks)
		})
	}
}

func TestScientificUnclosedGluedAttributesRecoverAtPhysicalLine(t *testing.T) {
	for _, name := range []string{"sup", "sub", "i", "em"} {
		t.Run(name, func(t *testing.T) {
			for _, suffix := range []string{"[2]\nOutside [3]", "[2]</" + name + "> Same [3]"} {
				source := "<" + name + " onmouseover=\"x\"class=\"y\">" + suffix + "\n\nControl [2]"
				doc, err := BuildCited(source, nil, Options{})
				if err != nil {
					t.Fatal(err)
				}
				indices := [][]int{}
				for _, mark := range citationMarks(doc.blocks) {
					indices = append(indices, mark.indices)
				}
				if !reflect.DeepEqual(indices, [][]int{{3}, {2}}) {
					t.Errorf("source %q: %v, want [[3] [2]]", source, indices)
				}
				if got := plainText(doc.blocks[0].inlines); !strings.Contains(got, "<"+name+" onmouseover=\"x\"class=\"y\">[2]") {
					t.Errorf("rejected source text changed: %q", got)
				}
			}
		})
	}
}

func TestScientificMalformedSourceDoesNotEscapeProtectedContexts(t *testing.T) {
	for _, name := range []string{"sup", "sub", "i", "em"} {
		opening := "<" + name + " onmouseover=\"x\"class=\"y\">"
		for _, tc := range []struct {
			source  string
			indices [][]int
		}{
			{"\\" + opening + "[2]\nOutside [3]", [][]int{{2}, {3}}},
			{"&lt;" + opening[1:len(opening)-1] + "&gt;[2]\nOutside [3]", [][]int{{2}, {3}}},
			{"Before <span>" + opening + "[2]\nOutside [3]</span> [2]", [][]int{{2}}},
			{"`" + opening + "[2]` [3]", [][]int{{3}}},
			{"$" + opening + "[2]$ [3]", [][]int{{3}}},
		} {
			doc, err := BuildCited(tc.source, nil, Options{})
			if err != nil {
				t.Fatal(err)
			}
			indices := [][]int{}
			for _, mark := range citationMarks(doc.blocks) {
				indices = append(indices, mark.indices)
			}
			if !reflect.DeepEqual(indices, tc.indices) {
				t.Errorf("source %q: %v want %v", tc.source, indices, tc.indices)
			}
		}
	}
}

func TestScientificEscapedEntityIsDecodedOnlyFromOriginalSource(t *testing.T) {
	for _, tc := range []struct{ source, want string }{
		{`\&lt;sup\&gt;`, "&lt;sup&gt;"},
		{`\&amp;lt;sup\&amp;gt;`, "&amp;lt;sup&amp;gt;"},
		{`\&#10;`, "&#10;"},
		{`&lt;sup&gt;`, "<sup>"},
		{`&amp;lt;sup&amp;gt;`, "&lt;sup&gt;"},
	} {
		for _, wrapper := range []string{"", "sup", "i"} {
			source := tc.source
			if wrapper != "" {
				source = "<" + wrapper + ">" + source + "</" + wrapper + ">"
			}
			doc, err := BuildCited(source, nil, Options{})
			if err != nil {
				t.Fatal(err)
			}
			if got := plainText(doc.blocks[0].inlines); got != tc.want {
				t.Errorf("%q became %q, want %q", source, got, tc.want)
			}
		}
	}
}

func TestScientificRejectedSpanClosesEnclosingRawWrapper(t *testing.T) {
	for _, name := range []string{"sup", "sub", "i", "em"} {
		for _, attrs := range []string{"", ` onmouseover="x"class="y"`} {
			for _, wrappers := range []struct{ opening, closing string }{
				{"<span>", "</span>"},
				{"<span><b>", "</b></span>"},
			} {
				source := "Before " + wrappers.opening + "<" + name + attrs + ">[2]" + wrappers.closing + "\nOutside <sub>3</sub> [3]"
				doc, err := BuildCited(source, nil, Options{})
				if err != nil {
					t.Fatal(err)
				}
				indices := [][]int{}
				for _, mark := range citationMarks(doc.blocks) {
					indices = append(indices, mark.indices)
				}
				if !reflect.DeepEqual(indices, [][]int{{3}}) {
					t.Errorf("source %q: %v want [[3]]", source, indices)
				}
				found := false
				for _, in := range doc.blocks[0].inlines {
					found = found || in.text == "3" && in.style.vertical == verticalSubscript
				}
				if !found {
					t.Errorf("source %q: following subscript did not recover", source)
				}
			}
		}
	}
}

func TestScientificRejectedNestedRawWrapperCannotCloseItsOuterPeer(t *testing.T) {
	for _, source := range []string{
		"Before <span><sup><span>[2]</span>\nInside [3]</span> [2]",
		"Before <span><sup><span>[2]</span></span>\nOutside [2]",
		"Before <sup><span>[2]\nOutside [2]",
	} {
		doc, err := BuildCited(source, nil, Options{})
		if err != nil {
			t.Fatal(err)
		}
		indices := [][]int{}
		for _, mark := range citationMarks(doc.blocks) {
			indices = append(indices, mark.indices)
		}
		if !reflect.DeepEqual(indices, [][]int{{2}}) {
			t.Errorf("source %q: %v want [[2]]", source, indices)
		}
	}
}

func TestScientificUnclosedCandidateRecoversStylesInsideMultilineEmphasis(t *testing.T) {
	for _, name := range []string{"sup", "sub", "i", "em"} {
		for _, boundary := range []string{"\n", "</sub> ", "</" + name + "> "} {
			source := "<" + name + ">*First [2]" + boundary + "Outside <sub>3</sub> [3]*"
			doc, err := BuildCited(source, nil, Options{})
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, in := range doc.blocks[0].inlines {
				found = found || in.text == "3" && in.style.italic && in.style.vertical == verticalSubscript
			}
			if !found {
				t.Errorf("source %q: following italic subscript did not recover", source)
			}
			indices := [][]int{}
			for _, mark := range citationMarks(doc.blocks) {
				indices = append(indices, mark.indices)
			}
			if !reflect.DeepEqual(indices, [][]int{{3}}) {
				t.Errorf("source %q: %v want [[3]]", source, indices)
			}
		}
	}
}
