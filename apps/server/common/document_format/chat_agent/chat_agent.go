package chat_agent

import (
	"bytes"
	"fmt"
	"github.com/jung-kurt/gofpdf"
	"github.com/nguyenthenguyen/docx"
)

func GenerateMarkdown(content string) ([]byte, error) {
	return []byte(content), nil
}

func GenerateWord(content string) ([]byte, error) {
	r, err := docx.ReadDocxFile("./common/document_format/external_format/empty.docx")
	if err != nil {
		return nil, fmt.Errorf("无法读取模板文件: %v", err)
	}
	defer r.Close()

	docx1 := r.Editable()
	docx1.Replace("{placeholder}", content, -1)

	buf := new(bytes.Buffer)
	if err := docx1.Write(buf); err != nil {
		return nil, fmt.Errorf("生成DOCX失败: %v", err)
	}
	return buf.Bytes(), nil
}

func GeneratePDF(content string) ([]byte, error) {
	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.AddPage()

	// Register a CJK-capable font (a font file is required); simsun is the example here.
	pdf.AddUTF8Font("simsun", "", "./common/document_format/external_format/simsun.ttf")
	pdf.SetFont("simsun", "", 12)

	pdf.MultiCell(0, 10, content, "", "", false)

	buf := new(bytes.Buffer)
	err := pdf.Output(buf)
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
