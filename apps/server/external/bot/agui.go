package bot

import (
	"bytes"
	"encoding/json"
	"errors"
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

var (
	ErrAGUIContextStageMalformed     = errors.New("malformed AG-UI context stage")
	ErrAGUIContextStageTurnMismatch  = errors.New("AG-UI context stage turn mismatch")
	ErrAGUIContextStageConflict      = errors.New("conflicting AG-UI context stage")
	ErrAGUIContextStageAfterFinished = errors.New("AG-UI context stage after RunFinished")
)

// ParseAGUIFrame decodes one SSE frame (the bytes between blank-line
// separators) into an AGUIEvent. It returns ok=false for blank frames,
// comment lines (": ..."), and the legacy "[DONE]" sentinel — none of which
// are AG-UI events. The event type is taken from the data JSON "type" field
// (authoritative), falling back to the "event:" line.
func ParseAGUIFrame(frame []byte) (AGUIEvent, bool) {
	var eventLine string
	var dataLines []string
	for _, raw := range bytes.Split(frame, []byte("\n")) {
		line := strings.TrimRight(string(raw), "\r")
		switch {
		case strings.HasPrefix(line, "event:"):
			eventLine = strings.TrimSpace(line[len("event:"):])
		case strings.HasPrefix(line, "data:"):
			// SSE joins consecutive data: lines with "\n"; strip only the
			// single optional leading space after the colon, never inner
			// whitespace (it may be significant JSON string content).
			dataLines = append(dataLines, strings.TrimPrefix(line[len("data:"):], " "))
		}
	}
	dataLine := strings.TrimSpace(strings.Join(dataLines, "\n"))
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
// Bot run id, follow-up questions JSON, cited phyto.references, and any RunError).
type AGUIAccumulator struct {
	answer         strings.Builder
	runID          string
	followUp       string
	references     json.RawMessage
	expectedTurnID string
	contextStage   *ContextStageMetadata
	protocolErr    error
	runErr         *AGUIRunError
	runFinished    bool
}

// NewAGUIAccumulator creates an accumulator that validates staged context
// metadata against the expected V1 turn. An empty turn preserves V0 behavior.
func NewAGUIAccumulator(expectedTurnID string) *AGUIAccumulator {
	return &AGUIAccumulator{expectedTurnID: expectedTurnID}
}

// Observe folds one event into the accumulator.
func (a *AGUIAccumulator) Observe(ev AGUIEvent) {
	switch ev.Type {
	case "RunStarted":
		// Guard against a later RunStarted (retry / duplicate frame) with a
		// blank run_id clobbering an already-captured registry id — a blank
		// bot_run_id would strand the persisted row out of the GA cron's
		// WHERE status='RUNNING' reconcile set (same zero-value-clobber
		// invariant SyncBotRuns / QueryAnalystUpdateLog already enforce).
		if id := stringField(ev.Data, "run_id"); id != "" {
			a.runID = id
		}
	case "TextMessageContent":
		a.answer.WriteString(stringField(ev.Data, "delta"))
	case "RunError":
		a.runErr = &AGUIRunError{
			Code:    stringField(ev.Data, "code"),
			Message: stringField(ev.Data, "message"),
		}
	case "RunFinished":
		a.runFinished = true
	case "Custom":
		switch stringField(ev.Data, "name") {
		case "phyto.follow_up":
			if v, ok := ev.Data["value"]; ok {
				a.followUp = string(v)
			}
		case "phyto.references":
			a.observeReferences(ev.Data["value"])
		case "phyto.context_staged":
			a.observeContextStage(ev.Data["value"])
		}
	}
}

func (a *AGUIAccumulator) observeReferences(raw json.RawMessage) {
	if len(raw) == 0 {
		return
	}
	var envelope struct {
		DocList []json.RawMessage `json:"doc_list"`
	}
	if json.Unmarshal(raw, &envelope) != nil {
		return
	}
	kept := make([]json.RawMessage, 0, len(envelope.DocList))
	for _, item := range envelope.DocList {
		trimmed := bytes.TrimSpace(item)
		if len(trimmed) == 0 || trimmed[0] != '{' {
			continue
		}
		var obj map[string]json.RawMessage
		if json.Unmarshal(item, &obj) != nil || obj == nil {
			continue
		}
		kept = append(kept, append(json.RawMessage(nil), item...))
	}
	if len(kept) == 0 {
		return
	}
	encoded, err := json.Marshal(kept)
	if err != nil {
		return
	}
	a.references = encoded
}

func (a *AGUIAccumulator) observeContextStage(raw json.RawMessage) {
	if a.protocolErr != nil {
		return
	}
	if a.runFinished {
		a.protocolErr = ErrAGUIContextStageAfterFinished
		return
	}
	var stage ContextStageMetadata
	if len(raw) == 0 || json.Unmarshal(raw, &stage) != nil {
		a.protocolErr = ErrAGUIContextStageMalformed
		return
	}
	if a.expectedTurnID != "" && stage.TurnID != a.expectedTurnID {
		a.protocolErr = ErrAGUIContextStageTurnMismatch
		return
	}
	if a.contextStage == nil {
		a.contextStage = &stage
		return
	}
	if *a.contextStage != stage {
		a.protocolErr = ErrAGUIContextStageConflict
	}
}

func (a *AGUIAccumulator) AnswerText() string   { return a.answer.String() }
func (a *AGUIAccumulator) RunID() string        { return a.runID }
func (a *AGUIAccumulator) FollowUpJSON() string { return a.followUp }

// CitedFormatted is the bibliographic envelope ShapeAnswer needs for cited
// stream agents. Nil means the stream never yielded usable phyto.references.
func (a *AGUIAccumulator) CitedFormatted() *Formatted {
	if len(a.references) == 0 {
		return nil
	}
	return &Formatted{References: append(json.RawMessage(nil), a.references...)}
}
func (a *AGUIAccumulator) ContextStage() *ContextStageMetadata {
	if a.contextStage == nil {
		return nil
	}
	stage := *a.contextStage
	return &stage
}
func (a *AGUIAccumulator) ProtocolErr() error { return a.protocolErr }
func (a *AGUIAccumulator) Finished() bool     { return a.runFinished }
func (a *AGUIAccumulator) Err() *AGUIRunError { return a.runErr }

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
