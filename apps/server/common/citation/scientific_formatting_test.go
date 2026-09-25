package citation

import (
	"bytes"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"
)

func scientificRuns(t *testing.T, raw string) []Run {
	t.Helper()
	var runs []Run
	if err := json.Unmarshal([]byte(raw), &runs); err != nil {
		t.Fatal(err)
	}
	return runs
}

func TestScientificCitationImport(t *testing.T) {
	tests := []struct{ name, source, want string }{
		{"upper and lower", "x<sup>2</sup> H<sub>2</sub>O", `[{"text":"x"},{"text":"2","vertical":"superscript"},{"text":" H"},{"text":"2","vertical":"subscript"},{"text":"O"}]`},
		{"composed", "<I>x<sub>i</sub></I> <sup>***n***</sup>", `[{"text":"x","italic":true},{"text":"i","italic":true,"vertical":"subscript"},{"text":" "},{"text":"n","bold":true,"italic":true,"vertical":"superscript"}]`},
		{"numeric punctuation", "<sup>01, [2]-3</sup>", `[{"text":"01, [2]-3","vertical":"superscript"}]`},
		{"entities", "<sub>2&#10;3&#13;4&#13;&#10;5 &amp;lt;sup&amp;gt;</sub>", `[{"text":"2\n3\r4\r\n5 &lt;sup&gt;","vertical":"subscript"}]`},
		{"escaped", `\<sup>2</sup> &lt;sub&gt;3&lt;/sub&gt;`, `[{"text":"<sup>2</sup> <sub>3</sub>"}]`},
		{"nested", "<sup><sub>2</sub></sup> after", `[{"text":"<sup><sub>2</sub></sup> after"}]`},
		{"uppercase", "<SUP>2</SUP> after", `[{"text":"<SUP>2</SUP> after"}]`},
		{"attributes", "<sup class=\"x\">2</sup> after", `[{"text":"<sup class=\"x\">2</sup> after"}]`},
		{"glued attributes reject nested script", "<sup onmouseover=\"x\"class=\"y\"><sub>2</sub></sup> <sub>3</sub>", `[{"text":"<sup onmouseover=\"x\"class=\"y\"><sub>2</sub></sup> "},{"text":"3","vertical":"subscript"}]`},
		{"glued attributes newline recovery", "<sup onmouseover=\"x\"class=\"y\">[2]\nOutside <sub>3</sub>", `[{"text":"<sup onmouseover=\"x\"class=\"y\">[2] Outside "},{"text":"3","vertical":"subscript"}]`},
		{"mismatch", "<sup>2</sub> after <sub>3</sub>", `[{"text":"<sup>2</sub> after "},{"text":"3","vertical":"subscript"}]`},
		{"unterminated", "<sup>2 after", `[{"text":"<sup>2 after"}]`},
		{"cross line block", "<sup>\n2\n</sup>", `[{"text":"<sup>\n2\n</sup>"}]`},
		{"cross line literal entities", "<sub>\n&#49 &lt;x&gt;\n</sub>", `[{"text":"<sub>\n&#49 &lt;x&gt;\n</sub>"}]`},
		{"protected code", "<sup>`2`</sup> after", `[{"text":"<sup>2</sup> after"}]`},
		{"protected link", "<sup>[2](https://example.org)</sup> after", `[{"text":"<sup>2</sup> after"}]`},
		{"scientific link label", "[H<sub>2</sub>O](https://example.org)", `[{"text":"H"},{"text":"2","vertical":"subscript"},{"text":"O"}]`},
		{"protected wrapper scientific label", "<sup>[H<sub>2</sub>O](https://example.org)</sup>", `[{"text":"<sup>H<sub>2</sub>O</sup>"}]`},
		{"protected then independent label", "<sup>[H<sub>2</sub>O](https://example.org)</sup> then [H<sub>2</sub>O](https://example.org)", `[{"text":"<sup>H<sub>2</sub>O</sup> then H"},{"text":"2","vertical":"subscript"},{"text":"O"}]`},
		{"protected math", "<sup>$x^2$</sup> after <sub>3</sub>", `[{"text":"<sup>$x^2$</sup> after "},{"text":"3","vertical":"subscript"}]`},
		{"protected math emphasis", "<sup>$*x*$</sup>", `[{"text":"<sup>$*x*$</sup>"}]`},
		{"protected multiline math", "<sup>$x\n<sub>3</sub>$</sup>", `[{"text":"<sup>$x\n<sub>3</sub>$</sup>"}]`},
		{"empty", "before<sup></sup>after", `[{"text":"beforeafter"}]`},
		{"self closing", "before<sup/> [2] after <sub>3</sub>", `[{"text":"before<sup/> [2] after "},{"text":"3","vertical":"subscript"}]`},
		{"opaque wrapper", "Before <span><sup>2</sup></span> after <sub>3</sub>", `[{"text":"Before <sup>2</sup> after "},{"text":"3","vertical":"subscript"}]`},
		{"mixed HTML block", "<div><EM>Journal</EM> <sup>2</sup></div>", `[{"text":"Journal","italic":true},{"text":" <sup>2</sup>"}]`},
		{"cross emphasis container", "*<sup>2*3</sup> after <sub>4</sub>", `[{"text":"<sup>2","italic":true},{"text":"3</sup> after "},{"text":"4","vertical":"subscript"}]`},
		{"unclosed across emphasis newline", "<sup>*x\nOutside <sub>3</sub>*", `[{"text":"<sup>"},{"text":"x Outside ","italic":true},{"text":"3","italic":true,"vertical":"subscript"}]`},
		{"unclosed across strong newline", "<sup>**x\nOutside <sub>3</sub>** after <sup>4</sup>", `[{"text":"<sup>"},{"text":"x Outside ","bold":true},{"text":"3","bold":true,"vertical":"subscript"},{"text":" after "},{"text":"4","vertical":"superscript"}]`},
		{"mismatch inside emphasis recovery", "<sup>*2</sub> <sub>3</sub>*", `[{"text":"<sup>"},{"text":"2</sub> ","italic":true},{"text":"3","italic":true,"vertical":"subscript"}]`},
		{"closer inside emphasis recovery", "<sup>*2</sup> <sub>3</sub>*", `[{"text":"<sup>"},{"text":"2</sup> ","italic":true},{"text":"3","italic":true,"vertical":"subscript"}]`},
		{"case insensitive bibliography emphasis", "<B>A</B> <EM>B</EM> <strong>C</strong>", `[{"text":"A","bold":true},{"text":" "},{"text":"B","italic":true},{"text":" "},{"text":"C","bold":true}]`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := json.Marshal(importCitation(tt.source).Runs)
			if err != nil {
				t.Fatal(err)
			}
			var actual, expected any
			if json.Unmarshal(got, &actual) != nil || json.Unmarshal([]byte(tt.want), &expected) != nil || !reflect.DeepEqual(actual, expected) {
				t.Fatalf("runs = %s, want %s", got, tt.want)
			}
		})
	}
}

