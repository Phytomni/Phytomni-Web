package mdoc

import (
	"bytes"
	"errors"
	"image"
	"image/png"
	"math"
	"os"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"

	"phytomni-server/common/citation"
)

func TestPDFTableRendersAfterHeading(t *testing.T) {
	doc, err := BuildCited("## Results\n\n| First | Second |\n|:--|--:|\n| BODYONE | BODYTWO |", nil, Options{})
	if err != nil {
		t.Fatal(err)
	}
	data, err := RenderCitedPDF(doc, requireAcademicFonts(t))
	if err != nil {
		t.Fatalf("table after heading must render: %v", err)
	}
	items := academicPDFText(t, data)
	for _, token := range []string{"First", "Second", "BODYONE", "BODYTWO"} {
		findPDFText(t, items, token)
	}
	if findPDFText(t, items, "Results").page != findPDFText(t, items, "BODYONE").page {
		t.Fatal("orphan heading")
	}
}

func TestPDFTableOversizedRowsAndHeadersRetainSource(t *testing.T) {
	for _, tallHeader := range []bool{false, true} {
		header := "HEADER"
		if tallHeader {
			header = strings.Repeat("HEADERWORD ", 2200)
		}
		doc := Document{blocks: []block{{kind: blockTable, rows: [][][]inline{
			{{{text: header}}, {{text: "OTHERHEADER"}}},
			{{{text: strings.Repeat("BODYWORD ", 2500)}}, {{text: "SHORTCELL"}}},
			{{{text: "LASTCELL"}}},
		}}}}
		data, err := RenderCitedPDF(doc, requireAcademicFonts(t))
		if err != nil {
			t.Fatal(err)
		}
		items := academicPDFText(t, data)
		counts := map[string]int{}
		pages := map[int]bool{}
		for _, item := range items {
			counts[item.text]++
			pages[item.page] = true
		}
		if counts["BODYWORD"] != 2500 || counts["SHORTCELL"] != 1 || counts["LASTCELL"] != 1 {
			t.Fatalf("source loss: %v", counts)
		}
		// Each word fits a cell. Even one word/line has fewer than 100 pages
		// at the 10 pt line height; actual multiword lines must stay below 60.
		if len(pages) < 3 || len(pages) > 60 {
			t.Fatalf("unbounded or absent pagination: %d", len(pages))
		}
		if tallHeader && (counts["HEADERWORD"] != 2200 || counts["OTHERHEADER"] != 1) {
			t.Fatal("exceptional source header lost or repeated")
		}
		if !tallHeader && counts["HEADER"] < 3 {
			t.Fatal("ordinary header not repeated")
		}
	}
}

func tableTestImage(t *testing.T, width, height int) *Image {
	t.Helper()
	var out bytes.Buffer
	if err := png.Encode(&out, image.NewRGBA(image.Rect(0, 0, width, height))); err != nil {
		t.Fatal(err)
	}
	return &Image{Bytes: out.Bytes(), MIME: "image/png"}
}

func TestPDFTableStaggeredImagesStayIndivisibleAndInOrder(t *testing.T) {
	img := tableTestImage(t, 100, 640)
	doc := Document{blocks: []block{{kind: blockTable, rows: [][][]inline{
		{{{text: "FIRSTHEADER"}}, {{text: "SECONDHEADER"}}},
		{{{kind: inlineImage, image: img, text: "AVAILABLEALT"}, {text: "AFTERFIRST"}}, {{text: strings.Repeat("PREFIX\n", 20)}, {kind: inlineImage, image: img, text: "AVAILABLEALT"}, {text: "AFTERSECOND"}}},
	}}}}
	data, err := RenderCitedPDF(doc, requireAcademicFonts(t))
	if err != nil {
		t.Fatal(err)
	}
	items := academicPDFText(t, data)
	all := ""
	for _, item := range items {
		all += item.text
	}
	if strings.Contains(all, "AVAILABLEALT") || strings.Count(all, "PREFIX") != 20 {
		t.Fatal("admitted image replaced by alt or prefix lost")
	}
	first, second := findPDFText(t, items, "AFTERFIRST"), findPDFText(t, items, "AFTERSECOND")
	if first.page != 1 || second.page != 2 {
		t.Fatalf("staggered image continuation did not progress: %+v %+v", first, second)
	}
	count := 0
	for _, stream := range pdfDecodedStreams(t, data) {
		for _, m := range regexp.MustCompile(`q ([0-9.]+) 0 0 ([0-9.]+) ([0-9.]+) ([0-9.]+) cm /I[^ ]+ Do Q`).FindAllStringSubmatch(string(stream), -1) {
			count++
			values := make([]float64, 4)
			for i := range values {
				values[i], _ = strconv.ParseFloat(m[i+1], 64)
			}
			w, h, x, y := values[0], values[1], values[2], values[3]
			if math.Abs(w/h-100.0/640) > 0.0001 || w > 76*72/25.4+0.02 || x < 27*72/25.4-0.02 || x+w > 183*72/25.4+0.02 || y < 25*72/25.4-0.02 || y+h > 272*72/25.4+0.02 {
				t.Fatalf("image bounds/aspect lost: %v", values)
			}
		}
	}
	if count != 2 {
		t.Fatalf("images lost/repeated: %d", count)
	}
}

