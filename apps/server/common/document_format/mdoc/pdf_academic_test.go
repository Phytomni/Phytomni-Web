package mdoc

import (
	"bytes"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"unicode/utf16"

	"phytomni-server/common/citation"
)

func TestLongReferenceActualPagesHangingLinksAndSingleFinalGap(t *testing.T) {
	var reference, links []string
	for i := 0; i < 180; i++ {
		reference = append(reference, fmt.Sprintf("REF%04d", i))
	}
	for i := 0; i < 120; i++ {
		links = append(links, fmt.Sprintf("LINK%04d", i))
	}
	doc := Document{blocks: []block{
		{role: roleReference, referenceIndex: 1, inlines: []inline{{text: strings.Join(reference, "\n")}}},
		{role: roleReferenceLinks, referenceIndex: 1, inlines: []inline{{text: strings.Join(links, "\n"), href: "https://example.org/long-reference"}}},
		{role: roleLead, inlines: []inline{{text: "AFTERLONGREFERENCE"}}},
	}}
	data, err := RenderCitedPDF(doc, requireAcademicFonts(t))
	if err != nil {
		t.Fatal(err)
	}
	items := academicPDFText(t, data)
	counts := map[string]int{}
	for _, item := range items {
		counts[item.text]++
		if strings.HasPrefix(item.text, "REF") || strings.HasPrefix(item.text, "LINK") {
			if math.Abs(item.x-32.5*72/25.4) > 0.02 || item.y < 25*72/25.4-0.02 || item.y > 272*72/25.4+0.02 {
				t.Fatalf("continued reference/link lost hanging edge: %+v", item)
			}
		}
	}
	for _, token := range append(reference, links...) {
		if counts[token] != 1 {
			t.Fatalf("lost/duplicated %s", token)
		}
	}
	number, first, last := findPDFText(t, items, "1."), findPDFText(t, items, "REF0000"), findPDFText(t, items, "REF0179")
	firstLink, lastLink, after := findPDFText(t, items, "LINK0000"), findPDFText(t, items, "LINK0119"), findPDFText(t, items, "AFTERLONGREFERENCE")
	if number.page != first.page || number.y != first.y || math.Abs(number.x-25*72/25.4) > 0.02 || last.page <= first.page {
		t.Fatal("reference number/long-entry pagination lost")
	}
	if firstLink.page != last.page || math.Abs(last.y-firstLink.y-16) > 0.02 {
		t.Fatal("entry/link gap inserted or entry not grouped")
	}
	if lastLink.page <= firstLink.page || after.page != lastLink.page || math.Abs(lastLink.y-after.y-18) > 0.02 {
		t.Fatal("long links or single final 6pt gap lost")
	}
	if bytes.Count(data, []byte("https://example.org/long-reference")) != 120 {
		t.Fatal("continued reference links lost actual annotations")
	}
	word, err := RenderCitedWord(doc)
	if err != nil {
		t.Fatal(err)
	}
	parts := wordParts(t, word)
	tree := readWordNode(t, parts["word/document.xml"])
	styles := readWordNode(t, parts["word/styles.xml"])
	ps := tree.all(testWordNS, "p")
	if len(ps) != 3 || ps[0].content() != "1.\t"+strings.Join(reference, "\n") || ps[1].content() != strings.Join(links, "\n") {
		t.Fatal("Word long reference source lost")
	}
	for i, p := range ps[:2] {
		pr := resolvedWordProps(t, styles, p, nil, "pPr")
		if pr["ind/left"] != "425" || pr["keepLines/val"] != "false" || pr["spacing/after"] != []string{"0", "120"}[i] {
			t.Fatalf("Word hanging/split/final spacing: %v", pr)
		}
	}
	if len(ps[1].all(testWordNS, "hyperlink")) != 1 {
		t.Fatal("Word long link not real")
	}
}

