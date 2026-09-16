package mdoc

import (
	"bytes"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/jung-kurt/gofpdf"
	"phytomni-server/common/document_format/external_format"
)

const academicPDFTNR = "academic-tnr"
const academicPDFCJK = "academic-cjk"
const academicPDFSymbol = "academic-symbol"
const academicPDFHelvetica = "Helvetica"
const pdfPtMM = 25.4 / 72

var errAcademicPDF = errors.New("academic PDF could not be rendered")
var errAcademicPDFGlyph = errors.New("academic PDF contains an unsupported glyph")

var fixedPDFCJK struct {
	sync.Once
	data   []byte
	glyphs map[uint16]uint16
	err    error
}

var fixedPDFSymbol struct {
	sync.Once
	data   []byte
	glyphs map[uint16]uint16
	err    error
}

// RenderCitedPDF consumes the reviewed semantic document; ordinary Chat keeps
// using RenderPDF. This entrypoint does not fetch resources or parse Markdown.
func RenderCitedPDF(doc Document, fonts AcademicFonts) (data []byte, err error) {
	defer func() {
		if recover() != nil {
			data = nil
			err = errAcademicPDF
		}
	}()
	if academicPDFInvalidUTF8(doc) {
		return nil, errAcademicPDFGlyph
	}
	doc = normalizeScientificDocument(doc)
	w, err := newAcademicPDFWriter(fonts)
	if err != nil {
		return nil, err
	}
	defer w.pdf.SetWordSpacing(0)
	w.links = map[int]int{}
	for _, b := range doc.blocks {
		if b.role == roleReference && b.referenceIndex > 0 {
			w.links[b.referenceIndex] = w.pdf.AddLink()
		}
		if b.role == roleTitle {
			w.headingOffset = 1
		}
	}
	w.newPage()
	if err := w.writeBlocks(doc.blocks, 0); err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := w.pdf.Output(&buf); err != nil {
		return nil, errAcademicPDF
	}
	return buf.Bytes(), nil
}

type academicPDFWriter struct {
	pdf                       *gofpdf.Fpdf
	fonts                     AcademicFonts
	y                         float64
	links                     map[int]int
	headingOffset, imgN       int
	cjkReady, cjkFailed       bool
	symbolReady, symbolFailed bool
	asciiFamily               string
	tnrStyle                  map[string]bool
	translate                 func(string) string
	marker                    *pdfListMarker
}

type pdfListMarker struct {
	text  string
	depth int
}

func newAcademicPDFWriter(fonts AcademicFonts) (*academicPDFWriter, error) {
	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(academicPageMarginMM, academicPageMarginMM, academicPageMarginMM)
	pdf.SetAutoPageBreak(false, academicPageMarginMM)
	w := &academicPDFWriter{
		pdf:         pdf,
		fonts:       fonts,
		asciiFamily: academicPDFHelvetica,
		tnrStyle:    map[string]bool{},
		translate:   pdf.UnicodeTranslatorFromDescriptor(""),
	}
	faces := []academicFace{fonts.regular, fonts.bold, fonts.italic, fonts.boldItalic}
	for i, st := range []string{"", "B", "I", "BI"} {
		f := faces[i]
		if !validAcademicTNRFace(f, academicFontSpecs[i]) {
			continue
		}
		pdf.AddUTF8FontFromBytes(academicPDFTNR, st, bytes.Clone(f.data))
		pdf.SetFont(academicPDFTNR, st, 12)
		if pdf.Error() != nil {
			pdf.ClearError()
			continue
		}
		w.tnrStyle[st] = true
	}
	if len(w.tnrStyle) > 0 {
		w.asciiFamily = academicPDFTNR
	} else {
		pdf.SetFont(academicPDFHelvetica, "", 12)
		if pdf.Error() != nil {
			return nil, errAcademicPDF
		}
	}
	pdf.SetFooterFunc(func() {
		pdf.SetWordSpacing(0)
		pdf.SetTextColor(0, 0, 0)
		family, face := w.asciiFont(style{})
		pdf.SetFont(family, face, academicFooterFontSizePt)
		s := fmt.Sprint(pdf.PageNo())
		pdf.Text((academicPageWidthMM-pdf.GetStringWidth(s))/2, academicPageHeightMM-academicPageMarginMM/2, s)
	})
	return w, nil
}

