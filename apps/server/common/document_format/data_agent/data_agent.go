package data_agent

import (
	"bytes"
	"strings"

	"github.com/jung-kurt/gofpdf"
	"phytomni-server/common/document_format/xlsx"
)

type TableData struct {
	Headers []string   `json:"headers"`
	Rows    [][]string `json:"rows"`
}

func ExportToExcel(data TableData) ([]byte, error) {
	return xlsx.ExportTable(xlsx.TableInput{
		Headers: data.Headers,
		Rows:    data.Rows,
	})
}

func ExportToPdf(data TableData) ([]byte, error) {
	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.AddPage()

	pdf.SetFont("Arial", "B", 16)
	pdf.Cell(40, 10, "Homology Gene Results")
	pdf.Ln(12)

	pdf.SetFont("Arial", "", 12)

	colWidth := float64(190) / float64(len(data.Headers))

	pdf.SetFillColor(200, 200, 200)
	for _, header := range data.Headers {
		pdf.CellFormat(colWidth, 7, header, "1", 0, "C", true, 0, "")
	}
	pdf.Ln(-1)

	pdf.SetFillColor(255, 255, 255)
	for _, row := range data.Rows {
		for _, cell := range row {
			pdf.CellFormat(colWidth, 6, cell, "1", 0, "C", false, 0, "")
		}
		pdf.Ln(-1)
	}

	buf := new(bytes.Buffer)
	if err := pdf.Output(buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func ExportToMarkdown(data TableData) ([]byte, error) {
	var builder strings.Builder

	builder.WriteString("# Homology Gene Results\n\n")

	builder.WriteString("| " + strings.Join(data.Headers, " | ") + " |\n")

	separator := make([]string, len(data.Headers))
	for i := range separator {
		separator[i] = "---"
	}
	builder.WriteString("|" + strings.Join(separator, "|") + "|\n")

	for _, row := range data.Rows {
		builder.WriteString("| " + strings.Join(row, " | ") + " |\n")
	}

	return []byte(builder.String()), nil
}
