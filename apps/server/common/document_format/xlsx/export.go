package xlsx

import (
	"bytes"
	"fmt"

	"github.com/xuri/excelize/v2"
)

// ExportTable writes an xlsx workbook for tabular agent data using StreamWriter.
func ExportTable(data TableInput) ([]byte, error) {
	f := excelize.NewFile()
	defer f.Close()

	sw, err := f.NewStreamWriter("Sheet1")
	if err != nil {
		return nil, fmt.Errorf("export xlsx: %w", err)
	}

	if err := sw.SetPanes(&excelize.Panes{
		Freeze:      true,
		YSplit:      1,
		TopLeftCell: "A2",
		ActivePane:  "bottomLeft",
	}); err != nil {
		return nil, fmt.Errorf("export xlsx: %w", err)
	}

	colCount := len(data.Headers)
	if colCount > 0 {
		headerRow := make([]interface{}, colCount)
		for i, h := range data.Headers {
			headerRow[i] = h
		}
		if err := sw.SetRow("A1", headerRow); err != nil {
			return nil, fmt.Errorf("export xlsx: %w", err)
		}
	}

	for rowIdx, row := range data.Rows {
		if colCount == 0 {
			break
		}
		cell, err := excelize.CoordinatesToCellName(1, rowIdx+2)
		if err != nil {
			return nil, fmt.Errorf("export xlsx: %w", err)
		}
		if err := sw.SetRow(cell, normalizeRow(row, colCount)); err != nil {
			return nil, fmt.Errorf("export xlsx: %w", err)
		}
	}

	if err := sw.Flush(); err != nil {
		return nil, fmt.Errorf("export xlsx: %w", err)
	}

	buf := new(bytes.Buffer)
	if err := f.Write(buf); err != nil {
		return nil, fmt.Errorf("export xlsx: %w", err)
	}
	return buf.Bytes(), nil
}

func normalizeRow(row []string, colCount int) []interface{} {
	out := make([]interface{}, colCount)
	for i := 0; i < colCount; i++ {
		if i < len(row) {
			out[i] = row[i]
		} else {
			out[i] = ""
		}
	}
	return out
}
