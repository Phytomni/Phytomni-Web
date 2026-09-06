package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"

	"phytomni-server/common/citation"
	"phytomni-server/common/document_format/mdoc"
)

type fixtureCase struct {
	Body       string          `json:"body,omitempty"`
	References json.RawMessage `json:"references"`
}

func generate(source []byte) ([]byte, error) {
	var sources map[string]fixtureCase
	if err := json.Unmarshal(source, &sources); err != nil || sources == nil {
		return nil, errors.New("invalid citation fixture source")
	}

	generated := make(map[string]fixtureCase, len(sources))
	for slug, fixture := range sources {
		references, err := citation.NormalizeRows(fixture.References)
		if err != nil {
			return nil, fmt.Errorf("normalize %s references: %w", slug, err)
		}
		body := fixture.Body
		if slug == "deep_genome" {
			rows, decodeErr := citation.DecodeRows(fixture.References)
			if decodeErr != nil {
				return nil, decodeErr
			}
			var matched bool
			body, matched, err = mdoc.SplitOwnedReferences(body, rows)
			if err != nil {
				return nil, err
			}
			if !matched {
				return nil, errors.New("deep genome source bibliography does not exactly match its references")
			}
			// Preserve the existing Case adapter's trailing-whitespace boundary.
			body = strings.TrimRight(body, " \t\r\n")
		}
		generated[slug] = fixtureCase{
			Body:       body,
			References: references,
		}
	}

	artifact, err := json.MarshalIndent(generated, "", "  ")
	if err != nil {
		return nil, errors.New("encode citation fixture artifact")
	}
	return append(artifact, '\n'), nil
}

func run(sourcePath, outputPath string, check bool) error {
	source, err := os.ReadFile(sourcePath)
	if err != nil {
		return err
	}
	generated, err := generate(source)
	if err != nil {
		return err
	}
	if check {
		current, readErr := os.ReadFile(outputPath)
		if readErr != nil {
			return readErr
		}
		if !bytes.Equal(current, generated) {
			return errors.New("generated citation fixtures are out of date")
		}
		return nil
	}
	return os.WriteFile(outputPath, generated, 0o644)
}

func main() {
	sourcePath := flag.String("source", "", "source JSON path")
	outputPath := flag.String("output", "", "generated JSON path")
	check := flag.Bool("check", false, "compare generated output without writing")
	flag.Parse()
	if *sourcePath == "" || *outputPath == "" {
		fmt.Fprintln(os.Stderr, "-source and -output are required")
		os.Exit(2)
	}
	if err := run(*sourcePath, *outputPath, *check); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
