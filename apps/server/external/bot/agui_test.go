package bot

import "testing"

func TestParseAGUIFrame_TextContent(t *testing.T) {
	frame := []byte("event: TextMessageContent\ndata: {\"type\":\"TextMessageContent\",\"message_id\":\"m1\",\"delta\":\"photosynthesis\"}")
	ev, ok := ParseAGUIFrame(frame)
	if !ok {
		t.Fatal("expected ok for a content frame")
	}
	if ev.Type != "TextMessageContent" {
		t.Fatalf("type = %q, want TextMessageContent", ev.Type)
	}
}

func TestParseAGUIFrame_DoneAndBlankIgnored(t *testing.T) {
	for _, f := range [][]byte{[]byte("data: [DONE]"), []byte(""), []byte(": comment")} {
		if _, ok := ParseAGUIFrame(f); ok {
			t.Fatalf("frame %q must not parse as an event", f)
		}
	}
}

func TestAccumulator_AnswerRunIDFollowUp(t *testing.T) {
	a := &AGUIAccumulator{}
	feed := []string{
		`event: RunStarted` + "\n" + `data: {"type":"RunStarted","run_id":"run_42","dialogue_id":"d1"}`,
		`event: TextMessageContent` + "\n" + `data: {"type":"TextMessageContent","delta":"hello "}`,
		`event: TextMessageContent` + "\n" + `data: {"type":"TextMessageContent","delta":"world"}`,
		`event: Custom` + "\n" + `data: {"type":"Custom","name":"phyto.follow_up","value":["q1","q2"]}`,
		`event: RunFinished` + "\n" + `data: {"type":"RunFinished","run_id":"run_42"}`,
	}
	for _, f := range feed {
		if ev, ok := ParseAGUIFrame([]byte(f)); ok {
			a.Observe(ev)
		}
	}
	if got := a.AnswerText(); got != "hello world" {
		t.Fatalf("AnswerText = %q, want %q", got, "hello world")
	}
	if got := a.RunID(); got != "run_42" {
		t.Fatalf("RunID = %q, want run_42", got)
	}
	if got := a.FollowUpJSON(); got != `["q1","q2"]` {
		t.Fatalf("FollowUpJSON = %q, want [\"q1\",\"q2\"]", got)
	}
	if a.Err() != nil {
		t.Fatalf("Err = %v, want nil", a.Err())
	}
}

func TestAccumulator_RunError(t *testing.T) {
	a := &AGUIAccumulator{}
	f := `event: RunError` + "\n" + `data: {"type":"RunError","code":"bot_failure","message":"boom"}`
	ev, ok := ParseAGUIFrame([]byte(f))
	if !ok {
		t.Fatal("RunError frame should parse")
	}
	a.Observe(ev)
	if a.Err() == nil || a.Err().Message != "boom" {
		t.Fatalf("Err = %v, want message boom", a.Err())
	}
}

func TestAccumulator_RunStartedBlankIDDoesNotClobber(t *testing.T) {
	a := &AGUIAccumulator{}
	feed := []string{
		`event: RunStarted` + "\n" + `data: {"type":"RunStarted","run_id":"run_42"}`,
		// a later RunStarted with a blank run_id (retry / duplicate) must not
		// wipe the captured id.
		`event: RunStarted` + "\n" + `data: {"type":"RunStarted","run_id":""}`,
	}
	for _, f := range feed {
		if ev, ok := ParseAGUIFrame([]byte(f)); ok {
			a.Observe(ev)
		}
	}
	if got := a.RunID(); got != "run_42" {
		t.Fatalf("RunID = %q, want run_42 (blank later RunStarted must not clobber)", got)
	}
}

func TestParseAGUIFrame_MultiLineDataJoined(t *testing.T) {
	// SSE concatenates consecutive data: lines with "\n"; a JSON object split
	// across two data: lines must reassemble into one valid event.
	frame := `event: TextMessageContent` + "\n" +
		`data: {"type":"TextMessageContent",` + "\n" +
		`data: "delta":"hi"}`
	ev, ok := ParseAGUIFrame([]byte(frame))
	if !ok {
		t.Fatal("multi-line data frame should parse")
	}
	if ev.Type != "TextMessageContent" {
		t.Fatalf("Type = %q, want TextMessageContent", ev.Type)
	}
	if got := stringField(ev.Data, "delta"); got != "hi" {
		t.Fatalf("delta = %q, want hi", got)
	}
}

