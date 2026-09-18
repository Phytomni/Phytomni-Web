package api_service

import (
	"bytes"
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/spf13/viper"
	"gorm.io/gorm"
)

const serviceCitedDownloadAnswer = `{"content":"# Plant report\n\nEvidence [1].","doc_list":[{"au":"Doe, JA","ti":"A plant study","so":"Plant Journal","vl":"12","bp":"45","ep":"49","py":"2024"}]}`

func TestDownloadObsRenderingFileUsesServerFontDirectory(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(
		`INSERT INTO question_agent_logs (id, user_name, answer, tool_name, download_path, image_paths) VALUES (?, 'alice', ?, ?, '', '[]')`,
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

	data, filename, err := NewService().DownloadObsRenderingFile(context.Background(), "alice", 1301, "PDF")
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
			`INSERT INTO question_agent_logs (id, user_name, answer, tool_name, download_path, image_paths) VALUES (?, 'alice', ?, ?, '', '[]')`,
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
		data, _, err := service.DownloadObsRenderingFile(context.Background(), "alice", 1302, format)
		if err != nil || len(data) == 0 {
			t.Fatalf("cited %s without fonts: data=%d err=%v", format, len(data), err)
		}
	}
	data, _, err := service.DownloadObsRenderingFile(context.Background(), "alice", 1302, "PDF")
	if err != nil || !bytes.HasPrefix(data, []byte("%PDF")) {
		t.Fatalf("cited PDF without fonts: data=%d err=%v", len(data), err)
	}
	data, _, err = service.DownloadObsRenderingFile(context.Background(), "alice", 1303, "PDF")
	if err != nil || !bytes.HasPrefix(data, []byte("%PDF")) {
		t.Fatalf("ordinary Chat PDF without academic fonts: data=%d err=%v", len(data), err)
	}
}

func TestRenderingDownloadServiceOwnLiveRowsAllAgentsAndFormats(t *testing.T) {
	gdb := setupTestDB(t)
	fontDir := os.Getenv("PHYTOMNI_REPORT_FONT_DIR")
	if fontDir == "" {
		t.Fatal("PHYTOMNI_REPORT_FONT_DIR is required for genuine Times New Roman tests")
	}
	previous := viper.Get("document_export.font_dir")
	viper.Set("document_export.font_dir", fontDir)
	t.Cleanup(func() { viper.Set("document_export.font_dir", previous) })
	for index, tool := range []string{"ChatAgent", "DataAgent", "KnowledgeAgent", "ReviewAgent", "BriefGeneAgent", "DeepGenomeAgent"} {
		rootID := 1400 + index*2
		answer := serviceCitedDownloadAnswer
		formats := []string{"Markdown", "Word", "PDF"}
		if tool == "ChatAgent" {
			answer = "# Owner report\n\nBody."
		}
		if tool == "DataAgent" {
			answer = `{"headers":["Gene","Value"],"rows":[["TEST1","1"]]}`
			formats = []string{"Markdown", "Xlsx", "PDF"}
		}
		for offset := 0; offset < 2; offset++ {
			id, parent := rootID+offset, 0
			if offset == 1 {
				parent = rootID
			}
			if err := gdb.Exec(`INSERT INTO question_agent_logs
				(id, user_name, dialogue_id, f_id, tool_name, answer, image_paths)
				VALUES (?, 'alice', 'dialogue-owner', ?, ?, ?, '[]')`, id, parent, tool, answer).Error; err != nil {
				t.Fatal(err)
			}
			for _, format := range formats {
				data, filename, err := NewService().DownloadObsRenderingFile(context.Background(), "alice", id, format)
				if err != nil || len(data) == 0 || filename == "" {
					t.Fatalf("own %s row=%d %s: bytes=%d filename=%q err=%v", tool, id, format, len(data), filename, err)
				}
				switch format {
				case "PDF":
					if !bytes.HasPrefix(data, []byte("%PDF")) || !strings.HasSuffix(filename, ".pdf") {
						t.Fatalf("own %s row=%d: invalid PDF", tool, id)
					}
				case "Word", "Xlsx":
					suffix := ".docx"
					if format == "Xlsx" {
						suffix = ".xlsx"
					}
					if !bytes.HasPrefix(data, []byte("PK")) || !strings.HasSuffix(filename, suffix) {
						t.Fatalf("own %s row=%d: invalid %s", tool, id, format)
					}
				case "Markdown":
					if !strings.HasSuffix(filename, ".md") {
						t.Fatalf("own %s row=%d: invalid Markdown filename %q", tool, id, filename)
					}
				}
			}
		}
	}
}

