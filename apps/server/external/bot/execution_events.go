package bot

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"time"
)

// KnownExecutionEventKinds is the ordered V1 contract mirrored from Bot.
var KnownExecutionEventKinds = []string{
	"run.started",
	"run.accepted",
	"run.waiting_input",
	"run.resumed",
	"run.succeeded",
	"run.failed",
	"run.cancelled",
	"phase.started",
	"phase.progress",
	"phase.completed",
	"phase.failed",
	"tool.started",
	"tool.completed",
	"tool.failed",
	"todo.snapshot",
	"reasoning.summary",
	"decision.note",
	"input.required",
	"input.resolved",
	"artifact.published",
	"tracking.degraded",
}

var knownExecutionEventKinds = stringSet(KnownExecutionEventKinds)

var knownExecutionEventStatuses = stringSet([]string{
	"queued", "running", "waiting", "succeeded", "failed", "cancelled",
})

// KnownExecutionTargetKinds is the ordered target allowlist advertised to Web.
var KnownExecutionTargetKinds = []string{
	"event", "artifact", "report", "todo", "preview", "download", "trace",
}

var knownExecutionTargetKinds = stringSet(KnownExecutionTargetKinds)

var knownTodoStatuses = stringSet([]string{
	"pending", "in_progress", "completed",
})

// ExecutionEventLimitsV1 bounds public history, storage, and live delivery.
type ExecutionEventLimitsV1 struct {
	MaxEventBytes      int `json:"max_event_bytes"`
	MaxSummaryChars    int `json:"max_summary_chars"`
	MaxTodoItems       int `json:"max_todo_items"`
	DefaultPageSize    int `json:"default_page_size"`
	MaxPageSize        int `json:"max_page_size"`
	MaxEventsPerRun    int `json:"max_events_per_run"`
	MaxLiveBacklog     int `json:"max_live_backlog"`
	ProgressCoalesceMS int `json:"progress_coalesce_ms"`
}

// DefaultExecutionEventLimits mirrors Bot's V1 advertised defaults.
var DefaultExecutionEventLimits = ExecutionEventLimitsV1{
	MaxEventBytes:      16_384,
	MaxSummaryChars:    512,
	MaxTodoItems:       100,
	DefaultPageSize:    50,
	MaxPageSize:        200,
	MaxEventsPerRun:    10_000,
	MaxLiveBacklog:     1_000,
	ProgressCoalesceMS: 500,
}

var forbiddenPublicEventKeys = stringSet([]string{
	"authorization",
	"authorization_header",
	"credential",
	"credentials",
	"headers",
	"path",
	"provider_payload",
	"raw_reasoning",
	"secret",
	"storage_key",
	"system_prompt",
	"token",
	"url",
})

var forbiddenPublicEventValuePatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)https?://`),
	regexp.MustCompile(`(?i)\bbearer\s+[a-z0-9._~+/=-]+`),
	regexp.MustCompile(`(?i)\b(password|passwd|api[_-]?key|secret|token)\s*[:=]`),
	regexp.MustCompile(`(?i)\b[a-z]:[\\/]`),
	regexp.MustCompile(`(?i)(^|[^a-z0-9._-])/(?:[a-z0-9._-]+/)+[a-z0-9._-]+`),
}

var eventPayloadFields = map[string]map[string]struct{}{
	"run.started":        stringSet(nil),
	"run.accepted":       stringSet(nil),
	"run.waiting_input":  stringSet(nil),
	"run.resumed":        stringSet(nil),
	"run.succeeded":      stringSet(nil),
	"run.failed":         stringSet([]string{"code", "retryable"}),
	"run.cancelled":      stringSet(nil),
	"phase.started":      stringSet([]string{"phase", "label_key"}),
	"phase.progress":     stringSet([]string{"phase", "completed", "total"}),
	"phase.completed":    stringSet([]string{"phase", "label_key"}),
	"phase.failed":       stringSet([]string{"phase", "code"}),
	"tool.started":       stringSet([]string{"tool_key", "call_id"}),
	"tool.completed":     stringSet([]string{"tool_key", "call_id", "duration_ms"}),
	"tool.failed":        stringSet([]string{"tool_key", "call_id", "duration_ms", "code"}),
	"todo.snapshot":      stringSet([]string{"items"}),
	"reasoning.summary":  stringSet([]string{"text"}),
	"decision.note":      stringSet([]string{"text"}),
	"input.required":     stringSet([]string{"surface_id", "widget"}),
	"input.resolved":     stringSet([]string{"surface_id", "outcome"}),
	"artifact.published": stringSet([]string{"name", "media_type", "size_bytes"}),
	"tracking.degraded":  stringSet([]string{"code", "retryable"}),
}