func TestParseAGUIFrame_MalformedJSONRejected(t *testing.T) {
	// A data line that is not valid JSON must be dropped (ok=false), not
	// surfaced as a partial event.
	if _, ok := ParseAGUIFrame([]byte(`data: {"type":`)); ok {
		t.Fatal("malformed JSON frame must not parse")
	}
}

func TestAccumulator_UnknownEventIgnored(t *testing.T) {
	// An event type the reducer does not handle must be a no-op, not a panic or
	// a spurious state change — forward-compatibility with new AG-UI events.
	a := &AGUIAccumulator{}
	ev, ok := ParseAGUIFrame([]byte(`event: StepStarted` + "\n" + `data: {"type":"StepStarted","step_name":"retrieving"}`))
	if !ok {
		t.Fatal("StepStarted frame should parse")
	}
	a.Observe(ev)
	if a.AnswerText() != "" || a.RunID() != "" || a.Err() != nil {
		t.Fatalf("unknown event mutated state: answer=%q runID=%q err=%v", a.AnswerText(), a.RunID(), a.Err())
	}
}

func TestAccumulator_EmptyDeltaIsNoOp(t *testing.T) {
	// A TextMessageContent with no delta must leave the answer untouched.
	a := &AGUIAccumulator{}
	ev, ok := ParseAGUIFrame([]byte(`event: TextMessageContent` + "\n" + `data: {"type":"TextMessageContent"}`))
	if !ok {
		t.Fatal("frame should parse")
	}
	a.Observe(ev)
	if a.AnswerText() != "" {
		t.Fatalf("empty delta appended %q, want empty", a.AnswerText())
	}
}

// TestAGUICompatibilityFixture_BoundedMixedTerminal folds the synthetic
// stream fixture used by the Web compatibility gate in arrival order. The
// fixture deliberately mixes LF and CRLF frames, carries one forward-compatible
// unknown event, and ends with both the Bot RunError and legacy [DONE] marker.
// The parser observes the bytes; the gateway owns forwarding them unchanged.
func TestAGUICompatibilityFixture_BoundedMixedTerminal(t *testing.T) {
	frames := []struct {
		name string
		raw  string
	}{
		{
			name: "run started",
			raw:  "event: RunStarted\r\ndata: {\"type\":\"RunStarted\",\"run_id\":\"run-task27\"}",
		},
		{
			name: "unknown step",
			raw:  "event: FutureEvent\ndata: {\"type\":\"FutureEvent\",\"value\":\"ignored\"}",
		},
		{
			name: "content",
			raw:  "event: TextMessageContent\r\ndata: {\"type\":\"TextMessageContent\",\"delta\":\"synthetic\"}",
		},
		{
			name: "run error",
			raw:  "event: RunError\ndata: {\"type\":\"RunError\",\"code\":\"fixture_failure\",\"message\":\"synthetic failure\"}",
		},
		{
			name: "done",
			raw:  "data: [DONE]",
		},
	}

	expectedTypes := []string{"RunStarted", "FutureEvent", "TextMessageContent", "RunError"}
	var gotTypes []string
	acc := &AGUIAccumulator{}
	for _, frame := range frames {
		ev, ok := ParseAGUIFrame([]byte(frame.raw))
		if frame.name == "done" {
			if ok {
				t.Fatal("[DONE] must not become an AG-UI event")
			}
			continue
		}
		if !ok {
			t.Fatalf("%s fixture frame did not parse", frame.name)
		}
		gotTypes = append(gotTypes, ev.Type)
		acc.Observe(ev)
	}
	if len(gotTypes) != len(expectedTypes) {
		t.Fatalf("event types = %v, want %v", gotTypes, expectedTypes)
	}
	for index, want := range expectedTypes {
		if gotTypes[index] != want {
			t.Fatalf("event %d = %q, want %q", index, gotTypes[index], want)
		}
	}
	if acc.RunID() != "run-task27" {
		t.Fatalf("run id = %q, want run-task27", acc.RunID())
	}
	if acc.AnswerText() != "synthetic" {
		t.Fatalf("answer = %q, want synthetic", acc.AnswerText())
	}
	if acc.Err() == nil || acc.Err().Code != "fixture_failure" {
		t.Fatalf("terminal error = %+v, want fixture_failure", acc.Err())
	}
}
