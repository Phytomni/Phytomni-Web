package document_format

import (
	"bytes"
	"os"
	"testing"
)

func TestDownloadsDoNotDependOnProcessWorkingDirectory(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(wd)
	})
	agent, err := NewAgent("ChatAgent")
	if err != nil {
		t.Fatal(err)
	}
	content, _, err := agent.Download("Word", "cwd-independent fixture")
	if err != nil {
		t.Fatalf("Word from empty cwd: %v", err)
	}
	if !bytes.HasPrefix(content, []byte("PK")) {
		t.Fatal("Word from empty cwd is not a docx")
	}
}

func TestChatAgentDownloadsWordAndPDF(t *testing.T) {
	agent, err := NewAgent("ChatAgent")
	if err != nil {
		t.Fatal(err)
	}
	answer := "# Rice genomics\n\nA **short** fixture for download regression."
	for _, format := range []string{"Word", "PDF"} {
		content, filename, err := agent.Download(format, answer)
		if err != nil {
			t.Fatalf("%s download failed: %v", format, err)
		}
		if len(content) == 0 {
			t.Fatalf("%s download returned empty body", format)
		}
		if format == "Word" && !bytes.HasPrefix(content, []byte("PK")) {
			t.Fatalf("Word payload is not a zip/docx, filename=%s", filename)
		}
		if format == "PDF" && !bytes.HasPrefix(content, []byte("%PDF")) {
			t.Fatalf("PDF payload missing %%PDF header, filename=%s", filename)
		}
		if bytes.Contains(content, []byte("# Rice genomics")) {
			t.Fatalf("%s still contains raw markdown heading", format)
		}
	}
}

func TestKnowledgeAgentDownloadsWordAndPDFFromMarkdownAnswer(t *testing.T) {
	agent, err := NewAgent("KnowledgeAgent")
	if err != nil {
		t.Fatal(err)
	}
	answer := "# Protein design\n\nA markdown report stored as the conversation answer."
	for _, format := range []string{"Word", "PDF"} {
		content, filename, err := agent.Download(format, answer)
		if err != nil {
			t.Fatalf("%s download failed on markdown answer: %v", format, err)
		}
		if len(content) == 0 {
			t.Fatalf("%s download returned empty body, filename=%s", format, filename)
		}
	}
}

func TestKnowledgeAgentDownloadsWordAndPDFFromLegacyJSON(t *testing.T) {
	agent, err := NewAgent("KnowledgeAgent")
	if err != nil {
		t.Fatal(err)
	}
	answer := `{"content":"Legacy JSON knowledge body","doc_list":[{"title":"Doc A"}]}`
	for _, format := range []string{"Word", "PDF"} {
		content, _, err := agent.Download(format, answer)
		if err != nil {
			t.Fatalf("%s download failed on JSON answer: %v", format, err)
		}
		if len(content) == 0 {
			t.Fatalf("%s download returned empty body", format)
		}
	}
}

func TestReviewAgentDownloadsWordAndPDFFromMarkdownAnswer(t *testing.T) {
	agent, err := NewAgent("ReviewAgent")
	if err != nil {
		t.Fatal(err)
	}
	for _, format := range []string{"Word", "PDF"} {
		content, filename, err := agent.Download(format, "# Review\n\nMarkdown body.")
		if err != nil {
			t.Fatalf("%s download failed on markdown answer: %v", format, err)
		}
		if len(content) == 0 {
			t.Fatalf("%s download returned empty body, filename=%s", format, filename)
		}
	}
}
