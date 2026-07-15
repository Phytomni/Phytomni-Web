package api_service

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"unicode/utf8"
)

const a2uiIdentifierMaxChars = 256

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