func validAcademicTNRFace(face academicFace, spec academicFontSpec) bool {
	return len(face.glyphs) > 0 && face.postScriptName == spec.postScriptName && validateAcademicSFNT(face.data) == ""
}

func academicPDFInvalidUTF8(doc Document) bool {
	return academicPDFBlocksInvalidUTF8(doc.blocks)
}

func academicPDFBlocksInvalidUTF8(blocks []block) bool {
	for _, b := range blocks {
		if academicPDFInlinesInvalidUTF8(b.inlines) || !utf8.ValidString(b.code) || academicPDFBlocksInvalidUTF8(b.children) {
			return true
		}
		for _, item := range b.items {
			if academicPDFBlocksInvalidUTF8(item) {
				return true
			}
		}
		for _, row := range b.rows {
			for _, cell := range row {
				if academicPDFInlinesInvalidUTF8(cell) {
					return true
				}
			}
		}
	}
	return false
}

func academicPDFInlinesInvalidUTF8(inlines []inline) bool {
	for _, in := range inlines {
		if !utf8.ValidString(in.text) {
			return true
		}
	}
	return false
}

func pdfFontStyle(st style) string {
	s := ""
	if st.bold {
		s += "B"
	}
	if st.italic {
		s += "I"
	}
	return s
}

func loadFixedPDFCJK() error {
	fixedPDFCJK.Do(func() {
		fixedPDFCJK.data, fixedPDFCJK.err = external_format.CJKFontBytes()
		if fixedPDFCJK.err != nil {
			return
		}
		record, err := parseAcademicTTF(fixedPDFCJK.data)
		fixedPDFCJK.err = err
		fixedPDFCJK.glyphs = record.Chars
	})
	if fixedPDFCJK.err != nil {
		return errAcademicPDF
	}
	return nil
}

func loadFixedPDFSymbol() error {
	fixedPDFSymbol.Do(func() {
		fixedPDFSymbol.data, fixedPDFSymbol.err = external_format.ScientificSymbolFontBytes()
		if fixedPDFSymbol.err != nil {
			return
		}
		record, err := parseAcademicTTF(fixedPDFSymbol.data)
		fixedPDFSymbol.err = err
		fixedPDFSymbol.glyphs = record.Chars
	})
	if fixedPDFSymbol.err != nil {
		return errAcademicPDF
	}
	return nil
}

func (w *academicPDFWriter) cjk() error {
	if err := loadFixedPDFCJK(); err != nil {
		return err
	}
	return w.registerFixedUTF8(academicPDFCJK, fixedPDFCJK.data, []string{"", "B"}, &w.cjkReady, &w.cjkFailed)
}

func (w *academicPDFWriter) symbol() error {
	if err := loadFixedPDFSymbol(); err != nil {
		return err
	}
	return w.registerFixedUTF8(academicPDFSymbol, fixedPDFSymbol.data, []string{"", "B"}, &w.symbolReady, &w.symbolFailed)
}

func (w *academicPDFWriter) registerFixedUTF8(family string, data []byte, styles []string, ready, failed *bool) error {
	if *ready {
		return nil
	}
	if *failed {
		return errAcademicPDF
	}
	for _, st := range styles {
		w.pdf.AddUTF8FontFromBytes(family, st, bytes.Clone(data))
		w.pdf.SetFont(family, st, 12)
		if w.pdf.Error() != nil {
			w.pdf.ClearError()
			*failed = true
			return errAcademicPDF
		}
	}
	*ready = true
	return nil
}

func pdfCourierRune(r rune) bool {
	return r >= 32 && r <= 126 || r >= 160 && r <= 255 || strings.ContainsRune("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ", r)
}