func TestCitedPDFFontsRequired(t *testing.T) {
	data, err := RenderCitedPDF(Document{blocks: []block{{kind: blockParagraph, role: roleLead, inlines: []inline{{text: "Fallback"}}}}}, AcademicFonts{})
	if err != nil || len(data) == 0 || errors.Is(err, errAcademicPDFGlyph) {
		t.Fatal("missing TNR faces blocked PDF")
	}
	findPDFText(t, academicPDFText(t, data), "Fallback")
}

type pdfTextEvidence struct {
	text, font string
	size, x, y float64
	page       int
}

func academicPDFText(t *testing.T, data []byte) []pdfTextEvidence {
	t.Helper()
	var out []pdfTextEvidence
	page := 0
	utf8Objects := map[string]bool{}
	utf8Fonts := map[string]bool{}
	for _, m := range regexp.MustCompile(`(?s)(\d+) 0 obj\s*(.*?)endobj`).FindAllSubmatch(data, -1) {
		if bytes.Contains(m[2], []byte("/Subtype /Type0")) {
			utf8Objects[string(m[1])] = true
		}
	}
	for _, m := range regexp.MustCompile(`/([^ /\s]+) (\d+) 0 R`).FindAllSubmatch(data, -1) {
		if utf8Objects[string(m[2])] {
			utf8Fonts[string(m[1])] = true
		}
	}
	re := regexp.MustCompile(`(?s)/([^ /]+) ([0-9.]+) Tf|BT ([0-9.-]+) ([0-9.-]+) Td \(((?:\\.|[^\\)])*)\) Tj`)
	for _, stream := range pdfDecodedStreams(t, data) {
		if !bytes.Contains(stream, []byte(" Tj")) {
			continue
		}
		page++
		font := ""
		size := 0.0
		for _, m := range re.FindAllStringSubmatch(string(stream), -1) {
			if m[1] != "" {
				font = m[1]
				size, _ = strconv.ParseFloat(m[2], 64)
				continue
			}
			x, _ := strconv.ParseFloat(m[3], 64)
			y, _ := strconv.ParseFloat(m[4], 64)
			raw := []byte(m[5])
			var unescaped []byte
			for i := 0; i < len(raw); i++ {
				if raw[i] == '\\' && i+1 < len(raw) {
					i++
					switch raw[i] {
					case 'r':
						unescaped = append(unescaped, '\r')
					case 'n':
						unescaped = append(unescaped, '\n')
					default:
						unescaped = append(unescaped, raw[i])
					}
				} else {
					unescaped = append(unescaped, raw[i])
				}
			}
			text := string(unescaped)
			if utf8Fonts[font] {
				var codes []uint16
				for i := 0; i+1 < len(unescaped); i += 2 {
					codes = append(codes, uint16(unescaped[i])<<8|uint16(unescaped[i+1]))
				}
				text = string(utf16.Decode(codes))
			}
			out = append(out, pdfTextEvidence{text, font, size, x, y, page})
		}
	}
	return out
}

func findPDFText(t *testing.T, items []pdfTextEvidence, text string) pdfTextEvidence {
	t.Helper()
	for _, p := range items {
		if p.text == text {
			return p
		}
	}
	t.Fatalf("missing painted text %q", text)
	return pdfTextEvidence{}
}

func pdfPaintedContains(items []pdfTextEvidence, text string) bool {
	for _, p := range items {
		if strings.Contains(p.text, text) {
			return true
		}
	}
	return false
}

