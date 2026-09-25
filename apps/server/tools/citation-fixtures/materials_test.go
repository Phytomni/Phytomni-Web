package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

func materialInputs(t *testing.T, titles, excerpts []string) ([]byte, []byte) {
	t.Helper()
	references := make([]map[string]string, len(titles))
	documents := make([]map[string]any, len(titles))
	for index, title := range titles {
		references[index] = map[string]string{"title": title}
		documents[index] = map[string]any{
			"title": title + ".pdf", "content": excerpts[index],
			"file_id": "private-source", "file_path": "/obs/private/example.pdf",
			"repo_id": "private-repository", "score": 0.8,
			"_inference.semantic_vector": []float64{0.1, 0.2},
		}
	}
	citations, err := json.Marshal(map[string]any{"deep_genome": map[string]any{"references": references}})
	if err != nil {
		t.Fatal(err)
	}
	source, err := json.Marshal(map[string]any{"doc_list": documents})
	if err != nil {
		t.Fatal(err)
	}
	return citations, source
}

func TestMaterialGeneratorPreservesSlotsAndExactExcerpts(t *testing.T) {
	excerpts := []string{"  *OsD18* H<sub>2</sub>O\n[1]  ", "second fragment", "second fragment"}
	citations, source := materialInputs(t, []string{"Same source", "123456789", "Same source"}, excerpts)
	first, err := generateMaterials(citations, source)
	if err != nil {
		t.Fatal(err)
	}
	second, err := generateMaterials(citations, source)
	if err != nil || !bytes.Equal(first, second) {
		t.Fatal("material artifact is not deterministic")
	}
	var rows []map[string]json.RawMessage
	if err := json.Unmarshal(first, &rows); err != nil {
		t.Fatal(err)
	}
	if len(rows) != len(excerpts) {
		t.Fatal("material positions changed")
	}
	for index, row := range rows {
		if len(row) != 3 || string(row["referenceIndex"]) != strconv.Itoa(index+1) || string(row["resourceIds"]) != "[]" {
			t.Fatalf("slot %d does not contain exactly the public material fields", index+1)
		}
		var excerpt string
		if err := json.Unmarshal(row["excerpt"], &excerpt); err != nil || excerpt != excerpts[index] {
			t.Fatalf("slot %d scientific content changed", index+1)
		}
	}
	for _, forbidden := range []string{"file_id", "file_path", "repo_id", "semantic_vector", "score", "private-source", "/obs/"} {
		if bytes.Contains(first, []byte(forbidden)) {
			t.Fatalf("material projection leaked field %q", forbidden)
		}
	}
}

func TestMaterialGeneratorRejectsMismatchedOrMalformedInputs(t *testing.T) {
	citations, _ := materialInputs(t, []string{"First", "Second"}, []string{"one", "two"})
	cases := map[string]string{
		"missing collection": `{}`,
		"null collection":    `{"doc_list":null}`,
		"wrong collection":   `{"doc_list":{}}`,
		"missing slot":       `{"doc_list":[{"title":"First.pdf","content":"one"}]}`,
		"reordered slots":    `{"doc_list":[{"title":"Second.pdf","content":"two"},{"title":"First.pdf","content":"one"}]}`,
		"missing content":    `{"doc_list":[{"title":"First.pdf"},{"title":"Second.pdf","content":"two"}]}`,
		"null content":       `{"doc_list":[{"title":"First.pdf","content":null},{"title":"Second.pdf","content":"two"}]}`,
		"nontext content":    `{"doc_list":[{"title":"First.pdf","content":9},{"title":"Second.pdf","content":"two"}]}`,
		"missing title":      `{"doc_list":[{"content":"one"},{"title":"Second.pdf","content":"two"}]}`,
		"malformed slot":     `{"doc_list":[null,{"title":"Second.pdf","content":"two"}]}`,
	}
	for name, source := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := generateMaterials(citations, []byte(source)); err == nil {
				t.Fatal("invalid material source accepted")
			}
		})
	}
	_, valid := materialInputs(t, []string{"First"}, []string{"one"})
	for _, source := range []string{`{}`, `null`, `{"review":{"references":[]}}`, `{"deep_genome":{"references":null}}`} {
		if _, err := generateMaterials([]byte(source), valid); err == nil {
			t.Fatal("material generation accepted a missing DeepGenome bibliography")
		}
	}
}