func TestPDFTableHeadingKeepsOversizedFirstRow(t *testing.T) {
	w, err := newAcademicPDFWriter(requireAcademicFonts(t))
	if err != nil {
		t.Fatal(err)
	}
	w.newPage()
	w.y = 245
	blocks := []block{{kind: blockHeading, role: roleSection, level: 2, inlines: []inline{{text: "KEEPTABLE"}}}, {kind: blockTable, rows: [][][]inline{
		{{{text: "HEAD"}}}, {{{text: strings.Repeat("DATALINE\n", 100)}}},
	}}}
	if err := w.writeBlocks(blocks, 0); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := w.pdf.Output(&out); err != nil {
		t.Fatal(err)
	}
	items := academicPDFText(t, out.Bytes())
	if findPDFText(t, items, "KEEPTABLE").page != findPDFText(t, items, "DATALINE").page {
		t.Fatal("oversized first row orphaned preceding heading")
	}
}

func TestPDFTableMeasuresTallestCellAndPreservesFragments(t *testing.T) {
	styled := pdfFragment{text: "Bold code linked citation", style: style{bold: true, italic: true, code: true}, sizePt: 8, risePt: 3, href: "https://example.org", target: 7}
	rows := [][][]pdfFragment{{{{text: "Short", sizePt: 10}}, {{text: "Header", sizePt: 10}}}, {{{text: "A", sizePt: 10}}, {styled}, {{text: strings.Repeat("long cell ", 40), sizePt: 10}}}, {{{text: "LAST", sizePt: 10}}}}
	planned, err := planPDFTableRows(rows, []tableAlignment{alignLeft, alignCenter, alignRight}, 160, func(s string, _ style, _ float64) float64 { return float64(utf8.RuneCountInString(s)) })
	if err != nil {
		t.Fatal(err)
	}
	if len(planned) != 3 || !planned[0].header || planned[1].header || planned[1].heightMM <= planned[0].heightMM {
		t.Fatal("header/tallest-cell measurement lost")
	}
	for i, row := range planned {
		if len(row.cells) != 3 {
			t.Fatal("ragged source truncated")
		}
		for j, cell := range row.cells {
			if cell.alignment != []tableAlignment{alignLeft, alignCenter, alignRight}[j] {
				t.Fatal("semantic alignment lost")
			}
			var text strings.Builder
			for _, line := range cell.lines {
				if line.widthMM > 160.0/3-4+1e-9 {
					t.Fatal("line exceeds padding")
				}
				for _, f := range line.fragments {
					text.WriteString(f.fragment.text)
					if i == 1 && j == 1 {
						got := f.fragment
						got.text = styled.text
						if !reflect.DeepEqual(got, styled) {
							t.Fatal("fragment metadata lost")
						}
					}
				}
			}
			want := ""
			if j < len(rows[i]) {
				for _, f := range rows[i][j] {
					want += f.text
				}
			}
			if text.String() != want {
				t.Fatal("cell source loss")
			}
		}
	}
	if math.Abs(planned[0].heightMM-(4+10*1.2*25.4/72)) > 1e-9 {
		t.Fatal("10pt/1.2/2mm metrics drift")
	}
}