func TestCitedPDFPositionsStylesSuperscriptAndLinks(t *testing.T) {
	doc, err := BuildCited("# Report\n\n## Introduction\n\nAlpha [1,2] beta [1,9] [article](https://example.org/prose).\n\nBody paragraph.", []citation.Row{
		{Citation: citation.Presentation{Runs: []citation.Run{{Text: "Journal", Italic: true}, {Text: " 12", Bold: true}}, Links: []citation.Link{{Label: "Article", Href: "https://example.org/ref"}}}},
		{Citation: citation.Presentation{Runs: []citation.Run{{Text: "Second"}}}},
	}, Options{})
	if err != nil {
		t.Fatal(err)
	}
	data, err := RenderCitedPDF(doc, requireAcademicFonts(t))
	if err != nil {
		t.Fatal(err)
	}
	texts := academicPDFText(t, data)
	alpha := findPDFText(t, texts, "Alpha")
	mark := findPDFText(t, texts, "1,2")
	invalid := findPDFText(t, texts, "1,9")
	if alpha.size != 12 || mark.size != 8 || invalid.size != 8 || math.Abs(mark.y-alpha.y-3) > 0.02 {
		t.Fatalf("superscript geometry: %+v %+v", alpha, mark)
	}
	if math.Abs(alpha.x-25*72/25.4) > 0.02 {
		t.Fatal("lead indent")
	}
	body := findPDFText(t, texts, "Body")
	if math.Abs(body.x-32.5*72/25.4) > 0.02 {
		t.Fatal("body first indent")
	}
	if findPDFText(t, texts, "Journal").font == alpha.font {
		t.Fatal("journal italic flattened")
	}
	if bytes.Count(data, []byte("/Subtype /Link")) != 3 {
		t.Fatalf("expected one valid group and two external links; got %d", bytes.Count(data, []byte("/Subtype /Link")))
	}
	for _, target := range []string{"https://example.org/prose", "https://example.org/ref", "/Dest ["} {
		if !bytes.Contains(data, []byte(target)) {
			t.Fatalf("missing actual annotation %s", target)
		}
	}
	ann := regexp.MustCompile(`/Subtype /Link /Rect \[([0-9. -]+)\] /Border \[0 0 0\] /Dest \[(\d+) 0 R /XYZ 0 ([0-9.-]+) null\]`).FindSubmatch(data)
	if len(ann) != 4 {
		t.Fatal("no internal citation annotation")
	}
	var rect []float64
	for _, v := range strings.Fields(string(ann[1])) {
		n, _ := strconv.ParseFloat(v, 64)
		rect = append(rect, n)
	}
	if len(rect) != 4 || math.Abs(rect[0]-mark.x) > 0.02 || math.Abs(rect[1]-mark.y-8) > 0.02 || math.Abs(rect[2]-mark.x-10) > 0.02 || math.Abs(rect[3]-mark.y+1.6) > 0.02 {
		t.Fatalf("superscript hitbox not tied to paint: %v %+v", rect, mark)
	}
}

func TestCitedPDFLongReferenceDestinationsFollowActualPagination(t *testing.T) {
	doc := Document{blocks: []block{
		{kind: blockParagraph, role: roleLead, inlines: []inline{{text: "1", citation: &citationMark{text: "1", indices: []int{1}, active: true}}, {text: strings.Repeat(" prelude", 1600)}}},
		{kind: blockParagraph, role: roleReference, referenceIndex: 1, inlines: []inline{{text: strings.Repeat("REFWORD ", 1600) + "REFLAST"}}},
		{kind: blockParagraph, role: roleReferenceLinks, referenceIndex: 1, inlines: []inline{{text: strings.Repeat("LINKWORD ", 60) + "LINKLAST", href: "https://example.org/reference"}}},
	}}
	data, err := RenderCitedPDF(doc, requireAcademicFonts(t))
	if err != nil {
		t.Fatal(err)
	}
	items := academicPDFText(t, data)
	number := findPDFText(t, items, "1.")
	first := findPDFText(t, items, "REFWORD")
	last := findPDFText(t, items, "REFLAST")
	link := findPDFText(t, items, "LINKWORD")
	if number.page < 2 || number.page != first.page || number.y != first.y || last.page != link.page {
		t.Fatal("reference number/link grouping failed")
	}
	count := 0
	for _, p := range items {
		if p.text == "REFWORD" {
			count++
		}
	}
	if count != 1600 {
		t.Fatalf("reference words lost: %d", count)
	}
	ann := regexp.MustCompile(`/Subtype /Link /Rect \[[^]]+\] /Border \[0 0 0\] /Dest \[(\d+) 0 R /XYZ 0 ([0-9.-]+) null\]`).FindSubmatch(data)
	if len(ann) != 3 {
		t.Fatal("missing true destination")
	}
	page, _ := strconv.Atoi(string(ann[1]))
	y, _ := strconv.ParseFloat(string(ann[2]), 64)
	if page != 1+2*number.page || math.Abs(y-number.y-12) > 0.02 {
		t.Fatal("destination not at actual paginated entry")
	}
}

