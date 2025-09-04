package knowledge_agent

import (
	"bytes"
	"fmt"
	"github.com/jung-kurt/gofpdf"
	"github.com/nguyenthenguyen/docx"
	"os"
	"strings"
)

// 数据结构
type Document struct {
	Content string                   `json:"content"`
	DocList []map[string]interface{} `json:"doc_list"`
}

// 生成Markdown文件内容
func GenerateMarkdown(doc Document) ([]byte, error) {
	// 处理转义字符
	cleanContent := strings.ReplaceAll(doc.Content, "\\n", "\n")
	cleanContent = strings.ReplaceAll(cleanContent, "\\\"", "\"")

	// 构建完整内容
	var fullContent strings.Builder
	fullContent.WriteString(cleanContent)
	fullContent.WriteString("\n\n## references\n")

	// 添加参考文献
	for i, item := range doc.DocList {
		title := item["title"].(string)
		fullContent.WriteString(fmt.Sprintf("%d. %s\n", i+1, title))
	}

	return []byte(fullContent.String()), nil
}

// 生成Word文件内容
func GenerateWord(doc Document) ([]byte, error) {
	// 处理转义字符
	cleanContent := strings.ReplaceAll(doc.Content, "\\n", "\n")
	cleanContent = strings.ReplaceAll(cleanContent, "\\\"", "\"")

	// 准备参考文献内容
	var references strings.Builder
	references.WriteString("\nreferences\n")
	for i, item := range doc.DocList {
		title := item["title"].(string)
		references.WriteString(fmt.Sprintf("%d. %s\n", i+1, title))
	}

	// 方法1：使用预先生成的有效模板文件
	templateFile := "template.docx"

	// 如果模板文件不存在，创建一个有占位符的简单文档
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

	// 读取模板文件
	r, err := docx.ReadDocxFile(templateFile)
	if err != nil {
		return nil, fmt.Errorf("读取模板文件失败: %v", err)
	}
	defer r.Close()

	docx1 := r.Editable()
	fullContent := cleanContent + "\n" + references.String()
	docx1.Replace("{{content}}", fullContent, -1)

	// 写入内存缓冲区
	buf := new(bytes.Buffer)
	if err := docx1.Write(buf); err != nil {
		return nil, fmt.Errorf("生成DOCX失败: %v", err)
	}
	return buf.Bytes(), nil
}

// // GeneratePDF 生成PDF文件内容（无需任何外部字体文件）
//
//	func GeneratePDF(doc Document) ([]byte, error) {
//		// 处理转义字符
//		cleanContent := strings.ReplaceAll(doc.Content, "\\n", "\n")
//		cleanContent = strings.ReplaceAll(cleanContent, "\\\"", "\"")
//
//		// 初始化PDF（使用内置核心字体）
//		pdf := gofpdf.New("P", "mm", "A4", "")
//		pdf.AddPage()
//
//		// 使用内置核心字体（无需任何外部文件）
//		pdf.SetFont("Arial", "", 12)
//
//		// 自动检测内容编码
//		if hasChinese(cleanContent) {
//			return nil, fmt.Errorf("文档包含中文，请使用专业版PDF生成方案")
//		}
//
//		// 添加正文内容
//		pdf.MultiCell(0, 10, cleanContent, "", "", false)
//
//		// 添加参考文献标题
//		pdf.Ln(10)
//		pdf.SetFont("Arial", "B", 14)
//		pdf.Cell(0, 10, "References")
//		pdf.Ln(10)
//		pdf.SetFont("Arial", "", 12)
//
//		// 添加参考文献内容
//		for i, item := range doc.DocList {
//			if title, ok := item["title"].(string); ok {
//				if hasChinese(title) {
//					return nil, fmt.Errorf("文献标题包含中文，请使用专业版PDF生成方案")
//				}
//				refText := fmt.Sprintf("%d. %s", i+1, title)
//				pdf.MultiCell(0, 8, refText, "", "", false)
//				pdf.Ln(5)
//			}
//		}
//
//		// 写入内存缓冲区
//		buf := new(bytes.Buffer)
//		if err := pdf.Output(buf); err != nil {
//			return nil, fmt.Errorf("生成PDF失败: %v", err)
//		}
//		return buf.Bytes(), nil
//	}
//
// // hasChinese 检查字符串是否包含中文
//
//	func hasChinese(text string) bool {
//		for _, r := range text {
//			if unicode.Is(unicode.Han, r) {
//				return true
//			}
//		}
//		return false
//	}
//