func pdfCoveredGlyph(glyphs map[uint16]uint16, r rune) bool {
	return r >= 32 && r <= 0xffff && glyphs[uint16(r)] != 0
}

func pdfGlyphEscape(r rune) string {
	return fmt.Sprintf("\\u{%04X}", r)
}

func pdfTNRStyleOrder(requested string) []string {
	switch requested {
	case "B":
		return []string{"B", "BI", "", "I"}
	case "I":
		return []string{"I", "BI", "", "B"}
	case "BI":
		return []string{"BI", "B", "I", ""}
	default:
		return []string{"", "I", "B", "BI"}
	}
}

func (w *academicPDFWriter) tnrFace(style string) academicFace {
	switch style {
	case "B":
		return w.fonts.bold
	case "I":
		return w.fonts.italic
	case "BI":
		return w.fonts.boldItalic
	default:
		return w.fonts.regular
	}
}

func (w *academicPDFWriter) closestTNRStyle(requested string) string {
	for _, face := range pdfTNRStyleOrder(requested) {
		if w.tnrStyle[face] {
			return face
		}
	}
	return ""
}

func (w *academicPDFWriter) asciiFont(st style) (family, face string) {
	requested := pdfFontStyle(st)
	if w.asciiFamily == academicPDFTNR {
		return academicPDFTNR, w.closestTNRStyle(requested)
	}
	return academicPDFHelvetica, requested
}

func (w *academicPDFWriter) lookupASCII(r rune, st style) (family, face string, ok bool) {
	requested := pdfFontStyle(st)
	if len(w.tnrStyle) > 0 {
		for _, face := range pdfTNRStyleOrder(requested) {
			if !w.tnrStyle[face] {
				continue
			}
			if pdfCoveredGlyph(w.tnrFace(face).glyphs, r) {
				return academicPDFTNR, face, true
			}
		}
		return "", "", false
	}
	if pdfCourierRune(r) {
		return academicPDFHelvetica, requested, true
	}
	return "", "", false
}

func (w *academicPDFWriter) lookupFixed(r rune, st style, load, register func() error, glyphs *map[uint16]uint16, family string) (string, string, bool) {
	if r < 32 || r > 0xffff || load() != nil || !pdfCoveredGlyph(*glyphs, r) || register() != nil {
		return "", "", false
	}
	// Only the existing regular resource is available; B is the established
	// alias, not a claim of genuine bold/italic font fidelity.
	face := ""
	if st.bold {
		face = "B"
	}
	return family, face, true
}

func (w *academicPDFWriter) lookupFont(r rune, st style) (family, face string, ok bool) {
	if r == '\n' || r == '\t' {
		r = ' '
	}
	if st.code {
		if pdfCourierRune(r) {
			return academicCodePDFFamily, pdfFontStyle(st), true
		}
	} else if family, face, ok = w.lookupASCII(r, st); ok {
		return family, face, true
	}
	if family, face, ok = w.lookupFixed(r, st, loadFixedPDFCJK, w.cjk, &fixedPDFCJK.glyphs, academicPDFCJK); ok {
		return family, face, true
	}
	return w.lookupFixed(r, st, loadFixedPDFSymbol, w.symbol, &fixedPDFSymbol.glyphs, academicPDFSymbol)
}

func (w *academicPDFWriter) fontFor(r rune, st style) (family, face string, err error) {
	family, face, ok := w.lookupFont(r, st)
	if !ok {
		family, face = w.asciiFont(st)
	}
	return family, face, nil
}

func (w *academicPDFWriter) replaceUncovered(text string, st style) string {
	var b strings.Builder
	b.Grow(len(text))
	for _, r := range text {
		probe := r
		if probe == '\n' || probe == '\t' {
			probe = ' '
		}
		if _, _, ok := w.lookupFont(probe, st); ok {
			b.WriteRune(r)
			continue
		}
		b.WriteString(pdfGlyphEscape(r))
	}
	return b.String()
}

