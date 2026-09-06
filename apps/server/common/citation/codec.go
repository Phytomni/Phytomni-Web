package citation

import (
	"bytes"
	"encoding/json"
	"errors"
)

var ErrInvalidReferences = errors.New("invalid reference payload")

type Row struct {
	// FileID retains the existing source identity only for internal mapping.
	FileID   json.RawMessage `json:"-"`
	Source   Source
	Citation Presentation
}

// DecodeRows decodes members independently so malformed sources keep their slot.
func DecodeRows(raw json.RawMessage) ([]Row, error) {
	raw = bytes.TrimSpace(raw)
	rows := []Row{}
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return rows, nil
	}
	var members []json.RawMessage
	if raw[0] != '[' || json.Unmarshal(raw, &members) != nil {
		return nil, ErrInvalidReferences
	}
	for _, member := range members {
		var fields map[string]json.RawMessage
		if json.Unmarshal(member, &fields) != nil {
			fields = nil
		}
		source := Source{}
		for key, target := range sourceFields(&source) {
			*target = bibliographicScalar(fields[key])
		}
		rows = append(rows, Row{FileID: referenceFileID(fields["file_id"]), Source: source, Citation: Format(source)})
	}
	return rows, nil
}

// NormalizeRows publishes only bibliographic inputs and their regenerated presentation.
func NormalizeRows(raw json.RawMessage) (json.RawMessage, error) {
	rows, err := DecodeRows(raw)
	if err != nil {
		return nil, err
	}
	public := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		fields := map[string]any{"title": row.Source.Title, "citation": row.Citation}
		for key, value := range sourceFields(&row.Source) {
			if *value != "" {
				fields[key] = *value
			}
		}
		public = append(public, fields)
	}
	encoded, err := json.Marshal(public)
	if err != nil {
		return nil, ErrInvalidReferences
	}
	return encoded, nil
}

func referenceFileID(raw json.RawMessage) json.RawMessage {
	// Members have already passed JSON decoding. Keep only string/number
	// identities, retaining escapes and numeric precision without coercion.
	if len(raw) == 0 {
		return nil
	}
	if raw[0] == '"' || raw[0] == '-' || raw[0] >= '0' && raw[0] <= '9' {
		return append(json.RawMessage(nil), raw...)
	}
	return nil
}

func sourceFields(source *Source) map[string]*string {
	return map[string]*string{
		"title": &source.Title, "au": &source.AU, "ti": &source.TI,
		"so": &source.SO, "vl": &source.VL, "bp": &source.BP, "ep": &source.EP,
		"ar": &source.AR, "py": &source.PY, "di": &source.DI, "dl": &source.DL,
		"pm": &source.PM, "formatted_citation": &source.Formatted,
	}
}

func bibliographicScalar(raw json.RawMessage) string {
	var value string
	if json.Unmarshal(raw, &value) == nil {
		return value
	}
	var number json.Number
	if len(raw) > 0 && raw[0] != '"' && json.Unmarshal(raw, &number) == nil {
		return number.String()
	}
	return ""
}
