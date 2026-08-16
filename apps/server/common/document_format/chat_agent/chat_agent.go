package chat_agent

import "phytomni-server/common/document_format/mdoc"

func GenerateMarkdown(content string) ([]byte, error) {
	return []byte(content), nil
}

func GenerateWord(content string, fetch mdoc.ImageFetcher) ([]byte, error) {
	return mdoc.RenderWord(content, mdoc.Options{FetchImage: fetch})
}

func GeneratePDF(content string, fetch mdoc.ImageFetcher) ([]byte, error) {
	return mdoc.RenderPDF(content, mdoc.Options{FetchImage: fetch})
}