func TestCitedPDFFooterDoesNotInheritLinkColor(t *testing.T) {
	doc := Document{blocks: []block{{kind: blockParagraph, role: roleReferenceLinks, inlines: []inline{{text: "Link", href: "https://example.org"}}}}}
	data, err := RenderCitedPDF(doc, requireAcademicFonts(t))
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range pdfDecodedStreams(t, data) {
		lines := strings.Split(string(s), "\n")
		last := ""
		for _, line := range lines {
			if strings.Contains(line, " Tj") {
				last = line
			}
		}
		if last != "" && strings.Contains(last, " rg BT") {
			t.Fatal("footer inherited colored reference link")
		}
	}
}

func TestCitedPDFReferenceKeepsFirstTwoLinkLinesAtPageBoundary(t *testing.T) {
	w, err := newAcademicPDFWriter(requireAcademicFonts(t))
	if err != nil {
		t.Fatal(err)
	}
	w.newPage()
	w.y = 261
	blocks := []block{
		{kind: blockParagraph, role: roleReference, referenceIndex: 1, inlines: []inline{{text: "REFLAST"}}},
		{kind: blockParagraph, role: roleReferenceLinks, referenceIndex: 1, inlines: []inline{{text: strings.Repeat("LINKWORD ", 30), href: "https://example.org"}}},
	}
	if err := w.writeBlocks(blocks, 0); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := w.pdf.Output(&buf); err != nil {
		t.Fatal(err)
	}
	items := academicPDFText(t, buf.Bytes())
	if findPDFText(t, items, "REFLAST").page != findPDFText(t, items, "LINKWORD").page {
		t.Fatal("final reference line stranded before two-line link row")
	}
}

func TestCitedPDFListMarkerFollowsHeadingAcrossPageBreak(t *testing.T) {
	w, err := newAcademicPDFWriter(requireAcademicFonts(t))
	if err != nil {
		t.Fatal(err)
	}
	w.newPage()
	w.y = 258
	b := block{kind: blockList, ordered: true, items: [][]block{{
		{kind: blockHeading, role: roleSection, level: 2, inlines: []inline{{text: "ListHeading"}}},
		{kind: blockParagraph, role: roleLead, inlines: []inline{{text: "following content"}}},
	}}}
	if err := w.writeBlocks([]block{b}, 0); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := w.pdf.Output(&buf); err != nil {
		t.Fatal(err)
	}
	items := academicPDFText(t, buf.Bytes())
	marker := findPDFText(t, items, "1.")
	heading := findPDFText(t, items, "ListHeading")
	if marker.page != heading.page || marker.y != heading.y {
		t.Fatal("list marker orphaned from actual first line")
	}
}

func TestCitedPDFImageOnlyListItemKeepsItsMarker(t *testing.T) {
	doc, err := BuildCited("1. ![image](asset)\n2. Text", nil, Options{FetchImage: func(string) (*Image, error) { return &Image{Bytes: png1x1, MIME: "image/png"}, nil }})
	if err != nil {
		t.Fatal(err)
	}
	data, err := RenderCitedPDF(doc, requireAcademicFonts(t))
	if err != nil {
		t.Fatal(err)
	}
	items := academicPDFText(t, data)
	first := findPDFText(t, items, "1.")
	second := findPDFText(t, items, "2.")
	if first.page != second.page || first.y-second.y < 18 {
		t.Fatal("image item marker lost or overlapping next item")
	}
}

