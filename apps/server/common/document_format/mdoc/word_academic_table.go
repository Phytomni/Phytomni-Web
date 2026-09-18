package mdoc

import (
	"errors"
	"fmt"
	"math"
	"unicode"
)

var errAcademicWordTableGeometry = errors.New("academic Word table cannot fit page geometry")

// Word owns final pagination and does not expose its font metrics to godocx.
// Use a conservative em envelope only to decide whether a header can safely
// repeat. It is not a text reflow algorithm and never edits source inlines.
func academicWordTableLineHeightPt() float64 {
	layout := academicLayout(roleCaption)
	return layout.sizePt * layout.lineMultiple * 1.5
}

func academicWordTableRows(rows [][][]inline, columns int) ([][][]inline, float64, bool, error) {
	if len(rows) == 0 {
		return rows, 0, false, nil
	}
	if columns <= 0 {
		return nil, 0, false, errAcademicWordTableGeometry
	}
	height := academicWordHeaderHeightPt(rows[0], columns)
	pageHeight := (academicPageHeightMM - 2*academicPageMarginMM) * 72 / 25.4
	// Keep at least one body line plus a line of leading/border allowance.
	if height+2*academicWordTableLineHeightPt() <= pageHeight {
		return rows, height, false, nil
	}
	compact := make([][]inline, columns)
	for i := range compact {
		compact[i] = []inline{{text: fmt.Sprintf("Column %d", i+1)}}
	}
	height = academicWordHeaderHeightPt(compact, columns)
	if math.IsNaN(height) || math.IsInf(height, 0) || height+2*academicWordTableLineHeightPt() > pageHeight {
		return nil, 0, false, errAcademicWordTableGeometry
	}
	prepared := make([][][]inline, 0, len(rows)+1)
	prepared = append(prepared, compact)
	prepared = append(prepared, rows...)
	return prepared, height, true, nil
}

func academicWordHeaderHeightPt(cells [][]inline, columns int) float64 {
	height := academicWordTableLineHeightPt()
	for i, cell := range cells {
		width := float64(academicWordColumnWidth(columns, i)-2*academicWordCellSideMarginTwips) / 20
		height = max(height, academicWordCellHeightPt(cell, width))
	}
	return height
}

func academicWordCellHeightPt(cell []inline, width float64) float64 {
	if width <= 0 {
		return math.Inf(1)
	}
	lineHeight := academicWordTableLineHeightPt()
	height, used, word := lineHeight, 0.0, 0.0
	flushWord := func() {
		if word == 0 {
			return
		}
		if used > 0 && used+word > width {
			height += lineHeight
			used = 0
		}
		// Count oversized tokens without inserting breaks into the document.
		lines := math.Ceil(word / width)
		height += max(0, lines-1) * lineHeight
		used += word - max(0, lines-1)*width
		word = 0
	}
	for _, in := range cell {
		if in.kind == inlineImage && in.image != nil && len(in.image.Bytes) > 0 {
			flushWord()
			pxW, pxH := imageSize(in.image)
			imageHeight := width * 0.6
			if pxW > 0 {
				_, imageHeight = scaleTo(pxW, pxH, width*96/72,
					(academicPageHeightMM-2*academicPageMarginMM)*96/25.4)
				imageHeight *= 72.0 / 96
			}
			// An inline picture affects native automatic line spacing; reserve
			// both that scaled height and a text line for baseline/descent.
			height += imageHeight*academicLayout(roleCaption).lineMultiple + lineHeight
			used = 0
			continue
		}
		size := academicLayout(roleCaption).sizePt
		if in.style.code {
			size = academicCodeFontSizePt
		}
		if validWordLink(in.href) {
			size = max(size, academicLayout(roleReferenceLinks).sizePt)
		}
		for _, r := range in.text {
			switch {
			case r == '\n' || r == '\t':
				flushWord()
				height += lineHeight
				used = 0
			case unicode.IsSpace(r):
				flushWord()
				if used+size > width {
					height += lineHeight
					used = 0
				}
				used += size
			default:
				// One em bounds ASCII advances, including wide bold/italic
				// letters; two em conservatively cover non-ASCII/fallback glyphs.
				advance := size
				if r > unicode.MaxASCII {
					advance *= 2
				}
				word += advance
			}
		}
	}
	flushWord()
	return height
}
