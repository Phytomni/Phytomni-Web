package mdoc

import (
	"archive/zip"
	"bytes"
	"compress/zlib"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

const fixtureMarkdown = `# Protein design

A **bold** intro with *italic* and ` + "`code`" + `.

- item one
- item two

| Gene | Role |
| --- | --- |
| Os01g | kinase |

水稻基因组

` + "```" + `python
print("ok")
` + "```" + `

<script>alert(1)</script>
`

// 1x1 PNG (black pixel).
var png1x1 = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
	0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
	0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
	0x00, 0x03, 0x01, 0x01, 0x00, 0xc9, 0xfe, 0x92,
	0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
	0x44, 0xae, 0x42, 0x60, 0x82,
}

func TestRenderWordStructuresMarkdown(t *testing.T) {
	body, err := RenderWord(fixtureMarkdown, Options{})
	if err != nil {
		t.Fatalf("RenderWord: %v", err)
	}
	if !bytes.HasPrefix(body, []byte("PK")) {
		t.Fatal("Word payload is not a docx zip")
	}
	xml := wordDocumentXML(t, body)
	plain := stripXMLTags(xml)
	styles := wordPStyleValues(xml)
	if !containsString(styles, "Heading1") {
		t.Fatalf("missing built-in Heading1 styleId, pStyle=%v xml=%s", styles, xml)
	}
	if containsString(styles, "Heading 1") {
		t.Fatalf("Word used display name Heading 1 instead of styleId Heading1: %v", styles)
	}
	if !strings.Contains(xml, "w:b") && !strings.Contains(xml, "w:bCs") {
		t.Fatalf("missing bold run in word xml")
	}
	if !strings.Contains(xml, "w:tbl") {
		t.Fatalf("missing table in word xml")
	}
	if strings.Contains(plain, "# Protein design") {
		t.Fatalf("raw markdown heading leaked into Word")
	}
	if !strings.Contains(plain, "Protein") || !strings.Contains(plain, "design") {
		t.Fatalf("heading text missing from Word: %s", plain)
	}
	if !strings.Contains(plain, "水稻基因组") {
		t.Fatalf("CJK text missing from Word: %s", plain)
	}
	if strings.Contains(xml, "<script>alert(1)</script>") || strings.Contains(plain, "<script>") {
		t.Fatalf("raw HTML leaked into Word")
	}
}

func TestRenderWordUsesBuiltInHeadingStyleIds(t *testing.T) {
	src := "# Heading One\n\nbody paragraph under h1\n\n## Heading Two\n\nmore body\n"
	body, err := RenderWord(src, Options{})
	if err != nil {
		t.Fatalf("RenderWord: %v", err)
	}
	styles := wordPStyleValues(wordDocumentXML(t, body))
	if !containsString(styles, "Heading1") || !containsString(styles, "Heading2") {
		t.Fatalf("want Heading1 and Heading2 styleIds, got %v", styles)
	}
	for _, style := range styles {
		if strings.Contains(style, " ") {
			t.Fatalf("Word heading styleId %q is not a built-in OOXML id", style)
		}
	}
}

func TestRenderPDFDropsMarkdownMarkers(t *testing.T) {
	body, err := RenderPDF(fixtureMarkdown, Options{})
	if err != nil {
		t.Fatalf("RenderPDF: %v", err)
	}
	if !bytes.HasPrefix(body, []byte("%PDF")) {
		t.Fatal("PDF payload missing %PDF header")
	}
	if bytes.Contains(body, []byte("# Protein design")) {
		t.Fatalf("raw markdown heading leaked into PDF")
	}
	if bytes.Contains(body, []byte("<script>alert(1)</script>")) {
		t.Fatalf("raw HTML leaked into PDF")
	}
}

