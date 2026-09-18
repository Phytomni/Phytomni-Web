// Command report-fixture emits reviewed synthetic evidence through the real report dispatcher.
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"phytomni-server/common/citation"
	"phytomni-server/common/document_format"
)

func main() { os.Exit(run(os.Args[1:], os.Stderr)) }

func run(args []string, stderr io.Writer) int {
	flags := flag.NewFlagSet("report-fixture", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	source := flags.String("source", "", "reviewed synthetic contract JSON")
	output := flags.String("output", "", "evidence output directory")
	fontDir := flags.String("font-dir", "", "genuine Times New Roman font directory")
	if err := flags.Parse(args); err != nil || flags.NArg() != 0 || *source == "" || *output == "" {
		fmt.Fprintln(stderr, "report fixture generation failed")
		return 1
	}
	if err := emit(*source, *output, *fontDir); err != nil {
		fmt.Fprintln(stderr, "report fixture generation failed")
		return 1
	}
	return 0
}

func emit(source, output, fontDir string) error {
	names := []string{"report.md", "report.docx", "report.pdf", "references.json", "expected.json"}
	for _, name := range names {
		_, err := os.Lstat(filepath.Join(output, name))
		if err == nil {
			return os.ErrExist
		}
		if !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	data, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	var fixture struct {
		Content    string          `json:"content"`
		References json.RawMessage `json:"references"`
		Expected   json.RawMessage `json:"expected"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		return err
	}
	if fixture.Content == "" || len(fixture.References) == 0 || len(fixture.Expected) == 0 {
		return errors.New("invalid fixture")
	}
	refs, err := citation.NormalizeRows(fixture.References)
	if err != nil {
		return err
	}
	answer, err := json.Marshal(struct {
		Content string          `json:"content"`
		DocList json.RawMessage `json:"doc_list"`
	}{fixture.Content, fixture.References})
	if err != nil {
		return err
	}
	agent, err := document_format.NewAgentWithOptions("ReviewAgent", document_format.AgentOptions{FontDir: fontDir})
	if err != nil {
		return err
	}
	artifacts := make([][]byte, 5)
	for i, format := range []string{"Markdown", "Word", "PDF"} {
		artifacts[i], _, err = agent.Download(format, string(answer))
		if err != nil {
			return err
		}
	}
	artifacts[3], artifacts[4] = refs, fixture.Expected
	if err := os.MkdirAll(output, 0700); err != nil {
		return err
	}
	// Exclusive creation also refuses a named collision introduced after preflight.
	for i, name := range names {
		file, err := os.OpenFile(filepath.Join(output, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return err
		}
		_, writeErr := file.Write(artifacts[i])
		closeErr := file.Close()
		if writeErr != nil {
			return writeErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}