func TestPDFTableRejectsImpossibleGeometry(t *testing.T) {
	rows := [][][]pdfFragment{{{{text: "X", sizePt: 10}}}}
	for _, width := range []float64{0, 4, -1, math.NaN(), math.Inf(1)} {
		if _, err := planPDFTableRows(rows, nil, width, func(string, style, float64) float64 { return 1 }); err == nil {
			t.Errorf("accepted width %v", width)
		}
	}
	if _, err := planPDFTableRows(nil, nil, 160, func(string, style, float64) float64 { return 1 }); err == nil {
		t.Fatal("accepted empty table")
	}
	for _, measure := range []pdfMeasure{nil, func(string, style, float64) float64 { return math.NaN() }, func(string, style, float64) float64 { return math.Inf(1) }, func(string, style, float64) float64 { return 200 }} {
		if _, err := planPDFTableRows(rows, nil, 160, measure); err == nil {
			t.Fatal("accepted impossible measurement")
		}
	}
}

func TestPDFTableFixtureAllCellsStylesLinksAndBounds(t *testing.T) {
	src, err := os.ReadFile("../testdata/academic-table.txt")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := BuildCited(string(src), []citation.Row{{Citation: citation.Presentation{Runs: []citation.Run{{Text: "Reference entry"}}}}}, Options{})
	if err != nil {
		t.Fatal(err)
	}
	tables := 0
	for _, b := range doc.blocks {
		if b.kind == blockTable {
			tables++
			if !reflect.DeepEqual(b.alignments, []tableAlignment{alignLeft, alignRight}) {
				t.Fatal("Goldmark alignment lost")
			}
		}
	}
	if tables != 2 {
		t.Fatal("fixture tables not parsed")
	}
	data, err := RenderCitedPDF(doc, requireAcademicFonts(t))
	if err != nil {
		t.Fatal(err)
	}
	items := academicPDFText(t, data)
	counts := map[string]int{}
	dataPages := map[int]bool{}
	columnsPerPage := map[int]int{}
	for _, item := range items {
		counts[item.text]++
		if item.text == "Column" {
			columnsPerPage[item.page]++
		}
		if strings.HasPrefix(item.text, "E0") {
			dataPages[item.page] = true
		}
		if item.size != 9 && (item.x < 25*72/25.4-0.02 || item.x > 185*72/25.4+0.02 || item.y < 25*72/25.4-0.02 || item.y > 272*72/25.4+0.02) {
			t.Fatalf("text outside margin: %+v", item)
		}
	}
	for _, token := range regexp.MustCompile(`\b(?:R\d{3}[LR]|T\d{4}|H\d{4}|E\d{3}[LR])\b`).FindAllString(string(src), -1) {
		if counts[token] != 1 {
			t.Errorf("source token %s occurs %d times", token, counts[token])
		}
	}
	for _, token := range []string{"RAGGEDCELL", "SHORTTALL", "FULLHEADERSECOND", "BOLDCELL", "ITALICCELL", "BOTHCELL", "CODECELL", "LINKCELL", "植物"} {
		if counts[token] != 1 {
			t.Errorf("lost/duplicated %s", token)
		}
	}
	regular := findPDFText(t, items, "STYLEEND")
	fonts := map[string]bool{regular.font: true}
	for _, token := range []string{"BOLDCELL", "ITALICCELL", "BOTHCELL", "CODECELL", "植物"} {
		fonts[findPDFText(t, items, token).font] = true
	}
	if len(fonts) != 6 {
		t.Fatal("table font/script/style partition flattened")
	}
	if findPDFText(t, items, "CODECELL").size != 9 || regular.size != 10 {
		t.Fatal("table/code sizes lost")
	}
	if !bytes.Contains(data, []byte("https://example.org/table")) || !bytes.Contains(data, []byte("/Dest [")) {
		t.Fatal("table external/internal links absent")
	}
	if counts["LEFTHEADER"] < 3 || len(dataPages) < 2 {
		t.Fatal("missing continued ordinary/exceptional table pages")
	}
	firstData, lastData := 10000, 0
	for page := range dataPages {
		firstData = min(firstData, page)
		lastData = max(lastData, page)
	}
	for page := firstData; page <= lastData; page++ {
		if !dataPages[page] || columnsPerPage[page] != 2 {
			t.Fatal("blank exceptional data page or missing compact mapping header")
		}
	}
	assertPDFTableRectangles(t, data, 25)
}

