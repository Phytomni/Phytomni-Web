package review_agent

import (
	"fmt"
	"strings"

	"phytomni-server/common/document_format/mdoc"
)

type Document struct {
	Content string                   `json:"content"`
	DocList []map[string]interface{} `json:"doc_list"`
}

func refTitle(item map[string]interface{}) string {
	title, _ := item["title"].(string)
	return title
}

func markdownSource(doc Document) string {
	cleanContent := strings.ReplaceAll(doc.Content, "\\n", "\n")
	cleanContent = strings.ReplaceAll(cleanContent, "\\\"", "\"")

	var fullContent strings.Builder
	fullContent.WriteString(cleanContent)
	if len(doc.DocList) == 0 {
		return fullContent.String()
	}
	fullContent.WriteString("\n\n## references\n\n")
	for i, item := range doc.DocList {
		if title := refTitle(item); title != "" {
			fullContent.WriteString(fmt.Sprintf("%d. %s\n", i+1, title))
		}
	}
	return fullContent.String()
}

func GenerateMarkdown(doc Document) ([]byte, error) {
	return []byte(markdownSource(doc)), nil
}

func GenerateWord(doc Document, fetch mdoc.ImageFetcher) ([]byte, error) {
	return mdoc.RenderWord(markdownSource(doc), mdoc.Options{FetchImage: fetch})
}

func GeneratePDF(doc Document, fetch mdoc.ImageFetcher) ([]byte, error) {
	return mdoc.RenderPDF(markdownSource(doc), mdoc.Options{FetchImage: fetch})
}
