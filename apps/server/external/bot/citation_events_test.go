package bot

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"phytomni-server/common/citation"
)

func TestNormalizeExecutionEventFrameV2CanonicalizesReferences(t *testing.T) {
	text := "durable answer"
	digest := fmt.Sprintf("%x", sha256.Sum256([]byte(text)))
	event := ExecutionEventV2{
		SchemaVersion: 2, EventID: "event-citation", ExecutionID: "turn-citation", Seq: 1,
		Type: "message.completed", Status: "succeeded", OccurredAt: time.Now().UTC().Format(time.RFC3339Nano),
		Source: "message", SpanID: "root", Attempt: 1,
		Summary: ExecutionSafeSummaryV2{Key: "message.completed", Text: "Answer completed"},
		PublicPayload: map[string]any{
			"output_revision": float64(1), "message_id": "msg-citation", "source_message_id": "msg-citation",
			"base_offset": float64(0), "offset": float64(len([]rune(text))), "total_length": float64(len([]rune(text))),
			"chunk_index": float64(0), "chunk_count": float64(1), "content_sha256": digest, "text": text,
			"references": []any{map[string]any{"title": "A study", "di": "10.1000/safe", "citation": map[string]any{"runs": []any{map[string]any{"text": "forged"}}, "links": []any{map[string]any{"label": "Article", "href": "https://evil.example"}}}}},
		},
	}
	raw, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	frame := []byte("id: 1\nevent: execution_event\ndata: " + string(raw) + "\n\n")
	normalized, err := NormalizeExecutionEventFrameV2(frame, "turn-citation")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(normalized, []byte("id: 1\n")) || bytes.Contains(normalized, []byte("forged")) || bytes.Contains(normalized, []byte("evil.example")) || !bytes.Contains(normalized, []byte("https://doi.org/10.1000/safe")) {
		t.Fatalf("unsafe or incomplete canonical frame: %s", normalized)
	}

	for _, executionID := range []string{"", "turn-other"} {
		event.ExecutionID = executionID
		raw, _ = json.Marshal(event)
		if got, err := NormalizeExecutionEventFrameV2([]byte("event: execution_event\ndata: "+string(raw)+"\n\n"), "turn-citation"); err == nil || len(got) != 0 {
			t.Fatalf("execution identity %q did not fail closed: %s %v", executionID, got, err)
		}
	}
	event.ExecutionID = "turn-citation"
	event.PublicPayload["references"] = []any{map[string]any{"title": "A study", "file_id": "private"}}
	raw, _ = json.Marshal(event)
	if got, err := NormalizeExecutionEventFrameV2([]byte("event: execution_event\ndata: "+string(raw)+"\n\n"), "turn-citation"); err == nil || len(got) != 0 {
		t.Fatalf("private reference frame did not fail closed: %s %v", got, err)
	}

	heartbeat := []byte(": heartbeat\n\n")
	got, err := NormalizeExecutionEventFrameV2(heartbeat, "turn-citation")
	if err != nil || !bytes.Equal(got, heartbeat) {
		t.Fatalf("heartbeat changed: %q %v", got, err)
	}
	if strings.Count(string(normalized), "data:") != 1 {
		t.Fatalf("execution frame data lines changed: %q", normalized)
	}
}

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