func (w *academicPDFWriter) selectText(text string, st style, size float64) (string, error) {
	r, _ := utf8.DecodeRuneInString(text)
	family, face, err := w.fontFor(r, st)
	if err != nil {
		return "", err
	}
	w.pdf.SetFont(family, face, size)
	if w.pdf.Error() != nil {
		return "", errAcademicPDF
	}
	text = strings.ReplaceAll(text, "\t", "    ")
	if family == academicCodePDFFamily || family == academicPDFHelvetica {
		text = w.translate(text)
	}
	return text, nil
}

func (w *academicPDFWriter) measure(text string, st style, size float64) float64 {
	if text == "\n" {
		return 0
	}
	value, err := w.selectText(text, st, size)
	if err != nil {
		return math.NaN()
	}
	return w.pdf.GetStringWidth(value)
}

func (w *academicPDFWriter) fragments(inlines []inline, layout paragraphLayout) ([]pdfFragment, error) {
	var out []pdfFragment
	for _, in := range inlines {
		if in.text == "" {
			continue
		}
		if !utf8.ValidString(in.text) {
			return nil, errAcademicPDFGlyph
		}
		value := strings.ReplaceAll(strings.ReplaceAll(in.text, "\r\n", "\n"), "\r", "\n")
		f := pdfFragment{text: value, style: in.style, sizePt: layout.sizePt}
		f.style.bold = f.style.bold || layout.bold
		f.text = w.replaceUncovered(f.text, f.style)
		if in.style.code {
			f.sizePt = academicCodeFontSizePt
		}
		if validWordLink(in.href) {
			f.href = in.href
		}
		if in.style.vertical != verticalBaseline {
			base := f.sizePt
			f.sizePt = base * 2 / 3
			f.risePt = base / 4
			if in.style.vertical == verticalSubscript {
				f.risePt = -f.risePt
			}
		}
		if in.citation != nil {
			f.sizePt = academicCitationFontSizePt
			f.risePt = academicCitationRisePt
			f.href = ""
			active := in.citation.active && len(in.citation.indices) > 0
			for _, index := range in.citation.indices {
				active = active && w.links[index] > 0
			}
			if active {
				f.target = w.links[in.citation.indices[0]]
			}
		}
		start := 0
		lastFamily, lastFace := "", ""
		for pos, r := range f.text {
			family, face, err := w.fontFor(r, f.style)
			if err != nil {
				return nil, err
			}
			if pos > start && (family != lastFamily || face != lastFace) {
				part := f
				part.text = f.text[start:pos]
				out = append(out, part)
				start = pos
			}
			lastFamily, lastFace = family, face
		}
		f.text = f.text[start:]
		out = append(out, f)
	}
	return out, nil
}

func (w *academicPDFWriter) newPage() {
	if w.pdf.PageNo() > 0 {
		w.pdf.SetWordSpacing(0)
	}
	w.pdf.AddPage()
	w.y = academicPageMarginMM
}
func (w *academicPDFWriter) reserve(height float64) {
	if w.y+height > academicPageHeightMM-academicPageMarginMM+1e-9 && w.y > academicPageMarginMM {
		w.newPage()
	}
}

type academicPDFParagraph struct {
	lines                        []pdfMeasuredLine
	layout                       paragraphLayout
	x, firstX, width, firstWidth float64
}

func (w *academicPDFWriter) plan(b block, depth int) (academicPDFParagraph, error) {
	layout := academicLayout(b.role)
	if b.kind == blockCode {
		layout = paragraphLayout{sizePt: academicCodeFontSizePt, lineMultiple: 1.2, afterPt: 6}
		b.inlines = []inline{{text: b.code, style: style{code: true}}}
	}
	x := academicPageMarginMM + float64(depth)*7.5
	if depth > 0 {
		layout.firstIndentMM = 0
	}
	if b.role == roleReferenceLinks {
		x += academicLayout(roleReference).hangingMM
	}
	firstX := x + layout.firstIndentMM
	x += layout.hangingMM
	if b.role == roleReference {
		firstX = x
	}
	runs, err := w.fragments(b.inlines, layout)
	if err != nil {
		return academicPDFParagraph{}, err
	}
	width := academicPageWidthMM - academicPageMarginMM - x
	firstWidth := academicPageWidthMM - academicPageMarginMM - firstX
	lines, err := wrapPDFRuns(runs, firstWidth, width, w.measure)
	return academicPDFParagraph{lines, layout, x, firstX, width, firstWidth}, err
}

