package utils

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func TestCleanUploadFilenameRejectsUnsafeNames(t *testing.T) {
	cases := []string{
		"",
		"   ",
		"../escape.png",
		"sub/escape.md",
		`sub\escape.md`,
		"/tmp/escape.png",
		`C:\fakepath\escape.png`,
		"..",
		".",
		"bad\x00name.png",
	}
	for _, name := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := CleanUploadFilename(name)
			if !errors.Is(err, ErrInvalidUploadFilename) {
				t.Fatalf("CleanUploadFilename(%q) err = %v, want ErrInvalidUploadFilename", name, err)
			}
			if got != "" {
				t.Fatalf("CleanUploadFilename(%q) got %q, want empty", name, got)
			}
		})
	}
}

func TestCleanUploadFilenameAcceptsPlainBasenames(t *testing.T) {
	cases := []string{
		"report_result.md",
		"figure 1.png",
		".hidden",
	}
	for _, name := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := CleanUploadFilename(name)
			if err != nil {
				t.Fatalf("CleanUploadFilename(%q) unexpected err: %v", name, err)
			}
			if got != name {
				t.Fatalf("CleanUploadFilename(%q) got %q, want original name", name, got)
			}
		})
	}
}

func TestSafeJoinUploadPathContainsOutput(t *testing.T) {
	base := t.TempDir()
	got, err := SafeJoinUploadPath(base, "figure.png")
	if err != nil {
		t.Fatalf("SafeJoinUploadPath unexpected err: %v", err)
	}
	if filepath.Dir(got) != base {
		t.Fatalf("joined path dir = %q, want %q", filepath.Dir(got), base)
	}
	if filepath.Base(got) != "figure.png" {
		t.Fatalf("joined path base = %q, want figure.png", filepath.Base(got))
	}
}

func TestSafeJoinUploadPathRejectsEscapes(t *testing.T) {
	base := t.TempDir()
	for _, name := range []string{"../figure.png", "sub/figure.png", `sub\figure.png`, ".."} {
		t.Run(name, func(t *testing.T) {
			got, err := SafeJoinUploadPath(base, name)
			if !errors.Is(err, ErrInvalidUploadFilename) {
				t.Fatalf("SafeJoinUploadPath(%q) err = %v, want ErrInvalidUploadFilename", name, err)
			}
			if got != "" {
				t.Fatalf("SafeJoinUploadPath(%q) got %q, want empty", name, got)
			}
		})
	}
}

func TestSafeJoinUploadPathRejectsRelativeTraversalAfterJoin(t *testing.T) {
	base := t.TempDir()
	got, err := SafeJoinUploadPath(base, strings.Repeat("a", 16)+".png")
	if err != nil {
		t.Fatalf("safe control case failed: %v", err)
	}
	rel, err := filepath.Rel(base, got)
	if err != nil {
		t.Fatalf("rel control case: %v", err)
	}
	if strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		t.Fatalf("control path escaped base: rel=%q", rel)
	}
}
