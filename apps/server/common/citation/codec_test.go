package citation

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"testing"
)

func TestRowsReviewedContract(t *testing.T) {
	data, err := os.ReadFile("../document_format/testdata/cited-contract.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		References json.RawMessage `json:"references"`
		Expected   struct {
			Sentences []string `json:"sentences"`
			Emphasis  []struct {
				Index int `json:"index"`
				Run
			} `json:"emphasis"`
			Links []struct {
				Index int `json:"index"`
				Link
			} `json:"links"`
		} `json:"expected"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	original := append([]byte(nil), fixture.References...)
	normalized, err := NormalizeRows(fixture.References)
	if err != nil {
		t.Fatal(err)
	}
	again, err := NormalizeRows(normalized)
	if err != nil || !bytes.Equal(normalized, again) || !bytes.Equal(original, fixture.References) {
		t.Fatal("normalization changed source or was not idempotent")
	}
	rows, err := DecodeRows(normalized)
	if err != nil {
		t.Fatal(err)
	}
	var observed struct {
		Sentences []string `json:"sentences"`
		Emphasis  []struct {
			Index int `json:"index"`
			Run
		} `json:"emphasis"`
		Links []struct {
			Index int `json:"index"`
			Link
		} `json:"links"`
	}
	for i, row := range rows {
		observed.Sentences = append(observed.Sentences, PlainText(row.Citation))
		for _, run := range row.Citation.Runs {
			if run.Bold || run.Italic {
				observed.Emphasis = append(observed.Emphasis, struct {
					Index int `json:"index"`
					Run
				}{i + 1, run})
			}
		}
		for _, link := range row.Citation.Links {
			observed.Links = append(observed.Links, struct {
				Index int `json:"index"`
				Link
			}{i + 1, link})
		}
	}
	if !reflect.DeepEqual(observed, fixture.Expected) {
		t.Fatalf("reviewed oracle mismatch: got %+v want %+v", observed, fixture.Expected)
	}
	frontend, err := os.ReadFile("../../../web/tests/fixtures/cited-contract.generated.json")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(frontend, normalized) {
		t.Fatal("frontend fixture drift: regenerate from report-fixture references.json, never update the oracle")
	}
}

func TestRowsPreserveMalformedSlots(t *testing.T) {
	raw := json.RawMessage(`[{"title":"First"},null,{"title":"Third","ar":"e123","formatted_citation":"Rich *citation*."},42,[],{"title":{"private":"value"},"file_id":"secret-id"}]`)
	one, err := NormalizeRows(raw)
	if err != nil {
		t.Fatal(err)
	}
	var rows []map[string]json.RawMessage
	if err := json.Unmarshal(one, &rows); err != nil {
		t.Fatal(err)
	}
	if len(rows) != 6 {
		t.Fatalf("shifted reference slots: %d", len(rows))
	}
	two, err := NormalizeRows(one)
	if err != nil || !bytes.Equal(one, two) {
		t.Fatal("normalization is not idempotent")
	}
	if string(rows[2]["ar"]) != `"e123"` || string(rows[2]["formatted_citation"]) != `"Rich *citation*."` {
		t.Fatal("source fields lost")
	}
	decoded, err := DecodeRows(one)
	if err != nil {
		t.Fatal(err)
	}
	for _, i := range []int{1, 3, 4, 5} {
		if PlainText(decoded[i].Citation) != "Reference details unavailable." {
			t.Fatalf("slot %d not neutral: %+v", i, decoded[i])
		}
	}
	if bytes.Contains(one, []byte("secret-id")) || bytes.Contains(one, []byte("private")) {
		t.Fatal("arbitrary source data exposed")
	}
}

func TestRowsRootAndScalarFields(t *testing.T) {
	for _, raw := range []string{"", "null", "[]"} {
		got, err := NormalizeRows(json.RawMessage(raw))
		if err != nil || string(got) != "[]" {
			t.Fatalf("empty %q: %s %v", raw, got, err)
		}
	}
	for _, raw := range []string{`{"bad":"private-source"}`, `"secret"`, `123`, `[`} {
		_, err := NormalizeRows(json.RawMessage(raw))
		if !errors.Is(err, ErrInvalidReferences) || err.Error() != "invalid reference payload" {
			t.Fatalf("root error: %v", err)
		}
	}
	got, err := NormalizeRows(json.RawMessage(`[{"title":"T","vl":12,"py":2026,"pm":12345,"citation":{"runs":[{"text":"forged"}]}}]`))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(got, []byte("forged")) || !bytes.Contains(got, []byte(`"vl":"12"`)) {
		t.Fatalf("bad canonical row: %s", got)
	}
}

func TestRowsInternalIdentity(t *testing.T) {
	raw := json.RawMessage(`[{"file_id":"private\\path\u002did"},{"file_id":123456789012345678901234567890},{"file_id":1.2300e+42},{"file_id":{"private":"object"}},{"file_id":["array"]},{"file_id":true},{"file_id":null},{}]`)
	rows, err := DecodeRows(raw)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{`"private\\path\u002did"`, "123456789012345678901234567890", "1.2300e+42", "", "", "", "", ""}
	if len(rows) != len(want) {
		t.Fatal("identity slots shifted")
	}
	for i, row := range rows {
		if string(row.FileID) != want[i] {
			t.Errorf("slot %d identity = %s, want %s", i, row.FileID, want[i])
		}
		if row.Source.Title != "" || PlainText(row.Citation) != "Reference details unavailable." || Markdown(row.Citation) != "Reference details unavailable." {
			t.Errorf("identity became presentation in slot %d", i)
		}
		encoded, err := json.Marshal(row)
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Contains(encoded, []byte("file_id")) || bytes.Contains(encoded, []byte("FileID")) || bytes.Contains(encoded, []byte("private")) {
			t.Errorf("internal identity exposed: %s", encoded)
		}
	}
	public, err := NormalizeRows(raw)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(public, []byte("file_id")) || bytes.Contains(public, []byte("private")) || bytes.Contains(public, []byte("123456789012345678901234567890")) || bytes.Contains(public, []byte("1.2300e+42")) {
		t.Fatal("identity exposed in public rows")
	}
}