func TestRenderPDFHeadingsUseOutlineAndSize(t *testing.T) {
	src := "# Heading One\n\nbody paragraph under h1\n\n## Heading Two\n\nmore body\n"
	body, err := RenderPDF(src, Options{})
	if err != nil {
		t.Fatalf("RenderPDF: %v", err)
	}
	if !bytes.Contains(body, []byte("/Outlines")) {
		t.Fatal("PDF missing /Outlines bookmark dictionary")
	}
	sizes := pdfTfSizes(t, body)
	if !containsString(sizes, "18.00") {
		t.Fatalf("PDF H1 size 18.00 missing, Tf=%v", sizes)
	}
	if !containsString(sizes, "16.00") {
		t.Fatalf("PDF H2 size 16.00 missing, Tf=%v", sizes)
	}
	if !containsString(sizes, "11.00") {
		t.Fatalf("PDF body size 11.00 missing, Tf=%v", sizes)
	}
	if containsString(sizes, "16.50") || containsString(sizes, "15.00") {
		t.Fatalf("PDF still uses 18-level*1.5 heading sizes, Tf=%v", sizes)
	}
}

func TestRenderWordAndPDFEmbedFetchedImage(t *testing.T) {
	var seen []string
	fetch := func(href string) (*Image, error) {
		seen = append(seen, href)
		return &Image{Bytes: png1x1, MIME: "image/png"}, nil
	}
	src := "# Figure\n\n![tree](/api/v1/gene-images/Os01g0107900/tree.png)\n"
	word, err := RenderWord(src, Options{FetchImage: fetch})
	if err != nil {
		t.Fatalf("RenderWord: %v", err)
	}
	if !wordZipHasMediaPNG(t, word) {
		t.Fatal("Word zip has no embedded png")
	}
	pdf, err := RenderPDF(src, Options{FetchImage: fetch})
	if err != nil {
		t.Fatalf("RenderPDF: %v", err)
	}
	if !bytes.Contains(pdf, []byte("/Subtype /Image")) && !bytes.Contains(pdf, []byte("/Subtype/Image")) {
		t.Fatal("PDF missing embedded image object")
	}
	if len(seen) == 0 {
		t.Fatal("image fetcher was not called")
	}
}

func TestRenderWordUsesAltWhenFetcherFails(t *testing.T) {
	fetch := func(href string) (*Image, error) {
		return nil, nil
	}
	body, err := RenderWord("![missing plot](./gone.png)\n", Options{FetchImage: fetch})
	if err != nil {
		t.Fatalf("RenderWord: %v", err)
	}
	xml := wordDocumentXML(t, body)
	if !strings.Contains(xml, "missing plot") {
		t.Fatalf("alt text missing after failed fetch: %s", xml)
	}
	if wordZipHasMediaPNG(t, body) {
		t.Fatal("failed fetch must not embed an image")
	}
}

func stripXMLTags(raw string) string {
	var b strings.Builder
	inTag := false
	for _, r := range raw {
		switch {
		case r == '<':
			inTag = true
		case r == '>':
			inTag = false
		case !inTag:
			b.WriteRune(r)
		}
	}
	return b.String()
}

func wordDocumentXML(t *testing.T, body []byte) string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatalf("zip: %v", err)
	}
	for _, f := range zr.File {
		if f.Name != "word/document.xml" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open document.xml: %v", err)
		}
		raw, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatalf("read document.xml: %v", err)
		}
		return string(raw)
	}
	t.Fatal("document.xml missing")
	return ""
}

func wordZipHasMediaPNG(t *testing.T, body []byte) bool {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatalf("zip: %v", err)
	}
	for _, f := range zr.File {
		name := strings.ToLower(f.Name)
		if strings.HasPrefix(name, "word/media/") && strings.HasSuffix(name, ".png") {
			return true
		}
	}
	return false
}

func wordPStyleValues(xml string) []string {
	matches := regexp.MustCompile(`w:pStyle[^>]*w:val="([^"]+)"`).FindAllStringSubmatch(xml, -1)
	out := make([]string, 0, len(matches))
	for _, m := range matches {
		out = append(out, m[1])
	}
	return out
}

