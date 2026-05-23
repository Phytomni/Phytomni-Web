package data_agent

import (
	"bytes"
	"fmt"
	"github.com/360EntSecGroup-Skylar/excelize"
	"github.com/jung-kurt/gofpdf"
	"strings"
)

type TableData struct {
	Headers []string   `json:"headers"`
	Rows    [][]string `json:"rows"`
}

// 导出为Word(Excel)文件内容
func ExportToExecl(data TableData) ([]byte, error) {
	f := excelize.NewFile()

	// 创建一个新工作表
	index := f.NewSheet("Sheet1")

	// 设置表头
	for i, header := range data.Headers {
		col := string(rune('A' + i))
		cell := fmt.Sprintf("%s%d", col, 1)
		f.SetCellValue("Sheet1", cell, header)
	}

	// 设置数据行
	for rowIdx, row := range data.Rows {
		for colIdx, value := range row {
			col := string(rune('A' + colIdx))
			cell := fmt.Sprintf("%s%d", col, rowIdx+2)
			f.SetCellValue("Sheet1", cell, value)
		}
	}

	// 设置活动工作表
	f.SetActiveSheet(index)

	// 写入内存缓冲区
	buf := new(bytes.Buffer)
	if err := f.Write(buf); err != nil {
		return nil, fmt.Errorf("生成Excel失败: %v", err)
	}
	return buf.Bytes(), nil
}

// 导出为PDF文件内容
func ExportToPdf(data TableData) ([]byte, error) {
	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.AddPage()

	// 设置标题
	pdf.SetFont("Arial", "B", 16)
	pdf.Cell(40, 10, "Homology Gene Results")
	pdf.Ln(12)

	// 设置表格
	pdf.SetFont("Arial", "", 12)

	// 计算列宽
	colWidth := float64(190) / float64(len(data.Headers))

	// 添加表头
	pdf.SetFillColor(200, 200, 200)
	for _, header := range data.Headers {
		pdf.CellFormat(colWidth, 7, header, "1", 0, "C", true, 0, "")
	}
	pdf.Ln(-1)

	// 添加数据行
	pdf.SetFillColor(255, 255, 255)
	for _, row := range data.Rows {
		for _, cell := range row {
			pdf.CellFormat(colWidth, 6, cell, "1", 0, "C", false, 0, "")
		}
		pdf.Ln(-1)
	}

	// 写入内存缓冲区
	buf := new(bytes.Buffer)
	if err := pdf.Output(buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// 导出为Markdown文件内容
func ExportToMarkdown(data TableData) ([]byte, error) {
	var builder strings.Builder

	// 写入标题
	builder.WriteString("# Homology Gene Results\n\n")

	// 写入表头
	builder.WriteString("| " + strings.Join(data.Headers, " | ") + " |\n")

	// 写入分隔线
	separator := make([]string, len(data.Headers))
	for i := range separator {
		separator[i] = "---"
	}
	builder.WriteString("|" + strings.Join(separator, "|") + "|\n")

	// 写入数据行
	for _, row := range data.Rows {
		builder.WriteString("| " + strings.Join(row, " | ") + " |\n")
	}

	return []byte(builder.String()), nil
}