func (w *academicPDFWriter) paint(line pdfMeasuredLine, x, baseline float64) error {
	defer w.pdf.SetWordSpacing(0)
	for _, p := range line.fragments {
		f := p.fragment
		if f.text == "\n" || f.text == "" {
			continue
		}
		text, err := w.selectText(f.text, f.style, f.sizePt)
		if err != nil {
			return err
		}
		px, py := x+p.xMM, baseline-f.risePt*pdfPtMM
		w.pdf.SetTextColor(0, 0, 0)
		if f.href != "" {
			w.pdf.SetTextColor(5, 99, 193)
		}
		w.pdf.Text(px, py, text)
		if f.style.strike {
			w.pdf.Line(px, py-f.sizePt*pdfPtMM*.3, px+p.widthMM, py-f.sizePt*pdfPtMM*.3)
		}
		top, height := py-f.sizePt*pdfPtMM, f.sizePt*pdfPtMM*1.2
		if f.href != "" {
			w.pdf.LinkString(px, top, p.widthMM, height, f.href)
			w.pdf.SetDrawColor(5, 99, 193)
			w.pdf.Line(px, py+0.3, px+p.widthMM, py+0.3)
			w.pdf.SetDrawColor(0, 0, 0)
		}
		if f.target > 0 {
			w.pdf.Link(px, top, p.widthMM, height, f.target)
		}
	}
	if w.pdf.Error() != nil {
		return errAcademicPDF
	}
	return nil
}

// Measure the same first text content that container traversal will paint,
// including nested indentation and any intervening keep-next headings.
func (w *academicPDFWriter) keepNextHeight(blocks []block, depth int) (float64, error) {
	height := 0.0
	for _, b := range blocks {
		switch b.kind {
		case blockList:
			if len(b.items) == 0 {
				continue
			}
			item := b.items[0]
			if len(item) == 0 {
				return height + 18*pdfPtMM, nil
			}
			// These first-child kinds render the outer marker on its own line.
			if item[0].kind == blockList || item[0].kind == blockQuote || item[0].kind == blockHR {
				height += 18 * pdfPtMM
			}
			nested, err := w.keepNextHeight(item, depth+1)
			return height + nested, err
		case blockQuote:
			nested, err := w.keepNextHeight(b.children, depth+1)
			if err != nil || nested > 0 {
				return height + nested, err
			}
		case blockHR:
			height += 3
		case blockTable:
			rows, _, width, err := w.planTable(b, depth)
			if err != nil {
				return 0, err
			}
			first, err := w.tableFirstHeight(rows, width, depth)
			return height + first, err
		default:
			p, err := w.plan(b, depth)
			if err != nil {
				return 0, err
			}
			height += p.layout.beforePt * pdfPtMM
			if !p.layout.keepNext {
				return height + pdfLinesHeight(p.lines[:min(2, len(p.lines))], p.layout), nil
			}
			height += pdfLinesHeight(p.lines, p.layout) + p.layout.afterPt*pdfPtMM
		}
	}
	return height, nil
}

