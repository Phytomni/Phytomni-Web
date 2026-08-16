package knowledge_agent

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/jung-kurt/gofpdf"
	"github.com/nguyenthenguyen/docx"
	"phytomni-server/common/document_format/external_format"
)

type Document struct {
	Content string                   `json:"content"`
	DocList []map[string]interface{} `json:"doc_list"`
}

func refTitle(item map[string]interface{}) string {
	title, _ := item["title"].(string)
	return title
}

func GenerateMarkdown(doc Document) ([]byte, error) {
	cleanContent := strings.ReplaceAll(doc.Content, "\\n", "\n")
	cleanContent = strings.ReplaceAll(cleanContent, "\\\"", "\"")

	var fullContent strings.Builder
	fullContent.WriteString(cleanContent)
	fullContent.WriteString("\n\n## references\n")

	for i, item := range doc.DocList {
		if title := refTitle(item); title != "" {
			fullContent.WriteString(fmt.Sprintf("%d. %s\n", i+1, title))
		}
	}

	return []byte(fullContent.String()), nil
}

func GenerateWord(doc Document) ([]byte, error) {
	cleanContent := strings.ReplaceAll(doc.Content, "\\n", "\n")
	cleanContent = strings.ReplaceAll(cleanContent, "\\\"", "\"")

	var references strings.Builder
	references.WriteString("\nreferences\n")
	for i, item := range doc.DocList {
		if title := refTitle(item); title != "" {
			references.WriteString(fmt.Sprintf("%d. %s\n", i+1, title))
		}
	}

	templateFile, cleanup, err := external_format.WordTemplatePath()
	if err != nil {
		return nil, fmt.Errorf("failed to read template file: %v", err)
	}
	defer cleanup()
	r, err := docx.ReadDocxFile(templateFile)
	if err != nil {
		return nil, fmt.Errorf("failed to read template file: %v", err)
	}
	defer r.Close()

	docx1 := r.Editable()
	fullContent := cleanContent + "\n" + references.String()
	docx1.Replace("{{content}}", fullContent, -1)

	buf := new(bytes.Buffer)
	if err := docx1.Write(buf); err != nil {
		return nil, fmt.Errorf("failed to generate DOCX: %v", err)
	}
	return buf.Bytes(), nil
}

func GeneratePDF(doc Document) ([]byte, error) {
	cleanContent := strings.ReplaceAll(doc.Content, "\\n", "\n")
	cleanContent = strings.ReplaceAll(cleanContent, "\\\"", "\"")

	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.AddPage()

	if err := external_format.RegisterCJKFont(pdf, "msyh", "", "msyh.ttf"); err != nil {
		return nil, err
	}
	if err := external_format.RegisterCJKFont(pdf, "msyh", "B", "msyh.ttf"); err != nil {
		return nil, err
	}

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
		return nil, fmt.Errorf("failed to generate PDF: %v", err)
	}
	return buf.Bytes(), nil
}
