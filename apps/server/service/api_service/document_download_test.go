package api_service

import (
	"bytes"
	"context"
	"errors"
	"os"
	"testing"

	"phytomni-server/common/document_format/mdoc"

	"github.com/spf13/viper"
)

const serviceCitedDownloadAnswer = `{"content":"# Plant report\n\nEvidence [1].","doc_list":[{"au":"Doe, JA","ti":"A plant study","so":"Plant Journal","vl":"12","bp":"45","ep":"49","py":"2024"}]}`

func TestDownloadObsRenderingFileUsesServerFontDirectory(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(
		`INSERT INTO question_agent_logs (id, answer, tool_name, download_path, image_paths) VALUES (?, ?, ?, '', '[]')`,
		1301, serviceCitedDownloadAnswer, "ReviewAgent",
	).Error; err != nil {
		t.Fatalf("seed cited row: %v", err)
	}
	fontDir := os.Getenv("PHYTOMNI_REPORT_FONT_DIR")
	if fontDir == "" {
		t.Fatal("PHYTOMNI_REPORT_FONT_DIR is required for genuine Times New Roman tests")
	}
	previous := viper.Get("document_export.font_dir")
	viper.Set("document_export.font_dir", fontDir)
	t.Cleanup(func() { viper.Set("document_export.font_dir", previous) })

	data, filename, err := NewService().DownloadObsRenderingFile(context.Background(), 1301, "PDF")
	if err != nil {
		t.Fatalf("configured cited PDF: %v", err)
	}
	if !bytes.HasPrefix(data, []byte("%PDF")) || filename == "" {
		t.Fatalf("configured cited PDF payload=%q filename=%q", data[:min(len(data), 8)], filename)
	}
}

func TestDownloadObsRenderingFileMissingFontsAffectsOnlyCitedPDF(t *testing.T) {
	gdb := setupTestDB(t)
	for _, row := range []struct {
		id       int
		toolName string
		answer   string
	}{
		{id: 1302, toolName: "KnowledgeAgent", answer: serviceCitedDownloadAnswer},
		{id: 1303, toolName: "ChatAgent", answer: "# Ordinary chat\n\nBody."},
	} {
		if err := gdb.Exec(
			`INSERT INTO question_agent_logs (id, answer, tool_name, download_path, image_paths) VALUES (?, ?, ?, '', '[]')`,
			row.id, row.answer, row.toolName,
		).Error; err != nil {
			t.Fatalf("seed row %d: %v", row.id, err)
		}
	}
	previous := viper.Get("document_export.font_dir")
	viper.Set("document_export.font_dir", "")
	t.Cleanup(func() { viper.Set("document_export.font_dir", previous) })
	service := NewService()

	for _, format := range []string{"Markdown", "Word"} {
		data, _, err := service.DownloadObsRenderingFile(context.Background(), 1302, format)
		if err != nil || len(data) == 0 {
			t.Fatalf("cited %s without fonts: data=%d err=%v", format, len(data), err)
		}
	}
	data, _, err := service.DownloadObsRenderingFile(context.Background(), 1302, "PDF")
	if data != nil || !errors.Is(err, mdoc.ErrAcademicFontsUnavailable) {
		t.Fatalf("cited PDF without fonts: data=%d err=%v", len(data), err)
	}
	data, _, err = service.DownloadObsRenderingFile(context.Background(), 1303, "PDF")
	if err != nil || !bytes.HasPrefix(data, []byte("%PDF")) {
		t.Fatalf("ordinary Chat PDF without academic fonts: data=%d err=%v", len(data), err)
	}
}
