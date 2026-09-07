package document_format

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"io"
	"os"
	"reflect"
	"regexp"
	"strings"
	"testing"

	"phytomni-server/common/citation"
)

// The expected runs are hand-authored independently of Go's normalization.
// Browser fixtures are generated from the same source, not from this oracle.
func TestScientificFormattingContractAcrossCitedAgents(t *testing.T) {
	data, err := os.ReadFile("testdata/scientific-formatting-contract.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Content    string          `json:"content"`
		References json.RawMessage `json:"references"`
		Expected   struct {
			ReferenceRuns   [][]map[string]any `json:"reference_runs"`
			CitationIndices [][]int            `json:"citation_indices"`
			RequiredText    []string           `json:"required_text"`
		} `json:"expected"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	normalized, err := citation.NormalizeRows(fixture.References)
	if err != nil {
		t.Fatal(err)
	}
	var rows []struct {
		Citation struct {
			Runs []map[string]any `json:"runs"`
		} `json:"citation"`
	}
	if err := json.Unmarshal(normalized, &rows); err != nil {
		t.Fatal(err)
	}
	if len(rows) != len(fixture.Expected.ReferenceRuns) {
		t.Fatalf("reference slots changed: %d", len(rows))
	}
	for index, row := range rows {
		if !reflect.DeepEqual(row.Citation.Runs, fixture.Expected.ReferenceRuns[index]) {
			t.Fatalf("reference %d differs from independent scientific runs: %#v", index+1, row.Citation.Runs)
		}
	}
	answer, err := json.Marshal(citedEnvelope{fixture.Content, fixture.References})
	if err != nil {
		t.Fatal(err)
	}
	for _, tool := range []string{"KnowledgeAgent", "ReviewAgent", "BriefGeneAgent", "DeepGenomeAgent"} {
		t.Run(tool, func(t *testing.T) {
			agent, err := NewAgentWithOptions(tool, AgentOptions{FontDir: requiredAcademicFontDir(t)})
			if err != nil {
				t.Fatal(err)
			}
			for _, format := range []string{"Word", "PDF", "Markdown"} {
				t.Run(format, func(t *testing.T) {
					body, _, err := agent.Download(format, string(answer))
					if err != nil {
						t.Fatal(err)
					}
					var visible strings.Builder
					switch format {
					case "Word":
						decoder := xml.NewDecoder(strings.NewReader(wordDocumentXML(t, body)))
						for {
							token, err := decoder.Token()
							if err == io.EOF {
								break
							}
							if err != nil {
								t.Fatal(err)
							}
							if start, ok := token.(xml.StartElement); ok && start.Name.Local == "t" {
								var value string
								if err := decoder.DecodeElement(&value, &start); err != nil {
									t.Fatal(err)
								}
								visible.WriteString(value)
							}
						}
					case "PDF":
						for _, paint := range contractPDFPaint(t, body) {
							visible.WriteString(paint.text)
						}
						links := regexp.MustCompile(`/Subtype /Link /Rect \[[^]]+\] /Border \[0 0 0\] /Dest`).FindAll(body, -1)
						if len(links) != len(fixture.Expected.CitationIndices) {
							t.Fatalf("ordinary scripts gained targets or explicit citations lost them: got %d want %d", len(links), len(fixture.Expected.CitationIndices))
						}
					case "Markdown":
						if !strings.HasPrefix(string(body), fixture.Content+"\n\n## References\n\n") {
							t.Fatal("authored body was rewritten")
						}
						visible.Write(body)
					}
					for _, text := range fixture.Expected.RequiredText {
						if !strings.Contains(visible.String(), text) {
							t.Fatalf("lost scientific/table text %q", text)
						}
					}
				})
			}
		})
	}
	again, err := os.ReadFile("testdata/scientific-formatting-contract.json")
	if err != nil || !bytes.Equal(data, again) {
		t.Fatal("fixture source mutated during export")
	}
}
