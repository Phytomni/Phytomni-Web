package chat_agent

import (
	"bytes"
	"fmt"
	"github.com/jung-kurt/gofpdf"     // PDF 生成
	"github.com/nguyenthenguyen/docx" // DOCX 生成
)

// 生成Markdown文件
func GenerateMarkdown(content string) ([]byte, error) {
	return []byte(content), nil
}

// 生成Word文件
func GenerateWord(content string) ([]byte, error) {
	// 1. 读取模板文件
	r, err := docx.ReadDocxFile("./common/document_format/external_format/empty.docx")
	if err != nil {
		return nil, fmt.Errorf("无法读取模板文件: %v", err)
	}
	defer r.Close()

	// 2. 替换占位符
	docx1 := r.Editable()
	docx1.Replace("{placeholder}", content, -1)

	// 3. 创建内存缓冲区
	buf := new(bytes.Buffer)
	if err := docx1.Write(buf); err != nil {
		return nil, fmt.Errorf("生成DOCX失败: %v", err)
	}
	return buf.Bytes(), nil
}

// 生成PDF文件
func GeneratePDF(content string) ([]byte, error) {
	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.AddPage()

	// 添加支持中文的字体（需要字体文件）
	// 这里以"simsun"为例，你需要准备相应的字体文件
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
