package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"phytomni-server/common/citation"
)

const sourcePath = "../../common/document_format/testdata/cited-contract.json"

func TestReportFixtureArtifactsAndPermissions(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "evidence")
	font := os.Getenv("PHYTOMNI_REPORT_FONT_DIR")
	if font == "" {
		t.Fatal("genuine fonts required")
	}
	var stderr bytes.Buffer
	if code := run([]string{"-source", sourcePath, "-output", dir, "-font-dir", font}, &stderr); code != 0 {
		t.Fatalf("exit=%d stderr=%s", code, &stderr)
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 5 {
		t.Fatalf("outputs=%v err=%v", entries, err)
	}
	info, err := os.Stat(dir)
	if err != nil || info.Mode().Perm() != 0700 {
		t.Fatalf("directory permissions: %v %v", info, err)
	}
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil || info.Mode().Perm() != 0600 {
			t.Fatalf("file permissions: %v %v", info, err)
		}
	}
	read := func(name string) []byte {
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	source, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		References json.RawMessage
		Expected   json.RawMessage
	}
	if err := json.Unmarshal(source, &fixture); err != nil {
		t.Fatal(err)
	}
	refs, err := citation.NormalizeRows(fixture.References)
	if err != nil || !bytes.Equal(read("references.json"), refs) {
		t.Fatal("reference projection drift")
	}
	if !bytes.Equal(read("expected.json"), fixture.Expected) {
		t.Fatal("expected literals were not copied")
	}
	if !bytes.Contains(read("report.md"), []byte("*Plant Journal* **12**")) {
		t.Fatal("Markdown bibliography missing")
	}
	docx := read("report.docx")
	z, err := zip.NewReader(bytes.NewReader(docx), int64(len(docx)))
	if err != nil {
		t.Fatal(err)
	}
	var document string
	for _, file := range z.File {
		if file.Name == "word/document.xml" {
			r, err := file.Open()
			if err != nil {
				t.Fatal(err)
			}
			b, err := io.ReadAll(r)
			r.Close()
			if err != nil {
				t.Fatal(err)
			}
			document = string(b)
		}
	}
	if !strings.Contains(document, "Plant Journal") || !strings.Contains(document, "Reference details unavailable.") {
		t.Fatal("actual DOCX bibliography missing")
	}
	pdf := read("report.pdf")
	if !bytes.HasPrefix(pdf, []byte("%PDF")) || !bytes.Contains(pdf, []byte("/FontFile2")) || !bytes.Contains(pdf, []byte("/Annots")) {
		t.Fatal("actual PDF fonts/links missing")
	}
	stderr.Reset()
	if run([]string{"-source", sourcePath, "-output", dir, "-font-dir", font}, &stderr) == 0 || stderr.String() != "report fixture generation failed\n" {
		t.Fatal("repeat must fail generically")
	}
}

func TestReportFixtureRefusesEveryCollisionIncludingDanglingSymlink(t *testing.T) {
	for _, name := range []string{"report.md", "report.docx", "report.pdf", "references.json", "expected.json"} {
		for _, symlink := range []bool{false, true} {
			t.Run(name+string(rune('0'+map[bool]int{false: 0, true: 1}[symlink])), func(t *testing.T) {
				dir := t.TempDir()
				target := filepath.Join(dir, name)
				var err error
				if symlink {
					err = os.Symlink(filepath.Join(dir, "absent"), target)
				} else {
					err = os.WriteFile(target, []byte("keep"), 0600)
				}
				if err != nil {
					t.Fatal(err)
				}
				var stderr bytes.Buffer
				if run([]string{"-source", sourcePath, "-output", dir}, &stderr) == 0 || stderr.String() != "report fixture generation failed\n" {
					t.Fatal("collision accepted or leaked")
				}
				entries, err := os.ReadDir(dir)
				if err != nil || len(entries) != 1 {
					t.Fatalf("partial outputs: %v %v", entries, err)
				}
				if !symlink {
					data, err := os.ReadFile(target)
					if err != nil || string(data) != "keep" {
						t.Fatal("existing artifact overwritten")
					}
				}
			})
		}
	}
}

func TestReportFixtureFailureWritesNothingAndAllowsUnrelatedNames(t *testing.T) {
	for _, args := range [][]string{nil, {"-unknown"}, {"-source", "private-source", "-output", "unused"}} {
		var stderr bytes.Buffer
		if run(args, &stderr) == 0 || stderr.String() != "report fixture generation failed\n" {
			t.Fatal("failure must be generic")
		}
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "unrelated"), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	args := []string{"-source", sourcePath, "-output", dir, "-font-dir", t.TempDir()}
	if run(args, &stderr) != 0 {
		t.Fatalf("empty font dir blocked PDF fixture: %s", stderr.String())
	}
	keep, err := os.ReadFile(filepath.Join(dir, "unrelated"))
	if err != nil || string(keep) != "keep" {
		t.Fatal("unrelated output name refused")
	}
	pdf, err := os.ReadFile(filepath.Join(dir, "report.pdf"))
	if err != nil || !bytes.HasPrefix(pdf, []byte("%PDF")) {
		t.Fatal("empty font dir did not emit a PDF")
	}
}
