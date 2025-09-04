package document_format

import (
	"encoding/json"
	"fmt"
	"nky_client_go/common/document_format/chat_agent"
	"nky_client_go/common/document_format/data_agent"
	"nky_client_go/common/document_format/knowledge_agent"
	"nky_client_go/common/document_format/review_agent"
	"time"
)

type FileDownloader interface {
	Download(format string, answer string) ([]byte, string, error)
}

func NewAgent(toolName string) (FileDownloader, error) {
	switch toolName {
	case "ChatAgent":
		return &ChatAgent{}, nil
	case "KnowledgeAgent":
		return &KnowledgeAgent{}, nil
	case "DataAgent":
		return &DataAgent{}, nil
	case "ReviewAgent":
		return &ReviewAgent{}, nil
	default:
		return nil, fmt.Errorf("unknown tool: %s", toolName)
	}
}

// ChatAgent 实现
type ChatAgent struct{}

func (a *ChatAgent) Download(format string, answer string) ([]byte, string, error) {
	timestamp := time.Now().Unix() // 获取当前 Unix 时间戳（秒级）
	filename := fmt.Sprintf("chat_%d", timestamp)
	switch format {
	case "Word":
		filename += ".docx"
		content, err := chat_agent.GenerateWord(answer)
		return content, filename, err
	case "PDF":
		filename += ".pdf"
		content, err := chat_agent.GeneratePDF(answer)
		return content, filename, err
	case "Markdown":
		filename += ".md"
		content, err := chat_agent.GenerateMarkdown(answer)
		return content, filename, err
	default:
		return nil, "", fmt.Errorf("unsupported format: %s", format)
	}
}

// KnowledgeAgent 实现
type KnowledgeAgent struct{}

// KnowledgeAgent 的实现
func (a *KnowledgeAgent) Download(format string, answer string) ([]byte, string, error) {
	// 解析answer为Document结构
	var doc knowledge_agent.Document
	if err := json.Unmarshal([]byte(answer), &doc); err != nil {
		return nil, "", fmt.Errorf("解析answer失败: %v", err)
	}

	timestamp := time.Now().Unix()
	filename := fmt.Sprintf("knowledge_%d", timestamp)

	switch format {
	case "Word":
		filename += ".docx"
		content, err := knowledge_agent.GenerateWord(doc)
		return content, filename, err
	case "PDF":
		filename += ".pdf"
		content, err := knowledge_agent.GeneratePDF(doc)
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
	// 解析answer为TableData结构
	var data data_agent.TableData
	if err := json.Unmarshal([]byte(answer), &data); err != nil {
		return nil, "", fmt.Errorf("解析answer失败: %v", err)
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
		content, err := data_agent.ExportToExecl(data)
		return content, filename, err
	default:
		return nil, "", fmt.Errorf("unsupported format: %s", format)
	}
}

type ReviewAgent struct{}

func (a *ReviewAgent) Download(format string, answer string) ([]byte, string, error) {
	// 解析answer为Document结构
	var doc review_agent.Document
	if err := json.Unmarshal([]byte(answer), &doc); err != nil {
		return nil, "", fmt.Errorf("解析answer失败: %v", err)
	}

	timestamp := time.Now().Unix()
	filename := fmt.Sprintf("review_%d", timestamp)

	switch format {
	case "Word":
		filename += ".docx"
		content, err := review_agent.GenerateWord(doc)
		return content, filename, err
	case "PDF":
		filename += ".pdf"
		content, err := review_agent.GeneratePDF(doc)
		return content, filename, err
	case "Markdown":
		filename += ".md"
		content, err := review_agent.GenerateMarkdown(doc)
		return content, filename, err
	default:
		return nil, "", fmt.Errorf("unsupported format: %s", format)
	}
}
