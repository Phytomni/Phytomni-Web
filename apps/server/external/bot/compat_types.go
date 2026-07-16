package bot

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
)

// AgentRunInterrupt contains the bounded pause metadata returned when an
// agent needs user input before it can continue.
type AgentRunInterrupt struct {
	ThreadID   string          `json:"thread_id,omitempty"`
	RunID      string          `json:"-"`
	Generation string          `json:"generation,omitempty"`
	Draft      json.RawMessage `json:"draft,omitempty"`
}

// UnmarshalJSON accepts Bot's thread_id interrupt identity and the legacy
// run_id spelling, while keeping one normalized RunID for Web callers.
func (i *AgentRunInterrupt) UnmarshalJSON(data []byte) error {
	var raw struct {
		ThreadID   string          `json:"thread_id"`
		RunID      string          `json:"run_id"`
		Generation string          `json:"generation"`
		Draft      json.RawMessage `json:"draft"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	i.ThreadID = raw.ThreadID
	i.RunID = raw.ThreadID
	if i.RunID == "" {
		i.RunID = raw.RunID
	}
	i.Generation = raw.Generation
	i.Draft = raw.Draft
	return nil
}

// RunProjectionEnvelope is the public projection envelope returned in a run
// result. Raw provider state remains opaque so downstream code can choose
// which bounded fields to persist or display.
type RunProjectionEnvelope struct {
	ReportStage        string          `json:"report_stage,omitempty"`
	ReportCompleteness string          `json:"report_completeness,omitempty"`
	ReportRevision     *int64          `json:"report_revision,omitempty"`
	ReportUpdatedAt    string          `json:"report_updated_at,omitempty"`
	IntermediateReport string          `json:"intermediate_report,omitempty"`
	FinalReport        string          `json:"final_report,omitempty"`
	Progress           json.RawMessage `json:"progress,omitempty"`
	Degraded           bool            `json:"degraded,omitempty"`
	DegradedReason     string          `json:"degraded_reason,omitempty"`
	Failures           []string        `json:"failures,omitempty"`
	Artifacts          json.RawMessage `json:"artifacts,omitempty"`
	Formatted          *Formatted      `json:"formatted,omitempty"`
}

const (
	// MaxProjectionFailures and MaxProjectionFailureMessage are shared by the
	// compatibility envelope and the service projection decoder.  Keeping the
	// limits here prevents the two Bot boundaries from silently drifting.
	MaxProjectionFailures       = 32
	MaxProjectionFailureMessage = 256
	MaxProjectionFailureField   = 128

	maxProjectionFailures       = MaxProjectionFailures
	maxProjectionFailureMessage = MaxProjectionFailureMessage
	maxProjectionFailureField   = MaxProjectionFailureField
)

// UnmarshalJSON accepts both the legacy string failure list and Bot HEAD's
// bounded failure objects, retaining only safe user-facing messages.
func (p *RunProjectionEnvelope) UnmarshalJSON(data []byte) error {
	var raw struct {
		ReportStage        string          `json:"report_stage"`
		ReportCompleteness string          `json:"report_completeness"`
		ReportRevision     *int64          `json:"report_revision"`
		ReportUpdatedAt    string          `json:"report_updated_at"`
		IntermediateReport string          `json:"intermediate_report"`
		FinalReport        string          `json:"final_report"`
		Progress           json.RawMessage `json:"progress"`
		Degraded           bool            `json:"degraded"`
		DegradedReason     string          `json:"degraded_reason"`
		Failures           json.RawMessage `json:"failures"`
		Artifacts          json.RawMessage `json:"artifacts"`
		Formatted          *Formatted      `json:"formatted"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	failures, err := decodeProjectionFailures(raw.Failures)
	if err != nil {
		return err
	}
	*p = RunProjectionEnvelope{
		ReportStage:        raw.ReportStage,
		ReportCompleteness: raw.ReportCompleteness,
		ReportRevision:     raw.ReportRevision,
		ReportUpdatedAt:    raw.ReportUpdatedAt,
		IntermediateReport: raw.IntermediateReport,
		FinalReport:        raw.FinalReport,
		Progress:           raw.Progress,
		Degraded:           raw.Degraded,
		DegradedReason:     raw.DegradedReason,
		Failures:           failures,
		Artifacts:          raw.Artifacts,
		Formatted:          raw.Formatted,
	}
	return nil
}

func decodeProjectionFailures(raw json.RawMessage) ([]string, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return nil, nil
	}

	var entries []json.RawMessage
	if err := json.Unmarshal(trimmed, &entries); err != nil {
		return nil, err
	}

	failures := make([]string, 0, len(entries))
	for _, entry := range entries {
		if len(failures) == maxProjectionFailures {
			break
		}

		var message string
		if err := json.Unmarshal(entry, &message); err == nil {
			if message, ok := boundedProjectionFailureMessage(message); ok {
				failures = append(failures, message)
			}
			continue
		}

		var object struct {
			WorkItemKey string `json:"work_item_key"`
			Status      string `json:"status"`
			Message     string `json:"message"`
		}
		if err := json.Unmarshal(entry, &object); err != nil {
			continue
		}
		if !validProjectionFailureField(object.WorkItemKey) || !validProjectionFailureField(object.Status) {
			continue
		}
		if message, ok := boundedProjectionFailureMessage(object.Message); ok {
			failures = append(failures, message)
			continue
		}
		if message, ok := normalizedProjectionFailureMessage(object.Status); ok {
			failures = append(failures, message)
		}
	}
	return failures, nil
}

