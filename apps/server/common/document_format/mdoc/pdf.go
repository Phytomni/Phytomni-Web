package mdoc

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/jung-kurt/gofpdf"
	"phytomni-server/common/document_format/external_format"
)

const (
	pdfMaxImageMMW = 170.0
	pdfMaxImageMMH = 220.0
	pdfLine        = 6.0
)

// RenderPDF turns Markdown into a structured PDF with embedded CJK fonts.
func RenderPDF(src string, opts Options) ([]byte, error) {
	blocks, err := parse(src, opts)
	if err != nil {
		return nil, err
	}
	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(20, 18, 20)
	pdf.SetAutoPageBreak(true, 18)
	pdf.AddPage()
	if err := external_format.RegisterCJKFont(pdf, "msyh", "", "msyh.ttf"); err != nil {
		return nil, err
	}
	if err := external_format.RegisterCJKFont(pdf, "msyh", "B", "msyh.ttf"); err != nil {
		return nil, err
	}
	pdf.SetFont("msyh", "", 11)

	w := &pdfWriter{pdf: pdf}
	w.writeBlocks(blocks, 0)

	buf := new(bytes.Buffer)
	if err := pdf.Output(buf); err != nil {
		return nil, fmt.Errorf("write pdf: %w", err)
	}
	return buf.Bytes(), nil
}

type pdfWriter struct {
	pdf  *gofpdf.Fpdf
	imgN int
}

func (w *pdfWriter) writeBlocks(blocks []block, indent int) {
	for _, b := range blocks {
		w.writeBlock(b, indent)
	}
}

func (w *pdfWriter) writeBlock(b block, indent int) {
	switch b.kind {
	case blockHeading:
		w.pdf.Ln(3)
		size := 18.0 - float64(b.level)*1.5
		if size < 12 {
			size = 12
		}
		w.pdf.SetFont("msyh", "B", size)
		w.pdf.MultiCell(0, size*0.55, plainText(b.inlines), "", "", false)
		w.pdf.SetFont("msyh", "", 11)
		w.pdf.Ln(1)
	case blockParagraph:
		w.writeInlines(b.inlines, indent)
		w.pdf.Ln(2)
	case blockList:
		w.writeList(b, indent)
	case blockCode:
		w.pdf.SetFont("msyh", "", 9)
		w.pdf.SetFillColor(245, 245, 245)
		w.pdf.MultiCell(0, 5, b.code, "", "", true)
		w.pdf.SetFont("msyh", "", 11)
		w.pdf.Ln(2)
	case blockQuote:
		w.pdf.SetLeftMargin(28 + float64(indent)*6)
		w.writeBlocks(b.children, indent+1)
		w.pdf.SetLeftMargin(20)
	case blockHR:
		x := w.pdf.GetX()
		y := w.pdf.GetY() + 2
		w.pdf.Line(20, y, 190, y)
		w.pdf.SetXY(x, y+3)
	case blockTable:
		w.writeTable(b)
	}
}

func (w *pdfWriter) writeList(b block, indent int) {
	for i, item := range b.items {
		prefix := "• "
		if b.ordered {
			prefix = fmt.Sprintf("%d. ", i+1)
		}
		first := true
		for _, child := range item {
			if child.kind == blockList {
				w.writeList(child, indent+1)
				continue
			}
			if first && child.kind == blockParagraph {
				w.writePlain(strings.Repeat("    ", indent)+prefix+plainText(child.inlines), false)
				first = false
				continue
			}
			w.writeBlock(child, indent+1)
			first = false
		}
		if first {
			w.writePlain(strings.Repeat("    ", indent)+prefix, false)
		}
	}
	w.pdf.Ln(1)
}

func (w *pdfWriter) writeTable(b block) {
	if len(b.rows) == 0 {
		return
	}
	cols := 0
	for _, row := range b.rows {
		if len(row) > cols {
			cols = len(row)
		}
	}
	if cols == 0 {
		return
	}
	width := 170.0 / float64(cols)
	w.pdf.SetFont("msyh", "", 9)
	for r, row := range b.rows {
		fill := r == 0
		if fill {
			w.pdf.SetFillColor(230, 230, 230)
			w.pdf.SetFont("msyh", "B", 9)
		} else {
			w.pdf.SetFillColor(255, 255, 255)
			w.pdf.SetFont("msyh", "", 9)
		}
		for c := 0; c < cols; c++ {
			text := ""
			if c < len(row) {
				text = plainText(row[c])
			}
			w.pdf.CellFormat(width, 7, text, "1", 0, "L", fill, 0, "")
		}
		w.pdf.Ln(-1)
	}
	w.pdf.SetFont("msyh", "", 11)
	w.pdf.Ln(2)
}

func (w *pdfWriter) writeInlines(inlines []inline, indent int) {
	var text strings.Builder
	flush := func() {
		if text.Len() == 0 {
			return
		}
		w.writePlain(strings.Repeat("    ", indent)+text.String(), false)
		text.Reset()
	}
	for _, in := range inlines {
		if in.kind == inlineImage {
			flush()
			if in.image != nil && w.addImage(in.image) {
				continue
			}
			if in.text != "" {
				w.writePlain(in.text, false)
			}
			continue
		}
		text.WriteString(in.text)
	}
	flush()
}

func (w *pdfWriter) writePlain(s string, fill bool) {
	if s == "" {
		return
	}
	w.pdf.MultiCell(0, pdfLine, s, "", "", fill)
}

func (w *pdfWriter) addImage(img *Image) bool {
	pxW, pxH := imageSize(img)
	var mmW, mmH float64
	if pxW > 0 {
		mmW, mmH = scaleTo(pxW, pxH, pdfMaxImageMMW*96/25.4, pdfMaxImageMMH*96/25.4)
		mmW = mmW * 25.4 / 96
		mmH = mmH * 25.4 / 96
	} else {
		mmW, mmH = pdfMaxImageMMW, pdfMaxImageMMW*0.6
	}
	_, pageH := w.pdf.GetPageSize()
	_, _, _, bottom := w.pdf.GetMargins()
	if w.pdf.GetY()+mmH > pageH-bottom {
		w.pdf.AddPage()
	}
	w.imgN++
	name := fmt.Sprintf("img%d", w.imgN)
	opt := gofpdf.ImageOptions{ImageType: pdfImageType(img.MIME), ReadDpi: true}
	info := w.pdf.RegisterImageOptionsReader(name, opt, bytes.NewReader(img.Bytes))
	if info == nil {
		return false
	}
	w.pdf.ImageOptions(name, w.pdf.GetX(), w.pdf.GetY(), mmW, mmH, false, opt, 0, "")
	w.pdf.Ln(mmH + 2)
	return true
}