// PublicEventSummary is bounded user-visible copy, not Bot-authored HTML.
type PublicEventSummary struct {
	Key  string `json:"key"`
	Text string `json:"text"`
}

// PublicExecutionTarget identifies a resource resolved under current owner.
type PublicExecutionTarget struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

// ExecutionEventV1 is the finite public event envelope produced by Bot.
type ExecutionEventV1 struct {
	SchemaVersion  int                    `json:"schema_version"`
	EventID        string                 `json:"event_id"`
	RunID          string                 `json:"run_id"`
	Seq            int64                  `json:"seq"`
	IdempotencyKey string                 `json:"idempotency_key,omitempty"`
	OccurredAt     string                 `json:"occurred_at"`
	Kind           string                 `json:"kind"`
	Status         string                 `json:"status"`
	Summary        PublicEventSummary     `json:"summary"`
	Payload        map[string]any         `json:"payload"`
	Ignorable      bool                   `json:"ignorable"`
	Target         *PublicExecutionTarget `json:"target,omitempty"`
	TaskID         string                 `json:"task_id,omitempty"`
	ParentEventID  string                 `json:"parent_event_id,omitempty"`
}

// IsKnown reports whether this event participates in the V1 projection.
func (event ExecutionEventV1) IsKnown() bool {
	_, ok := knownExecutionEventKinds[event.Kind]
	return ok
}

// SupportsExecutionEventV1 validates the exact Bot discovery descriptor.
func SupportsExecutionEventV1(capability AgentDescriptorExecutionEvents) bool {
	if capability.MajorVersion != 1 || !capability.ResumableHistory || capability.CustomEvent != "phyto.run_event" {
		return false
	}
	if len(capability.TargetKinds) != len(KnownExecutionTargetKinds) {
		return false
	}
	for index, target := range KnownExecutionTargetKinds {
		if capability.TargetKinds[index] != target {
			return false
		}
	}
	return true
}

const workTraceDetailEndpointV1 = "/v2/executions/{execution_id}/targets/trace/{target_id}"

var knownWorkTraceFeatureStates = stringSet([]string{
	"supported", "degraded", "unsupported",
})

// SupportsAgentWorkTraceV1 validates the complete finite discovery record.
// Missing, future, internally inconsistent, or unknown declarations fail
// closed so an old Web server never exposes an empty trace surface.
func SupportsAgentWorkTraceV1(capability AgentDescriptorWorkTrace) bool {
	if capability.MajorVersion != 1 {
		return false
	}
	states := []string{
		capability.State,
		capability.Features.Lifecycle,
		capability.Features.SemanticPhases,
		capability.Features.SemanticTools,
		capability.Features.PublicReasoning,
		capability.Features.TraceTarget,
	}
	for _, state := range states {
		if _, ok := knownWorkTraceFeatureStates[state]; !ok {
			return false
		}
	}
	if capability.Features.TraceTarget == "supported" {
		return capability.Target != nil && capability.Target.Kind == "trace" &&
			capability.Target.MajorVersion == 1 && capability.DetailEndpoint == workTraceDetailEndpointV1
	}
	return capability.Target == nil && capability.DetailEndpoint == ""
}

// PublicTodoItem is one item from an atomic Todo snapshot.
type PublicTodoItem struct {
	ID       string `json:"id"`
	LabelKey string `json:"label_key"`
	Status   string `json:"status"`
}

// PublicExecutionResult is one bounded artifact/result projection.
type PublicExecutionResult struct {
	EventID   string                `json:"event_id"`
	Name      string                `json:"name"`
	MediaType string                `json:"media_type"`
	SizeBytes int64                 `json:"size_bytes"`
	Target    PublicExecutionTarget `json:"target"`
}

// PublicTerminalState caches the terminal event identity.
type PublicTerminalState struct {
	Status  string `json:"status"`
	EventID string `json:"event_id"`
}

// PublicInputRequired is the finite interactive surface projection.
type PublicInputRequired struct {
	SurfaceID string `json:"surface_id"`
	Widget    string `json:"widget"`
}

