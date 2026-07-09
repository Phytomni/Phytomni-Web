package utils_test

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSnowflakeRetiredFromGoMod(t *testing.T) {
	_, file, _, _ := runtime.Caller(0)
	modPath := filepath.Join(filepath.Dir(file), "..", "go.mod")
	body, err := os.ReadFile(modPath)
	if err != nil {
		t.Fatalf("read go.mod: %v", err)
	}
	if strings.Contains(string(body), "github.com/bwmarrin/snowflake") {
		t.Fatal("go.mod still references github.com/bwmarrin/snowflake")
	}
}
