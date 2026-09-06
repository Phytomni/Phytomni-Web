package citation

import (
	"bytes"
	"html"
	"reflect"
	"strings"
	"testing"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
)

func TestCitationLinksNormalizeKnownIdentifiers(t *testing.T) {
	tests := []struct {
		name string
		src  Source
		want []Link
	}{
		{
			name: "bare DOI",
			src:  Source{DI: "10.1000/a?x#y"},
			want: []Link{{Label: "Article", Href: "https://doi.org/10.1000/a%3Fx%23y"}},
		},
		{
			name: "DOI URL",
			src:  Source{DI: "https://dx.doi.org/10.1000/example"},
			want: []Link{{Label: "Article", Href: "https://doi.org/10.1000/example"}},
		},
		{
			name: "DOI resolver download link",
			src:  Source{DL: "http://doi.org/10.1000/from-download"},
			want: []Link{{Label: "Article", Href: "https://doi.org/10.1000/from-download"}},
		},
		{
			name: "only PMID",
			src:  Source{PM: "21914492"},
			want: []Link{{Label: "PubMed", Href: "https://pubmed.ncbi.nlm.nih.gov/21914492/"}},
		},
		{
			name: "PubMed URL",
			src:  Source{PM: "https://www.ncbi.nlm.nih.gov/pubmed/21914492?from=legacy"},
			want: []Link{{Label: "PubMed", Href: "https://pubmed.ncbi.nlm.nih.gov/21914492/"}},
		},
		{
			name: "quoted Unicode title",
			src:  Source{Title: `"水稻" & Arabidopsis`},
			want: []Link{{Label: "Google Scholar", Href: "https://scholar.google.com/scholar?q=%22%E6%B0%B4%E7%A8%BB%22+%26+Arabidopsis"}},
		},
		{
			name: "article URL without CAS or ADS",
			src:  Source{DL: "https://publisher.example/article/1"},
			want: []Link{{Label: "Article", Href: "https://publisher.example/article/1"}},
		},
		{
			name: "duplicate DOI destinations",
			src:  Source{DI: "10.1000/example", DL: "https://doi.org/10.1000/example"},
			want: []Link{{Label: "Article", Href: "https://doi.org/10.1000/example"}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := citationLinks(tt.src, nil); !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("citationLinks(%+v, nil) = %#v, want %#v", tt.src, got, tt.want)
			}
		})
	}
}