func (w *academicPDFWriter) writeParagraph(b block, depth int, after bool, following []block, sectionLevel int) error {
	var next *block
	if len(following) > 0 {
		next = &following[0]
	}
	// Images interrupt the text flow without being re-fetched or widening the
	// authorized image surface. Each surrounding text segment remains styled.
	for i, in := range b.inlines {
		if in.kind == inlineImage && in.image != nil && len(in.image.Bytes) > 0 {
			head := b
			head.inlines = b.inlines[:i]
			if len(head.inlines) > 0 {
				if err := w.writeParagraph(head, depth, false, nil, sectionLevel); err != nil {
					return err
				}
			}
			if err := w.image(in, depth); err != nil {
				return err
			}
			tail := b
			tail.inlines = b.inlines[i+1:]
			tail.role = roleLead
			if len(tail.inlines) > 0 {
				return w.writeParagraph(tail, depth, after, following, sectionLevel)
			}
			if after {
				w.y += academicLayout(b.role).afterPt * pdfPtMM
			}
			return nil
		}
	}
	p, err := w.plan(b, depth)
	if err != nil {
		return err
	}
	before := p.layout.beforePt * pdfPtMM
	reserve := before + pdfLinesHeight(p.lines[:min(1, len(p.lines))], p.layout)
	linkKeepHeight := 0.0
	if b.role == roleReference && next != nil && next.role == roleReferenceLinks && next.referenceIndex == b.referenceIndex {
		q, e := w.plan(*next, depth)
		if e != nil {
			return e
		}
		linkKeepHeight = pdfLinesHeight(q.lines[:min(2, len(q.lines))], q.layout)
	}
	if p.layout.keepNext && next != nil {
		nextHeight, e := w.keepNextHeight(following, depth)
		if e != nil {
			return e
		}
		candidate := before + pdfLinesHeight(p.lines, p.layout) + p.layout.afterPt*pdfPtMM + nextHeight
		if candidate <= academicPageHeightMM-2*academicPageMarginMM {
			reserve = candidate
		}
	}
	w.reserve(reserve)
	w.y += before
	for i, line := range p.lines {
		baseline, lineHeight := pdfLineGeometry(line, p.layout)
		height := lineHeight
		// Avoid a lone first/last paragraph line when two lines fit on a fresh page.
		if i == 0 && len(p.lines) > 1 || len(p.lines)-i == 2 {
			height = pdfLinesHeight(p.lines[i:min(i+2, len(p.lines))], p.layout)
		}
		if i == len(p.lines)-1 {
			height += linkKeepHeight
		}
		w.reserve(height)
		if i == 0 && b.kind == blockHeading {
			level := 0
			if b.role == roleSection {
				level = w.headingOffset
			}
			if b.role == roleSubsection {
				level = max(1, b.level-sectionLevel) + w.headingOffset
			}
			family, face := w.asciiFont(style{bold: true})
			w.pdf.SetFont(family, face, p.layout.sizePt)
			w.pdf.Bookmark(plainText(b.inlines), level, w.y)
		}
		if i == 0 && w.marker != nil {
			w.paintMarker(w.y + baseline)
		}
		if i == 0 && b.role == roleReference {
			if id := w.links[b.referenceIndex]; id > 0 {
				w.pdf.SetLink(id, w.y, w.pdf.PageNo())
			}
			family, face := w.asciiFont(style{})
			w.pdf.SetFont(family, face, p.layout.sizePt)
			w.pdf.SetTextColor(0, 0, 0)
			w.pdf.Text(academicPageMarginMM+float64(depth)*7.5, w.y+baseline, fmt.Sprintf("%d.", b.referenceIndex))
		}
		x, width := p.x, p.width
		if i == 0 {
			x, width = p.firstX, p.firstWidth
		}
		if p.layout.justified {
			line = justifyPDFLine(line, width)
		}
		if p.layout.alignment == alignCenter {
			x += (width - line.widthMM) / 2
		}
		if p.layout.alignment == alignRight {
			x += width - line.widthMM
		}
		if err := w.paint(line, x, w.y+baseline); err != nil {
			return err
		}
		w.y += lineHeight
	}
	if after {
		w.y += p.layout.afterPt * pdfPtMM
	}
	return nil
}