// GeneratePDF 生成PDF文件内容（支持中文）
//func GeneratePDF(doc Document) ([]byte, error) {
//	// 处理转义字符
//	cleanContent := strings.ReplaceAll(doc.Content, "\\n", "\n")
//	cleanContent = strings.ReplaceAll(cleanContent, "\\\"", "\"")
//
//	// 初始化PDF（使用支持中文的配置）
//	pdf := gofpdf.New("P", "mm", "A4", "")
//	pdf.AddPage()
//
//	// 使用内置支持中文的字体
//	pdf.AddUTF8Font("simsun", "", "common/document_format/knowledge_agent/simsun.ttf") // 或者使用其他内置中文字体
//	pdf.SetFont("simsun", "", 12)
//
//	// 添加正文内容
//	pdf.MultiCell(0, 10, cleanContent, "", "", false)
//
//	// 添加参考文献标题
//	pdf.Ln(10)
//	pdf.SetFont("simsun", "", 14)
//	pdf.Cell(0, 10, "参考文献") // 中文标题
//	pdf.Ln(10)
//	pdf.SetFont("simsun", "", 12)
//
//	// 添加参考文献内容
//	for i, item := range doc.DocList {
//		if title, ok := item["title"].(string); ok {
//			refText := fmt.Sprintf("%d. %s", i+1, title)
//			pdf.MultiCell(0, 8, refText, "", "", false)
//			pdf.Ln(5)
//		}
//	}
//
//	// 写入内存缓冲区
//	buf := new(bytes.Buffer)
//	if err := pdf.Output(buf); err != nil {
//		return nil, fmt.Errorf("生成PDF失败: %v", err)
//	}
//	return buf.Bytes(), nil
//}

func GeneratePDF(doc Document) ([]byte, error) {
	// 处理转义字符
	cleanContent := strings.ReplaceAll(doc.Content, "\\n", "\n")
	cleanContent = strings.ReplaceAll(cleanContent, "\\\"", "\"")

	// 初始化PDF（使用支持中文的配置）
	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.AddPage()

	// 注册微软雅黑字体（普通+粗体）
	fontPath := "./common/document_format/external_format/msyh.ttf" // 确保字体文件在可访问路径
	pdf.AddUTF8Font("msyh", "", fontPath)                           // 普通字体
	pdf.AddUTF8Font("msyh", "B", fontPath)                          // 粗体（可选，如果要用Bold）

	// 设置默认字体
	pdf.SetFont("msyh", "", 12)

	// 添加正文内容
	pdf.MultiCell(0, 10, cleanContent, "", "", false)

	// 添加参考文献标题（使用粗体）
	pdf.Ln(10)
	pdf.SetFont("msyh", "B", 14) // 使用微软雅黑粗体
	pdf.Cell(0, 10, "references")
	pdf.Ln(10)
	pdf.SetFont("msyh", "", 12) // 切换回普通字体

	// 添加参考文献内容
	for i, item := range doc.DocList {
		if title, ok := item["title"].(string); ok {
			refText := fmt.Sprintf("%d. %s", i+1, title)
			pdf.MultiCell(0, 8, refText, "", "", false)
			pdf.Ln(5)
		}
	}

	// 写入内存缓冲区
	buf := new(bytes.Buffer)
	if err := pdf.Output(buf); err != nil {
		return nil, fmt.Errorf("生成PDF失败: %v", err)
	}
	return buf.Bytes(), nil
}
