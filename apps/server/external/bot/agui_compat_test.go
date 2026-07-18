package bot

import (
	"bytes"
	"testing"
)

// The fixture mirrors the Web compatibility contract. Keep its wire bytes
// visible here so changes to the parser cannot silently normalize or reorder
// frames before the service forwards them.
const aguiCompatibilityFixture = "event: RunStarted\ndata: {\"type\":\"RunStarted\",\"run_id\":\"run-k\"}\n\n" +
	"event: StepStarted\ndata: {\"type\":\"StepStarted\",\"step_name\":\"retrieve\"}\n\n" +
	"event: TextMessageContent\ndata: {\"type\":\"TextMessageContent\",\"delta\":\"answer\"}\n\n" +
	"event: RunFinished\ndata: {\"type\":\"RunFinished\",\"run_id\":\"run-k\"}\n\n" +
	"data: [DONE]\n\n"

func TestAGUICompatibilityFixtureOrderAndRawBytes(t *testing.T) {
	frames := bytes.Split([]byte(aguiCompatibilityFixture), []byte("\n\n"))
	wantTypes := []string{"RunStarted", "StepStarted", "TextMessageContent", "RunFinished"}
	var gotTypes []string
	for _, frame := range frames {
		if len(frame) == 0 {
			continue
		}
		ev, ok := ParseAGUIFrame(frame)
		if !ok {
			continue
		}
		gotTypes = append(gotTypes, ev.Type)
	}
	if len(gotTypes) != len(wantTypes) {
		t.Fatalf("event count = %d, want %d (%v)", len(gotTypes), len(wantTypes), wantTypes)
	}
	for i, want := range wantTypes {
		if gotTypes[i] != want {
			t.Fatalf("event %d = %q, want %q", i, gotTypes[i], want)
		}
	}
	// ParseAGUIFrame must not mutate the source fixture. The gateway forwards
	// this exact byte sequence; the parser is only an observation side effect.
	raw := []byte(aguiCompatibilityFixture)
	copyBefore := append([]byte(nil), raw...)
	for _, frame := range bytes.Split(raw, []byte("\n\n")) {
		_, _ = ParseAGUIFrame(frame)
	}
	if !bytes.Equal(raw, copyBefore) {
		t.Fatal("AG-UI parser mutated the source bytes")
	}
}

func TestAGUICompatibilityUnknownEventIsIgnored(t *testing.T) {
	a := &AGUIAccumulator{}
	ev, ok := ParseAGUIFrame([]byte("event: FutureEvent\ndata: {\"type\":\"FutureEvent\",\"value\":\"ignored\"}"))
	if !ok {
		t.Fatal("unknown AG-UI event should still parse for forward compatibility")
	}
	a.Observe(ev)
	if a.RunID() != "" || a.AnswerText() != "" || a.Err() != nil {
		t.Fatalf("unknown event changed accumulator: run=%q answer=%q err=%v", a.RunID(), a.AnswerText(), a.Err())
	}
}
