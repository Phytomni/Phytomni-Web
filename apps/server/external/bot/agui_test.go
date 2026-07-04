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