func TestScientificCitationVerticalTitleTransferAndNormalization(t *testing.T) {
	raw := json.RawMessage(`[{"au":"Doe, JA","ti":"x2 study","so":"Journal","vl":"3","bp":"4","py":"2024","formatted_citation":"Author. x<sup>2</sup> study. Journal.","citation":{"runs":[{"text":"forged","vertical":"blink"}],"links":[]}}]`)
	original := append([]byte(nil), raw...)
	normalized, err := NormalizeRows(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(normalized, []byte(`"vertical":"superscript"`)) || bytes.Contains(normalized, []byte("forged")) {
		t.Fatalf("vertical-only title transfer or source authority lost: %s", normalized)
	}
	again, err := NormalizeRows(normalized)
	if err != nil || !bytes.Equal(again, normalized) || !bytes.Equal(original, raw) {
		t.Fatal("source changed or normalization was not idempotent")
	}
	rows, err := DecodeRows(normalized)
	if err != nil || len(rows) != 1 || PlainText(rows[0].Citation) != "Doe, J. A. x2 study. Journal 3, 4 (2024)." {
		t.Fatalf("metadata/order lost: %#v %v", rows, err)
	}
}

func TestScientificCitationRunOperations(t *testing.T) {
	runs := scientificRuns(t, `[{"text":" AB","italic":true,"vertical":"superscript"},{"text":"CD","italic":true,"vertical":"subscript"},{"text":"EF ","italic":true}]`)
	want := scientificRuns(t, `[{"text":"AB","italic":true,"vertical":"superscript"},{"text":"CD","italic":true,"vertical":"subscript"}]`)
	if got := sliceRuns(trimRuns(runs), 1, 5); !reflect.DeepEqual(got, want) {
		t.Fatalf("trim/slice lost style: %#v, want %#v", got, want)
	}
	replaced := replaceRunRange(runs, 3, 5, scientificRuns(t, `[{"text":"X","italic":true,"vertical":"superscript"}]`))
	expected := scientificRuns(t, `[{"text":" ABX","italic":true,"vertical":"superscript"},{"text":"EF ","italic":true}]`)
	if !reflect.DeepEqual(replaced, expected) {
		t.Fatalf("replace/merge lost vertical: %#v, want %#v", replaced, expected)
	}
}

func TestScientificCitationMarkdownRoundTrip(t *testing.T) {
	for _, vertical := range []string{"superscript", "subscript"} {
		for _, flags := range []string{"", `,"italic":true`, `,"bold":true`, `,"bold":true,"italic":true`} {
			for _, value := range []string{"2", "(n)", "[2]", "2\n3", "2\r3", "2\r\n3", " x ", "<sup>2</sup>", "&lt;sup&gt;", "&amp;lt;sup&amp;gt;"} {
				t.Run(vertical+flags+value, func(t *testing.T) {
					encoded, _ := json.Marshal(value)
					runs := scientificRuns(t, `[{"text":"before","italic":true},{"text":`+string(encoded)+`,"vertical":"`+vertical+`"`+flags+`},{"text":"after","bold":true}]`)
					raw := Markdown(Presentation{Runs: runs})
					if strings.ContainsAny(raw, "\r\n") {
						t.Fatalf("vertical serialization introduced a physical newline: %q", raw)
					}
					got := importCitation(raw).Runs
					if !reflect.DeepEqual(got, runs) {
						t.Fatalf("round trip = %#v, want %#v, Markdown %q", got, runs, raw)
					}
				})
			}
		}
	}
}

func TestScientificCitationMarkdownAllScriptRuns(t *testing.T) {
	for _, raw := range []string{
		`[{"text":"01, [2]-3","vertical":"superscript"}]`,
		`[{"text":" x ","bold":true,"italic":true,"vertical":"subscript"}]`,
		`[{"text":"2","vertical":"superscript"},{"text":"i","italic":true,"vertical":"subscript"},{"text":"3","vertical":"superscript"}]`,
		`[{"text":"first\r\nsecond","bold":true,"vertical":"subscript"}]`,
	} {
		runs := scientificRuns(t, raw)
		markdown := Markdown(Presentation{Runs: runs})
		if got := importCitation(markdown); !reflect.DeepEqual(got.Runs, runs) || len(got.Links) != 0 {
			t.Fatalf("all-script semantic round trip = %#v, want %#v, Markdown %q", got, runs, markdown)
		}
	}
}

func TestScientificCitationTrimmingPreservesAuthoredScriptWhitespace(t *testing.T) {
	source := Source{Formatted: "  <sub>***&#32;x&#32;***</sub>  "}
	original := source
	got := Format(source)
	want := scientificRuns(t, `[{"text":" x ","bold":true,"italic":true,"vertical":"subscript"}]`)
	if !reflect.DeepEqual(got.Runs, want) || source != original {
		t.Fatalf("trimming changed script characters or source: %#v, source %+v", got.Runs, source)
	}
	if got := importCitation("  baseline  "); PlainText(got) != "baseline" {
		t.Fatalf("baseline boundary trimming changed: %#v", got.Runs)
	}
}

func TestScientificCitationReviewedSyntheticReferenceRuns(t *testing.T) {
	data, err := os.ReadFile("../document_format/testdata/scientific-formatting-contract.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		References json.RawMessage `json:"references"`
		Expected   struct {
			Runs [][]Run `json:"reference_runs"`
		} `json:"expected"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	rows, err := DecodeRows(fixture.References)
	if err != nil || len(rows) != len(fixture.Expected.Runs) {
		t.Fatalf("reference row count changed: %d %v", len(rows), err)
	}
	for index, row := range rows {
		if !reflect.DeepEqual(row.Citation.Runs, fixture.Expected.Runs[index]) {
			t.Errorf("reference %d = %#v, want manually reviewed %#v", index, row.Citation.Runs, fixture.Expected.Runs[index])
		}
	}
}

func TestScientificCitationPreservesIncompleteAndUnknownEntityNames(t *testing.T) {
	for _, value := range []string{"&#49", "&#x31", "&nbsp1", "&notit;", "&copyright;"} {
		for _, wrapper := range []string{"", "sup", "sub"} {
			source := value
			if wrapper != "" {
				source = "<" + wrapper + ">" + value + "</" + wrapper + ">"
			}
			if got := PlainText(importCitation(source)); got != value {
				t.Errorf("source %q became %q, want %q", source, got, value)
			}
		}
	}
}

func TestScientificCitationTitleTransferPreservesUnicodeAndScriptWhitespace(t *testing.T) {
	source := Source{AU: "Smith, J", TI: "<sub> αβ </sub>", SO: "Synthetic Journal", PY: "2026", VL: "4", BP: "10", Formatted: "Other author. <sup>αβ</sup>. Other journal."}
	original := source
	got := Format(source)
	baseline := source
	baseline.Formatted = ""
	if want := PlainText(Format(baseline)); PlainText(got) != want || !utf8.ValidString(PlainText(got)) {
		t.Fatalf("exact title transfer corrupted scientific characters: %q, want %q", PlainText(got), want)
	}
	want := scientificRuns(t, `[{"text":"Smith, J. "},{"text":" ","vertical":"subscript"},{"text":"αβ","vertical":"superscript"},{"text":" ","vertical":"subscript"},{"text":". "},{"text":"Synthetic Journal","italic":true},{"text":" "},{"text":"4","bold":true},{"text":", 10 (2026)."}]`)
	if !reflect.DeepEqual(got.Runs, want) || source != original {
		t.Fatalf("exact title transfer changed whitespace/style/source: %#v, want %#v", got.Runs, want)
	}
}

func TestScientificCitationLinkLabelsPreserveDestinationsAndContainerState(t *testing.T) {
	source := "Before [H<sub>2</sub>O](https://example.org/water) after [<i>Label](https://example.org/label) plain"
	got := importCitation(source)
	want := []Link{{Label: "Article", Href: "https://example.org/water"}, {Label: "Article", Href: "https://example.org/label"}}
	if !reflect.DeepEqual(got.Links, want) || got.Runs[len(got.Runs)-1].Italic {
		t.Fatalf("authored link destinations or formatting containment changed: %#v", got)
	}
}