func TestMaterialGeneratorAcceptsEmptyExcerptAndUppercasePDFSuffix(t *testing.T) {
	citations, source := materialInputs(t, []string{"Source"}, []string{""})
	source = bytes.ReplaceAll(source, []byte("Source.pdf"), []byte("Source.PDF"))
	generated, err := generateMaterials(citations, source)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(generated, []byte(`"excerpt": ""`)) {
		t.Fatal("empty source slot was dropped")
	}
}

func TestMaterialGeneratorEnforcesByteBudgets(t *testing.T) {
	for _, test := range []struct {
		name    string
		count   int
		excerpt string
		wantErr bool
	}{
		{"slot boundary", 1, strings.Repeat("x", 64<<10), false},
		{"oversize slot", 1, strings.Repeat("x", (64<<10)+1), true},
		{"unicode uses bytes", 1, strings.Repeat("植", (64<<10)/3+1), true},
		{"total boundary", 64, strings.Repeat("x", 64<<10), false},
		{"oversize total", 65, strings.Repeat("x", 64<<10), true},
	} {
		t.Run(test.name, func(t *testing.T) {
			titles, excerpts := make([]string, test.count), make([]string, test.count)
			for index := range titles {
				titles[index], excerpts[index] = "Source", test.excerpt
			}
			citations, source := materialInputs(t, titles, excerpts)
			_, err := generateMaterials(citations, source)
			if (err != nil) != test.wantErr {
				t.Fatalf("error = %v, want failure = %v", err, test.wantErr)
			}
		})
	}
}

func TestMaterialGeneratorUsesAllOriginalDeepGenomeSourceSlots(t *testing.T) {
	citations, err := os.ReadFile("../../../web/src/views/agent-cases/citations/sources.json")
	if err != nil {
		t.Fatal(err)
	}
	source, err := os.ReadFile("../../../web/src/assets/agentOut/round1-references.json")
	if err != nil {
		t.Fatal(err)
	}
	generated, err := generateMaterials(citations, source)
	if err != nil {
		t.Fatal(err)
	}
	var originals struct {
		DocList []struct {
			Content string `json:"content"`
		} `json:"doc_list"`
	}
	var materials []struct {
		ReferenceIndex int      `json:"referenceIndex"`
		Excerpt        string   `json:"excerpt"`
		ResourceIDs    []string `json:"resourceIds"`
	}
	if err := json.Unmarshal(source, &originals); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(generated, &materials); err != nil {
		t.Fatal(err)
	}
	if len(materials) != 256 || len(materials) != len(originals.DocList) {
		t.Fatal("original material slot count changed")
	}
	internal := regexp.MustCompile(`(?i)(?:\b(?:obs|s3|file)://|/(?:obs|home|mnt|tmp|var|root|workspace)/|https?://(?:localhost|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)|[?&](?:token|signature|x-amz-[a-z-]+|x-obs-[a-z-]+|access_key|secret_key)=)`)
	for index, material := range materials {
		if material.ReferenceIndex != index+1 || material.Excerpt != originals.DocList[index].Content || material.ResourceIDs == nil || len(material.ResourceIDs) != 0 {
			t.Fatalf("original source position %d changed", index+1)
		}
		if internal.MatchString(material.Excerpt) {
			t.Fatalf("source position %d needs private-location review before publication", index+1)
		}
	}
}

