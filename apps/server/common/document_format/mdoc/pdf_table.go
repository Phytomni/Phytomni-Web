package mdoc

import (
	"bytes"
	"fmt"
	"math"

	"github.com/jung-kurt/gofpdf"
)

const pdfTablePaddingMM = 2.0

type pdfTableCell struct {
	lines     []pdfMeasuredLine
	alignment tableAlignment
	images    []pdfTableImage
}

// Images occupy indivisible line slots. Text still uses the reviewed measured
// fragments, and each cell retains its own safe continuation cursor.
type pdfTableImage struct {
	startLine, lineCount int
	in                   inline
	widthMM, heightMM    float64
}
type pdfTableRow struct {
	cells    []pdfTableCell
	header   bool
	heightMM float64
}

func pdfTableLineHeight() float64 {
	l := academicLayout(roleCaption)
	return l.sizePt * l.lineMultiple * pdfPtMM
}

func planPDFTableRows(rows [][][]pdfFragment, alignments []tableAlignment, widthMM float64, measure pdfMeasure) ([]pdfTableRow, error) {
	columns := 0
	for _, row := range rows {
		columns = max(columns, len(row))
	}
	if columns == 0 || !finitePDFWidth(widthMM) {
		return nil, errPDFLayout
	}
	contentWidth := widthMM/float64(columns) - 2*pdfTablePaddingMM
	if contentWidth <= 0 {
		return nil, errPDFLayout
	}
	out := make([]pdfTableRow, len(rows))
	for i, row := range rows {
		out[i] = pdfTableRow{cells: make([]pdfTableCell, columns), header: i == 0}
		for j := 0; j < columns; j++ {
			var runs []pdfFragment
			if j < len(row) {
				runs = row[j]
			}
			lines, err := wrapPDFRuns(runs, contentWidth, contentWidth, measure)
			if err != nil {
				return nil, err
			}
			alignment := alignLeft
			if j < len(alignments) {
				alignment = alignments[j]
			}
			out[i].cells[j] = pdfTableCell{lines: lines, alignment: alignment}
		}
		out[i].heightMM = pdfTableRowHeight(out[i])
	}
	return out, nil
}

func pdfTableRowHeight(row pdfTableRow) float64 {
	lines := 0
	for _, cell := range row.cells {
		lines = max(lines, len(cell.lines))
	}
	if lines == 0 {
		return 0
	}
	return float64(lines)*pdfTableLineHeight() + 2*pdfTablePaddingMM
}

func splitPDFTableRow(row pdfTableRow, budget int) (pdfTableRow, pdfTableRow) {
	head, tail := row, row
	head.cells = make([]pdfTableCell, len(row.cells))
	tail.cells = make([]pdfTableCell, len(row.cells))
	for i, cell := range row.cells {
		n := min(budget, len(cell.lines))
		for _, img := range cell.images {
			if img.startLine < n && img.startLine+img.lineCount > n {
				n = img.startLine
				break
			}
		}
		head.cells[i] = pdfTableCell{lines: cell.lines[:n], alignment: cell.alignment}
		tail.cells[i] = pdfTableCell{lines: cell.lines[n:], alignment: cell.alignment}
		for _, img := range cell.images {
			if img.startLine < n {
				head.cells[i].images = append(head.cells[i].images, img)
			} else {
				img.startLine -= n
				tail.cells[i].images = append(tail.cells[i].images, img)
			}
		}
	}
	head.heightMM, tail.heightMM = pdfTableRowHeight(head), pdfTableRowHeight(tail)
	return head, tail
}

func (w *academicPDFWriter) planTable(b block, depth int) ([]pdfTableRow, float64, float64, error) {
	x := academicPageMarginMM + float64(depth)*7.5
	width := academicPageWidthMM - academicPageMarginMM - x
	rows := make([][][]pdfFragment, len(b.rows))
	for i, row := range b.rows {
		rows[i] = make([][]pdfFragment, len(row))
		for j, cell := range row {
			hasImage := false
			for _, in := range cell {
				hasImage = hasImage || tableAdmittedImage(in)
			}
			// Image cells are wrapped around their indivisible slots below.
			// Do not first measure a flattened version that will be discarded.
			if hasImage {
				continue
			}
			var err error
			rows[i][j], err = w.fragments(cell, academicLayout(roleCaption))
			if err != nil {
				return nil, 0, 0, err
			}
		}
	}
	planned, err := planPDFTableRows(rows, b.alignments, width, w.measure)
	if err != nil {
		return nil, 0, 0, err
	}
	contentWidth := width/float64(len(planned[0].cells)) - 2*pdfTablePaddingMM
	usable := float64(academicPageHeightMM - 2*academicPageMarginMM)
	// Header images can also occur in preserved exceptional-header fragments.
	compactHeight := pdfTableLineHeight() + 2*pdfTablePaddingMM
	maxHeight := float64(pdfTableLineBudget(usable-compactHeight)) * pdfTableLineHeight()
	for i, row := range b.rows {
		if i == 1 {
			headerHeight := planned[0].heightMM
			if headerHeight > usable {
				headerHeight = compactHeight
			}
			maxHeight = float64(pdfTableLineBudget(usable-headerHeight)) * pdfTableLineHeight()
		}
		for j, cell := range row {
			hasImage := false
			for _, in := range cell {
				hasImage = hasImage || tableAdmittedImage(in)
			}
			if !hasImage {
				continue
			}
			imageHeight := maxHeight
			if i == 0 {
				note, e := w.plan(tableHeaderNote(), depth)
				if e != nil {
					return nil, 0, 0, e
				}
				imageHeight = float64(pdfTableLineBudget(usable-compactHeight-float64(len(note.lines))*pdfTableLineHeight())) * pdfTableLineHeight()
			}
			planned[i].cells[j], err = w.planTableImageCell(cell, planned[i].cells[j].alignment, contentWidth, imageHeight)
			if err != nil {
				return nil, 0, 0, err
			}
		}
		planned[i].heightMM = pdfTableRowHeight(planned[i])
	}
	return planned, x, width, err
}

