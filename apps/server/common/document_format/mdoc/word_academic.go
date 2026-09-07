package mdoc

import (
	"bytes"
	"fmt"
	"math"
	"os"
	"strings"

	"github.com/gomutex/godocx"
	"github.com/gomutex/godocx/docx"
	"github.com/gomutex/godocx/wml/ctypes"
	"github.com/gomutex/godocx/wml/stypes"
)

// RenderCitedWord writes the already assembled semantic report. Ordinary Chat
// continues to use RenderWord and never opts in to this layout/package policy.
func RenderCitedWord(document Document) ([]byte, error) {
	doc, err := godocx.NewDocument()
	if err != nil {
		return nil, fmt.Errorf("create academic word: %w", err)
	}
	tmp, err := os.MkdirTemp("", "phytomni-mdoc-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)
	headingOffset := 0
	for _, b := range document.blocks {
		if b.role == roleTitle {
			headingOffset = 1
			break
		}
	}
	configureAcademicWord(doc, headingOffset)
	w := academicWordWriter{images: wordWriter{doc: doc, tmp: tmp}, doc: doc, plan: wordPackagePlan{academic: true}, headingOffset: headingOffset}
	w.writeBlocks(document.blocks, 0)
	if w.err != nil {
		return nil, w.err
	}
	var buf bytes.Buffer
	if err := doc.Write(&buf); err != nil {
		return nil, fmt.Errorf("write academic word: %w", err)
	}
	return patchWordPackage(buf.Bytes(), w.plan)
}

func wordPtr[T any](v T) *T    { return &v }
func wordTwips(mm float64) int { return int(math.Round(mm * 1440 / 25.4)) }
func academicWordFonts(family string) *ctypes.RunFonts {
	return &ctypes.RunFonts{Ascii: family, HAnsi: family, CS: family, EastAsia: "Microsoft YaHei"}
}
func academicWordRunProps(layout paragraphLayout, family string) *ctypes.RunProperty {
	return &ctypes.RunProperty{Fonts: academicWordFonts(family), Size: ctypes.NewFontSize(uint64(layout.sizePt * 2)), SizeCs: ctypes.NewFontSizeCS(uint64(layout.sizePt * 2)), Bold: ctypes.OnOffFromBool(layout.bold), BoldCS: ctypes.OnOffFromBool(layout.bold)}
}
func academicWordParaProps(layout paragraphLayout) *ctypes.ParagraphProp {
	jc := stypes.Justification("left")
	if layout.justified {
		jc = "both"
	} else if layout.alignment == alignCenter {
		jc = "center"
	} else if layout.alignment == alignRight {
		jc = "right"
	}
	indent := &ctypes.Indent{Left: wordPtr(0), FirstLine: wordPtr(uint64(wordTwips(layout.firstIndentMM)))}
	if layout.hangingMM > 0 {
		indent = &ctypes.Indent{Left: wordPtr(wordTwips(layout.hangingMM)), Hanging: wordPtr(uint64(wordTwips(layout.hangingMM)))}
	}
	// Omit wordWrap: false means character-level breaking, not ordinary Word
	// wrapping. Oversized-token visual acceptance remains a renderer check.
	return &ctypes.ParagraphProp{
		Justification: ctypes.NewGenSingleStrVal(jc),
		Spacing: &ctypes.Spacing{
			Before: wordPtr(uint64(layout.beforePt * 20)), After: wordPtr(uint64(layout.afterPt * 20)),
			Line: wordPtr(int(layout.lineMultiple * 240)), LineRule: wordPtr(stypes.LineSpacingRule("auto")),
		},
		Indent: indent, KeepNext: ctypes.OnOffFromBool(layout.keepNext),
		KeepLines: ctypes.OnOffFromBool(false), WindowControl: ctypes.OnOffFromBool(true),
	}
}
func academicWordStyle(role reportRole) string { return fmt.Sprintf("Academic%d", role) }
func configureAcademicWord(doc *docx.RootDoc, headingOffset int) {
	m := wordTwips(academicPageMarginMM)
	doc.Document.Body.SectPr = &ctypes.SectionProp{PageSize: &ctypes.PageSize{Width: wordPtr(uint64(wordTwips(academicPageWidthMM))), Height: wordPtr(uint64(wordTwips(academicPageHeightMM))), Orient: stypes.PageOrient("portrait")}, PageMargin: &ctypes.PageMargin{Left: &m, Right: &m, Top: &m, Bottom: &m, Header: wordPtr(wordTwips(12.5)), Footer: wordPtr(wordTwips(12.5)), Gutter: wordPtr(0)}}
	doc.DocStyles.DocDefaults = &ctypes.DocDefault{RunProp: &ctypes.RunPropDefault{RunProp: academicWordRunProps(academicLayout(roleBody), "Times New Roman")}}
	// GetStyleByID returns a pointer to a copy, not the backing slice element.
	for i := range doc.DocStyles.StyleList {
		s := &doc.DocStyles.StyleList[i]
		if s.ID != nil && *s.ID == "Normal" {
			s.RunProp = academicWordRunProps(academicLayout(roleBody), "Times New Roman")
			s.ParaProp = academicWordParaProps(academicLayout(roleBody))
		}
	}
	for role := roleTitle; role <= roleCaption; role++ {
		layout := academicLayout(role)
		pp := academicWordParaProps(layout)
		if role == roleReferenceLinks {
			pp.Indent.Left = wordPtr(wordTwips(academicLayout(roleReference).hangingMM))
		}
		if role == roleReference {
			pp.Tabs = ctypes.Tabs{Tab: []ctypes.Tab{{Val: stypes.CustTabStop("left"), Position: wordTwips(layout.hangingMM)}}}
		}
		if role == roleTitle {
			pp.OutlineLvl = ctypes.NewDecimalNum(0)
		}
		if role == roleSection {
			pp.OutlineLvl = ctypes.NewDecimalNum(headingOffset)
		}
		if role == roleSubsection {
			pp.OutlineLvl = ctypes.NewDecimalNum(1 + headingOffset)
		}
		doc.DocStyles.StyleList = append(doc.DocStyles.StyleList, ctypes.Style{ID: wordPtr(academicWordStyle(role)), Type: wordPtr(stypes.StyleType("paragraph")), Name: ctypes.NewCTString(academicWordStyle(role)), Next: ctypes.NewCTString(academicWordStyle(roleBody)), ParaProp: pp, RunProp: academicWordRunProps(layout, "Times New Roman")})
	}
	code := academicLayout(roleLead)
	code.sizePt = academicCodeFontSizePt
	code.lineMultiple = 1
	code.justified = academicCodeJustified
	doc.DocStyles.StyleList = append(doc.DocStyles.StyleList, ctypes.Style{ID: wordPtr("AcademicCode"), Type: wordPtr(stypes.StyleType("paragraph")), Name: ctypes.NewCTString("Academic Code"), ParaProp: academicWordParaProps(code), RunProp: academicWordRunProps(code, academicCodeDOCXFamily)})
}

type academicWordWriter struct {
	err           error
	doc           *docx.RootDoc
	images        wordWriter
	paragraph     int
	headingOffset int
	plan          wordPackagePlan
}

func (w *academicWordWriter) paragraphWithRole(role reportRole) (*docx.Paragraph, int) {
	p := w.doc.AddEmptyParagraph()
	return w.recordParagraph(p, role)
}
func (w *academicWordWriter) recordParagraph(p *docx.Paragraph, role reportRole) (*docx.Paragraph, int) {
	if role == roleDefault {
		role = roleBody
	}
	p.Style(academicWordStyle(role))
	id := w.paragraph
	w.paragraph++
	return p, id
}
func (w *academicWordWriter) writeBlocks(blocks []block, depth int) {
	sectionLevel := 7
	for i, b := range blocks {
		canonical := i+1 < len(blocks) && blocks[i+1].role == roleReference
		if b.kind == blockHeading && b.role == roleSection && b.level > 0 && b.level < sectionLevel && !canonical {
			sectionLevel = b.level
		}
	}
	for i, b := range blocks {
		switch b.kind {
		case blockParagraph, blockHeading:
			p, id := w.paragraphWithRole(b.role)
			if b.role == roleSubsection && sectionLevel < 7 {
				p.GetCT().Property.OutlineLvl = ctypes.NewDecimalNum(min(8, max(1, b.level-sectionLevel)+w.headingOffset))
			}
			if b.role == roleReference {
				if i+1 < len(blocks) && blocks[i+1].role == roleReferenceLinks && blocks[i+1].referenceIndex == b.referenceIndex {
					p.GetCT().Property.Spacing = &ctypes.Spacing{After: wordPtr(uint64(0))}
					p.GetCT().Property.KeepNext = ctypes.OnOffFromBool(true)
				}
				academicWordText(p, fmt.Sprintf("%d.\t", b.referenceIndex))
			}
			if depth > 0 {
				p.GetCT().Property.Indent = &ctypes.Indent{Left: wordPtr(depth * 360), FirstLine: wordPtr(uint64(0))}
			}
			w.writeInlines(p, id, b.inlines)
		case blockCode:
			p, _ := w.paragraphWithRole(roleLead)
			p.Style("AcademicCode")
			academicWordText(p, b.code).Highlight("lightGray")
		case blockQuote:
			w.writeBlocks(b.children, depth+1)
		case blockList:
			w.writeList(b, depth)
		case blockHR:
			w.paragraphWithRole(roleLead)
		case blockTable:
			columns := 0
			for _, row := range b.rows {
				columns = max(columns, len(row))
			}
			rows, headerHeightPt, compact, err := academicWordTableRows(b.rows, columns)
			if err != nil {
				w.err = err
				return
			}
			if compact {
				p, id := w.paragraphWithRole(roleCaption)
				w.writeInlines(p, id, []inline{{text: "Full header follows once; Column numbers map to the data columns."}})
			}
			table := w.doc.AddTable()
			table.Style("TableGrid")
			for rowIndex, row := range rows {
				r := table.AddRow()
				for i := 0; i < columns; i++ {
					var cell []inline
					if i < len(row) {
						cell = row[i]
					}
					p, id := w.recordParagraph(r.AddCell().AddEmptyPara(), roleCaption)
					if i < len(b.alignments) {
						layout := academicLayout(roleCaption)
						layout.alignment = b.alignments[i]
						p.GetCT().Property = academicWordParaProps(layout)
						p.Style(academicWordStyle(roleCaption))
					}
					width := academicWordColumnWidth(columns, i) - 2*academicWordCellSideMarginTwips
					imageHeightMM := float64(academicPageHeightMM - 2*academicPageMarginMM)
					if rowIndex > 0 {
						imageHeightMM = (imageHeightMM - (headerHeightPt+academicWordTableLineHeightPt())*25.4/72) / academicLayout(roleCaption).lineMultiple
					}
					w.writeInlinesWithin(p, id, cell, float64(width)*25.4/1440, imageHeightMM)
				}
			}
		}
	}
}
func (w *academicWordWriter) writeList(b block, depth int) {
	id := min(depth, 3) + 1
	if b.ordered {
		abstract := []int{7, 3, 2, 1, 0}[min(depth, 4)]
		id = 10 + len(w.plan.numbering)
		w.plan.numbering = append(w.plan.numbering, wordNumberingPatch{id: id, abstract: abstract})
	}
	for _, item := range b.items {
		first := true
		for _, child := range item {
			if first {
				p, ordinal := w.listParagraph(id, depth)
				first = false
				switch child.kind {
				case blockParagraph, blockHeading:
					w.writeInlines(p, ordinal, child.inlines)
					continue
				case blockCode:
					p.Style("AcademicCode")
					academicWordText(p, child.code).Highlight("lightGray")
					continue
				}
				// Non-paragraph first children need a real parent marker before
				// their nested content, not a synthetic text-prefix run.
			}
			w.writeBlocks([]block{child}, depth+1)
		}
		if first {
			w.listParagraph(id, depth)
		}
	}
}

func (w *academicWordWriter) listParagraph(id, depth int) (*docx.Paragraph, int) {
	p, ordinal := w.paragraphWithRole(roleLead)
	p.Numbering(id, 0)
	p.GetCT().Property.Indent = &ctypes.Indent{Left: wordPtr((min(depth, 4) + 1) * 360), Hanging: wordPtr(uint64(360))}
	return p, ordinal
}

// Keep breaks and tabs as Word elements within the same direct run; coordinates
// are therefore independent of literal newlines and tab characters in content.
func academicWordText(p *docx.Paragraph, text string) *docx.Run {
	text = strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")
	r := p.AddText("")
	ct := p.GetCT().Children[len(p.GetCT().Children)-1].Run
	ct.Children = nil
	start := 0
	for i, c := range text {
		if c != '\n' && c != '\t' {
			continue
		}
		if i > start {
			ct.Children = append(ct.Children, ctypes.RunChild{Text: ctypes.TextFromString(text[start:i])})
		}
		if c == '\n' {
			ct.Children = append(ct.Children, ctypes.RunChild{Break: &ctypes.Break{}})
		} else {
			ct.Children = append(ct.Children, ctypes.RunChild{Tab: &ctypes.Empty{}})
		}
		start = i + 1
	}
	if start < len(text) || len(ct.Children) == 0 {
		ct.Children = append(ct.Children, ctypes.RunChild{Text: ctypes.TextFromString(text[start:])})
	}
	return r
}
func (w *academicWordWriter) writeInlines(p *docx.Paragraph, ordinal int, inlines []inline) {
	w.writeInlinesWithin(p, ordinal, inlines, academicPageWidthMM-2*academicPageMarginMM, academicPageHeightMM-2*academicPageMarginMM)
}

func (w *academicWordWriter) writeInlinesWithin(p *docx.Paragraph, ordinal int, inlines []inline, widthMM, heightMM float64) {
	for _, in := range inlines {
		if in.kind == inlineImage {
			if in.image != nil && len(in.image.Bytes) > 0 && (widthMM <= 0 || heightMM <= 0) {
				w.err = fmt.Errorf("academic Word image cannot fit cell geometry")
				return
			}
			if in.image != nil && w.images.addPictureWithin(p, in.image, widthMM/25.4, heightMM/25.4) == nil {
				continue
			}
			if in.text != "" {
				academicWordText(p, in.text)
			}
			continue
		}
		if in.text == "" {
			continue
		}
		index := len(p.GetCT().Children)
		r := academicWordText(p, in.text)
		if in.style.bold {
			r.Bold(true)
		}
		if in.style.italic {
			r.Italic(true)
		}
		if in.style.strike {
			r.Strike(true)
		}
		if in.style.code {
			r.Highlight("lightGray")
			r.Size(academicCodeFontSizePt)
			p.GetCT().Children[index].Run.Property.Fonts = academicWordFonts(academicCodeDOCXFamily)
		}
		if in.style.vertical != verticalBaseline {
			ct := p.GetCT().Children[index].Run
			if ct.Property == nil {
				ct.Property = &ctypes.RunProperty{}
			}
			ct.Property.VertAlign = ctypes.NewGenSingleStrVal(stypes.VerticalAlignRun(in.style.vertical))
		}
		if in.citation != nil {
			// Word applies native superscript scaling to the 12 pt body-size base.
			size := uint64(academicLayout(roleBody).sizePt)
			r.Size(size)
			pr := p.GetCT().Children[index].Run.Property
			pr.SizeCs = ctypes.NewFontSizeCS(size * 2)
			pr.VertAlign = ctypes.NewGenSingleStrVal(stypes.VerticalAlignRun("superscript"))
			continue
		}
		if validWordLink(in.href) {
			r.Color("0563C1").Underline(stypes.UnderlineSingle)
			patch := wordLinkPatch{ordinal, index, 1, in.href}
			n := len(w.plan.links)
			if n > 0 {
				last := &w.plan.links[n-1]
				if last.paragraph == ordinal && last.href == in.href && last.firstRun+last.runCount == index {
					last.runCount++
					continue
				}
			}
			w.plan.links = append(w.plan.links, patch)
		}
	}
}
