package mdoc

import (
	"archive/zip"
	"bytes"
	"io"
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
	if !strings.Contains(xml, "Heading1") && !strings.Contains(xml, "Heading 1") {
		t.Fatalf("missing heading style in word xml")
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
