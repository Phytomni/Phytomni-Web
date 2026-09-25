package utils

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestFileReadersAppendAndExistence(t *testing.T) {
	filename := filepath.Join(t.TempDir(), "notes.txt")
	if err := os.WriteFile(filename, []byte("first\nsecond\n"), 0o644); err != nil {
		t.Fatalf("seed file: %v", err)
	}

	content, err := ReadFileContent(filename)
	if err != nil {
		t.Fatalf("ReadFileContent: %v", err)
	}
	if string(content) != "first\nsecond\n" {
		t.Fatalf("ReadFileContent = %q", content)
	}
	lines, err := ReadFileContentLineByLine(filename)
	if err != nil {
		t.Fatalf("ReadFileContentLineByLine: %v", err)
	}
	if want := []string{"first", "second"}; !reflect.DeepEqual(lines, want) {
		t.Fatalf("ReadFileContentLineByLine = %#v, want %#v", lines, want)
	}

	if err := AppendToFile(filename, "third"); err != nil {
		t.Fatalf("AppendToFile: %v", err)
	}
	updated, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("read appended file: %v", err)
	}
	if string(updated) != "first\nsecond\nthird\n" {
		t.Fatalf("appended content = %q", updated)
	}

	exists, err := FileExists(filename)
	if err != nil || !exists {
		t.Fatalf("FileExists(existing) = %v, %v", exists, err)
	}
	exists, err = FileExists(filepath.Join(filepath.Dir(filename), "missing.txt"))
	if err != nil || exists {
		t.Fatalf("FileExists(missing) = %v, %v", exists, err)
	}
	if !FilesExists([]string{"missing.txt", filename}) {
		t.Fatal("FilesExists must return true when any candidate exists")
	}
}
