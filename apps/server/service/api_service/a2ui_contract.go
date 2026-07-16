package api_service

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime"
	"strings"
	"unicode/utf8"
)

const a2uiIdentifierMaxChars = 256

const (
	a2uiFormFieldMaxCount = 20
	a2uiFormValueMaxChars = 4096
	a2uiChoiceMaxCount    = 100
	a2uiLabelMaxChars     = 256
	a2uiTextMaxChars      = 4096
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

// A2uiSurfacePropsDTO is the bounded public props union exposed by QueryData.
// The concrete values are intentionally finite structs; arbitrary provider JSON
// never crosses the HTTP boundary.
type A2uiSurfacePropsDTO interface {
	isA2uiSurfaceProps()
}

type A2uiConfirmPropsDTO struct {
	Title        string `json:"title"`
	Body         string `json:"body,omitempty"`
	ConfirmLabel string `json:"confirm_label"`
	CancelLabel  string `json:"cancel_label"`
}

func (A2uiConfirmPropsDTO) isA2uiSurfaceProps() {}

type A2uiFormFieldDTO struct {
	Name     string        `json:"name"`
	Label    string        `json:"label"`
	Type     string        `json:"type"`
	Required bool          `json:"required"`
	Options  []interface{} `json:"options,omitempty"`
}

type A2uiFormPropsDTO struct {
	Title  string             `json:"title"`
	Fields []A2uiFormFieldDTO `json:"fields"`
}

func (A2uiFormPropsDTO) isA2uiSurfaceProps() {}

type A2uiChoiceOptionDTO struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type A2uiChoicePropsDTO struct {
	Title    string                `json:"title"`
	Options  []A2uiChoiceOptionDTO `json:"options"`
	Multiple bool                  `json:"multiple"`
}

func (A2uiChoicePropsDTO) isA2uiSurfaceProps() {}

// A2uiSurfaceDTO is the only A2UI shape that blocking Query exposes. It is a
// closed union of confirm/form/choice props with the same limits used by the
// action and browser decoders.
type A2uiSurfaceDTO struct {
	CatalogVersion string              `json:"catalog_version"`
	SurfaceID      string              `json:"surface_id"`
	Widget         string              `json:"widget"`
	Props          A2uiSurfacePropsDTO `json:"props"`
}

// DecodeA2uiSurface strictly decodes one open A2UI surface. Duplicate keys,
// unsupported widgets, unknown shape fields, and over-limit values fail closed.
func DecodeA2uiSurface(raw json.RawMessage) (*A2uiSurfaceDTO, error) {
	entries, ok := decodeA2uiObjectEntries(raw)
	if !ok {
		return nil, errA2uiSurface
	}
	if !a2uiEntriesAllowed(entries, "catalog_version", "surface_id", "widget", "props") {
		return nil, errA2uiSurface
	}
	fields := a2uiEntriesMap(entries)
	catalog, ok := decodeA2uiCatalog(fields["catalog_version"])
	if !ok {
		return nil, errA2uiSurface
	}
	surfaceID, ok := decodeA2uiIdentifier(fields["surface_id"])
	if !ok {
		return nil, errA2uiSurface
	}
	widget, ok := decodeA2uiStringValue(fields["widget"])
	if !ok || !isA2uiWidget(widget) {
		return nil, errA2uiSurface
	}
	props, ok := decodeA2uiSurfaceProps(widget, fields["props"])
	if !ok {
		return nil, errA2uiSurface
	}
	return &A2uiSurfaceDTO{
		CatalogVersion: catalog,
		SurfaceID:      surfaceID,
		Widget:         widget,
		Props:          props,
	}, nil
}

// DecodeA2uiSurfaceDTO is a descriptive alias for callers that prefer the
// public DTO name in their decoder code.
func DecodeA2uiSurfaceDTO(raw json.RawMessage) (*A2uiSurfaceDTO, error) {
	return DecodeA2uiSurface(raw)
}

var errA2uiSurface = errors.New("invalid a2ui surface")

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

func a2uiEntriesMap(entries []a2uiObjectEntry) map[string]json.RawMessage {
	fields := make(map[string]json.RawMessage, len(entries))
	for _, entry := range entries {
		fields[entry.key] = entry.value
	}
	return fields
}

func a2uiEntriesAllowed(entries []a2uiObjectEntry, allowed ...string) bool {
	set := make(map[string]struct{}, len(allowed))
	for _, key := range allowed {
		set[key] = struct{}{}
	}
	for _, entry := range entries {
		if _, ok := set[entry.key]; !ok {
			return false
		}
	}
	return true
}

func decodeA2uiIdentifier(raw json.RawMessage) (string, bool) {
	value, ok := decodeA2uiStringValue(raw)
	if !ok || value == "" || strings.TrimSpace(value) != value || !utf8.ValidString(value) {
		return "", false
	}
	if utf8.RuneCountInString(value) > a2uiIdentifierMaxChars {
		return "", false
	}
	return value, true
}

func decodeA2uiLabel(raw json.RawMessage, required bool) (string, bool) {
	value, ok := decodeA2uiStringValue(raw)
	if !ok || strings.TrimSpace(value) != value || !utf8.ValidString(value) {
		return "", false
	}
	if required && value == "" {
		return "", false
	}
	if utf8.RuneCountInString(value) > a2uiLabelMaxChars {
		return "", false
	}
	return value, true
}

func decodeA2uiText(raw json.RawMessage, required bool) (string, bool) {
	value, ok := decodeA2uiStringValue(raw)
	if !ok || strings.TrimSpace(value) != value || !utf8.ValidString(value) {
		return "", false
	}
	if required && value == "" {
		return "", false
	}
	if utf8.RuneCountInString(value) > a2uiTextMaxChars {
		return "", false
	}
	return value, true
}

func decodeA2uiCatalog(raw json.RawMessage) (string, bool) {
	value, ok := decodeA2uiIdentifier(raw)
	if !ok {
		return "", false
	}
	if !strings.HasPrefix(value, "v1") && !strings.HasPrefix(value, "1") {
		return "", false
	}
	if len(value) > 2 && value[0] == 'v' && value[1] == '1' && value[2] != '.' {
		return "", false
	}
	if len(value) > 1 && value[0] == '1' && value[1] != '.' {
		return "", false
	}
	return value, true
}

func decodeA2uiSurfaceProps(widget string, raw json.RawMessage) (A2uiSurfacePropsDTO, bool) {
	entries, ok := decodeA2uiObjectEntries(raw)
	if !ok {
		return nil, false
	}
	fields := a2uiEntriesMap(entries)
	switch widget {
	case "confirm":
		if !a2uiEntriesAllowed(entries, "title", "body", "confirm_label", "cancel_label") || len(entries) < 3 {
			return nil, false
		}
		title, titleOK := decodeA2uiLabel(fields["title"], true)
		confirmLabel, confirmOK := decodeA2uiLabel(fields["confirm_label"], true)
		cancelLabel, cancelOK := decodeA2uiLabel(fields["cancel_label"], true)
		if !titleOK || !confirmOK || !cancelOK {
			return nil, false
		}
		body := ""
		if rawBody, exists := fields["body"]; exists {
			var bodyOK bool
			body, bodyOK = decodeA2uiText(rawBody, false)
			if !bodyOK {
				return nil, false
			}
		}
		return A2uiConfirmPropsDTO{
			Title: title, Body: body, ConfirmLabel: confirmLabel, CancelLabel: cancelLabel,
		}, true
	case "form":
		if !a2uiEntriesAllowed(entries, "title", "fields") || len(entries) != 2 {
			return nil, false
		}
		title, titleOK := decodeA2uiLabel(fields["title"], true)
		formFields, fieldsOK := decodeA2uiFormFields(fields["fields"])
		if !titleOK || !fieldsOK {
			return nil, false
		}
		return A2uiFormPropsDTO{Title: title, Fields: formFields}, true
	case "choice":
		if !a2uiEntriesAllowed(entries, "title", "options", "multiple") || len(entries) != 3 {
			return nil, false
		}
		title, titleOK := decodeA2uiLabel(fields["title"], true)
		options, optionsOK := decodeA2uiChoiceOptions(fields["options"])
		multiple, multipleOK := decodeA2uiBool(fields["multiple"])
		if !titleOK || !optionsOK || !multipleOK {
			return nil, false
		}
		return A2uiChoicePropsDTO{Title: title, Options: options, Multiple: multiple}, true
	default:
		return nil, false
	}
}

func decodeA2uiFormFields(raw json.RawMessage) ([]A2uiFormFieldDTO, bool) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	opening, err := decoder.Token()
	if err != nil {
		return nil, false
	}
	if delim, ok := opening.(json.Delim); !ok || delim != '[' {
		return nil, false
	}
	fields := make([]A2uiFormFieldDTO, 0)
	seenNames := make(map[string]struct{})
	for decoder.More() {
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return nil, false
		}
		entries, ok := decodeA2uiObjectEntries(value)
		if !ok || !a2uiEntriesAllowed(entries, "name", "label", "type", "required", "options") {
			return nil, false
		}
		if len(entries) < 4 {
			return nil, false
		}
		object := a2uiEntriesMap(entries)
		name, nameOK := decodeA2uiIdentifier(object["name"])
		label, labelOK := decodeA2uiLabel(object["label"], true)
		fieldType, typeOK := decodeA2uiStringValue(object["type"])
		required, requiredOK := decodeA2uiBool(object["required"])
		if !nameOK || !labelOK || !typeOK || !requiredOK || (fieldType != "text" && fieldType != "number" && fieldType != "select") {
			return nil, false
		}
		if !validA2uiFieldName(name) {
			return nil, false
		}
		if _, duplicate := seenNames[name]; duplicate {
			return nil, false
		}
		seenNames[name] = struct{}{}
		optionsRaw, hasOptions := object["options"]
		var options []interface{}
		if hasOptions {
			var optionsOK bool
			options, optionsOK = decodeA2uiScalarArray(optionsRaw)
			if !optionsOK {
				return nil, false
			}
		}
		if fieldType == "select" && !hasOptions {
			return nil, false
		}
		if fieldType != "select" && hasOptions {
			return nil, false
		}
		fields = append(fields, A2uiFormFieldDTO{
			Name: name, Label: label, Type: fieldType, Required: required, Options: options,
		})
		if len(fields) > a2uiFormFieldMaxCount {
			return nil, false
		}
	}
	closing, err := decoder.Token()
	if err != nil {
		return nil, false
	}
	if delim, ok := closing.(json.Delim); !ok || delim != ']' {
		return nil, false
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); err != io.EOF {
		return nil, false
	}
	return fields, true
}