func TestPDFTableUnsupportedGlyphReturnsControlledError(t *testing.T) {
	doc := Document{blocks: []block{{kind: blockTable, rows: [][][]inline{{{{text: "\U0001f9ec"}}}}}}}
	data, err := RenderCitedPDF(doc, requireAcademicFonts(t))
	if data != nil || !errors.Is(err, errAcademicPDFGlyph) {
		t.Fatal("unsupported table glyph silently substituted")
	}
}

func TestPDFTableCellCitationAndExternalHitRectanglesFollowPaint(t *testing.T) {
	doc, err := BuildCited("| A | B |\n|--|--|\n| Base [1] [link](https://example.org/cell-hit) | End |", []citation.Row{{Citation: citation.Presentation{Runs: []citation.Run{{Text: "Entry"}}}}}, Options{})
	if err != nil {
		t.Fatal(err)
	}
	fonts := requireAcademicFonts(t)
	data, err := RenderCitedPDF(doc, fonts)
	if err != nil {
		t.Fatal(err)
	}
	items := academicPDFText(t, data)
	base, link := findPDFText(t, items, "Base"), findPDFText(t, items, "link")
	mark := pdfTextEvidence{}
	for _, item := range items {
		if item.text == "1" && item.size == 8 {
			mark = item
		}
	}
	if mark.text == "" || math.Abs(mark.y-base.y-3) > 0.02 || base.size != 10 {
		t.Fatal("cell citation rise/size lost")
	}
	ann := regexp.MustCompile(`/Subtype /Link /Rect \[([0-9. -]+)\] /Border \[0 0 0\] /A <</S /URI /URI \(https://example.org/cell-hit\)>>`).FindSubmatch(data)
	if len(ann) != 2 {
		t.Fatal("missing real external cell annotation")
	}
	v := strings.Fields(string(ann[1]))
	rect := make([]float64, len(v))
	for i, s := range v {
		rect[i], _ = strconv.ParseFloat(s, 64)
	}
	w, err := newAcademicPDFWriter(fonts)
	if err != nil {
		t.Fatal(err)
	}
	if len(rect) != 4 || math.Abs(rect[0]-link.x) > 0.02 || math.Abs(rect[2]-rect[0]-w.measure("link", style{}, 10)*72/25.4) > 0.02 || math.Abs(rect[1]-link.y-10) > 0.02 || math.Abs(rect[3]-link.y+2) > 0.02 {
		t.Fatalf("link hit geometry diverges: %v %+v", rect, link)
	}
}

func TestPDFTableActualRaggedGridRetainsExtraCell(t *testing.T) {
	doc := Document{blocks: []block{{kind: blockTable, rows: [][][]inline{
		{{{text: "H1"}}, {{text: "H2"}}},
		{{{text: "R1"}}, {{text: "R2"}}, {{text: "EXTRACELL"}}},
		{{{text: "RAGGEDFINAL"}}},
	}}}}
	data, err := RenderCitedPDF(doc, requireAcademicFonts(t))
	if err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	for _, item := range academicPDFText(t, data) {
		counts[item.text]++
	}
	for _, token := range []string{"H1", "H2", "R1", "R2", "EXTRACELL", "RAGGEDFINAL"} {
		if counts[token] != 1 {
			t.Fatalf("ragged source lost/duplicated: %s", token)
		}
	}
	assertPDFTableRectangles(t, data, 25)
}

func TestPDFTableRejectsHeaderLeavingNoBodyLine(t *testing.T) {
	doc := Document{blocks: []block{{kind: blockTable, rows: [][][]inline{
		{{{text: strings.TrimSuffix(strings.Repeat("HEADER\n", 57), "\n")}}},
		{{{text: "BODY"}}},
	}}}}
	data, err := RenderCitedPDF(doc, requireAcademicFonts(t))
	if data != nil || !errors.Is(err, errPDFLayout) {
		t.Fatal("impossible ordinary header/body budget accepted")
	}
}

func assertPDFTableRectangles(t *testing.T, data []byte, leftMM float64) {
	t.Helper()
	count := 0
	for _, stream := range pdfDecodedStreams(t, data) {
		for _, m := range regexp.MustCompile(`([0-9.-]+) ([0-9.-]+) ([0-9.-]+) ([0-9.-]+) re S`).FindAllStringSubmatch(string(stream), -1) {
			count++
			v := make([]float64, 4)
			for i := range v {
				v[i], _ = strconv.ParseFloat(m[i+1], 64)
			}
			if v[0] < leftMM*72/25.4-0.02 || v[0]+v[2] > 185*72/25.4+0.02 || v[1] > 272*72/25.4+0.02 || v[1]+v[3] < 25*72/25.4-0.02 {
				t.Fatalf("cell rectangle outside margins: %v", v)
			}
		}
	}
	if count == 0 {
		t.Fatal("no actual table rectangles")
	}
}

