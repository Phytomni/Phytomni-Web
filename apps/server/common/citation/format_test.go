package citation

import (
	"reflect"
	"testing"
)

func TestStructuredCitationEmphasis(t *testing.T) {
	p := Format(Source{AU: "Doe, JA; van Test, B", TI: "A plant study",
		SO: "Plant Journal", VL: "12", BP: "45", EP: "49", PY: "2024"})
	if got := PlainText(p); got != "Doe, J. A. & van Test, B. A plant study. Plant Journal 12, 45–49 (2024)." {
		t.Fatalf("unexpected citation: %q", got)
	}
	var journal, volume bool
	for _, run := range p.Runs {
		journal = journal || run.Text == "Plant Journal" && run.Italic
		volume = volume || run.Text == "12" && run.Bold
		if run.Bold && run.Text == "12," {
			t.Fatal("comma must not be bold")
		}
	}
	if !journal || !volume {
		t.Fatal("missing bibliographic emphasis")
	}
}

func TestStructuredCitationPartialFields(t *testing.T) {
	tests := []struct {
		name string
		src  Source
		want string
	}{
		{
			name: "equal beginning and ending pages",
			src:  Source{SO: "Plant Journal", VL: "7", BP: "18", EP: "18"},
			want: "Plant Journal 7, 18.",
		},
		{
			name: "beginning page only",
			src:  Source{SO: "Plant Journal", VL: "7", BP: "18"},
			want: "Plant Journal 7, 18.",
		},
		{
			name: "ending page only",
			src:  Source{SO: "Plant Journal", VL: "7", EP: "24"},
			want: "Plant Journal 7, 24.",
		},
		{
			name: "plus ending page",
			src:  Source{SO: "Plant Journal", VL: "7", BP: "18", EP: "+"},
			want: "Plant Journal 7, 18.",
		},
		{
			name: "article number only",
			src:  Source{SO: "Plant Journal", VL: "7", AR: "e12345"},
			want: "Plant Journal 7, e12345.",
		},
		{
			name: "missing year and volume",
			src:  Source{TI: "A plant study", SO: "Plant Journal", BP: "18", EP: "24"},
			want: "A plant study. Plant Journal, 18–24.",
		},
		{
			name: "title quotes belong to title",
			src:  Source{TI: `The "green revolution" revisited`, SO: "Plant Journal"},
			want: `The "green revolution" revisited. Plant Journal.`,
		},
		{
			name: "title only",
			src:  Source{TI: "A plant study"},
			want: "A plant study.",
		},
		{
			name: "incomplete book-like record",
			src:  Source{AU: "Doe, JA", TI: "Plant handbook", PY: "2020"},
			want: "Doe, J. A. Plant handbook. (2020).",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := PlainText(Format(tt.src)); got != tt.want {
				t.Fatalf("PlainText(Format(%+v)) = %q, want %q", tt.src, got, tt.want)
			}
		})
	}
}

func TestStructuredCitationTrimsFieldsAndPreservesTerminalPunctuation(t *testing.T) {
	p := Format(Source{TI: "  Does this work?  ", SO: "  Plant Journal  ", PY: " 2024 "})
	if got, want := PlainText(p), "Does this work? Plant Journal (2024)."; got != want {
		t.Fatalf("PlainText(Format(source)) = %q, want %q", got, want)
	}
}

func TestStructuredCitationSeparatesOpaqueAuthorFromTitle(t *testing.T) {
	for _, tc := range []struct {
		name, author, want string
	}{
		{"organization", "International Rice Research Institute", "International Rice Research Institute. Plant handbook."},
		{"full name", "Jane Doe", "Jane Doe. Plant handbook."},
		{"already punctuated", "Crop Trust.", "Crop Trust. Plant handbook."},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := PlainText(Format(Source{AU: tc.author, TI: "Plant handbook"}))
			if got != tc.want {
				t.Fatalf("complete citation = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestStructuredCitationUnavailableUsesInitializedSlices(t *testing.T) {
	p := Format(Source{})
	want := Presentation{
		Runs:  []Run{{Text: "Reference details unavailable."}},
		Links: []Link{},
	}
	if !reflect.DeepEqual(p, want) {
		t.Fatalf("Format(Source{}) = %#v, want %#v", p, want)
	}
	if p.Runs == nil || p.Links == nil {
		t.Fatal("runs and links must serialize as arrays, not null")
	}
}

func TestStructuredCitationEmptyLinksAreInitialized(t *testing.T) {
	p := Format(Source{})
	if !reflect.DeepEqual(p.Links, []Link{}) {
		t.Fatalf("links = %#v, want an initialized empty slice", p.Links)
	}
}
