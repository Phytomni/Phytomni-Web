package chat_agent

import (
	"bytes"
	"fmt"

	"github.com/jung-kurt/gofpdf"
	"github.com/nguyenthenguyen/docx"
	"phytomni-server/common/document_format/external_format"
)

func GenerateMarkdown(content string) ([]byte, error) {
	return []byte(content), nil
}

func GenerateWord(content string) ([]byte, error) {
	templatePath, cleanup, err := external_format.EmptyWordPath()
	if err != nil {
		return nil, fmt.Errorf("cannot read template file: %v", err)
	}
	defer cleanup()
	r, err := docx.ReadDocxFile(templatePath)
	if err != nil {
		return nil, fmt.Errorf("cannot read template file: %v", err)
	}
	defer r.Close()

	docx1 := r.Editable()
	docx1.Replace("{placeholder}", content, -1)

	buf := new(bytes.Buffer)
	if err := docx1.Write(buf); err != nil {
		return nil, fmt.Errorf("failed to generate DOCX: %v", err)
	}
	return buf.Bytes(), nil
}

func GeneratePDF(content string) ([]byte, error) {
	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.AddPage()
	if err := external_format.RegisterCJKFont(pdf, "simsun", "", "simsun.ttf"); err != nil {
		return nil, err
	}
	pdf.SetFont("simsun", "", 12)

	pdf.MultiCell(0, 10, content, "", "", false)

	buf := new(bytes.Buffer)
	err := pdf.Output(buf)
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
