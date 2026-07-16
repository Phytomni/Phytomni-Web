package bot

import "encoding/json"

// AgentRunInterrupt contains the bounded pause metadata returned when an
// agent needs user input before it can continue.
type AgentRunInterrupt struct {
	RunID      string          `json:"run_id"`
	Generation string          `json:"generation,omitempty"`
	Draft      json.RawMessage `json:"draft,omitempty"`
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
