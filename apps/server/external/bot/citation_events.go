package bot

import (
	"bytes"
	"encoding/json"

	"phytomni-server/common/citation"
)

// NormalizeReferenceFrame rewrites only the known phyto.references payload.
// Non-data lines and the last data line's ending retain their original bytes.
func NormalizeReferenceFrame(frame []byte) ([]byte, error) {
	event, ok := ParseAGUIFrame(frame)
	if !ok || event.Type != "Custom" || stringField(event.Data, "name") != "phyto.references" {
		return frame, nil
	}
	value, changed, err := normalizeReferenceField(event.Data["value"], "doc_list")
	if err != nil {
		return nil, err
	}
	if !changed {
		return frame, nil
	}
	event.Data["value"] = value
	data, err := json.Marshal(event.Data)
	if err != nil {
		return nil, citation.ErrInvalidReferences
	}
	lines := bytes.SplitAfter(frame, []byte("\n"))
	lastData := -1
	for i, line := range lines {
		if bytes.HasPrefix(line, []byte("data:")) {
			lastData = i
		}
	}
	var out bytes.Buffer
	for i, line := range lines {
		if !bytes.HasPrefix(line, []byte("data:")) {
			out.Write(line)
			continue
		}
		if i != lastData {
			continue
		}
		out.WriteString("data: ")
		out.Write(data)
		switch {
		case bytes.HasSuffix(line, []byte("\r\n")):
			out.WriteString("\r\n")
		case bytes.HasSuffix(line, []byte("\n")):
			out.WriteByte('\n')
		case bytes.HasSuffix(line, []byte("\r")):
			out.WriteByte('\r')
		}
	}
	return out.Bytes(), nil
}

// NormalizeActionReferences preserves the terminal action envelope and widgets,
// normalizing references and separating only their exactly owned bibliography.
func NormalizeActionReferences(body json.RawMessage) (json.RawMessage, error) {
	var envelope map[string]json.RawMessage
	if json.Unmarshal(body, &envelope) != nil || envelope == nil {
		return nil, citation.ErrInvalidReferences
	}
	var result map[string]json.RawMessage
	if raw := envelope["result"]; len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return body, nil
	} else if json.Unmarshal(raw, &result) != nil || result == nil {
		return nil, citation.ErrInvalidReferences
	}
	formatted, changed, err := normalizeReferenceField(result["formatted"], "references")
	if err != nil {
		return nil, err
	}
	if !changed {
		return body, nil
	}
	result["formatted"] = formatted
	envelope["result"], err = json.Marshal(result)
	if err != nil {
		return nil, citation.ErrInvalidReferences
	}
	return json.Marshal(envelope)
}

func normalizeReferenceField(raw json.RawMessage, key string) (json.RawMessage, bool, error) {
	if len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return raw, false, nil
	}
	var envelope map[string]json.RawMessage
	if json.Unmarshal(raw, &envelope) != nil || envelope == nil {
		return nil, false, citation.ErrInvalidReferences
	}
	references, exists := envelope[key]
	if !exists {
		return raw, false, nil
	}
	normalized, err := citation.NormalizeRows(references)
	if err != nil {
		return nil, false, err
	}
	envelope[key] = normalized
	if key == "references" {
		if err := separateCitedBody(envelope, "answer", references); err != nil {
			return nil, false, err
		}
	}
	encoded, err := json.Marshal(envelope)
	if err != nil {
		return nil, false, citation.ErrInvalidReferences
	}
	return encoded, true, nil
}
