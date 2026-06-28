package review_agent

import (
	"bytes"
	"fmt"
	"github.com/jung-kurt/gofpdf"
	"github.com/nguyenthenguyen/docx"
	"os"
	"strings"
)

type Document struct {
	Content string                   `json:"content"`
	DocList []map[string]interface{} `json:"doc_list"`
}

func GenerateMarkdown(doc Document) ([]byte, error) {
	cleanContent := strings.ReplaceAll(doc.Content, "\\n", "\n")
	cleanContent = strings.ReplaceAll(cleanContent, "\\\"", "\"")

	var fullContent strings.Builder
	fullContent.WriteString(cleanContent)
	fullContent.WriteString("\n\n## references\n")

	for i, item := range doc.DocList {
		title := item["title"].(string)
		fullContent.WriteString(fmt.Sprintf("%d. %s\n", i+1, title))
	}

	return []byte(fullContent.String()), nil
}

func GenerateWord(doc Document) ([]byte, error) {
	cleanContent := strings.ReplaceAll(doc.Content, "\\n", "\n")
	cleanContent = strings.ReplaceAll(cleanContent, "\\\"", "\"")

	var references strings.Builder
	references.WriteString("\nreferences\n")
	for i, item := range doc.DocList {
		title := item["title"].(string)
		references.WriteString(fmt.Sprintf("%d. %s\n", i+1, title))
	}

	templateFile := "template.docx"

	if _, err := os.Stat(templateFile); os.IsNotExist(err) {
		r, err := docx.ReadDocxFile("./common/document_format/knowledge_agent/template.docx")
		if err != nil {
			return nil, fmt.Errorf("读取空模板失败: %v", err)
		}
		docx1 := r.Editable()
		docx1.Replace("old", "{{content}}", -1)
		if err := docx1.WriteToFile(templateFile); err != nil {
			return nil, fmt.Errorf("创建模板文件失败: %v", err)
		}
	}

	r, err := docx.ReadDocxFile(templateFile)
	if err != nil {
		return nil, fmt.Errorf("读取模板文件失败: %v", err)
	}
	defer r.Close()

	docx1 := r.Editable()
	fullContent := cleanContent + "\n" + references.String()
	docx1.Replace("{{content}}", fullContent, -1)

	buf := new(bytes.Buffer)
	if err := docx1.Write(buf); err != nil {
		return nil, fmt.Errorf("生成DOCX失败: %v", err)
	}
	return buf.Bytes(), nil
}

func GeneratePDF(doc Document) ([]byte, error) {
	cleanContent := strings.ReplaceAll(doc.Content, "\\n", "\n")
	cleanContent = strings.ReplaceAll(cleanContent, "\\\"", "\"")

	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.AddPage()

	fontPath := "./common/document_format/external_format/msyh.ttf"
	pdf.AddUTF8Font("msyh", "", fontPath)
	pdf.AddUTF8Font("msyh", "B", fontPath)

	pdf.SetFont("msyh", "", 12)
	pdf.MultiCell(0, 10, cleanContent, "", "", false)

	pdf.Ln(10)
	pdf.SetFont("msyh", "B", 14)
	pdf.Cell(0, 10, "references")
	pdf.Ln(10)
	pdf.SetFont("msyh", "", 12)

	for i, item := range doc.DocList {
		if title, ok := item["title"].(string); ok {
			refText := fmt.Sprintf("%d. %s", i+1, title)
			pdf.MultiCell(0, 8, refText, "", "", false)
			pdf.Ln(5)
		}
	}

	buf := new(bytes.Buffer)
	if err := pdf.Output(buf); err != nil {
		return nil, fmt.Errorf("生成PDF失败: %v", err)
	}
	return buf.Bytes(), nil
}
