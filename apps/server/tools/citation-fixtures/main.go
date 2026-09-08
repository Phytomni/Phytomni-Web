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

type generatorOptions struct {
	SourcePath, OutputPath                 string
	MaterialSourcePath, MaterialOutputPath string
	Check                                  bool
}

type generatedArtifact struct {
	path    string
	content []byte
	label   string
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

func run(opts generatorOptions) error {
	if (opts.MaterialSourcePath == "") != (opts.MaterialOutputPath == "") {
		return errors.New("-material-source and -material-output must be supplied together")
	}
	source, err := os.ReadFile(opts.SourcePath)
	if err != nil {
		return err
	}
	generated, err := generate(source)
	if err != nil {
		return err
	}
	outputs := []generatedArtifact{{opts.OutputPath, generated, "citation fixtures"}}
	if opts.MaterialSourcePath != "" {
		materialSource, readErr := os.ReadFile(opts.MaterialSourcePath)
		if readErr != nil {
			return readErr
		}
		materials, generateErr := generateMaterials(source, materialSource)
		if generateErr != nil {
			return generateErr
		}
		outputs = append(outputs, generatedArtifact{opts.MaterialOutputPath, materials, "deep genome material fixtures"})
	}
	for _, output := range outputs {
		if !opts.Check {
			if err := os.WriteFile(output.path, output.content, 0o644); err != nil {
				return err
			}
			continue
		}
		current, readErr := os.ReadFile(output.path)
		if readErr != nil {
			return readErr
		}
		if !bytes.Equal(current, output.content) {
			return fmt.Errorf("generated %s are out of date", output.label)
		}
	}
	return nil
}

func main() {
	sourcePath := flag.String("source", "", "source JSON path")
	outputPath := flag.String("output", "", "generated JSON path")
	materialSourcePath := flag.String("material-source", "", "DeepGenome source material JSON path (requires -material-output)")
	materialOutputPath := flag.String("material-output", "", "sanitized DeepGenome material JSON path (requires -material-source)")
	check := flag.Bool("check", false, "compare generated output without writing")
	flag.Parse()
	if *sourcePath == "" || *outputPath == "" {
		fmt.Fprintln(os.Stderr, "-source and -output are required")
		os.Exit(2)
	}
	if err := run(generatorOptions{
		SourcePath: *sourcePath, OutputPath: *outputPath,
		MaterialSourcePath: *materialSourcePath, MaterialOutputPath: *materialOutputPath,
		Check: *check,
	}); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