func tableAdmittedImage(in inline) bool {
	if in.kind != inlineImage || in.image == nil || len(in.image.Bytes) == 0 {
		return false
	}
	w, h := imageSize(in.image)
	return w > 0 && h > 0
}

func (w *academicPDFWriter) planTableImageCell(inlines []inline, alignment tableAlignment, width, maxHeight float64) (pdfTableCell, error) {
	cell := pdfTableCell{alignment: alignment}
	if maxHeight <= 0 {
		return cell, errPDFLayout
	}
	var text []inline
	flush := func() error {
		if len(text) == 0 {
			return nil
		}
		runs, err := w.fragments(text, academicLayout(roleCaption))
		if err != nil {
			return err
		}
		lines, err := wrapPDFRuns(runs, width, width, w.measure)
		if err != nil {
			return err
		}
		cell.lines = append(cell.lines, lines...)
		text = nil
		return nil
	}
	for _, in := range inlines {
		if !tableAdmittedImage(in) {
			text = append(text, in)
			continue
		}
		if err := flush(); err != nil {
			return cell, err
		}
		pxW, pxH := imageSize(in.image)
		imgW, imgH := scaleTo(pxW, pxH, width*96/25.4, maxHeight*96/25.4)
		imgW *= 25.4 / 96
		imgH *= 25.4 / 96
		slots := max(1, int(math.Ceil(imgH/pdfTableLineHeight()-1e-9)))
		cell.images = append(cell.images, pdfTableImage{len(cell.lines), slots, in, imgW, imgH})
		cell.lines = append(cell.lines, make([]pdfMeasuredLine, slots)...)
	}
	err := flush()
	return cell, err
}

func (w *academicPDFWriter) paintTableRow(row pdfTableRow, x, width float64) error {
	columnWidth := width / float64(len(row.cells))
	for j, cell := range row.cells {
		left := x + float64(j)*columnWidth
		w.pdf.Rect(left, w.y, columnWidth, row.heightMM, "D")
		for _, img := range cell.images {
			start := left + pdfTablePaddingMM
			if cell.alignment == alignCenter {
				start += (columnWidth - 2*pdfTablePaddingMM - img.widthMM) / 2
			}
			if cell.alignment == alignRight {
				start += columnWidth - 2*pdfTablePaddingMM - img.widthMM
			}
			w.imgN++
			name := fmt.Sprintf("academic-img-%d", w.imgN)
			opt := gofpdf.ImageOptions{ImageType: pdfImageType(img.in.image.MIME), ReadDpi: true}
			if w.pdf.RegisterImageOptionsReader(name, opt, bytes.NewReader(img.in.image.Bytes)) == nil || w.pdf.Error() != nil {
				return errAcademicPDF
			}
			href := ""
			if validWordLink(img.in.href) {
				href = img.in.href
			}
			w.pdf.ImageOptions(name, start, w.y+pdfTablePaddingMM+float64(img.startLine)*pdfTableLineHeight(), img.widthMM, img.heightMM, false, opt, 0, href)
			if w.pdf.Error() != nil {
				return errAcademicPDF
			}
		}
		for i, line := range cell.lines {
			start := left + pdfTablePaddingMM
			if cell.alignment == alignCenter {
				start += (columnWidth - 2*pdfTablePaddingMM - line.widthMM) / 2
			}
			if cell.alignment == alignRight {
				start += columnWidth - 2*pdfTablePaddingMM - line.widthMM
			}
			baseline := w.y + pdfTablePaddingMM + float64(i)*pdfTableLineHeight() + academicLayout(roleCaption).sizePt*pdfPtMM
			if err := w.paint(line, start, baseline); err != nil {
				return err
			}
		}
	}
	if w.marker != nil {
		w.paintMarker(w.y + pdfTablePaddingMM + 12*pdfPtMM)
	}
	w.y += row.heightMM
	return nil
}

func pdfTableLineBudget(height float64) int {
	return max(0, int(math.Floor((height-2*pdfTablePaddingMM+1e-9)/pdfTableLineHeight())))
}