func TestCitedPDFJustifiesMeasuredWordsOnlyOnNonfinalLines(t *testing.T) {
	doc := Document{blocks: []block{{kind: blockParagraph, role: roleLead, inlines: []inline{{text: strings.Repeat("alpha beta gamma ", 25) + "FINAL"}}}}}
	data, err := RenderCitedPDF(doc, requireAcademicFonts(t))
	if err != nil {
		t.Fatal(err)
	}
	texts := academicPDFText(t, data)
	first := findPDFText(t, texts, "alpha")
	var line []pdfTextEvidence
	for _, p := range texts {
		if p.y == first.y {
			line = append(line, p)
		}
	}
	if len(line) < 4 {
		t.Fatal("no explicitly positioned word/space chunks")
	}
	// Independent natural TNR width of 'alpha' at 12 pt is 25.992 pt.
	if line[2].x-first.x <= 25.992+3.001 {
		t.Fatal("multibyte words not justified")
	}
	for _, stream := range pdfDecodedStreams(t, data) {
		for _, m := range regexp.MustCompile(`([0-9.-]+) Tw`).FindAllSubmatch(stream, -1) {
			v, _ := strconv.ParseFloat(string(m[1]), 64)
			if v != 0 {
				t.Fatal("nonzero Tw in UTF8 Text writer")
			}
		}
	}
	final := findPDFText(t, texts, "FINAL")
	if final.x >= 185*72/25.4-20 {
		t.Fatal("final line stretched")
	}
}

func TestCitedPDFMixedScriptsCodeAndUnsupportedGlyphs(t *testing.T) {
	fonts := requireAcademicFonts(t)
	doc := Document{blocks: []block{{kind: blockParagraph, role: roleLead, inlines: []inline{{text: "Latin中文Latin"}}}, {kind: blockCode, code: "é € α 中"}}}
	data, err := RenderCitedPDF(doc, fonts)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(data, []byte("/BaseFont /Courier")) {
		t.Fatal("code is not Courier")
	}
	texts := academicPDFText(t, data)
	latin := findPDFText(t, texts, "Latin")
	findPDFText(t, texts, "中文")
	findPDFText(t, texts, "α")
	findPDFText(t, texts, "中")
	cjkCount := 0
	for _, p := range texts {
		if p.text == "Latin" && p.font != latin.font {
			t.Fatal("Latin switched to CJK")
		}
		if p.font != latin.font && p.size == 12 {
			cjkCount++
		}
	}
	if cjkCount != 1 {
		t.Fatal("CJK span was not isolated")
	}
	var streams []byte
	for _, s := range pdfDecodedStreams(t, data) {
		streams = append(streams, s...)
	}
	if !bytes.Contains(streams, []byte{0xe9}) || !bytes.Contains(streams, []byte{0x80}) {
		t.Fatal("Courier CP1252 encoded text lost")
	}
	for _, tc := range []struct {
		text, escape string
	}{
		{"private-secret-😀", `\u{1F600}`},
		{"\u0378", `\u{0378}`},
	} {
		data, err := RenderCitedPDF(Document{blocks: []block{{kind: blockParagraph, inlines: []inline{{text: tc.text}}}}}, fonts)
		if err != nil || len(data) == 0 || errors.Is(err, errAcademicPDFGlyph) {
			t.Fatal("valid uncovered rune failed")
		}
		if !pdfPaintedContains(academicPDFText(t, data), tc.escape) {
			t.Fatalf("missing lossless escape %q", tc.escape)
		}
	}
	bad := string([]byte{255})
	data, err = RenderCitedPDF(Document{blocks: []block{{kind: blockParagraph, inlines: []inline{{text: bad}}}}}, fonts)
	if err == nil || data != nil || !errors.Is(err, errAcademicPDFGlyph) || strings.Contains(err.Error(), bad) {
		t.Fatal("invalid UTF-8 did not produce safe error")
	}
}