// RunEventProjectionV1 is a replaceable cache derivable from ordered events.
type RunEventProjectionV1 struct {
	SchemaVersion int                     `json:"schema_version"`
	RunID         string                  `json:"run_id"`
	LatestSeq     int64                   `json:"latest_seq"`
	Status        string                  `json:"status"`
	Phase         *string                 `json:"phase"`
	Todos         []PublicTodoItem        `json:"todos"`
	Results       []PublicExecutionResult `json:"results"`
	InputRequired *PublicInputRequired    `json:"input_required"`
	Terminal      *PublicTerminalState    `json:"terminal"`
}

// ExecutionEventPageV1 is one bounded resumable history page from Bot.
type ExecutionEventPageV1 struct {
	SchemaVersion int                `json:"schema_version"`
	RunID         string             `json:"run_id"`
	Items         []ExecutionEventV1 `json:"items"`
	NextAfterSeq  int64              `json:"next_after_seq"`
	HasMore       bool               `json:"has_more"`
}

// ParseExecutionEventV1 decodes required events strictly and permits only
// explicitly ignorable unknown extensions to advance a replay cursor.
func ParseExecutionEventV1(raw []byte) (ExecutionEventV1, error) {
	var event ExecutionEventV1
	if err := decodeStrictJSON(raw, &event); err != nil {
		return event, fmt.Errorf("invalid_event: %w", err)
	}
	if event.SchemaVersion != 1 || event.EventID == "" || event.RunID == "" || event.Seq < 1 {
		return event, fmt.Errorf("invalid_event")
	}
	if _, ok := knownExecutionEventStatuses[event.Status]; !ok {
		return event, fmt.Errorf("invalid_event_status")
	}
	if event.Summary.Key == "" || event.Summary.Text == "" || len([]rune(event.Summary.Text)) > DefaultExecutionEventLimits.MaxSummaryChars {
		return event, fmt.Errorf("invalid_event_summary")
	}
	if err := validatePublicEventValue(map[string]any{
		"key": event.Summary.Key, "text": event.Summary.Text,
	}); err != nil {
		return event, err
	}
	parsedAt, err := time.Parse(time.RFC3339Nano, event.OccurredAt)
	_, offsetSeconds := parsedAt.Zone()
	if err != nil || offsetSeconds != 0 {
		return event, fmt.Errorf("invalid_occurred_at")
	}
	if !event.IsKnown() && !event.Ignorable {
		return event, fmt.Errorf("unknown_required_kind")
	}
	if event.Target != nil {
		if _, ok := knownExecutionTargetKinds[event.Target.Kind]; !ok || event.Target.ID == "" {
			return event, fmt.Errorf("unknown_target_kind")
		}
	}
	if err := validatePublicEventValue(event.Payload); err != nil {
		return event, err
	}
	if event.IsKnown() {
		allowed := eventPayloadFields[event.Kind]
		for key := range event.Payload {
			if _, ok := allowed[key]; !ok {
				return event, fmt.Errorf("invalid_public_payload")
			}
		}
		if event.Kind == "todo.snapshot" {
			if err := validateTodoPayload(event.Payload); err != nil {
				return event, err
			}
		}
	}
	if len(raw) > DefaultExecutionEventLimits.MaxEventBytes {
		return event, fmt.Errorf("event_payload_too_large")
	}
	return event, nil
}

// ParseRunEventProjectionV1 decodes Bot's bounded replaceable projection.
func ParseRunEventProjectionV1(raw []byte) (RunEventProjectionV1, error) {
	var projection RunEventProjectionV1
	if err := decodeStrictJSON(raw, &projection); err != nil {
		return projection, fmt.Errorf("invalid_projection: %w", err)
	}
	if projection.SchemaVersion != 1 || projection.RunID == "" || projection.LatestSeq < 0 {
		return projection, fmt.Errorf("invalid_projection")
	}
	if _, ok := knownExecutionEventStatuses[projection.Status]; !ok {
		return projection, fmt.Errorf("invalid_projection")
	}
	for _, todo := range projection.Todos {
		if todo.ID == "" || todo.LabelKey == "" {
			return projection, fmt.Errorf("invalid_projection")
		}
		if _, ok := knownTodoStatuses[todo.Status]; !ok {
			return projection, fmt.Errorf("invalid_projection")
		}
	}
	for _, result := range projection.Results {
		if result.EventID == "" || result.Name == "" || result.MediaType == "" || result.SizeBytes < 0 {
			return projection, fmt.Errorf("invalid_projection")
		}
		if _, ok := knownExecutionTargetKinds[result.Target.Kind]; !ok || result.Target.ID == "" {
			return projection, fmt.Errorf("unknown_target_kind")
		}
	}
	if projection.InputRequired != nil && (projection.InputRequired.SurfaceID == "" || projection.InputRequired.Widget == "") {
		return projection, fmt.Errorf("invalid_projection")
	}
	if projection.Terminal != nil {
		if projection.Terminal.EventID == "" {
			return projection, fmt.Errorf("invalid_projection")
		}
		if projection.Terminal.Status != "succeeded" && projection.Terminal.Status != "failed" && projection.Terminal.Status != "cancelled" {
			return projection, fmt.Errorf("invalid_projection")
		}
	}
	return projection, nil
}

