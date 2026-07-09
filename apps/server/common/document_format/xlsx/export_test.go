package xlsx

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func fixturePath(name string) string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "testdata", name+".sha256")
}

func assertGolden(t *testing.T, name string, input TableInput) {
	t.Helper()
	out, err := ExportTable(input)
	if err != nil {
		t.Fatalf("ExportTable(%s): %v", name, err)
	}
	got, err := normalizedSHA256(out)
	if err != nil {
		t.Fatalf("normalizedSHA256(%s): %v", name, err)
	}

	path := fixturePath(name)
	if os.Getenv("GOUPDATE_GOLDEN") == "1" {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("mkdir testdata: %v", err)
		}
		if err := os.WriteFile(path, []byte(got+"\n"), 0o644); err != nil {
			t.Fatalf("write golden %s: %v", path, err)
		}
		t.Logf("updated golden %s -> %s", name, got)
		return
	}

	wantBytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read golden %s (run GOUPDATE_GOLDEN=1 go test ./common/document_format/xlsx/...): %v", path, err)
	}
	want := strings.TrimSpace(string(wantBytes))
	if got != want {
		t.Fatalf("golden %s mismatch\ngot:  %s\nwant: %s", name, got, want)
	}
}

func TestExportTableGoldenSmall3Col(t *testing.T) {
	assertGolden(t, "small_3col", TableInput{
		Headers: []string{"Gene", "Species", "E-value"},
		Rows: [][]string{
			{"Os01g01010", "rice", "1e-10"},
			{"At1g01010", "arabidopsis", "2e-8"},
		},
	})
}

func TestExportTableGoldenWide30Col(t *testing.T) {
	headers := make([]string, 30)
	row := make([]string, 30)
	for i := 0; i < 30; i++ {
		headers[i] = fmt.Sprintf("Col%d", i+1)
		row[i] = fmt.Sprintf("v%d", i+1)
	}
	assertGolden(t, "wide_30col", TableInput{
		Headers: headers,
		Rows:    [][]string{row},
	})
}

func TestExportTableGoldenUnicodeCJK(t *testing.T) {
	assertGolden(t, "unicode_cjk", TableInput{
		Headers: []string{"基因", "物种", "备注"},
		Rows: [][]string{
			{"Os01g01010", "水稻", "同源"},
		},
	})
}

func TestExportTableGoldenHeadersOnly(t *testing.T) {
	assertGolden(t, "headers_only", TableInput{
		Headers: []string{"A", "B", "C"},
		Rows:    nil,
	})
}

func TestExportTableGoldenEmpty(t *testing.T) {
	assertGolden(t, "empty", TableInput{})
}
