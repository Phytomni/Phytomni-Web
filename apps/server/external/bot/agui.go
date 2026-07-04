package bot

import (
	"bytes"
	"encoding/json"
	"strings"
)

// AGUIEvent is one decoded AG-UI SSE frame: its event type plus the parsed
// data-line JSON object. Raw keeps the original data JSON for forwarding.
type AGUIEvent struct {
	Type string
	Raw  []byte
	Data map[string]json.RawMessage
}

// AGUIRunError is a RunError event's surfaceable fields.
type AGUIRunError struct {
	Code    string
	Message string
}

// ParseAGUIFrame decodes one SSE frame (the bytes between blank-line
// separators) into an AGUIEvent. It returns ok=false for blank frames,
// comment lines (": ..."), and the legacy "[DONE]" sentinel — none of which
// are AG-UI events. The event type is taken from the data JSON "type" field
// (authoritative), falling back to the "event:" line.
func ParseAGUIFrame(frame []byte) (AGUIEvent, bool) {
	var eventLine, dataLine string
	for _, raw := range bytes.Split(frame, []byte("\n")) {
		line := strings.TrimRight(string(raw), "\r")
		switch {
		case strings.HasPrefix(line, "event:"):
			eventLine = strings.TrimSpace(line[len("event:"):])
		case strings.HasPrefix(line, "data:"):
			dataLine = strings.TrimSpace(line[len("data:"):])
		}
	}
	if dataLine == "" || dataLine == "[DONE]" {
		return AGUIEvent{}, false
	}
	var data map[string]json.RawMessage
	if err := json.Unmarshal([]byte(dataLine), &data); err != nil {
		return AGUIEvent{}, false
	}
	ev := AGUIEvent{Type: eventLine, Raw: []byte(dataLine), Data: data}
	if t, ok := data["type"]; ok {
		var ts string
		if json.Unmarshal(t, &ts) == nil && ts != "" {
			ev.Type = ts
		}
	}
	if ev.Type == "" {
		return AGUIEvent{}, false
	}
	return ev, true
}

// AGUIAccumulator tees the stream: while frames are forwarded to the browser
// it accumulates the fields the Web row needs at stream end (answer text, the
// Bot run id, follow-up questions JSON, and any RunError).
type AGUIAccumulator struct {
	answer   strings.Builder
	runID    string
	followUp string
	runErr   *AGUIRunError
}

// Observe folds one event into the accumulator.
func (a *AGUIAccumulator) Observe(ev AGUIEvent) {
	switch ev.Type {
	case "RunStarted":
		a.runID = stringField(ev.Data, "run_id")
	case "TextMessageContent":
		a.answer.WriteString(stringField(ev.Data, "delta"))
	case "RunError":
		a.runErr = &AGUIRunError{
			Code:    stringField(ev.Data, "code"),
			Message: stringField(ev.Data, "message"),
		}
	case "Custom":
		if stringField(ev.Data, "name") == "phyto.follow_up" {
			if v, ok := ev.Data["value"]; ok {
				a.followUp = string(v)
			}
		}
	}
}

func (a *AGUIAccumulator) AnswerText() string   { return a.answer.String() }
func (a *AGUIAccumulator) RunID() string        { return a.runID }
func (a *AGUIAccumulator) FollowUpJSON() string { return a.followUp }
func (a *AGUIAccumulator) Err() *AGUIRunError   { return a.runErr }

// stringField pulls a string value out of a decoded data object, tolerating
// absence and non-string JSON (returns "").
func stringField(m map[string]json.RawMessage, key string) string {
	raw, ok := m[key]
	if !ok {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) != nil {
		return ""
	}
	return s
}
