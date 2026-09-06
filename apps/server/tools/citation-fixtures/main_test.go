package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestGeneratorIsStable(t *testing.T) {
	input := []byte(`{"review":{"references":[{"title":"One"},null]}}`)
	a, err := generate(input)
	if err != nil {
		t.Fatal(err)
	}
	b, err := generate(input)
	if err != nil || !bytes.Equal(a, b) {
		t.Fatal("nondeterministic artifact")
	}
	if !bytes.Contains(a, []byte(`"citation"`)) {
		t.Fatal("missing presentation")
	}
	var artifact map[string]struct {
		References []json.RawMessage `json:"references"`
	}
	if err := json.Unmarshal(a, &artifact); err != nil {
		t.Fatal(err)
	}
	if len(artifact["review"].References) != 2 {
		t.Fatal("reference positions changed")
	}
	if !bytes.Contains(artifact["review"].References[1], []byte("Reference details unavailable.")) {
		t.Fatal("null slot did not receive neutral presentation")
	}
}

func TestGeneratorOriginalDeepGenomeSource(t *testing.T) {
	sourcePath := "../../../web/src/views/agent-cases/citations/sources.json"
	assetPath := "../../../web/src/assets/agentOut/round1-phytomni_output-Os01g0177400_result.md"
	source, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	asset, err := os.ReadFile(assetPath)
	if err != nil {
		t.Fatal(err)
	}
	if fmt.Sprintf("%x", sha256.Sum256(asset)) != "8d7779e248d7c97c17dd5b34adbb43ca57a72a998cf334d848e1da5ff851287d" {
		t.Fatal("original scientific source changed")
	}
	var inputs map[string]fixtureCase
	if err = json.Unmarshal(source, &inputs); err != nil {
		t.Fatal(err)
	}
	if inputs["deep_genome"].Body != string(asset) {
		t.Fatal("generator is not using full original source")
	}
	generated, err := generate(source)
	if err != nil {
		t.Fatal(err)
	}
	var outputs map[string]fixtureCase
	if err = json.Unmarshal(generated, &outputs); err != nil {
		t.Fatal(err)
	}
	if fmt.Sprintf("%x", sha256.Sum256([]byte(outputs["deep_genome"].Body))) != "ec1cacb9d051c6f5d99938b660c57f7bcca4cb2fb1114df3cba494d3e33338f5" {
		t.Fatal("scientific body bytes changed")
	}
	after, _ := os.ReadFile(sourcePath)
	if !bytes.Equal(source, after) {
		t.Fatal("source rewritten")
	}
	after, _ = os.ReadFile(assetPath)
	if !bytes.Equal(asset, after) {
		t.Fatal("asset rewritten")
	}
}

func TestGeneratorUsesExactSourceOwnership(t *testing.T) {
	input := []byte(`{"deep_genome":{"body":"Body unchanged.\n\n## Reference:\n\n[1] A plant study\n","references":[{"title":"A plant study"}]}}`)
	output, err := generate(input)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]fixtureCase
	if err = json.Unmarshal(output, &got); err != nil {
		t.Fatal(err)
	}
	if got["deep_genome"].Body != "Body unchanged." {
		t.Fatalf("body not separated: %s", output)
	}
}

func TestCheckDetectsChangedReferenceWithoutRewriting(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "sources.json")
	outputPath := filepath.Join(dir, "generated.json")

	initial := []byte(`{"review":{"references":[{"title":"One"},null]}}`)
	if err := os.WriteFile(sourcePath, initial, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := run(sourcePath, outputPath, false); err != nil {
		t.Fatal(err)
	}
	wantUnchanged, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatal(err)
	}

	changed := []byte(`{"review":{"references":[{"title":"Changed"},null]}}`)
	if err := os.WriteFile(sourcePath, changed, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := run(sourcePath, outputPath, true); err == nil {
		t.Fatal("check accepted stale generated references")
	} else if err.Error() != "generated citation fixtures are out of date" {
		t.Fatalf("unexpected check error: %v", err)
	}
	got, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, wantUnchanged) {
		t.Fatal("check rewrote generated references")
	}
}
