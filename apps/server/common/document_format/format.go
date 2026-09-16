package document_format

import (
	"encoding/json"
	"fmt"
	"time"

	"phytomni-server/common/citation"
	"phytomni-server/common/document_format/chat_agent"
	"phytomni-server/common/document_format/data_agent"
	"phytomni-server/common/document_format/mdoc"
)

type FileDownloader interface {
	Download(format string, answer string) ([]byte, string, error)
}

// AgentOptions carries server-owned per-download resources. A nil FetchImage
// leaves Markdown images as alt text; FontDir is read only for cited PDFs.
type AgentOptions struct {
	FetchImage mdoc.ImageFetcher
	FontDir    string
}

type citedEnvelope struct {
	Content string          `json:"content"`
	DocList json.RawMessage `json:"doc_list"`
}

func decodeCitedAnswer(answer string) (string, []citation.Row, error) {
	var envelope citedEnvelope
	if err := json.Unmarshal([]byte(answer), &envelope); err != nil {
		return answer, nil, nil
	}
	rows, err := citation.DecodeRows(envelope.DocList)
	return envelope.Content, rows, err
}

func NewAgent(toolName string) (FileDownloader, error) {
	return NewAgentWithOptions(toolName, AgentOptions{})
}

func NewAgentWithOptions(toolName string, opts AgentOptions) (FileDownloader, error) {
	switch toolName {
	case "ChatAgent":
		return &ChatAgent{opts: opts}, nil
	case "KnowledgeAgent":
		return &citedAgent{opts: opts, filePrefix: "knowledge"}, nil
	case "DataAgent":
		return &DataAgent{}, nil
	case "BriefGeneAgent", "ReviewAgent":
		// Cited-family reports share the {content, doc_list} formatter.
		// Register every canonical Bot-side tool name or /v1/download/*
		// reports "unknown tool".
		return &citedAgent{opts: opts, filePrefix: "review"}, nil
	case "DeepGenomeAgent":
		return &citedAgent{opts: opts, filePrefix: "deepgenome"}, nil
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

type citedAgent struct {
	opts       AgentOptions
	filePrefix string
}

func (a *citedAgent) Download(format string, answer string) ([]byte, string, error) {
	switch format {
	case "Word", "PDF", "Markdown":
	default:
		return nil, "", fmt.Errorf("unsupported format: %s", format)
	}
	source, rows, err := decodeCitedAnswer(answer)
	if err != nil {
		return nil, "", err
	}
	timestamp := time.Now().Unix()
	filename := fmt.Sprintf("%s_%d", a.filePrefix, timestamp)

	switch format {
	case "Word":
		filename += ".docx"
		document, err := mdoc.BuildCited(source, rows, mdoc.Options{FetchImage: a.opts.FetchImage})
		if err != nil {
			return nil, filename, err
		}
		content, err := mdoc.RenderCitedWord(document)
		return content, filename, err
	case "PDF":
		filename += ".pdf"
		document, err := mdoc.BuildCited(source, rows, mdoc.Options{FetchImage: a.opts.FetchImage})
		if err != nil {
			return nil, filename, err
		}
		fonts := mdoc.LoadAcademicFontsBestEffort(a.opts.FontDir)
		content, err := mdoc.RenderCitedPDF(document, fonts)
		return content, filename, err
	case "Markdown":
		filename += ".md"
		content, err := mdoc.CitedMarkdown(source, rows)
		if err != nil {
			return nil, filename, err
		}
		return []byte(content), filename, nil
	default:
		return nil, "", fmt.Errorf("unsupported format: %s", format)
	}
}