func TestCitationLinksRecognizeExplicitImportedDestinations(t *testing.T) {
	imported := importCitation("[PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC123/) [CAS](https://scifinder.cas.org/detail/1) [ADS](https://ui.adsabs.harvard.edu/abs/1)")
	want := []Link{
		{Label: "PubMed Central", Href: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC123/"},
		{Label: "CAS", Href: "https://scifinder.cas.org/detail/1"},
		{Label: "ADS", Href: "https://ui.adsabs.harvard.edu/abs/1"},
	}
	if got := citationLinks(Source{}, imported.Links); !reflect.DeepEqual(got, want) {
		t.Fatalf("citationLinks(Source{}, imported) = %#v, want %#v", got, want)
	}
}

func TestCitationLinksRejectServiceSpoofingWithoutReplacingCanonicalScholar(t *testing.T) {
	tests := []Link{
		{Label: "Scholar", Href: "https://attacker.example/scholar"},
		{Label: "Google Scholar", Href: "https://scholar.google.attacker.example/search"},
		{Label: "CAS", Href: "https://attacker.example/cas"},
		{Label: "ADS", Href: "https://attacker.example/ads"},
	}
	for _, spoof := range tests {
		t.Run(spoof.Label+spoof.Href, func(t *testing.T) {
			got := citationLinks(Source{Title: "Canonical title"}, []Link{spoof})
			want := []Link{
				{Label: "Article", Href: spoof.Href},
				{Label: "Google Scholar", Href: "https://scholar.google.com/scholar?q=Canonical+title"},
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("spoofed service link affected trusted labels: got %#v, want %#v", got, want)
			}
		})
	}
}

func TestCitationLinksCanonicalScholarWinsOverImportedScholarDestination(t *testing.T) {
	imported := []Link{{Label: "Google Scholar", Href: "https://scholar.google.com/scholar?q=attacker+terms"}}
	got := citationLinks(Source{Title: "Canonical title"}, imported)
	want := []Link{{Label: "Google Scholar", Href: "https://scholar.google.com/scholar?q=Canonical+title"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("imported Scholar replaced title-derived destination: got %#v, want %#v", got, want)
	}
}

func TestCitationLinksRejectUnsafeDestinations(t *testing.T) {
	imported := []Link{
		{Label: "Article", Href: "javascript:alert(1)"},
		{Label: "Article", Href: "file:///etc/passwd"},
		{Label: "Article", Href: "https://user:pass@example.org/private"},
		{Label: "Article", Href: "https://example.org/a\nb"},
		{Label: "Article", Href: "https://example.org/a?q=x%0Ay"},
		{Label: "Article", Href: "https://example.org/safe"},
	}
	if got, want := citationLinks(Source{DL: "javascript:alert(1)", PM: "12x"}, imported), []Link{{Label: "Article", Href: "https://example.org/safe"}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("citationLinks retained unsafe destinations: %#v", got)
	}
}

func TestCitationLinksRejectRawQueryBackslashWithoutDroppingSiblingLinks(t *testing.T) {
	got := Format(Source{
		Title: "Useful source",
		DL:    `https://example.org/article?q=a\b`,
		PM:    "21914492",
	})
	want := []Link{
		{Label: "PubMed", Href: "https://pubmed.ncbi.nlm.nih.gov/21914492/"},
		{Label: "Google Scholar", Href: "https://scholar.google.com/scholar?q=Useful+source"},
	}
	if PlainText(got) != "Useful source." || !reflect.DeepEqual(got.Links, want) {
		t.Fatalf("rejected Article invalidated useful citation/siblings: text=%q links=%#v", PlainText(got), got.Links)
	}
	for _, raw := range []string{
		`https://example.org/article?q=a\b`,
		`https://example.org/article?q=a"b`,
		`https://example.org/article?q=a<b`,
		`https://example.org/article?q=a>b`,
		`https://example.org/article?q=a b`,
	} {
		if got := safeHTTPURL(raw); got != "" {
			t.Fatalf("raw noncanonical query URL admitted as %q", got)
		}
	}
	for _, encoded := range []string{
		`https://example.org/article?q=a%5Cb&next=%2Fvalid`,
		`https://example.org/article?q=a%22b`,
		`https://example.org/article?q=a%3Cb`,
		`https://example.org/article?q=a%3Eb`,
		`https://example.org/article?q=a%20b`,
	} {
		if got := safeHTTPURL(encoded); got != encoded {
			t.Fatalf("encoded query URL = %q, want %q", got, encoded)
		}
	}
}

func TestCitationLinksUseFixedOrder(t *testing.T) {
	imported := []Link{
		{Label: "ADS", Href: "https://ui.adsabs.harvard.edu/abs/1"},
		{Label: "CAS", Href: "https://scifinder.cas.org/detail/1"},
		{Label: "PMC", Href: "https://pmc.ncbi.nlm.nih.gov/articles/PMC123/"},
	}
	got := citationLinks(Source{DI: "10.1000/example", PM: "21914492", TI: "A title"}, imported)
	want := []Link{
		{Label: "Article", Href: "https://doi.org/10.1000/example"},
		{Label: "PubMed", Href: "https://pubmed.ncbi.nlm.nih.gov/21914492/"},
		{Label: "PubMed Central", Href: "https://pmc.ncbi.nlm.nih.gov/articles/PMC123/"},
		{Label: "CAS", Href: "https://scifinder.cas.org/detail/1"},
		{Label: "ADS", Href: "https://ui.adsabs.harvard.edu/abs/1"},
		{Label: "Google Scholar", Href: "https://scholar.google.com/scholar?q=A+title"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("citationLinks order = %#v, want %#v", got, want)
	}
}

func TestCitationLinksUseTIThenTitleForScholar(t *testing.T) {
	got := citationLinks(Source{TI: "Preferred title", Title: "Fallback title"}, nil)
	want := []Link{{Label: "Google Scholar", Href: "https://scholar.google.com/scholar?q=Preferred+title"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("citationLinks title precedence = %#v, want %#v", got, want)
	}
}

func TestCitationMarkdownRoundTripsRunsAndLinks(t *testing.T) {
	p := Presentation{
		Runs: []Run{
			{Text: `A *literal* URL https://example.org/a_(b) and `},
			{Text: "italic_[x]", Italic: true},
			{Text: " + "},
			{Text: "bold*text", Bold: true},
		},
		Links: []Link{{Label: "Article", Href: "https://example.org/a_(b)?q=x(y)"}},
	}
	raw := Markdown(p)
	if got, want := raw, `A \*literal\* URL https://example.org/a\_\(b\) and *italic\_\[x\]* + **bold\*text**

[Article](<https://example.org/a_(b)?q=x(y)>)`; got != want {
		t.Fatalf("Markdown(p) = %q, want %q", got, want)
	}
	if got := PlainText(importCitation(raw)); got != PlainText(p)+" Article" {
		t.Fatalf("Markdown text did not round trip: %q", got)
	}
	if !reflect.DeepEqual(citationLinks(Source{}, importCitation(raw).Links), p.Links) {
		t.Fatalf("Markdown links did not round trip: %#v", importCitation(raw).Links)
	}
	if err := goldmark.New().Convert([]byte(raw), discardWriter{}); err != nil {
		t.Fatalf("generated Markdown did not parse: %v", err)
	}
}

func TestCitationMarkdownPreservesLiteralGFMSyntaxAndSemanticEmphasis(t *testing.T) {
	p := Presentation{Runs: []Run{
		{Text: "研究 ~~literal~~ $x^2$ | "},
		{Text: "real italic", Italic: true},
		{Text: " and "},
		{Text: "real bold", Bold: true},
	}}
	markdown := Markdown(p)
	var rendered bytes.Buffer
	parser := goldmark.New(goldmark.WithExtensions(extension.GFM))
	if err := parser.Convert([]byte(markdown), &rendered); err != nil {
		t.Fatal(err)
	}
	html := rendered.String()
	if strings.Contains(html, "<del>") || !strings.Contains(html, "研究 ~~literal~~ $x^2$ | ") {
		t.Fatalf("literal GFM delimiters changed: Markdown %q HTML %q", markdown, html)
	}
	if !strings.Contains(html, "<em>real italic</em>") || !strings.Contains(html, "<strong>real bold</strong>") {
		t.Fatalf("semantic emphasis changed: Markdown %q HTML %q", markdown, html)
	}
}

func TestCitationMarkdownPreservesEntityLikeDestinations(t *testing.T) {
	for _, href := range []string{"https://example.org/?q=&copy;", "https://example.org/?q=&#169;", "https://example.org/?q=&#xA9;", "https://example.org/a(b)?q=&copy;&next=&#169;"} {
		t.Run(href, func(t *testing.T) {
			p := Presentation{Runs: []Run{{Text: "Title"}}, Links: []Link{{Label: "Article", Href: href}}}
			var rendered bytes.Buffer
			if err := goldmark.New().Convert([]byte(Markdown(p)), &rendered); err != nil {
				t.Fatal(err)
			}
			want := `<p>Title</p>` + "\n" + `<p><a href="` + html.EscapeString(href) + `">Article</a></p>` + "\n"
			if got := rendered.String(); got != want {
				t.Fatalf("decoded destination changed: got %q, want %q", got, want)
			}
		})
	}
}

func TestCitationMarkdownPreservesEmphasisBoundaries(t *testing.T) {
	tests := []struct {
		name string
		runs []Run
		want string
	}{
		{"punctuation-adjacent italic", []Run{{Text: "gene"}, {Text: "(ABC)", Italic: true}, {Text: "marker"}}, "<p>gene<em>(ABC)</em>marker</p>\n"},
		{"punctuation-adjacent bold", []Run{{Text: "gene"}, {Text: "(ABC)", Bold: true}, {Text: "marker"}}, "<p>gene<strong>(ABC)</strong>marker</p>\n"},
		{"punctuation-adjacent both", []Run{{Text: "gene"}, {Text: "(ABC)", Italic: true, Bold: true}, {Text: "marker"}}, "<p>gene<em><strong>(ABC)</strong></em>marker</p>\n"},
		{"italic across paragraphs", []Run{{Text: "Alpha\n\nBeta", Italic: true}}, "<p><em>Alpha</em></p>\n<p><em>Beta</em></p>\n"},
		{"both across paragraphs", []Run{{Text: "Alpha\n\nBeta", Italic: true, Bold: true}}, "<p><em><strong>Alpha</strong></em></p>\n<p><em><strong>Beta</strong></em></p>\n"},
		{"adjacent different emphasis", []Run{{Text: "Alpha", Italic: true}, {Text: "(Beta)", Bold: true}, {Text: "Gamma", Italic: true, Bold: true}}, "<p><em>Alpha</em><strong>(Beta)</strong><em><strong>Gamma</strong></em></p>\n"},
		{"punctuation-only span", []Run{{Text: "gene"}, {Text: "!", Italic: true}, {Text: "marker"}}, "<p>gene<em>!</em>marker</p>\n"},
		{"Unicode neighbors", []Run{{Text: "α"}, {Text: "(ABC)", Italic: true}, {Text: "β"}}, "<p>α<em>(ABC)</em>β</p>\n"},
		{"literal delimiters with both flags", []Run{{Text: "pre"}, {Text: "*x_[y]", Italic: true, Bold: true}, {Text: "post"}}, "<p>pre<em><strong>*x_[y]</strong></em>post</p>\n"},
		{"paragraph and word boundaries", []Run{{Text: "pre"}, {Text: "(Alpha)\n\n(Beta)", Italic: true}, {Text: "post"}}, "<p>pre<em>(Alpha)</em></p>\n<p><em>(Beta)</em>post</p>\n"},
		{"alternate marker before plain word", []Run{{Text: "Alpha", Italic: true}, {Text: "Beta", Bold: true}, {Text: "Gamma"}}, "<p><em>Alpha</em><strong>Beta</strong>Gamma</p>\n"},
		{"both flags adjacent to punctuation-only style", []Run{{Text: "A", Italic: true, Bold: true}, {Text: "!", Italic: true}, {Text: "B"}}, "<p><em><strong>A</strong></em><em>!</em>B</p>\n"},
		{"non-BMP letter neighbors", []Run{{Text: "𐐀"}, {Text: "!", Italic: true}, {Text: "𐐁"}}, "<p>𐐀<em>!</em>𐐁</p>\n"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var rendered bytes.Buffer
			if err := goldmark.New().Convert([]byte(Markdown(Presentation{Runs: tt.runs})), &rendered); err != nil {
				t.Fatal(err)
			}
			if got := rendered.String(); got != tt.want {
				t.Fatalf("semantic emphasis changed: got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestCitationMarkdownKeepsStyledWhitespaceOutsideDelimiters(t *testing.T) {
	p := Presentation{Runs: []Run{{Text: "X"}, {Text: " italic ", Italic: true}, {Text: " bold ", Bold: true}, {Text: "Y"}}}
	raw := Markdown(p)
	if got, want := PlainText(importCitation(raw)), PlainText(p); got != want {
		t.Fatalf("styled whitespace did not round trip: got %q, want %q (Markdown %q)", got, want, raw)
	}
}

func TestCitationMarkdownNeutralizesBlockSyntaxAfterInternalNewlines(t *testing.T) {
	p := Presentation{Runs: []Run{{Text: "Title\n# Injected heading\n- injected item\n1. injected item\n    injected code\n---\n~~~"}}}
	raw := Markdown(p)

	var rendered bytes.Buffer
	if err := goldmark.New().Convert([]byte(raw), &rendered); err != nil {
		t.Fatalf("generated Markdown did not parse: %v", err)
	}
	html := rendered.String()
	for _, forbidden := range []string{"<h1", "<h2", "<ul", "<ol", "<blockquote", "<pre", "<hr"} {
		if strings.Contains(html, forbidden) {
			t.Fatalf("metadata changed Markdown block structure via %q: Markdown %q, HTML %q", forbidden, raw, html)
		}
	}
	for _, literal := range []string{"# Injected heading", "- injected item", "1. injected item", "injected code", "---", "~~~"} {
		if !strings.Contains(html, literal) {
			t.Fatalf("literal metadata %q was not retained: Markdown %q, HTML %q", literal, raw, html)
		}
	}
}

type discardWriter struct{}

func (discardWriter) Write(p []byte) (int, error) { return len(p), nil }
