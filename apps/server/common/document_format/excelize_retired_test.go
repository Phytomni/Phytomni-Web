package document_format_test

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestExcelizeV1RetiredFromGoMod(t *testing.T) {
	_, file, _, _ := runtime.Caller(0)
	modPath := filepath.Join(filepath.Dir(file), "..", "..", "go.mod")
	body, err := os.ReadFile(modPath)
	if err != nil {
		t.Fatalf("read go.mod: %v", err)
	}
	if strings.Contains(string(body), "360EntSecGroup-Skylar/excelize") {
		t.Fatal("go.mod still references abandoned excelize v1 module path")
	}
	if !strings.Contains(string(body), "github.com/xuri/excelize/v2") {
		t.Fatal("go.mod missing github.com/xuri/excelize/v2")
	}
}