// DecodeProjectionFailures strictly decodes the public failure projection.
// Unlike the legacy RunProjectionEnvelope decoder, which is deliberately
// best-effort for compatibility fixtures, this boundary rejects malformed or
// overlong entries so callers never persist a partial result.
func DecodeProjectionFailures(raw json.RawMessage) ([]string, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return nil, nil
	}

	var entries []json.RawMessage
	if err := json.Unmarshal(trimmed, &entries); err != nil {
		return nil, fmt.Errorf("projection failures must be an array: %w", err)
	}
	if len(entries) > MaxProjectionFailures {
		return nil, fmt.Errorf("projection failure count exceeds %d", MaxProjectionFailures)
	}

	failures := make([]string, 0, len(entries))
	for index, entry := range entries {
		message, err := decodeStrictProjectionFailure(entry)
		if err != nil {
			return nil, fmt.Errorf("projection failure %d: %w", index, err)
		}
		if message != "" {
			failures = append(failures, message)
		}
	}
	return failures, nil
}

func decodeStrictProjectionFailure(entry json.RawMessage) (string, error) {
	trimmed := bytes.TrimSpace(entry)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return "", fmt.Errorf("entry is null")
	}

	var message string
	if err := json.Unmarshal(trimmed, &message); err == nil {
		message = strings.TrimSpace(message)
		if message == "" {
			return "", nil
		}
		if len([]rune(message)) > MaxProjectionFailureMessage {
			return "", fmt.Errorf("message exceeds %d characters", MaxProjectionFailureMessage)
		}
		return message, nil
	}

	var object struct {
		WorkItemKey string `json:"work_item_key"`
		Status      string `json:"status"`
		Message     string `json:"message"`
	}
	if err := json.Unmarshal(trimmed, &object); err != nil {
		return "", fmt.Errorf("entry must be a string or object: %w", err)
	}
	if len([]rune(strings.TrimSpace(object.WorkItemKey))) > MaxProjectionFailureField {
		return "", fmt.Errorf("work_item_key exceeds %d characters", MaxProjectionFailureField)
	}
	if len([]rune(strings.TrimSpace(object.Status))) > MaxProjectionFailureField {
		return "", fmt.Errorf("status exceeds %d characters", MaxProjectionFailureField)
	}
	if message, ok := boundedProjectionFailureMessage(object.Message); ok {
		return message, nil
	}
	if strings.TrimSpace(object.Message) != "" {
		return "", fmt.Errorf("message exceeds %d characters", MaxProjectionFailureMessage)
	}
	if message, ok := normalizedProjectionFailureMessage(object.Status); ok {
		return message, nil
	}
	return "", fmt.Errorf("object has no safe message")
}

func validProjectionFailureField(value string) bool {
	value = strings.TrimSpace(value)
	return value != "" && len([]rune(value)) <= maxProjectionFailureField
}

func boundedProjectionFailureMessage(value string) (string, bool) {
	value = strings.TrimSpace(value)
	return value, value != "" && len([]rune(value)) <= maxProjectionFailureMessage
}

func normalizedProjectionFailureMessage(status string) (string, bool) {
	switch strings.TrimSpace(status) {
	case "failed":
		return "analysis task failed", true
	case "timed_out":
		return "analysis task timed out", true
	case "cancelled":
		return "analysis task cancelled", true
	default:
		return "", false
	}
}
