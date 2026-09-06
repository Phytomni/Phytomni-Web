package document_format

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"os"
	"regexp"
	"strings"
	"testing"

	"phytomni-server/common/citation"
	"phytomni-server/common/document_format/mdoc"
)

const citedDownloadAnswer = `{"content":"# Plant report\n\nEvidence [1].","doc_list":[{"au":"Doe, JA","ti":"A plant study","so":"Plant Journal","vl":"12","bp":"45","ep":"49","py":"2024"}]}`

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
	agent, err := NewAgentWithOptions("KnowledgeAgent", AgentOptions{FontDir: requiredAcademicFontDir(t)})
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
			assertAcademicWordHeadingStyleID(t, content)
		}
		if format == "PDF" && !bytes.Contains(content, []byte("/Outlines")) {
			t.Fatal("KnowledgeAgent PDF missing heading outline")
		}
	}
}

func TestKnowledgeAgentDownloadsWordAndPDFFromLegacyJSON(t *testing.T) {
	agent, err := NewAgentWithOptions("KnowledgeAgent", AgentOptions{FontDir: requiredAcademicFontDir(t)})
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
	agent, err := NewAgentWithOptions("ReviewAgent", AgentOptions{FontDir: requiredAcademicFontDir(t)})
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
			assertAcademicWordHeadingStyleID(t, content)
		}
		if format == "PDF" && !bytes.Contains(content, []byte("/Outlines")) {
			t.Fatal("ReviewAgent PDF missing heading outline")
		}
	}
}

func TestDeepGenomeAgentDownloadsPDFFromCitedAnswer(t *testing.T) {
	agent, err := NewAgentWithOptions("DeepGenomeAgent", AgentOptions{FontDir: requiredAcademicFontDir(t)})
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

func TestCitedDownloadsUseCanonicalAcademicWriters(t *testing.T) {
	fontDir := requiredAcademicFontDir(t)
	for _, fixture := range []struct {
		name       string
		filePrefix string
	}{
		{name: "KnowledgeAgent", filePrefix: "knowledge_"},
		{name: "BriefGeneAgent", filePrefix: "review_"},
		{name: "ReviewAgent", filePrefix: "review_"},
		{name: "DeepGenomeAgent", filePrefix: "deepgenome_"},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			withoutFonts, err := NewAgentWithOptions(fixture.name, AgentOptions{})
			if err != nil {
				t.Fatal(err)
			}
			markdown, filename, err := withoutFonts.Download("Markdown", citedDownloadAnswer)
			if err != nil {
				t.Fatalf("Markdown: %v", err)
			}
			assertDownloadFilename(t, filename, fixture.filePrefix, ".md")
			if !bytes.Contains(markdown, []byte(`*Plant Journal* **12**, 45–49 \(2024\).`)) {
				t.Fatalf("Markdown did not use canonical bibliography: %q", markdown)
			}

			word, filename, err := withoutFonts.Download("Word", citedDownloadAnswer)
			if err != nil {
				t.Fatalf("Word without PDF fonts: %v", err)
			}
			assertDownloadFilename(t, filename, fixture.filePrefix, ".docx")
			if !bytes.HasPrefix(word, []byte("PK")) {
				t.Fatal("Word payload is not a docx")
			}
			xmlBody := wordDocumentXML(t, word)
			if !strings.Contains(wordText(t, xmlBody), "Doe, J. A. A plant study. Plant Journal 12, 45–49 (2024).") {
				t.Fatalf("Word did not contain canonical bibliography: %s", wordText(t, xmlBody))
			}
			if !strings.Contains(wordPackagePart(t, word, "word/styles.xml"), "Times New Roman") {
				t.Fatal("Word did not use the academic font family")
			}
			assertWordReferenceEmphasis(t, xmlBody)

			if data, _, err := withoutFonts.Download("PDF", citedDownloadAnswer); data != nil || !errors.Is(err, mdoc.ErrAcademicFontsUnavailable) {
				t.Fatalf("PDF without fonts: data=%d err=%v", len(data), err)
			}

			withFonts, err := NewAgentWithOptions(fixture.name, AgentOptions{FontDir: fontDir})
			if err != nil {
				t.Fatal(err)
			}
			pdf, filename, err := withFonts.Download("PDF", citedDownloadAnswer)
			if err != nil {
				t.Fatalf("PDF with genuine fonts: %v", err)
			}
			assertDownloadFilename(t, filename, fixture.filePrefix, ".pdf")
			if !bytes.HasPrefix(pdf, []byte("%PDF")) || !bytes.Contains(pdf, []byte("/Outlines")) {
				t.Fatal("PDF payload is not a genuine outlined PDF")
			}
		})
	}
}