// Reserve the ordinary header with the first whole row when feasible; an
// oversized first row needs only a positive first fragment beside the heading.
func (w *academicPDFWriter) tableFirstHeight(rows []pdfTableRow, width float64, depth int) (float64, error) {
	usable := float64(academicPageHeightMM - 2*academicPageMarginMM)
	header := rows[0].heightMM
	if header > usable {
		compact, err := w.compactTableHeader(rows[0], width)
		if err != nil {
			return 0, err
		}
		note, err := w.plan(tableHeaderNote(), depth)
		if err != nil {
			return 0, err
		}
		first, _ := splitPDFTableRow(rows[0], firstPDFTableBudget(rows[0]))
		return float64(len(note.lines))*pdfTableLineHeight() + compact.heightMM + first.heightMM, nil
	}
	if len(rows) == 1 {
		return header, nil
	}
	budget := pdfTableLineBudget(usable - header)
	if budget < 1 {
		return 0, errPDFLayout
	}
	first, _ := splitPDFTableRow(rows[1], budget)
	if rows[1].heightMM > usable-header {
		first, _ = splitPDFTableRow(rows[1], firstPDFTableBudget(rows[1]))
	}
	return header + first.heightMM, nil
}

func tableHeaderNote() block {
	return block{role: roleCaption, inlines: []inline{{text: "Full header follows once; Column numbers map to the data columns."}}}
}

func (w *academicPDFWriter) compactTableHeader(header pdfTableRow, width float64) (pdfTableRow, error) {
	labels := make([][]pdfFragment, len(header.cells))
	alignments := make([]tableAlignment, len(header.cells))
	for i, cell := range header.cells {
		var err error
		labels[i], err = w.fragments([]inline{{text: fmt.Sprintf("Column %d", i+1)}}, academicLayout(roleCaption))
		if err != nil {
			return pdfTableRow{}, err
		}
		alignments[i] = cell.alignment
	}
	compact, err := planPDFTableRows([][][]pdfFragment{labels}, alignments, width, w.measure)
	if err != nil {
		return pdfTableRow{}, err
	}
	for _, cell := range compact[0].cells {
		if len(cell.lines) != 1 {
			return pdfTableRow{}, errPDFLayout
		}
	}
	return compact[0], nil
}

func firstPDFTableBudget(row pdfTableRow) int {
	budget := int(^uint(0) >> 1)
	for _, cell := range row.cells {
		if len(cell.lines) == 0 {
			continue
		}
		n := 1
		if len(cell.images) > 0 && cell.images[0].startLine == 0 {
			n = cell.images[0].lineCount
		}
		budget = min(budget, n)
	}
	return budget
}

// Every split consumes a common positive line budget. There is no retry cap:
// fresh-page geometry is proved before any continuation page can be created.
func (w *academicPDFWriter) writeTableRows(rows []pdfTableRow, header pdfTableRow, x, width float64) error {
	bottom := float64(academicPageHeightMM - academicPageMarginMM)
	fresh := bottom - academicPageMarginMM - header.heightMM
	if len(rows) > 0 && pdfTableLineBudget(fresh) < 1 {
		return errPDFLayout
	}
	for _, row := range rows {
		for row.heightMM > 0 {
			available := bottom - w.y
			if row.heightMM <= fresh && row.heightMM > available+1e-9 || pdfTableLineBudget(available) < 1 {
				w.newPage()
				if err := w.paintTableRow(header, x, width); err != nil {
					return err
				}
				available = bottom - w.y
			}
			part, rest := splitPDFTableRow(row, pdfTableLineBudget(available))
			if part.heightMM == 0 {
				part, rest = splitPDFTableRow(row, pdfTableLineBudget(fresh))
				if part.heightMM == 0 || part.heightMM > fresh+1e-9 {
					return errPDFLayout
				}
				w.newPage()
				if err := w.paintTableRow(header, x, width); err != nil {
					return err
				}
				available = bottom - w.y
			}
			if part.heightMM > available+1e-9 {
				return errPDFLayout
			}
			if err := w.paintTableRow(part, x, width); err != nil {
				return err
			}
			row = rest
		}
	}
	return nil
}

func (w *academicPDFWriter) writeTable(b block, depth int) error {
	rows, x, width, err := w.planTable(b, depth)
	if err != nil {
		return err
	}
	first, err := w.tableFirstHeight(rows, width, depth)
	if err != nil {
		return err
	}
	w.reserve(first)
	header := rows[0]
	if header.heightMM > academicPageHeightMM-2*academicPageMarginMM {
		compact, e := w.compactTableHeader(header, width)
		if e != nil {
			return e
		}
		if err = w.writeParagraph(tableHeaderNote(), depth, false, nil, 7); err != nil {
			return err
		}
		if err = w.paintTableRow(compact, x, width); err != nil {
			return err
		}
		if err = w.writeTableRows(rows[:1], compact, x, width); err != nil {
			return err
		}
		if len(rows) == 1 {
			return nil
		}
		w.newPage()
		header = compact
	}
	if err := w.paintTableRow(header, x, width); err != nil {
		return err
	}
	return w.writeTableRows(rows[1:], header, x, width)
}
