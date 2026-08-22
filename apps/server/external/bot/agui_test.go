package bot

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

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

func TestAccumulator_PhytoReferencesShapeCitedAnswer(t *testing.T) {
	a := NewAGUIAccumulator("")
	feed := []string{
		`event: RunStarted` + "\n" + `data: {"type":"RunStarted","run_id":"run_refs"}`,
		`event: TextMessageContent` + "\n" + `data: {"type":"TextMessageContent","delta":"body [1]"}`,
		`event: Custom` + "\n" + `data: {"type":"Custom","name":"phyto.references","value":{"doc_list":[{"title":"Doc A","au":"Archetti"}]}}`,
		`event: RunFinished` + "\n" + `data: {"type":"RunFinished","run_id":"run_refs"}`,
	}
	for _, f := range feed {
		if ev, ok := ParseAGUIFrame([]byte(f)); ok {
			a.Observe(ev)
		}
	}
	got := ShapeAnswer("knowledge", a.AnswerText(), a.CitedFormatted())
	var parsed struct {
		Content string                   `json:"content"`
		DocList []map[string]interface{} `json:"doc_list"`
	}
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("shaped answer is not JSON: %v (%s)", err, got)
	}
	if parsed.Content != "body [1]" {
		t.Fatalf("content = %q, want body [1]", parsed.Content)
	}
	if len(parsed.DocList) != 1 || parsed.DocList[0]["title"] != "Doc A" || parsed.DocList[0]["au"] != "Archetti" {
		t.Fatalf("doc_list = %#v, want one bibliographic row for Doc A", parsed.DocList)
	}
}

func TestAccumulator_PhytoReferencesMalformedSkipped(t *testing.T) {
	a := NewAGUIAccumulator("")
	feed := []string{
		`event: Custom` + "\n" + `data: {"type":"Custom","name":"phyto.references","value":"not-an-object"}`,
		`event: Custom` + "\n" + `data: {"type":"Custom","name":"phyto.references","value":{"doc_list":"oops"}}`,
		`event: RunFinished` + "\n" + `data: {"type":"RunFinished","run_id":"run_bad"}`,
	}
	for _, f := range feed {
		if ev, ok := ParseAGUIFrame([]byte(f)); ok {
			a.Observe(ev)
		}
	}
	if a.Err() != nil {
		t.Fatalf("malformed phyto.references must not fail the stream: %v", a.Err())
	}
	if a.CitedFormatted() != nil {
		t.Fatalf("CitedFormatted = %#v, want nil for unusable frames", a.CitedFormatted())
	}
}