func TestCitedDownloadRejectsMalformedReferences(t *testing.T) {
	agent, err := NewAgent("ReviewAgent")
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = agent.Download("Markdown", `{"content":"report","doc_list":{}}`)
	if !errors.Is(err, citation.ErrInvalidReferences) {
		t.Fatalf("malformed doc_list error = %v", err)
	}
}

func TestCitedPlainMarkdownDoesNotRewriteLiteralEscapes(t *testing.T) {
	agent, err := NewAgent("KnowledgeAgent")
	if err != nil {
		t.Fatal(err)
	}
	data, _, err := agent.Download("Markdown", `literal \\n and \\"quote\\"`)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(data, []byte(`literal \\n and \\"quote\\"`)) {
		t.Fatalf("plain Markdown literal escapes were rewritten: %q", data)
	}
}

func requiredAcademicFontDir(t *testing.T) string {
	t.Helper()
	dir := os.Getenv("PHYTOMNI_REPORT_FONT_DIR")
	if dir == "" {
		t.Fatal("PHYTOMNI_REPORT_FONT_DIR is required for genuine Times New Roman tests")
	}
	return dir
}

func assertDownloadFilename(t *testing.T, filename, prefix, suffix string) {
	t.Helper()
	if !strings.HasPrefix(filename, prefix) || !strings.HasSuffix(filename, suffix) {
		t.Fatalf("filename = %q, want %s*%s", filename, prefix, suffix)
	}
}

func wordDocumentXML(t *testing.T, body []byte) string {
	t.Helper()
	return wordPackagePart(t, body, "word/document.xml")
}

func wordPackagePart(t *testing.T, body []byte, name string) string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatalf("zip: %v", err)
	}
	for _, f := range zr.File {
		if f.Name != name {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open %s: %v", name, err)
		}
		raw, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		return string(raw)
	}
	t.Fatalf("%s missing", name)
	return ""
}

func wordText(t *testing.T, documentXML string) string {
	t.Helper()
	decoder := xml.NewDecoder(strings.NewReader(documentXML))
	var text strings.Builder
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			return text.String()
		}
		if err != nil {
			t.Fatalf("decode document.xml: %v", err)
		}
		start, ok := token.(xml.StartElement)
		if !ok || start.Name.Local != "t" {
			continue
		}
		var value string
		if err := decoder.DecodeElement(&value, &start); err != nil {
			t.Fatalf("decode Word text: %v", err)
		}
		text.WriteString(value)
	}
}

func assertWordReferenceEmphasis(t *testing.T, documentXML string) {
	t.Helper()
	decoder := xml.NewDecoder(strings.NewReader(documentXML))
	var journalItalic, volumeBold bool
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatalf("decode document.xml: %v", err)
		}
		start, ok := token.(xml.StartElement)
		if !ok || start.Name.Local != "r" {
			continue
		}
		var run struct {
			Properties struct {
				Bold   *struct{} `xml:"b"`
				Italic *struct{} `xml:"i"`
			} `xml:"rPr"`
			Text []string `xml:"t"`
		}
		if err := decoder.DecodeElement(&run, &start); err != nil {
			t.Fatalf("decode Word run: %v", err)
		}
		value := strings.Join(run.Text, "")
		journalItalic = journalItalic || value == "Plant Journal" && run.Properties.Italic != nil
		volumeBold = volumeBold || value == "12" && run.Properties.Bold != nil
	}
	if !journalItalic || !volumeBold {
		t.Fatalf("Word reference emphasis: journalItalic=%v volumeBold=%v", journalItalic, volumeBold)
	}
}

func assertWordHeadingStyleID(t *testing.T, body []byte) {
	assertWordHeadingStyle(t, body, "Heading1")
}

func assertAcademicWordHeadingStyleID(t *testing.T, body []byte) {
	assertWordHeadingStyle(t, body, "Academic1")
}

func assertWordHeadingStyle(t *testing.T, body []byte, expected string) {
	t.Helper()
	xml := wordDocumentXML(t, body)
	vals := regexp.MustCompile(`w:pStyle[^>]*w:val="([^"]+)"`).FindAllStringSubmatch(xml, -1)
	found := false
	for _, m := range vals {
		if m[1] == expected {
			found = true
		}
		if strings.Contains(m[1], " ") {
			t.Fatalf("Word heading styleId %q is not a built-in OOXML id", m[1])
		}
	}
	if !found {
		t.Fatalf("missing %s styleId in Word download, xml=%s", expected, xml)
	}
}