func TestPDFTableNestedWidthAndActualAlignment(t *testing.T) {
	table := block{kind: blockTable, alignments: []tableAlignment{alignLeft, alignCenter, alignRight}, rows: [][][]inline{{{{text: "LEFT"}}, {{text: "CENTER"}}, {{text: "RIGHT"}}}}}
	doc := Document{blocks: []block{{kind: blockQuote, children: []block{table}}}}
	fonts := requireAcademicFonts(t)
	data, err := RenderCitedPDF(doc, fonts)
	if err != nil {
		t.Fatal(err)
	}
	assertPDFTableRectangles(t, data, 32.5)
	w, err := newAcademicPDFWriter(fonts)
	if err != nil {
		t.Fatal(err)
	}
	items := academicPDFText(t, data)
	for i, token := range []string{"LEFT", "CENTER", "RIGHT"} {
		item := findPDFText(t, items, token)
		width := w.measure(token, style{}, 10)
		x := 34.5 + float64(i)*152.5/3
		if i == 1 {
			x += (152.5/3 - 4 - width) / 2
		}
		if i == 2 {
			x += 152.5/3 - 4 - width
		}
		if math.Abs(item.x-x*72/25.4) > 0.02 {
			t.Fatalf("alignment: %+v want x %v", item, x)
		}
	}
}

func TestPDFTableExceptionalHeaderImageKeepsHeadingAndMakesProgress(t *testing.T) {
	w, err := newAcademicPDFWriter(requireAcademicFonts(t))
	if err != nil {
		t.Fatal(err)
	}
	w.newPage()
	w.y = 180
	img := tableTestImage(t, 100, 640)
	blocks := []block{{kind: blockHeading, role: roleSection, level: 2, inlines: []inline{{text: "IMAGEHEADERHEADING"}}}, {kind: blockTable, rows: [][][]inline{
		{{{kind: inlineImage, image: img}, {text: strings.Repeat("HEADTAIL\n", 80)}}},
		{{{text: "DATAAFTERIMAGEHEADER"}}},
	}}}
	if err := w.writeBlocks(blocks, 0); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := w.pdf.Output(&out); err != nil {
		t.Fatal(err)
	}
	items := academicPDFText(t, out.Bytes())
	heading := findPDFText(t, items, "IMAGEHEADERHEADING")
	// The first preserved source item is an indivisible, tall
	// image; its mapping label and heading must not be stranded on an earlier page.
	firstImagePage := 0
	page := 0
	count := 0
	for _, stream := range pdfDecodedStreams(t, out.Bytes()) {
		if !bytes.Contains(stream, []byte(" Tj")) {
			continue
		}
		page++
		if bytes.Contains(stream, []byte(" Do Q")) {
			count++
			if firstImagePage == 0 {
				firstImagePage = page
			}
		}
	}
	if firstImagePage != heading.page || count != 1 {
		t.Fatalf("image header orphaned: heading%v imagepage%d count%d", heading, firstImagePage, count)
	}
	findPDFText(t, items, "DATAAFTERIMAGEHEADER")
	assertPDFTableRectangles(t, out.Bytes(), 25)
}

func TestPDFTableExceptionalHeaderTallImageFitsWithMappingNote(t *testing.T) {
	doc := Document{blocks: []block{{kind: blockTable, rows: [][][]inline{
		{{{kind: inlineImage, image: tableTestImage(t, 100, 2000)}, {text: strings.Repeat("CONTINUEDHEADER\n", 80)}}},
		{{{text: "BODYAFTERTALLHEADER"}}},
	}}}}
	data, err := RenderCitedPDF(doc, requireAcademicFonts(t))
	if err != nil {
		t.Fatal(err)
	}
	for _, stream := range pdfDecodedStreams(t, data) {
		if bytes.Contains(stream, []byte(" Tj")) {
			if !bytes.Contains(stream, []byte(" Do Q")) {
				t.Fatal("mapping note page consumes no source header image")
			}
			break
		}
	}
	assertPDFTableRectangles(t, data, 25)
}
