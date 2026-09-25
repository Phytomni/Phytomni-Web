package bot

import (
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"testing"

	"phytomni-server/common/citation"
)

func reviewedBotCitationFixture(t *testing.T) (string, json.RawMessage, json.RawMessage) {
	t.Helper()
	data, err := os.ReadFile("../../common/document_format/testdata/cited-contract.json")
	if err != nil {
		t.Fatal(err)
	}
	var source struct {
		Content    string
		References json.RawMessage
	}
	if err := json.Unmarshal(data, &source); err != nil {
		t.Fatal(err)
	}
	canonical, err := os.ReadFile("../../../web/tests/fixtures/cited-contract.generated.json")
	if err != nil {
		t.Fatal(err)
	}
	return source.Content, source.References, canonical
}

func TestCitationProjectionEnvelope(t *testing.T) {
	content, refs, canonical := reviewedBotCitationFixture(t)
	for _, slug := range []string{"knowledge", "review", "brief_gene", "deep_genome"} {
		before := string(refs)
		shaped, err := ShapeAnswer(slug, content, &Formatted{References: refs})
		if err != nil {
			t.Fatal(err)
		}
		var got struct {
			Content string
			DocList json.RawMessage `json:"doc_list"`
		}
		if err := json.Unmarshal([]byte(shaped), &got); err != nil {
			t.Fatal(err)
		}
		if got.Content != content || string(got.DocList) != string(canonical) || string(refs) != before {
			t.Fatalf("%s reviewed shape/source drift", slug)
		}
	}
	input := `{"content":"body [1]","unknown":{"n":12345678901234567890},"doc_list":[null,{"title":"T","ar":"e123","formatted_citation":"Rich *citation*."}]}`
	got, err := NormalizeCitedAnswer(input)
	if err != nil {
		t.Fatal(err)
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal([]byte(got), &envelope); err != nil {
		t.Fatal(err)
	}
	if string(envelope["content"]) != `"body [1]"` || string(envelope["unknown"]) != `{"n":12345678901234567890}` {
		t.Fatal("envelope changed")
	}
	rows, err := citation.DecodeRows(envelope["doc_list"])
	if err != nil || len(rows) != 2 || rows[1].Source.AR != "e123" {
		t.Fatalf("rows: %+v %v", rows, err)
	}
	if next, err := NormalizeCitedAnswer(got); err != nil || next != got {
		t.Fatal("not idempotent")
	}
	for _, input := range []string{"ordinary **Markdown**", `"quoted"`, `[1]`, `null`, `{"content":"no references"}`} {
		if got, err := NormalizeCitedAnswer(input); err != nil || got != input {
			t.Fatalf("unrelated answer changed: %s %v", got, err)
		}
	}
	if _, err := NormalizeCitedAnswer(`{"doc_list":{"bad":"private"}}`); !errors.Is(err, citation.ErrInvalidReferences) || err.Error() != "invalid reference payload" {
		t.Fatalf("error: %v", err)
	}
}

func TestCitationProjectionSeparatesOnlyOwnedBody(t *testing.T) {
	source := "Evidence [1].\n\n## References\n\n1. A plant study\n"
	raw, _ := json.Marshal(map[string]any{"content": source, "doc_list": json.RawMessage(`[{"title":"A plant study"}]`), "unknown": json.RawMessage(`{"id":9007199254740993}`)})
	projected, err := NormalizeCitedAnswer(string(raw))
	if err != nil {
		t.Fatal(err)
	}
	var envelope map[string]json.RawMessage
	if err = json.Unmarshal([]byte(projected), &envelope); err != nil {
		t.Fatal(err)
	}
	if string(envelope["content"]) != `"Evidence [1].\n\n"` || string(envelope["unknown"]) != `{"id":9007199254740993}` {
		t.Fatalf("projection %s", projected)
	}
	for _, slug := range []string{"knowledge", "review", "deep_genome", "brief_gene"} {
		shaped, err := ShapeAnswer(slug, source, &Formatted{References: json.RawMessage(`[{"title":"A plant study"}]`)})
		if err != nil {
			t.Fatal(err)
		}
		var got struct{ Content string }
		if err = json.Unmarshal([]byte(shaped), &got); err != nil {
			t.Fatal(err)
		}
		if got.Content != "Evidence [1].\n\n" {
			t.Fatalf("%s body not separated: %q", slug, got.Content)
		}
	}
	action := json.RawMessage(`{"status":"succeeded","run_id":"r","extension":9007199254740993,"result":{"a2ui":{"widget":"confirm"},"formatted":{"answer":"Evidence [1].\n\n## References\n\n1. A plant study\n","references":[{"title":"A plant study"}]}}}`)
	projectedAction, err := NormalizeActionReferences(action)
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Extension json.RawMessage
		Result    struct {
			A2UI      json.RawMessage
			Formatted struct{ Answer string }
		}
	}
	if err = json.Unmarshal(projectedAction, &got); err != nil {
		t.Fatal(err)
	}
	if got.Result.Formatted.Answer != "Evidence [1].\n\n" || string(got.Extension) != "9007199254740993" || string(got.Result.A2UI) != `{"widget":"confirm"}` {
		t.Fatalf("action %s", projectedAction)
	}
}

func TestShapeAnswer_CitedCanonicalAndMalformed(t *testing.T) {
	for _, slug := range []string{"knowledge", "review", "brief_gene", "deep_genome"} {
		t.Run(slug, func(t *testing.T) {
			f := &Formatted{References: json.RawMessage(`[{"title":"T","ar":"e123","formatted_citation":"Rich *citation*."},null,12]`)}
			answer, err := ShapeAnswer(slug, "body [3]\n\n## References\n\nUnchanged source body.", f)
			if err != nil {
				t.Fatal(err)
			}
			var envelope struct {
				Content    string          `json:"content"`
				References json.RawMessage `json:"doc_list"`
			}
			if err := json.Unmarshal([]byte(answer), &envelope); err != nil {
				t.Fatal(err)
			}
			if envelope.Content != "body [3]\n\n## References\n\nUnchanged source body." {
				t.Fatal("body changed")
			}
			rows, err := citation.DecodeRows(envelope.References)
			if err != nil || len(rows) != 3 || rows[0].Source.AR != "e123" || rows[0].Source.Formatted != "Rich *citation*." {
				t.Fatalf("rows: %+v %v", rows, err)
			}
			if citation.PlainText(rows[2].Citation) != "Reference details unavailable." {
				t.Fatal("slot lost")
			}
			var public []struct {
				Citation citation.Presentation `json:"citation"`
			}
			if err := json.Unmarshal(envelope.References, &public); err != nil {
				t.Fatal(err)
			}
			for i := range rows {
				if !reflect.DeepEqual(public[i].Citation, rows[i].Citation) {
					t.Fatalf("public citation %d differs: %+v", i, public[i])
				}
			}
			bad := &Formatted{References: json.RawMessage(`{"bad":"private-source"}`)}
			got, err := ShapeAnswer(slug, "body", bad)
			if got != "" || !errors.Is(err, citation.ErrInvalidReferences) || err.Error() != "invalid reference payload" {
				t.Fatalf("malformed: %s %v", got, err)
			}
		})
	}
}