func TestMaterialCheckDetectsDriftWithoutRewritingEitherArtifact(t *testing.T) {
	dir := t.TempDir()
	citations := []byte(`{"deep_genome":{"body":"Body.\n\n## Reference:\n\n[1] Source\n","references":[{"title":"Source"}]}}`)
	_, source := materialInputs(t, []string{"Source"}, []string{"original excerpt"})
	opts := generatorOptions{
		SourcePath: filepath.Join(dir, "sources.json"), OutputPath: filepath.Join(dir, "generated.json"),
		MaterialSourcePath: filepath.Join(dir, "material-source.json"), MaterialOutputPath: filepath.Join(dir, "materials.json"),
	}
	for path, content := range map[string][]byte{opts.SourcePath: citations, opts.MaterialSourcePath: source} {
		if err := os.WriteFile(path, content, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := run(opts); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(opts.OutputPath)
	if err != nil {
		t.Fatal(err)
	}
	materialBefore, err := os.ReadFile(opts.MaterialOutputPath)
	if err != nil {
		t.Fatal(err)
	}
	opts.Check = true
	if err := run(opts); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(opts.MaterialSourcePath, bytes.ReplaceAll(source, []byte("original excerpt"), []byte("changed excerpt")), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := run(opts); err == nil {
		t.Fatal("check accepted stale source materials")
	}
	after, _ := os.ReadFile(opts.OutputPath)
	materialAfter, _ := os.ReadFile(opts.MaterialOutputPath)
	if !bytes.Equal(before, after) || !bytes.Equal(materialBefore, materialAfter) {
		t.Fatal("check rewrote an artifact")
	}
}

func TestMaterialGeneratorRequiresPairedPathsBeforeWriting(t *testing.T) {
	dir := t.TempDir()
	output := filepath.Join(dir, "generated.json")
	for _, opts := range []generatorOptions{
		{SourcePath: "missing", OutputPath: output, MaterialSourcePath: "source-only"},
		{SourcePath: "missing", OutputPath: output, MaterialOutputPath: "output-only"},
	} {
		if err := run(opts); err == nil || err.Error() != "-material-source and -material-output must be supplied together" {
			t.Fatalf("paired material paths not validated first: %v", err)
		}
		if _, err := os.Stat(output); !os.IsNotExist(err) {
			t.Fatal("invalid flags wrote an artifact")
		}
	}
}

func TestInvalidMaterialSourceCannotRewriteCitationArtifact(t *testing.T) {
	dir := t.TempDir()
	opts := generatorOptions{
		SourcePath: filepath.Join(dir, "sources.json"), OutputPath: filepath.Join(dir, "generated.json"),
		MaterialSourcePath: filepath.Join(dir, "material-source.json"), MaterialOutputPath: filepath.Join(dir, "materials.json"),
	}
	citations := []byte(`{"deep_genome":{"body":"Body.\n\n## Reference:\n\n[1] Source\n","references":[{"title":"Source"}]}}`)
	untouched := []byte("existing artifact must remain unchanged")
	for path, content := range map[string][]byte{
		opts.SourcePath: citations, opts.MaterialSourcePath: []byte(`{"doc_list":[]}`),
		opts.OutputPath: untouched, opts.MaterialOutputPath: untouched,
	} {
		if err := os.WriteFile(path, content, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := run(opts); err == nil {
		t.Fatal("invalid material source accepted")
	}
	for _, path := range []string{opts.OutputPath, opts.MaterialOutputPath} {
		got, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(got, untouched) {
			t.Fatal("invalid material source rewrote an artifact")
		}
	}
}

func TestMaterialGeneratorRejectsInvalidUTF8WithoutReplacingScientificText(t *testing.T) {
	citations, source := materialInputs(t, []string{"Source"}, []string{"SOURCE_TEXT"})
	source = bytes.ReplaceAll(source, []byte("SOURCE_TEXT"), []byte{0xff})
	if _, err := generateMaterials(citations, source); err == nil {
		t.Fatal("invalid UTF-8 source was silently repaired")
	}
}