func TestAccumulator_PhytoReferencesBlankDoesNotClobber(t *testing.T) {
	a := NewAGUIAccumulator("")
	feed := []string{
		`event: Custom` + "\n" + `data: {"type":"Custom","name":"phyto.references","value":{"doc_list":[{"title":"Doc A"}]}}`,
		`event: Custom` + "\n" + `data: {"type":"Custom","name":"phyto.references","value":{"doc_list":[]}}`,
		`event: Custom` + "\n" + `data: {"type":"Custom","name":"phyto.references","value":{"doc_list":[{"title":"Doc A"},"x",null]}}`,
	}
	for _, f := range feed {
		if ev, ok := ParseAGUIFrame([]byte(f)); ok {
			a.Observe(ev)
		}
	}
	got := ShapeAnswer("knowledge", "body", a.CitedFormatted())
	var parsed struct {
		DocList []map[string]interface{} `json:"doc_list"`
	}
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("shaped answer is not JSON: %v (%s)", err, got)
	}
	if len(parsed.DocList) != 1 || parsed.DocList[0]["title"] != "Doc A" {
		t.Fatalf("doc_list = %#v, want Doc A kept across blank and mixed rows", parsed.DocList)
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

func validAGUIContextStage(turnID string) ContextStageMetadata {
	return ContextStageMetadata{
		SchemaVersion:                  1,
		TurnID:                         turnID,
		SelectedAgentID:                "ChatAgent",
		RouteSource:                    "instant_lock",
		RouteReasonCode:                "INSTANT_LOCK",
		BaseBusinessContextVersion:     0,
		ProposedBusinessContextVersion: 1,
		LastAppliedLedgerCursor:        1,
	}
}

func contextStageFrame(t *testing.T, stage ContextStageMetadata) AGUIEvent {
	t.Helper()
	raw, err := json.Marshal(stage)
	if err != nil {
		t.Fatal(err)
	}
	frame := []byte(
		"event: Custom\n" +
			`data: {"type":"Custom","name":"phyto.context_staged","value":` +
			string(raw) + "}",
	)
	event, ok := ParseAGUIFrame(frame)
	if !ok {
		t.Fatal("context stage frame did not parse")
	}
	return event
}

func TestAGUIAccumulatorContextAcceptsOneValidEventAndIdenticalDuplicate(t *testing.T) {
	acc := NewAGUIAccumulator("17")
	stage := validAGUIContextStage("17")

	acc.Observe(contextStageFrame(t, stage))
	acc.Observe(contextStageFrame(t, stage))

	if err := acc.ProtocolErr(); err != nil {
		t.Fatalf("identical context stage duplicate failed: %v", err)
	}
	if got := acc.ContextStage(); got == nil || *got != stage {
		t.Fatalf("context stage = %#v, want %#v", got, stage)
	}
}

func TestAGUIAccumulatorContextRejectsConflictingDuplicate(t *testing.T) {
	acc := NewAGUIAccumulator("17")
	first := validAGUIContextStage("17")
	conflict := first
	conflict.ContextDegraded = true

	acc.Observe(contextStageFrame(t, first))
	acc.Observe(contextStageFrame(t, conflict))

	if !errors.Is(acc.ProtocolErr(), ErrAGUIContextStageConflict) {
		t.Fatalf("protocol error = %v, want context stage conflict", acc.ProtocolErr())
	}
}

func TestAGUIAccumulatorContextRejectsEventAfterRunFinished(t *testing.T) {
	acc := NewAGUIAccumulator("17")
	finished, ok := ParseAGUIFrame([]byte(
		`event: RunFinished` + "\n" +
			`data: {"type":"RunFinished","run_id":"run-17"}`,
	))
	if !ok {
		t.Fatal("RunFinished frame did not parse")
	}
	acc.Observe(finished)
	acc.Observe(contextStageFrame(t, validAGUIContextStage("17")))

	if !errors.Is(acc.ProtocolErr(), ErrAGUIContextStageAfterFinished) {
		t.Fatalf("protocol error = %v, want context stage after finish", acc.ProtocolErr())
	}
}

func TestAGUIAccumulatorContextRejectsMalformedValue(t *testing.T) {
	acc := NewAGUIAccumulator("17")
	event, ok := ParseAGUIFrame([]byte(
		`event: Custom` + "\n" +
			`data: {"type":"Custom","name":"phyto.context_staged","value":{"turn_id":"17","secret":"raw-payload-marker"}}`,
	))
	if !ok {
		t.Fatal("malformed context frame must still parse as an AG-UI event")
	}
	acc.Observe(event)

	if !errors.Is(acc.ProtocolErr(), ErrAGUIContextStageMalformed) {
		t.Fatalf("protocol error = %v, want malformed context stage", acc.ProtocolErr())
	}
	if strings.Contains(acc.ProtocolErr().Error(), "raw-payload-marker") {
		t.Fatalf("protocol error exposed raw payload: %v", acc.ProtocolErr())
	}
}

func TestAGUIAccumulatorContextRejectsMismatchedTurn(t *testing.T) {
	acc := NewAGUIAccumulator("17")
	acc.Observe(contextStageFrame(t, validAGUIContextStage("18")))

	if !errors.Is(acc.ProtocolErr(), ErrAGUIContextStageTurnMismatch) {
		t.Fatalf("protocol error = %v, want turn mismatch", acc.ProtocolErr())
	}
}

func TestAGUIAccumulatorContextIgnoresUnknownCustomEvent(t *testing.T) {
	acc := NewAGUIAccumulator("17")
	event, ok := ParseAGUIFrame([]byte(
		`event: Custom` + "\n" +
			`data: {"type":"Custom","name":"future.context","value":{"secret":"must-not-be-read"}}`,
	))
	if !ok {
		t.Fatal("unknown custom frame did not parse")
	}
	acc.Observe(event)

	if acc.ContextStage() != nil || acc.ProtocolErr() != nil {
		t.Fatalf("unknown custom event changed context state: stage=%#v err=%v",
			acc.ContextStage(), acc.ProtocolErr())
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