func TestCitedPDFReferenceLinkGapAndContinuation(t *testing.T) {
	doc := Document{blocks: []block{
		{kind: blockParagraph, role: roleReference, referenceIndex: 1, inlines: []inline{{text: strings.Repeat("reference ", 100)}}},
		{kind: blockParagraph, role: roleReferenceLinks, referenceIndex: 1, inlines: []inline{{text: "Article", href: "https://example.org"}}},
		{kind: blockParagraph, role: roleReference, referenceIndex: 2, inlines: []inline{{text: "Next"}}},
	}}
	data, err := RenderCitedPDF(doc, requireAcademicFonts(t))
	if err != nil {
		t.Fatal(err)
	}
	items := academicPDFText(t, data)
	link := findPDFText(t, items, "Article")
	next := findPDFText(t, items, "Next")
	if link.size != 10 || math.Abs(link.x-32.5*72/25.4) > 0.02 {
		t.Fatal("reference link alignment/size")
	}
	if math.Abs(link.y-next.y-18) > 0.02 {
		t.Fatalf("reference link should have single 6pt after gap: %+v %+v", link, next)
	}
	for _, p := range items {
		if p.text == "reference" && math.Abs(p.x-32.5*72/25.4) < 0.02 {
			return
		}
	}
	t.Fatal("missing hanging continuation")
}

func TestCitedPDFTableRetainsContent(t *testing.T) {
	doc := Document{blocks: []block{{kind: blockTable, rows: [][][]inline{{{{text: "must not vanish"}}}}}}}
	data, err := RenderCitedPDF(doc, requireAcademicFonts(t))
	if err != nil {
		t.Fatal(err)
	}
	items := academicPDFText(t, data)
	for _, word := range []string{"must", "not", "vanish"} {
		findPDFText(t, items, word)
	}
}

func TestCitedPDFImagesAndStyledNestedLists(t *testing.T) {
	calls := 0
	doc, err := BuildCited("# Report\n\n1. **First** item\n   - *Nested* [link](https://example.org/list)\n\nBefore ![available](asset) after ![Missing](unavailable).", nil, Options{FetchImage: func(href string) (*Image, error) {
		calls++
		if href == "asset" {
			return &Image{Bytes: png1x1, MIME: "image/png"}, nil
		}
		return nil, errors.New("unavailable")
	}})
	if err != nil {
		t.Fatal(err)
	}
	data, err := RenderCitedPDF(doc, requireAcademicFonts(t))
	if err != nil {
		t.Fatal(err)
	}
	if calls != 2 || !bytes.Contains(data, []byte("/Subtype /Image")) {
		t.Fatal("authorized image not preserved")
	}
	items := academicPDFText(t, data)
	first := findPDFText(t, items, "First")
	nested := findPDFText(t, items, "Nested")
	if nested.x <= first.x || first.font == nested.font {
		t.Fatal("nested list styles/indent lost")
	}
	findPDFText(t, items, "Before")
	findPDFText(t, items, "after")
	findPDFText(t, items, "Missing")
}

func TestCitedPDFLongParagraphPaginationAndHeadingReservation(t *testing.T) {
	doc, err := BuildCited("# Report\n\n## Start\n\n"+strings.Repeat("word ", 3000)+"LAST\n\n## End\n\nfollowing content here.", nil, Options{})
	if err != nil {
		t.Fatal(err)
	}
	data, err := RenderCitedPDF(doc, requireAcademicFonts(t))
	if err != nil {
		t.Fatal(err)
	}
	items := academicPDFText(t, data)
	words := 0
	pages := map[int]bool{}
	for _, p := range items {
		if p.text == "word" {
			words++
			pages[p.page] = true
		}
		if p.size != 9 && (p.y < 25*72/25.4-0.02 || p.y > 272*72/25.4+0.02) {
			t.Fatalf("body outside margins: %+v", p)
		}
	}
	if words != 3000 || len(pages) < 3 {
		t.Fatalf("pagination lost words: %d pages=%d", words, len(pages))
	}
	end := findPDFText(t, items, "End")
	following := findPDFText(t, items, "following")
	if end.page != following.page {
		t.Fatal("orphan heading")
	}
}