func pdfTfSizes(t *testing.T, body []byte) []string {
	t.Helper()
	var sizes []string
	seen := map[string]bool{}
	re := regexp.MustCompile(`([0-9]+\.[0-9]+) Tf`)
	for _, stream := range pdfDecodedStreams(t, body) {
		for _, m := range re.FindAllStringSubmatch(string(stream), -1) {
			if !seen[m[1]] {
				seen[m[1]] = true
				sizes = append(sizes, m[1])
			}
		}
	}
	return sizes
}

func pdfDecodedStreams(t *testing.T, body []byte) [][]byte {
	t.Helper()
	// gofpdf writes direct stream lengths, including for image dictionaries
	// with nested DecodeParms. Binary checksum bytes are not line delimiters.
	header := regexp.MustCompile(`(?s)<<((?:[^<>]|<<[^<>]*>>)*)>>\r?\nstream\r?\n`)
	length := regexp.MustCompile(`/Length\s+([0-9]+)\b`)
	var out [][]byte
	for len(body) > 0 {
		m := header.FindSubmatchIndex(body)
		if m == nil {
			break
		}
		dictionary := body[m[2]:m[3]]
		value := length.FindSubmatch(dictionary)
		if value == nil {
			t.Fatal("PDF test stream is missing its direct /Length")
		}
		n, err := strconv.Atoi(string(value[1]))
		if err != nil || n > len(body)-m[1] {
			t.Fatal("PDF test stream /Length exceeds available data")
		}
		raw := body[m[1] : m[1]+n]
		body = body[m[1]+n:]
		if !bytes.HasPrefix(body, []byte("\nendstream")) && !bytes.HasPrefix(body, []byte("\r\nendstream")) {
			t.Fatal("PDF test stream /Length does not end at endstream")
		}
		if !bytes.Contains(dictionary, []byte("/FlateDecode")) {
			continue
		}
		r, err := zlib.NewReader(bytes.NewReader(raw))
		if err != nil {
			t.Fatalf("open compressed PDF test stream: %v", err)
		}
		decoded, err := io.ReadAll(r)
		r.Close()
		if err != nil {
			t.Fatalf("decode compressed PDF test stream: %v", err)
		}
		out = append(out, decoded)
	}
	return out
}

func TestPDFDecodedStreamsPreservesCompressedLineEndingBytes(t *testing.T) {
	for _, tc := range []struct {
		name, payload string
		last          byte
	}{
		{"carriage-return", "CRw", '\r'},
		{"line-feed", "LFw", '\n'},
	} {
		for _, eol := range []string{"\n", "\r\n"} {
			t.Run(fmt.Sprintf("%s/%q", tc.name, eol), func(t *testing.T) {
				var compressed bytes.Buffer
				writer := zlib.NewWriter(&compressed)
				if _, err := writer.Write([]byte(tc.payload)); err != nil {
					t.Fatal(err)
				}
				if err := writer.Close(); err != nil {
					t.Fatal(err)
				}
				raw := compressed.Bytes()
				if raw[len(raw)-1] != tc.last {
					t.Fatalf("fixture checksum must end with %q", tc.last)
				}
				body := []byte(fmt.Sprintf("1 0 obj%s<< /Length %d /Filter /FlateDecode >>%sstream%s", eol, len(raw), eol, eol))
				body = append(body, raw...)
				body = append(body, []byte(eol+"endstream"+eol+"endobj")...)
				streams := pdfDecodedStreams(t, body)
				if len(streams) != 1 || !bytes.Equal(streams[0], []byte(tc.payload)) {
					t.Fatalf("compressed content lost at stream boundary: %q", streams)
				}
			})
		}
	}
}

func containsString(xs []string, want string) bool {
	for _, x := range xs {
		if x == want {
			return true
		}
	}
	return false
}
