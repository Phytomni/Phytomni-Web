package api_service

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"
)

const a2uiIdentifierMaxChars = 256

const (
	a2uiFormFieldMaxCount = 20
	a2uiFormValueMaxChars = 4096
	a2uiChoiceMaxCount    = 100
)

var errA2uiPayload = fmt.Errorf("%w: invalid payload", ErrA2uiActionBadRequest)

// A2uiActionEnvelope is the single Web-side representation of an action
// submitted by an interactive A2UI surface. Payload is retained as raw JSON
// so widget-specific validation can run without re-encoding the request.
type A2uiActionEnvelope struct {
	SurfaceID string          `json:"surface_id"`
	Widget    string          `json:"widget"`
	ActionID  string          `json:"action_id"`
	RunID     string          `json:"run_id"`
	Payload   json.RawMessage `json:"payload"`
}

var errA2uiEnvelope = errors.New("invalid a2ui action envelope")

// decodeA2uiActionEnvelope parses exactly one strict A2UI action envelope.
// The top-level object is read token-by-token so duplicate keys cannot be
// silently overwritten by encoding/json. The decoder also rejects unknown
// fields and any second JSON value after the envelope.
func decodeA2uiActionEnvelope(raw []byte) (A2uiActionEnvelope, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()

	opening, err := decoder.Token()
	if err != nil {
		return A2uiActionEnvelope{}, errA2uiEnvelope
	}
	if delim, ok := opening.(json.Delim); !ok || delim != '{' {
		return A2uiActionEnvelope{}, errA2uiEnvelope
	}

	var envelope A2uiActionEnvelope
	seen := make(map[string]struct{}, 5)
	var hasSurfaceID, hasWidget, hasActionID, hasRunID, hasPayload bool

	for decoder.More() {
		keyToken, err := decoder.Token()
		if err != nil {
			return A2uiActionEnvelope{}, errA2uiEnvelope
		}
		key, ok := keyToken.(string)
		if !ok {
			return A2uiActionEnvelope{}, errA2uiEnvelope
		}
		if _, duplicate := seen[key]; duplicate {
			return A2uiActionEnvelope{}, errA2uiEnvelope
		}
		seen[key] = struct{}{}

		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return A2uiActionEnvelope{}, errA2uiEnvelope
		}

		switch key {
		case "surface_id":
			hasSurfaceID = true
			if envelope.SurfaceID, ok = decodeA2uiString(value); !ok {
				return A2uiActionEnvelope{}, errA2uiEnvelope
			}
		case "widget":
			hasWidget = true
			if envelope.Widget, ok = decodeA2uiString(value); !ok || !isA2uiWidget(envelope.Widget) {
				return A2uiActionEnvelope{}, errA2uiEnvelope
			}
		case "action_id":
			hasActionID = true
			if envelope.ActionID, ok = decodeA2uiString(value); !ok {
				return A2uiActionEnvelope{}, errA2uiEnvelope
			}
		case "run_id":
			hasRunID = true
			if envelope.RunID, ok = decodeA2uiString(value); !ok {
				return A2uiActionEnvelope{}, errA2uiEnvelope
			}
		case "payload":
			hasPayload = true
			if !isA2uiJSONObject(value) {
				return A2uiActionEnvelope{}, errA2uiEnvelope
			}
			envelope.Payload = append(json.RawMessage(nil), value...)
		default:
			return A2uiActionEnvelope{}, errA2uiEnvelope
		}
	}

	closing, err := decoder.Token()
	if err != nil {
		return A2uiActionEnvelope{}, errA2uiEnvelope
	}
	if delim, ok := closing.(json.Delim); !ok || delim != '}' {
		return A2uiActionEnvelope{}, errA2uiEnvelope
	}

	// Decoder.Token stops after the first complete JSON value. Decode once more
	// to distinguish trailing whitespace (EOF) from a second JSON value or
	// malformed trailing bytes.
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); err != io.EOF {
		return A2uiActionEnvelope{}, errA2uiEnvelope
	}

	if !hasSurfaceID || !hasWidget || !hasActionID || !hasRunID || !hasPayload {
		return A2uiActionEnvelope{}, errA2uiEnvelope
	}
	return envelope, nil
}

func decodeA2uiString(raw json.RawMessage) (string, bool) {
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", false
	}
	if value == "" || strings.TrimSpace(value) != value || utf8.RuneCountInString(value) > a2uiIdentifierMaxChars {
		return "", false
	}
	return value, true
}

func isA2uiWidget(widget string) bool {
	switch widget {
	case "confirm", "form", "choice":
		return true
	default:
		return false
	}
}

func isA2uiJSONObject(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) < 2 || trimmed[0] != '{' || trimmed[len(trimmed)-1] != '}' {
		return false
	}
	var object map[string]json.RawMessage
	return json.Unmarshal(trimmed, &object) == nil && object != nil
}

type a2uiObjectEntry struct {
	key   string
	value json.RawMessage
}

// decodeA2uiObjectEntries decodes exactly one JSON object while retaining key
// order and rejecting duplicate keys. Map unmarshalling is deliberately not
// used here because it silently overwrites duplicate submitted values.
func decodeA2uiObjectEntries(raw json.RawMessage) ([]a2uiObjectEntry, bool) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()

	opening, err := decoder.Token()
	if err != nil {
		return nil, false
	}
	if delim, ok := opening.(json.Delim); !ok || delim != '{' {
		return nil, false
	}

	entries := make([]a2uiObjectEntry, 0, 4)
	seen := make(map[string]struct{})
	for decoder.More() {
		keyToken, err := decoder.Token()
		if err != nil {
			return nil, false
		}
		key, ok := keyToken.(string)
		if !ok {
			return nil, false
		}
		if _, duplicate := seen[key]; duplicate {
			return nil, false
		}
		seen[key] = struct{}{}

		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return nil, false
		}
		entries = append(entries, a2uiObjectEntry{key: key, value: value})
	}

	closing, err := decoder.Token()
	if err != nil {
		return nil, false
	}
	if delim, ok := closing.(json.Delim); !ok || delim != '}' {
		return nil, false
	}

	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); err != io.EOF {
		return nil, false
	}
	return entries, true
}