func pdfOutlineParents(data []byte) (ids, parents map[string]string) {
	ids = map[string]string{}
	parents = map[string]string{}
	objects := regexp.MustCompile(`(?s)(\d+) 0 obj\s*(.*?)endobj`)
	for _, m := range objects.FindAllSubmatch(data, -1) {
		title := regexp.MustCompile(`(?s)/Title \((.*?)\)`).FindSubmatch(m[2])
		parent := regexp.MustCompile(`/Parent (\d+) 0 R`).FindSubmatch(m[2])
		if len(title) < 2 || len(parent) < 2 {
			continue
		}
		raw := title[1]
		var codes []uint16
		for i := 2; i+1 < len(raw); i += 2 {
			codes = append(codes, uint16(raw[i])<<8|uint16(raw[i+1]))
		}
		label := string(utf16.Decode(codes))
		ids[label] = string(m[1])
		parents[label] = string(parent[1])
	}
	return ids, parents
}

func TestCitedPDFBookmarksRetainAuthoredDepthWithCanonicalReferences(t *testing.T) {
	for _, source := range []string{"### Title: Report\n\n### Section\n\n#### Sub\n\nText.", "### Section\n\n#### Sub\n\nText."} {
		doc, err := BuildCited(source, []citation.Row{{Citation: citation.Presentation{Runs: []citation.Run{{Text: "Reference"}}}}}, Options{})
		if err != nil {
			t.Fatal(err)
		}
		data, err := RenderCitedPDF(doc, requireAcademicFonts(t))
		if err != nil {
			t.Fatal(err)
		}
		ids, parents := pdfOutlineParents(data)
		if parents["Sub"] != ids["Section"] {
			t.Fatalf("subsection parent %v ids %v", parents, ids)
		}
		if ids["Report"] != "" && (parents["Section"] != ids["Report"] || parents["References"] != ids["Report"]) {
			t.Fatal("sections lost title parent")
		}
		if ids["Report"] == "" && parents["Section"] != parents["References"] {
			t.Fatal("untitled sections not at root")
		}
	}
}

// Removing a real face or flattening inline emphasis must fail on embedded SFNT
// metadata, not merely on the arbitrary BaseFont registration name.
func TestCitedPDFEmbedsGenuineFourFaces(t *testing.T) {
	fonts := requireAcademicFonts(t)
	before := cloneAcademicFonts(fonts)
	doc := Document{blocks: []block{{kind: blockParagraph, role: roleLead, inlines: []inline{
		{text: "Regular "}, {text: "Bold ", style: style{bold: true}}, {text: "Italic ", style: style{italic: true}}, {text: "Both", style: style{bold: true, italic: true}},
	}}}}
	data, err := RenderCitedPDF(doc, fonts)
	if err != nil {
		t.Fatal(err)
	}
	items := academicPDFText(t, data)
	selected := map[string]bool{}
	for _, text := range []string{"Regular", "Bold", "Italic", "Both"} {
		selected[findPDFText(t, items, text).font] = true
	}
	if len(selected) != 4 {
		t.Fatal("four styles did not select distinct font resources")
	}
	names := map[string]bool{}
	for _, stream := range pdfDecodedStreams(t, data) {
		if len(stream) > 4 && bytes.Equal(stream[:4], []byte{0, 1, 0, 0}) {
			record, err := parseAcademicTTF(stream)
			if err != nil {
				t.Fatal(err)
			}
			names[record.PostScriptName] = true
		}
	}
	for _, name := range []string{"TimesNewRomanPSMT", "TimesNewRomanPS-BoldMT", "TimesNewRomanPS-ItalicMT", "TimesNewRomanPS-BoldItalicMT"} {
		if !names[name] {
			t.Errorf("missing actual embedded face %s; got %v", name, names)
		}
	}
	for _, pair := range [][2]academicFace{{fonts.regular, before.regular}, {fonts.bold, before.bold}, {fonts.italic, before.italic}, {fonts.boldItalic, before.boldItalic}} {
		if !bytes.Equal(pair[0].data, pair[1].data) {
			t.Fatal("font input mutated")
		}
	}
}