func decodeA2uiChoiceOptions(raw json.RawMessage) ([]A2uiChoiceOptionDTO, bool) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	opening, err := decoder.Token()
	if err != nil {
		return nil, false
	}
	if delim, ok := opening.(json.Delim); !ok || delim != '[' {
		return nil, false
	}
	options := make([]A2uiChoiceOptionDTO, 0)
	seenIDs := make(map[string]struct{})
	for decoder.More() {
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return nil, false
		}
		entries, ok := decodeA2uiObjectEntries(value)
		if !ok || len(entries) != 2 || !a2uiEntriesAllowed(entries, "id", "label") {
			return nil, false
		}
		object := a2uiEntriesMap(entries)
		id, idOK := decodeA2uiIdentifier(object["id"])
		label, labelOK := decodeA2uiLabel(object["label"], true)
		if !idOK || !labelOK {
			return nil, false
		}
		if _, duplicate := seenIDs[id]; duplicate {
			return nil, false
		}
		seenIDs[id] = struct{}{}
		options = append(options, A2uiChoiceOptionDTO{ID: id, Label: label})
		if len(options) > a2uiChoiceMaxCount {
			return nil, false
		}
	}
	closing, err := decoder.Token()
	if err != nil {
		return nil, false
	}
	if delim, ok := closing.(json.Delim); !ok || delim != ']' {
		return nil, false
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); err != io.EOF {
		return nil, false
	}
	return options, true
}

