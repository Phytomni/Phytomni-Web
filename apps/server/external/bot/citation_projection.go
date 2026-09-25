package bot

import (
	"encoding/json"

	"phytomni-server/common/citation"
	"phytomni-server/common/document_format/mdoc"
)

// NormalizeCitedAnswer normalizes references and separates their exactly owned body section.
// Plain Markdown and unrelated answer envelopes pass through unchanged.
func NormalizeCitedAnswer(answer string) (string, error) {
	var envelope map[string]json.RawMessage
	if json.Unmarshal([]byte(answer), &envelope) != nil || envelope == nil {
		return answer, nil
	}
	references, exists := envelope["doc_list"]
	if !exists {
		return answer, nil
	}
	normalized, err := citation.NormalizeRows(references)
	if err != nil {
		return "", err
	}
	envelope["doc_list"] = normalized
	if err := separateCitedBody(envelope, "content", references); err != nil {
		return "", err
	}
	encoded, err := json.Marshal(envelope)
	if err != nil {
		return "", citation.ErrInvalidReferences
	}
	return string(encoded), nil
}

func separateCitedBody(envelope map[string]json.RawMessage, key string, references json.RawMessage) error {
	var content string
	if json.Unmarshal(envelope[key], &content) != nil {
		return nil
	}
	rows, err := citation.DecodeRows(references)
	if err != nil {
		return err
	}
	body, matched, err := mdoc.SplitOwnedReferences(content, rows)
	if err != nil {
		return err
	}
	if matched {
		envelope[key], err = json.Marshal(body)
	}
	return err
}
