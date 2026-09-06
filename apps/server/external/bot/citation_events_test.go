package bot

import (
	"bytes"
	"encoding/json"
	"errors"
	"testing"

	"phytomni-server/common/citation"
)

func TestCitationFrameKeepsTransportIdentity(t *testing.T) {
	_, refs, canonical := reviewedBotCitationFixture(t)
	payload, err := json.Marshal(map[string]any{"doc_list": refs, "extra": json.RawMessage(`9007199254740993`)})
	if err != nil {
		t.Fatal(err)
	}
	for _, ending := range []string{"", "\n", "\n\n", "\r\n\r\n"} {
		frame := []byte(": keep\nid: 17\nevent: Custom\nretry: 200\ndata: {\"type\":\"Custom\",\n: between\ndata: \"name\":\"phyto.references\",\"value\":" + string(payload) + "}" + ending)
		got, err := NormalizeReferenceFrame(frame)
		if err != nil {
			t.Fatal(err)
		}
		for _, line := range [][]byte{[]byte(": keep\n"), []byte("id: 17\n"), []byte("event: Custom\n"), []byte("retry: 200\n"), []byte(": between\n")} {
			if !bytes.Contains(got, line) {
				t.Fatalf("missing transport line %q: %s", line, got)
			}
		}
		if !bytes.HasSuffix(got, []byte(ending)) || bytes.Count(got, []byte("data:")) != 1 {
			t.Fatalf("delimiter/data lines: %q", got)
		}
		ev, ok := ParseAGUIFrame(got)
		if !ok {
			t.Fatal("normalized frame did not parse")
		}
		var value struct {
			DocList []json.RawMessage `json:"doc_list"`
			Extra   json.RawMessage   `json:"extra"`
		}
		if err := json.Unmarshal(ev.Data["value"], &value); err != nil {
			t.Fatal(err)
		}
		actual, err := json.Marshal(value.DocList)
		if err != nil || !bytes.Equal(actual, canonical) || string(value.Extra) != "9007199254740993" {
			t.Fatalf("slots/extensions: %s", ev.Raw)
		}
		for _, row := range value.DocList {
			if !bytes.Contains(row, []byte(`"citation"`)) {
				t.Fatalf("not canonical: %s", row)
			}
		}
		second, err := NormalizeReferenceFrame(got)
		if err != nil || !bytes.Equal(got, second) {
			t.Fatalf("not idempotent: %s %v", second, err)
		}
	}
}

func TestCitationFrameUnrelatedBytesAndMalformedRoot(t *testing.T) {
	for _, plain := range []string{
		": keepalive\nid: 18\ndata: {\"type\":\"TextMessageContent\",\"delta\":\"  x doc_list  \"}\r\n\r\n",
		"event: Custom\ndata: {\"name\":\"other\",\"value\":{\"doc_list\":\"bad\"}}\n\n",
		"data: [DONE]\n\n",
	} {
		got, err := NormalizeReferenceFrame([]byte(plain))
		if err != nil || string(got) != plain {
			t.Fatalf("unrelated frame rewritten: %q %v", got, err)
		}
	}
	for _, value := range []string{`{"doc_list":"private bad source"}`, `{"doc_list":{}}`, `"bad envelope"`, `[]`} {
		got, err := NormalizeReferenceFrame([]byte("event: Custom\ndata: {\"name\":\"phyto.references\",\"value\":" + value + "}\n\n"))
		if !errors.Is(err, citation.ErrInvalidReferences) || len(got) != 0 {
			t.Fatalf("malformed frame: %s %v", got, err)
		}
	}
}

func TestCitationFrameActionReferences(t *testing.T) {
	raw := json.RawMessage(`{"status":"succeeded","run_id":"r","report_revision":9007199254740993,"extension":{"x":true},"result":{"a2ui":{"widget":"confirm"},"formatted":{"answer":"body [3]","references":[{"title":"First"},null,{"title":"Third"}],"extra":9007199254740993}}}`)
	got, err := NormalizeActionReferences(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(got, []byte(`"citation"`)) || !bytes.Contains(got, []byte(`"widget":"confirm"`)) || !bytes.Contains(got, []byte(`9007199254740993`)) {
		t.Fatalf("normalized action: %s", got)
	}
	for _, root := range []string{`{}`, `"private source"`} {
		_, err := NormalizeActionReferences(json.RawMessage(`{"result":{"formatted":{"references":` + root + `}}}`))
		if !errors.Is(err, citation.ErrInvalidReferences) {
			t.Fatalf("malformed root: %v", err)
		}
	}
}