func TestCitedPDFHeadingKeepsNestedFirstContent(t *testing.T) {
	prose := block{kind: blockParagraph, role: roleLead, inlines: []inline{{text: strings.Repeat("following ", 40)}}}
	for _, tc := range []struct {
		name  string
		next  block
		start float64
		depth int
	}{
		{"list", block{kind: blockList, items: [][]block{{prose}}}, 251, 1},
		{"quote", block{kind: blockQuote, children: []block{prose}}, 251, 1},
		{"quote-list", block{kind: blockQuote, children: []block{{kind: blockList, items: [][]block{{prose}}}}}, 251, 2},
		{"list-heading-chain", block{kind: blockList, items: [][]block{{{kind: blockHeading, role: roleSubsection, level: 3, inlines: []inline{{text: "NestedHeading"}}}, prose}}}, 241, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w, err := newAcademicPDFWriter(requireAcademicFonts(t))
			if err != nil {
				t.Fatal(err)
			}
			w.newPage()
			w.y = tc.start
			blocks := []block{{kind: blockHeading, role: roleSection, level: 2, inlines: []inline{{text: "Heading"}}}, tc.next}
			if err := w.writeBlocks(blocks, 0); err != nil {
				t.Fatal(err)
			}
			var buf bytes.Buffer
			if err := w.pdf.Output(&buf); err != nil {
				t.Fatal(err)
			}
			items := academicPDFText(t, buf.Bytes())
			head := findPDFText(t, items, "Heading")
			following := findPDFText(t, items, "following")
			if head.page != following.page || head.page != 2 {
				t.Fatalf("heading page=%d following page=%d", head.page, following.page)
			}
			if math.Abs(following.x-(25+float64(tc.depth)*7.5)*72/25.4) > 0.02 {
				t.Fatal("nested content indentation lost")
			}
			lines := map[float64]bool{}
			for _, p := range items {
				if p.text == "following" && p.page == head.page {
					lines[p.y] = true
				}
			}
			if len(lines) < 2 {
				t.Fatal("heading lacks following content's first two lines")
			}
			if tc.name == "list-heading-chain" && findPDFText(t, items, "NestedHeading").page != head.page {
				t.Fatal("keep-next heading chain split")
			}
		})
	}
}

func TestCitedPDFMultilineHeadingBookmarkUsesFinalFirstLinePage(t *testing.T) {
	w, err := newAcademicPDFWriter(requireAcademicFonts(t))
	if err != nil {
		t.Fatal(err)
	}
	w.newPage()
	w.y = 262.7
	heading := block{kind: blockHeading, role: roleSection, level: 2, inlines: []inline{{text: strings.Repeat("Heading ", 20)}}}
	if err := w.writeBlocks([]block{heading}, 0); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := w.pdf.Output(&buf); err != nil {
		t.Fatal(err)
	}
	items := academicPDFText(t, buf.Bytes())
	first := findPDFText(t, items, "Heading")
	if first.page != 2 {
		t.Fatal("fixture did not move multiline heading")
	}
	dest := regexp.MustCompile(`/Dest \[(\d+) 0 R /XYZ 0 ([0-9.]+) null\]`).FindSubmatch(buf.Bytes())
	if len(dest) != 3 {
		t.Fatal("missing actual bookmark destination")
	}
	object, _ := strconv.Atoi(string(dest[1]))
	y, _ := strconv.ParseFloat(string(dest[2]), 64)
	if object != 1+2*first.page || math.Abs(y-first.y-14) > 0.02 {
		t.Fatalf("bookmark page object=%d y=%f, actual heading=%+v", object, y, first)
	}
}