func decodeA2uiScalarArray(raw json.RawMessage) ([]interface{}, bool) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	opening, err := decoder.Token()
	if err != nil {
		return nil, false
	}
	if delim, ok := opening.(json.Delim); !ok || delim != '[' {
		return nil, false
	}
	values := make([]interface{}, 0)
	for decoder.More() {
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return nil, false
		}
		scalar, ok := decodeA2uiScalar(value)
		if !ok {
			return nil, false
		}
		values = append(values, scalar)
		if len(values) > a2uiChoiceMaxCount {
			return nil, false
		}
	}
	closing, err := decoder.Token()
	if err != nil {
		return nil, false
	}
	if delim, ok := closing.(json.Delim); !ok || delim != ']' {
		return nil, false
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); err != io.EOF {
		return nil, false
	}
	return values, true
}

func decodeA2uiScalar(raw json.RawMessage) (interface{}, bool) {
	if value, ok := decodeA2uiText(raw, true); ok {
		return value, true
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value interface{}
	if err := decoder.Decode(&value); err != nil {
		return nil, false
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); err != io.EOF {
		return nil, false
	}
	number, ok := value.(json.Number)
	if !ok {
		return nil, false
	}
	parsed, err := number.Float64()
	if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) {
		return nil, false
	}
	return number, true
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

func validateA2uiUpstreamResponse(status int, contentType string, raw []byte) error {
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil || !isA2uiJSONMediaType(mediaType) {
		return ErrA2uiUpstreamProtocol
	}

	entries, ok := decodeA2uiObjectEntries(raw)
	if !ok {
		return ErrA2uiUpstreamProtocol
	}
	if status < 200 || status >= 300 {
		return nil
	}

	fields := make(map[string]json.RawMessage, len(entries))
	for _, entry := range entries {
		fields[entry.key] = entry.value
	}
	statusValue, ok := decodeA2uiStringValue(fields["status"])
	if !ok {
		return ErrA2uiUpstreamProtocol
	}

	switch statusValue {
	case "succeeded":
		if _, hasInterrupt := fields["interrupt"]; hasInterrupt || !hasA2uiObjectField(fields["result"], "a2ui") {
			return ErrA2uiUpstreamProtocol
		}
	case "input_required":
		if _, hasResult := fields["result"]; hasResult || !hasA2uiNestedObjectField(fields["interrupt"], "draft", "a2ui") {
			return ErrA2uiUpstreamProtocol
		}
	default:
		return ErrA2uiUpstreamProtocol
	}
	return nil
}

func isA2uiJSONMediaType(mediaType string) bool {
	return mediaType == "application/json" ||
		strings.HasSuffix(mediaType, "+json")
}

func hasA2uiObjectField(raw json.RawMessage, field string) bool {
	if !isA2uiJSONObject(raw) {
		return false
	}
	entries, ok := decodeA2uiObjectEntries(raw)
	if !ok {
		return false
	}
	for _, entry := range entries {
		if entry.key == field && isA2uiJSONObject(entry.value) {
			return true
		}
	}
	return false
}

func hasA2uiNestedObjectField(raw json.RawMessage, outerField, innerField string) bool {
	if !isA2uiJSONObject(raw) {
		return false
	}
	entries, ok := decodeA2uiObjectEntries(raw)
	if !ok {
		return false
	}
	for _, entry := range entries {
		if entry.key == outerField {
			return hasA2uiObjectField(entry.value, innerField)
		}
	}
	return false
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