func decodeA2uiBool(raw json.RawMessage) (bool, bool) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	token, err := decoder.Token()
	if err != nil {
		return false, false
	}
	value, ok := token.(bool)
	if !ok {
		return false, false
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); err != io.EOF {
		return false, false
	}
	return value, true
}

func decodeA2uiStringValue(raw json.RawMessage) (string, bool) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	token, err := decoder.Token()
	if err != nil {
		return "", false
	}
	value, ok := token.(string)
	if !ok {
		return "", false
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); err != io.EOF {
		return "", false
	}
	return value, true
}

func isA2uiJSONNumber(raw json.RawMessage) bool {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	token, err := decoder.Token()
	if err != nil {
		return false
	}
	if _, ok := token.(json.Number); !ok {
		return false
	}
	var trailing json.RawMessage
	return decoder.Decode(&trailing) == io.EOF
}

func validateA2uiPayload(widget string, raw json.RawMessage) error {
	var valid bool
	switch widget {
	case "confirm":
		valid = validateConfirmPayload(raw) == nil
	case "form":
		valid = validateFormPayload(raw) == nil
	case "choice":
		valid = validateChoicePayload(raw) == nil
	default:
		valid = false
	}
	if !valid {
		return errA2uiPayload
	}
	return nil
}

func validateConfirmPayload(raw json.RawMessage) error {
	entries, ok := decodeA2uiObjectEntries(raw)
	if !ok || len(entries) != 1 || entries[0].key != "accepted" {
		return errA2uiPayload
	}
	if _, ok := decodeA2uiBool(entries[0].value); !ok {
		return errA2uiPayload
	}
	return nil
}

func validateFormPayload(raw json.RawMessage) error {
	entries, ok := decodeA2uiObjectEntries(raw)
	if !ok || len(entries) != 1 {
		return errA2uiPayload
	}
	switch entries[0].key {
	case "cancelled":
		cancelled, ok := decodeA2uiBool(entries[0].value)
		if !ok || !cancelled {
			return errA2uiPayload
		}
		return nil
	case "fields":
		return validateA2uiFormFields(entries[0].value)
	default:
		return errA2uiPayload
	}
}

func validateA2uiFormFields(raw json.RawMessage) error {
	entries, ok := decodeA2uiObjectEntries(raw)
	if !ok || len(entries) > a2uiFormFieldMaxCount {
		return errA2uiPayload
	}
	for _, entry := range entries {
		if !validA2uiFieldName(entry.key) {
			return errA2uiPayload
		}
		if value, ok := decodeA2uiStringValue(entry.value); ok {
			if utf8.RuneCountInString(value) > a2uiFormValueMaxChars {
				return errA2uiPayload
			}
			continue
		}
		if !isA2uiJSONNumber(entry.value) {
			return errA2uiPayload
		}
	}
	return nil
}

func validA2uiFieldName(name string) bool {
	if name == "" || !utf8.ValidString(name) || utf8.RuneCountInString(name) > a2uiIdentifierMaxChars {
		return false
	}
	switch name {
	case "__proto__", "prototype", "constructor":
		return false
	default:
		return true
	}
}

func validateChoicePayload(raw json.RawMessage) error {
	entries, ok := decodeA2uiObjectEntries(raw)
	if !ok || len(entries) != 1 {
		return errA2uiPayload
	}
	switch entries[0].key {
	case "cancelled":
		cancelled, ok := decodeA2uiBool(entries[0].value)
		if !ok || !cancelled {
			return errA2uiPayload
		}
		return nil
	case "selected":
		if selected, ok := decodeA2uiStringValue(entries[0].value); ok {
			if !validA2uiChoiceValue(selected) {
				return errA2uiPayload
			}
			return nil
		}
		return validateA2uiChoiceArray(entries[0].value)
	default:
		return errA2uiPayload
	}
}

func validateA2uiChoiceArray(raw json.RawMessage) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	opening, err := decoder.Token()
	if err != nil {
		return errA2uiPayload
	}
	if delim, ok := opening.(json.Delim); !ok || delim != '[' {
		return errA2uiPayload
	}

	seen := make(map[string]struct{})
	count := 0
	for decoder.More() {
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return errA2uiPayload
		}
		selected, ok := decodeA2uiStringValue(value)
		if !ok || !validA2uiChoiceValue(selected) {
			return errA2uiPayload
		}
		if _, duplicate := seen[selected]; duplicate {
			return errA2uiPayload
		}
		seen[selected] = struct{}{}
		count++
		if count > a2uiChoiceMaxCount {
			return errA2uiPayload
		}
	}

	closing, err := decoder.Token()
	if err != nil {
		return errA2uiPayload
	}
	if delim, ok := closing.(json.Delim); !ok || delim != ']' || count == 0 {
		return errA2uiPayload
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); err != io.EOF {
		return errA2uiPayload
	}
	return nil
}

func validA2uiChoiceValue(value string) bool {
	return value != "" && utf8.ValidString(value) && utf8.RuneCountInString(value) <= a2uiIdentifierMaxChars
}