func TestRenderingDownloadServiceRejectsBlankIdentityBeforeQuery(t *testing.T) {
	gdb := setupTestDB(t)
	queries := 0
	if err := gdb.Callback().Query().Before("gorm:query").Register("rendering_identity_query", func(tx *gorm.DB) {
		queries++
		tx.AddError(errors.New("database should not be accessed"))
	}); err != nil {
		t.Fatal(err)
	}
	for _, username := range []string{"", " \t\n"} {
		data, filename, err := NewService().DownloadObsRenderingFile(context.Background(), username, 1, "Word")
		if !errors.Is(err, ErrRenderingDownloadUnauthorized) || data != nil || filename != "" {
			t.Fatalf("blank identity: data=%d filename=%q err=%v", len(data), filename, err)
		}
	}
	if queries != 0 {
		t.Fatalf("blank identity queried database %d times", queries)
	}
}

func TestRenderingDownloadServicePreservesDatabaseFailure(t *testing.T) {
	gdb := setupTestDB(t)
	want := errors.New("synthetic database failure")
	if err := gdb.Callback().Query().Before("gorm:query").Register("rendering_database_failure", func(tx *gorm.DB) {
		tx.AddError(want)
	}); err != nil {
		t.Fatal(err)
	}
	data, filename, err := NewService().DownloadObsRenderingFile(context.Background(), "alice", 1, "Word")
	if !errors.Is(err, want) || errors.Is(err, ErrRenderingDownloadNotFound) || data != nil || filename != "" {
		t.Fatalf("database failure: data=%d filename=%q err=%v", len(data), filename, err)
	}
}

func TestRenderingDownloadServiceRejectsInaccessibleRows(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, dialogue_id, f_id, delete_at, tool_name, answer, image_paths) VALUES
		(1500, 'alice', 'owner-dialogue', 0, NULL, 'ChatAgent', 'owner report', '[]'),
		(1501, 'alice', 'owner-dialogue', 1500, NULL, 'PrivateUnknownTool', 'invalid private answer', '[]'),
		(1502, 'bob', 'owner-dialogue', 0, NULL, 'PrivateUnknownTool', 'invalid private answer', '[]'),
		(1503, 'alice', 'owner-dialogue', 0, '2026-09-01', 'PrivateUnknownTool', 'invalid private answer', '[]'),
		(1504, 'alice', 'owner-dialogue', 9999, NULL, 'PrivateUnknownTool', 'invalid private answer', '[]')`).Error; err != nil {
		t.Fatal(err)
	}
	for _, id := range []int{0, -1, 9999, 1502, 1503, 1504} {
		data, filename, err := NewService().DownloadObsRenderingFile(context.Background(), "alice", id, "Word")
		if !errors.Is(err, ErrRenderingDownloadNotFound) || data != nil || filename != "" {
			t.Fatalf("inaccessible row=%d: bytes=%d filename=%q err=%v", id, len(data), filename, err)
		}
	}
	for _, state := range []string{conversationDeletePending, conversationDeleteAcked} {
		// Mirror the root-only tombstone written by QueryListDelete: the child
		// remains undeleted, but neither record is eligible for a download.
		if err := gdb.Exec(`UPDATE question_agent_logs SET delete_at = '2026-09-01', log_status = ? WHERE id = 1500`, state).Error; err != nil {
			t.Fatal(err)
		}
		for _, id := range []int{1500, 1501} {
			data, filename, err := NewService().DownloadObsRenderingFile(context.Background(), "alice", id, "Word")
			if !errors.Is(err, ErrRenderingDownloadNotFound) || data != nil || filename != "" {
				t.Fatalf("deleted conversation=%s row=%d: bytes=%d filename=%q err=%v", state, id, len(data), filename, err)
			}
		}
	}
}
