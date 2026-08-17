package document_format

import (
	"encoding/json"
	"fmt"
	"phytomni-server/common/document_format/chat_agent"
	"phytomni-server/common/document_format/data_agent"
	"phytomni-server/common/document_format/knowledge_agent"
	"phytomni-server/common/document_format/mdoc"
	"phytomni-server/common/document_format/review_agent"
	"time"
)

type FileDownloader interface {
	Download(format string, answer string) ([]byte, string, error)
}

// AgentOptions carries per-download helpers. FetchImage is optional; a nil
// fetcher leaves Markdown images as alt text.
type AgentOptions struct {
	FetchImage mdoc.ImageFetcher
}

func parseKnowledgeAnswer(answer string) knowledge_agent.Document {
	var doc knowledge_agent.Document
	if err := json.Unmarshal([]byte(answer), &doc); err != nil {
		return knowledge_agent.Document{Content: answer}
	}
	return doc
}

func parseReviewAnswer(answer string) review_agent.Document {
	var doc review_agent.Document
	if err := json.Unmarshal([]byte(answer), &doc); err != nil {
		return review_agent.Document{Content: answer}
	}
	return doc
}

func NewAgent(toolName string) (FileDownloader, error) {
	return NewAgentWithOptions(toolName, AgentOptions{})
}

func NewAgentWithOptions(toolName string, opts AgentOptions) (FileDownloader, error) {
	switch toolName {
	case "ChatAgent":
		return &ChatAgent{opts: opts}, nil
	case "KnowledgeAgent":
		return &KnowledgeAgent{opts: opts}, nil
	case "DataAgent":
		return &DataAgent{}, nil
	case "BriefGeneAgent", "ReviewAgent":
		// Cited-family reports share the {content, doc_list} formatter.
		// Register every canonical Bot-side tool name or /v1/download/*
		// reports "unknown tool".
		return &ReviewAgent{opts: opts}, nil
	case "DeepGenomeAgent":
		return &ReviewAgent{opts: opts, filePrefix: "deepgenome"}, nil
	default:
		return nil, fmt.Errorf("unknown tool: %s", toolName)
	}
}

type ChatAgent struct {
	opts AgentOptions
}

func (a *ChatAgent) Download(format string, answer string) ([]byte, string, error) {
	timestamp := time.Now().Unix()
	filename := fmt.Sprintf("chat_%d", timestamp)
	switch format {
	case "Word":
		filename += ".docx"
		content, err := chat_agent.GenerateWord(answer, a.opts.FetchImage)
		return content, filename, err
	case "PDF":
		filename += ".pdf"
		content, err := chat_agent.GeneratePDF(answer, a.opts.FetchImage)
		return content, filename, err
	case "Markdown":
		filename += ".md"
		content, err := chat_agent.GenerateMarkdown(answer)
		return content, filename, err
	default:
		return nil, "", fmt.Errorf("unsupported format: %s", format)
	}
}

type KnowledgeAgent struct {
	opts AgentOptions
}

func (a *KnowledgeAgent) Download(format string, answer string) ([]byte, string, error) {
	doc := parseKnowledgeAnswer(answer)

	timestamp := time.Now().Unix()
	filename := fmt.Sprintf("knowledge_%d", timestamp)

	switch format {
	case "Word":
		filename += ".docx"
		content, err := knowledge_agent.GenerateWord(doc, a.opts.FetchImage)
		return content, filename, err
	case "PDF":
		filename += ".pdf"
		content, err := knowledge_agent.GeneratePDF(doc, a.opts.FetchImage)
		return content, filename, err
	case "Markdown":
		filename += ".md"
		content, err := knowledge_agent.GenerateMarkdown(doc)
		return content, filename, err
	default:
		return nil, "", fmt.Errorf("unsupported format: %s", format)
	}
}

type DataAgent struct{}

func (a *DataAgent) Download(format string, answer string) ([]byte, string, error) {
	var data data_agent.TableData
	if err := json.Unmarshal([]byte(answer), &data); err != nil {
		return nil, "", fmt.Errorf("failed to parse answer: %v", err)
	}

	timestamp := time.Now().Unix()
	filename := fmt.Sprintf("data_%d", timestamp)

	switch format {
	case "PDF":
		filename += ".pdf"
		content, err := data_agent.ExportToPdf(data)
		return content, filename, err
	case "Markdown":
		filename += ".md"
		content, err := data_agent.ExportToMarkdown(data)
		return content, filename, err
	case "Xlsx":
		filename += ".xlsx"
		content, err := data_agent.ExportToExcel(data)
		return content, filename, err
	default:
		return nil, "", fmt.Errorf("unsupported format: %s", format)
	}
}

type ReviewAgent struct {
	opts       AgentOptions
	filePrefix string
}

func (a *ReviewAgent) Download(format string, answer string) ([]byte, string, error) {
	doc := parseReviewAnswer(answer)

	timestamp := time.Now().Unix()
	prefix := a.filePrefix
	if prefix == "" {
		prefix = "review"
	}
	filename := fmt.Sprintf("%s_%d", prefix, timestamp)

	switch format {
	case "Word":
		filename += ".docx"
		content, err := review_agent.GenerateWord(doc, a.opts.FetchImage)
		return content, filename, err
	case "PDF":
		filename += ".pdf"
		content, err := review_agent.GeneratePDF(doc, a.opts.FetchImage)
		return content, filename, err
	case "Markdown":
		filename += ".md"
		content, err := review_agent.GenerateMarkdown(doc)
		return content, filename, err
	default:
		return nil, "", fmt.Errorf("unsupported format: %s", format)
	}
}
