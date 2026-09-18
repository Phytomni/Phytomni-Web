package data_agent

import (
	"strings"
	"testing"
)

func TestExportToMarkdownUsesTableTitle(t *testing.T) {
	got, err := ExportToMarkdown(TableData{
		Title:   "  Interacting proteins  ",
		Headers: []string{"gene"},
		Rows:    [][]string{{"g1"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(got), "# Interacting proteins\n") {
		t.Errorf("titled markdown = %q", got)
	}

	fallback, err := ExportToMarkdown(TableData{
		Headers: []string{"gene"},
		Rows:    [][]string{{"g1"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(fallback), "# Data results\n") {
		t.Errorf("fallback markdown = %q", fallback)
	}
}
