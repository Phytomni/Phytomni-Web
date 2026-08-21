package document_format

import (
	"archive/zip"
	"bytes"
	"io"
	"os"
	"regexp"
	"strings"
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
		if format == "Word" {
			assertWordHeadingStyleID(t, content)
		}
		if format == "PDF" && !bytes.Contains(content, []byte("/Outlines")) {
			t.Fatal("ChatAgent PDF missing heading outline")
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
		if format == "Word" {
			assertWordHeadingStyleID(t, content)
		}
		if format == "PDF" && !bytes.Contains(content, []byte("/Outlines")) {
			t.Fatal("KnowledgeAgent PDF missing heading outline")
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
		if format == "Word" {
			assertWordHeadingStyleID(t, content)
		}
		if format == "PDF" && !bytes.Contains(content, []byte("/Outlines")) {
			t.Fatal("ReviewAgent PDF missing heading outline")
		}
	}
}

func TestDeepGenomeAgentDownloadsPDFFromCitedAnswer(t *testing.T) {
	agent, err := NewAgent("DeepGenomeAgent")
	if err != nil {
		t.Fatal(err)
	}
	answer := `{"content":"# Deep genome report\n\nA cited fixture.","doc_list":[{"title":"Source A"}]}`
	content, filename, err := agent.Download("PDF", answer)
	if err != nil {
		t.Fatalf("DeepGenome PDF download failed: %v", err)
	}
	if !bytes.HasPrefix(content, []byte("%PDF")) {
		t.Fatalf("DeepGenome PDF missing %%PDF header, filename=%s", filename)
	}
	if bytes.Contains(content, []byte("# Deep genome report")) {
		t.Fatal("DeepGenome PDF still contains raw markdown heading")
	}
	if !strings.HasPrefix(filename, "deepgenome_") || !strings.HasSuffix(filename, ".pdf") {
		t.Fatalf("DeepGenome PDF filename = %q, want deepgenome_*.pdf", filename)
	}
	if !bytes.Contains(content, []byte("/Outlines")) {
		t.Fatal("DeepGenome PDF missing heading outline")
	}
}

func assertWordHeadingStyleID(t *testing.T, body []byte) {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatalf("zip: %v", err)
	}
	var xml string
	for _, f := range zr.File {
		if f.Name != "word/document.xml" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open document.xml: %v", err)
		}
		raw, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatalf("read document.xml: %v", err)
		}
		xml = string(raw)
		break
	}
	if xml == "" {
		t.Fatal("document.xml missing")
	}
	vals := regexp.MustCompile(`w:pStyle[^>]*w:val="([^"]+)"`).FindAllStringSubmatch(xml, -1)
	found := false
	for _, m := range vals {
		if m[1] == "Heading1" {
			found = true
		}
		if strings.Contains(m[1], " ") {
			t.Fatalf("Word heading styleId %q is not a built-in OOXML id", m[1])
		}
	}
	if !found {
		t.Fatalf("missing Heading1 styleId in Word download, xml=%s", xml)
	}
}