// ParseExecutionEventPageV1 strictly decodes a page and validates every item.
func ParseExecutionEventPageV1(raw []byte) (ExecutionEventPageV1, error) {
	var wire struct {
		SchemaVersion int               `json:"schema_version"`
		RunID         string            `json:"run_id"`
		Items         []json.RawMessage `json:"items"`
		NextAfterSeq  int64             `json:"next_after_seq"`
		HasMore       bool              `json:"has_more"`
	}
	if err := decodeStrictJSON(raw, &wire); err != nil {
		return ExecutionEventPageV1{}, fmt.Errorf("invalid_event_page: %w", err)
	}
	if wire.SchemaVersion != 1 || wire.RunID == "" || wire.NextAfterSeq < 0 || len(wire.Items) > DefaultExecutionEventLimits.MaxPageSize {
		return ExecutionEventPageV1{}, fmt.Errorf("invalid_event_page")
	}
	page := ExecutionEventPageV1{
		SchemaVersion: wire.SchemaVersion,
		RunID:         wire.RunID,
		Items:         make([]ExecutionEventV1, 0, len(wire.Items)),
		NextAfterSeq:  wire.NextAfterSeq,
		HasMore:       wire.HasMore,
	}
	var previous int64
	for _, rawEvent := range wire.Items {
		event, err := ParseExecutionEventV1(rawEvent)
		if err != nil || event.RunID != wire.RunID || event.Seq <= previous {
			return ExecutionEventPageV1{}, fmt.Errorf("invalid_event_page")
		}
		previous = event.Seq
		page.Items = append(page.Items, event)
	}
	if len(page.Items) > 0 && page.NextAfterSeq != page.Items[len(page.Items)-1].Seq {
		return ExecutionEventPageV1{}, fmt.Errorf("invalid_event_page")
	}
	return page, nil
}

func decodeStrictJSON(raw []byte, value any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("trailing JSON value")
	}
	return nil
}

func stringSet(values []string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		result[value] = struct{}{}
	}
	return result
}

func validatePublicEventValue(value any) error {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if _, forbidden := forbiddenPublicEventKeys[key]; forbidden {
				return fmt.Errorf("forbidden_public_payload")
			}
			if err := validatePublicEventValue(child); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range typed {
			if err := validatePublicEventValue(child); err != nil {
				return err
			}
		}
	case string:
		if len([]rune(typed)) > DefaultExecutionEventLimits.MaxSummaryChars {
			return fmt.Errorf("public_string_too_large")
		}
		for _, pattern := range forbiddenPublicEventValuePatterns {
			if pattern.MatchString(typed) {
				return fmt.Errorf("forbidden_public_value")
			}
		}
	}
	return nil
}

func validateTodoPayload(payload map[string]any) error {
	rawItems, ok := payload["items"]
	if !ok {
		return fmt.Errorf("invalid_todo_snapshot")
	}
	encoded, err := json.Marshal(rawItems)
	if err != nil {
		return fmt.Errorf("invalid_todo_snapshot")
	}
	var items []PublicTodoItem
	if err := decodeStrictJSON(encoded, &items); err != nil {
		return fmt.Errorf("invalid_todo_snapshot")
	}
	if len(items) > DefaultExecutionEventLimits.MaxTodoItems {
		return fmt.Errorf("too_many_todo_items")
	}
	for _, item := range items {
		if item.ID == "" || item.LabelKey == "" {
			return fmt.Errorf("invalid_todo_snapshot")
		}
		if _, ok := knownTodoStatuses[item.Status]; !ok {
			return fmt.Errorf("invalid_todo_snapshot")
		}
	}
	return nil
}