func (w *academicPDFWriter) writeBlocks(blocks []block, depth int) error {
	sectionLevel := 7
	for i, b := range blocks {
		// The assembler's appended reference heading is not an authored depth
		// baseline. Its next block owns the canonical reference index.
		canonical := i+1 < len(blocks) && blocks[i+1].role == roleReference
		if b.role == roleSection && b.level > 0 && !canonical {
			sectionLevel = min(sectionLevel, b.level)
		}
	}
	for i, b := range blocks {
		var next *block
		if i+1 < len(blocks) {
			next = &blocks[i+1]
		}
		switch b.kind {
		case blockParagraph, blockHeading, blockCode:
			after := !(b.role == roleReference && next != nil && next.role == roleReferenceLinks && b.referenceIndex == next.referenceIndex)
			if err := w.writeParagraph(b, depth, after, blocks[i+1:], sectionLevel); err != nil {
				return err
			}
		case blockList:
			if err := w.list(b, depth); err != nil {
				return err
			}
		case blockQuote:
			if err := w.writeBlocks(b.children, depth+1); err != nil {
				return err
			}
		case blockHR:
			w.reserve(3)
			w.pdf.Line(academicPageMarginMM, w.y+1, academicPageWidthMM-academicPageMarginMM, w.y+1)
			w.y += 3
		case blockTable:
			if err := w.writeTable(b, depth); err != nil {
				return err
			}
		}
	}
	return nil
}

func (w *academicPDFWriter) list(b block, depth int) error {
	if w.marker != nil {
		w.reserve(18 * pdfPtMM)
		w.paintMarker(w.y + 12*pdfPtMM)
		w.y += 18 * pdfPtMM
	}
	for i, item := range b.items {
		marker := "•"
		if b.ordered {
			marker = fmt.Sprintf("%d.", i+1)
		}
		w.marker = &pdfListMarker{marker, depth}
		// Non-text first children still need a visible marker line of their own.
		if len(item) == 0 || item[0].kind == blockHR || item[0].kind == blockQuote {
			w.reserve(18 * pdfPtMM)
			w.paintMarker(w.y + 12*pdfPtMM)
			w.y += 18 * pdfPtMM
		}
		if err := w.writeBlocks(item, depth+1); err != nil {
			return err
		}
	}
	return nil
}

func (w *academicPDFWriter) paintMarker(baseline float64) {
	m := w.marker
	family, face := w.asciiFont(style{})
	w.pdf.SetFont(family, face, 12)
	w.pdf.SetTextColor(0, 0, 0)
	text := m.text
	if family == academicPDFHelvetica {
		text = w.translate(text)
	}
	w.pdf.Text(academicPageMarginMM+float64(m.depth)*7.5, baseline, text)
	w.marker = nil
}

func (w *academicPDFWriter) image(in inline, depth int) error {
	pxW, pxH := imageSize(in.image)
	if pxW <= 0 || pxH <= 0 {
		return w.writeParagraph(block{kind: blockParagraph, role: roleLead, inlines: []inline{{text: in.text}}}, depth, false, nil, 7)
	}
	maxW := academicPageWidthMM - 2*academicPageMarginMM - float64(depth)*7.5
	maxH := float64(academicPageHeightMM - 2*academicPageMarginMM)
	if maxW <= 0 {
		return errPDFLayout
	}
	width, height := scaleTo(pxW, pxH, maxW*96/25.4, maxH*96/25.4)
	width *= 25.4 / 96
	height *= 25.4 / 96
	occupiedHeight := height
	if w.marker != nil {
		occupiedHeight = max(height, 18*pdfPtMM)
	}
	w.reserve(occupiedHeight)
	if w.marker != nil {
		w.paintMarker(w.y + 12*pdfPtMM)
	}
	w.imgN++
	name := fmt.Sprintf("academic-img-%d", w.imgN)
	opt := gofpdf.ImageOptions{ImageType: pdfImageType(in.image.MIME), ReadDpi: true}
	info := w.pdf.RegisterImageOptionsReader(name, opt, bytes.NewReader(in.image.Bytes))
	if info == nil || w.pdf.Error() != nil {
		return errAcademicPDF
	}
	href := ""
	if validWordLink(in.href) {
		href = in.href
	}
	w.pdf.ImageOptions(name, academicPageMarginMM+float64(depth)*7.5, w.y, width, height, false, opt, 0, href)
	if w.pdf.Error() != nil {
		return errAcademicPDF
	}
	w.y += occupiedHeight + 2
	return nil
}
