package api_service

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	rxBot "phytomni-server/external/bot"
)

const (
	maxProjectionRunID          = 128
	maxProjectionAgent          = 64
	maxProjectionStatus         = 32
	maxProjectionReportStage    = 64
	maxProjectionCompleteness   = 32
	maxProjectionDegraded       = rxBot.MaxProjectionFailureMessage
	maxProjectionFailureMessage = rxBot.MaxProjectionFailureMessage
	maxInteropMode              = 16
	maxInteropStatus            = 16
	maxInteropTargetID          = 64
	maxInteropKind              = 8
	maxInteropCode              = 32
)

var interopProjectionTargetPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)

// InteropProvenance is the Web-owned explanation of how a research/design
// request was executed. It intentionally contains only bounded, allowlisted
// labels; endpoints, credentials, schemas, and provider diagnostics never
// cross the Bot/Web boundary or enter the projection store.
type InteropProvenance struct {
	Mode     string `json:"mode"`
	Status   string `json:"status"`
	TargetID string `json:"target_id,omitempty"`
	Kind     string `json:"kind,omitempty"`
	Code     string `json:"code,omitempty"`
}

// ProjectionProgress contains only the bounded counters and public BriefGene
// status that Web surfaces need. Provider-specific progress payloads are not
// retained.
type ProjectionProgress struct {
	Completed       int64
	Total           int64
	Failed          int64
	Pending         int64
	BriefGeneStatus string
}

// ProjectionArtifacts contains validated output directories and OBS paths.
// OutputDirs is kept as a compatibility alias for callers that use the Bot
// naming; both slices contain the same bounded directory values.
type ProjectionArtifacts struct {
	Directories []string
	OutputDirs  []string
	Paths       []string
}

// BotRunProjection is the Web-owned, sanitized lifecycle snapshot. It never
// carries Bot's raw result, SQL, credentials, child task payloads, or provider
// diagnostics. RawPayload exists only as a nil compatibility sentinel for
// older callers that asserted raw state was absent; DecodeRunProjection never
// assigns it.
type BotRunProjection struct {
	RunID              string
	Agent              string
	Status             string
	ReportStage        string
	ReportCompleteness string
	ReportRevision     int64
	ReportUpdatedAt    *time.Time
	IntermediateReport string
	FinalReport        string
	Progress           ProjectionProgress
	Degraded           bool
	DegradedReason     string
	Failures           []string
	Artifacts          ProjectionArtifacts
	RequestID          string
	TrackingDegraded   bool
	DegradedInterop    bool
	InterOp            *InteropProvenance
	RawPayload         []byte
}

// ProjectionDecodeError identifies malformed data at the Bot/Web projection
// boundary without echoing the offending payload into logs or responses.
type ProjectionDecodeError struct {
	Field  string
	Reason string
}

func (e *ProjectionDecodeError) Error() string {
	if e == nil {
		return "invalid Bot run projection"
	}
	if e.Field == "" {
		return "invalid Bot run projection: " + e.Reason
	}
	return fmt.Sprintf("invalid Bot run projection field %s: %s", e.Field, e.Reason)
}

func projectionDecodeError(field, reason string) error {
	return &ProjectionDecodeError{Field: field, Reason: reason}
}

// VisibleReport prefers a non-blank final synthesis and otherwise returns the
// latest non-empty intermediate report. The original report text is returned
// unchanged so Markdown formatting is not rewritten at this boundary.
func (p BotRunProjection) VisibleReport() string {
	if strings.TrimSpace(p.FinalReport) != "" {
		return p.FinalReport
	}
	return p.IntermediateReport
}

// DecodeRunProjection accepts only a pollable bot.RunRecord. A submission
// bot.AgentRunResponse, especially a null run_id with degraded_tracking=true,
// must go through DecodeAgentRunSubmission so a caller cannot accidentally put
// an unpollable response on the reconciliation path.
func DecodeRunProjection(input interface{}) (BotRunProjection, error) {
	switch value := input.(type) {
	case rxBot.RunRecord:
		return decodeRunRecord(value)
	case *rxBot.RunRecord:
		if value == nil {
			return BotRunProjection{}, projectionDecodeError("run", "nil RunRecord")
		}
		return decodeRunRecord(*value)
	case rxBot.AgentRunResponse, *rxBot.AgentRunResponse:
		return BotRunProjection{}, projectionDecodeError("run", "AgentRunResponse is submission-only")
	default:
		return BotRunProjection{}, projectionDecodeError("run", "unsupported response type")
	}
}

// DecodeAgentRunSubmission projects a just-submitted AgentRunResponse. It is
// intentionally separate from DecodeRunProjection: a null umbrella run id is
// valid only when Bot explicitly marks tracking as degraded, and no synthetic
// id is ever created for that response.
func DecodeAgentRunSubmission(input interface{}) (BotRunProjection, error) {
	switch value := input.(type) {
	case rxBot.AgentRunResponse:
		return decodeAgentRunResponse(value)
	case *rxBot.AgentRunResponse:
		if value == nil {
			return BotRunProjection{}, projectionDecodeError("run", "nil AgentRunResponse")
		}
		return decodeAgentRunResponse(*value)
	default:
		return BotRunProjection{}, projectionDecodeError("run", "unsupported submission type")
	}
}

func decodeRunRecord(record rxBot.RunRecord) (BotRunProjection, error) {
	runID, err := normalizeProjectionRunID(record.RunID)
	if err != nil {
		return BotRunProjection{}, err
	}
	agent, err := normalizeProjectionAgent(record.Agent)
	if err != nil {
		return BotRunProjection{}, err
	}
	status, err := normalizeProjectionStatus(record.Status)
	if err != nil {
		return BotRunProjection{}, err
	}

	envelope, err := decodeProjectionEnvelope(record.Result)
	if err != nil {
		return BotRunProjection{}, err
	}
	projection, err := buildProjectionFromEnvelope(runID, agent, status, record.Answer, envelope)
	if err != nil {
		return BotRunProjection{}, err
	}
	return projection, nil
}

func decodeAgentRunResponse(response rxBot.AgentRunResponse) (BotRunProjection, error) {
	agent, err := normalizeProjectionAgent(response.Agent)
	if err != nil {
		return BotRunProjection{}, err
	}
	status, err := normalizeProjectionStatus(response.Status)
	if err != nil {
		return BotRunProjection{}, err
	}

	runID := ""
	if response.RunID != nil {
		runID, err = normalizeProjectionRunID(*response.RunID)
		if err != nil {
			return BotRunProjection{}, err
		}
	}
	if runID == "" && !response.DegradedTracking {
		return BotRunProjection{}, projectionDecodeError("run_id", "missing umbrella run id")
	}

	projection := BotRunProjection{
		RunID:            runID,
		Agent:            agent,
		Status:           status,
		ReportRevision:   -1,
		TrackingDegraded: response.DegradedTracking,
	}
	if response.Result.Formatted != nil {
		answer, err := boundProjectionText(response.Result.Formatted.Answer, rxBot.MaxProjectionReportLength, "formatted.answer")
		if err != nil {
			return BotRunProjection{}, err
		}
		projection.FinalReport = answer
	}
	return projection, nil
}

type projectionEnvelope struct {
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
	Formatted          json.RawMessage `json:"formatted"`
	Interop            json.RawMessage `json:"interop"`
	DegradedInterop    bool            `json:"degraded_interop"`
}

func decodeProjectionEnvelope(raw json.RawMessage) (projectionEnvelope, error) {
	if len(strings.TrimSpace(string(raw))) == 0 || strings.TrimSpace(string(raw)) == "null" {
		return projectionEnvelope{}, nil
	}
	var envelope projectionEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return projectionEnvelope{}, projectionDecodeError("result", "malformed JSON envelope")
	}
	return envelope, nil
}

func buildProjectionFromEnvelope(runID, agent, status, legacyAnswer string, envelope projectionEnvelope) (BotRunProjection, error) {
	revision := int64(-1)
	if envelope.ReportRevision != nil {
		if *envelope.ReportRevision < 0 {
			return BotRunProjection{}, projectionDecodeError("report_revision", "must be non-negative")
		}
		revision = *envelope.ReportRevision
	}

	stage, err := boundProjectionField(envelope.ReportStage, maxProjectionReportStage, "report_stage")
	if err != nil {
		return BotRunProjection{}, err
	}
	completeness, err := boundProjectionField(envelope.ReportCompleteness, maxProjectionCompleteness, "report_completeness")
	if err != nil {
		return BotRunProjection{}, err
	}
	if stage != "" && !validProjectionStage(stage) {
		return BotRunProjection{}, projectionDecodeError("report_stage", "unsupported value")
	}
	if completeness != "" && !validProjectionCompleteness(completeness) {
		return BotRunProjection{}, projectionDecodeError("report_completeness", "unsupported value")
	}

	intermediate, err := boundProjectionText(envelope.IntermediateReport, rxBot.MaxProjectionReportLength, "intermediate_report")
	if err != nil {
		return BotRunProjection{}, err
	}
	finalReport, err := boundProjectionText(envelope.FinalReport, rxBot.MaxProjectionReportLength, "final_report")
	if err != nil {
		return BotRunProjection{}, err
	}
	if strings.TrimSpace(intermediate) == "" && strings.TrimSpace(finalReport) == "" && len(envelope.Formatted) > 0 {
		var formatted struct {
			Answer string `json:"answer"`
		}
		if err := json.Unmarshal(envelope.Formatted, &formatted); err != nil {
			return BotRunProjection{}, projectionDecodeError("formatted", "malformed formatted envelope")
		}
		formattedAnswer, err := boundProjectionText(formatted.Answer, rxBot.MaxProjectionReportLength, "formatted.answer")
		if err != nil {
			return BotRunProjection{}, err
		}
		intermediate = formattedAnswer
	}
	if strings.TrimSpace(intermediate) == "" && strings.TrimSpace(finalReport) == "" {
		legacy, err := boundProjectionText(legacyAnswer, rxBot.MaxProjectionReportLength, "answer")
		if err != nil {
			return BotRunProjection{}, err
		}
		intermediate = legacy
	}

	updatedAt, err := parseProjectionTime(envelope.ReportUpdatedAt)
	if err != nil {
		return BotRunProjection{}, err
	}
	degradedReason, err := boundProjectionField(envelope.DegradedReason, maxProjectionDegraded, "degraded_reason")
	if err != nil {
		return BotRunProjection{}, err
	}
	failures, err := rxBot.DecodeProjectionFailures(envelope.Failures)
	if err != nil {
		return BotRunProjection{}, projectionDecodeError("failures", err.Error())
	}
	runProgress, err := rxBot.ParseRunProgress(envelope.Progress)
	if err != nil {
		return BotRunProjection{}, projectionDecodeError("progress", err.Error())
	}
	runArtifacts, err := rxBot.ParseRunProjectionArtifacts(envelope.Artifacts)
	if err != nil {
		return BotRunProjection{}, projectionDecodeError("artifacts", err.Error())
	}
	interop, err := decodeInteropProvenance(envelope.Interop)
	if err != nil {
		return BotRunProjection{}, err
	}

	directories := make([]string, 0, len(runArtifacts))
	paths := make([]string, 0)
	for _, artifact := range runArtifacts {
		if artifact.OutputDir != "" {
			directories = append(directories, artifact.OutputDir)
		}
		paths = append(paths, artifact.Paths...)
	}
	artifacts := ProjectionArtifacts{
		Directories: directories,
		OutputDirs:  append([]string(nil), directories...),
		Paths:       paths,
	}
	return BotRunProjection{
		RunID:              runID,
		Agent:              agent,
		Status:             status,
		ReportStage:        stage,
		ReportCompleteness: completeness,
		ReportRevision:     revision,
		ReportUpdatedAt:    updatedAt,
		IntermediateReport: intermediate,
		FinalReport:        finalReport,
		Progress: ProjectionProgress{
			Completed:       runProgress.Completed,
			Total:           runProgress.Total,
			Failed:          runProgress.Failed,
			Pending:         runProgress.Pending,
			BriefGeneStatus: runProgress.BriefGeneStatus,
		},
		Degraded:       envelope.Degraded,
		DegradedReason: degradedReason,
		Failures:       failures,
		Artifacts:      artifacts,
		// RequestID intentionally remains empty. A Bot request id is response
		// metadata, not public run state, and is never copied from provider data.
		DegradedInterop: envelope.DegradedInterop,
		InterOp:         interop,
	}, nil
}

// interopProvenancePtr returns a private copy so response/projection callers
// cannot mutate the decision that was validated at the service boundary.
func interopProvenancePtr(value InteropProvenance) *InteropProvenance {
	copyValue := value
	return &copyValue
}

func decodeInteropProvenance(raw json.RawMessage) (*InteropProvenance, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return nil, nil
	}
	var value InteropProvenance
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, projectionDecodeError("interop", "malformed provenance")
	}
	normalized, err := normalizeInteropProvenance(&value)
	if err != nil {
		return nil, err
	}
	return normalized, nil
}

func normalizeInteropProvenance(value *InteropProvenance) (*InteropProvenance, error) {
	if value == nil {
		return nil, nil
	}
	copyValue := *value
	copyValue.Mode = strings.TrimSpace(copyValue.Mode)
	copyValue.Status = strings.TrimSpace(copyValue.Status)
	copyValue.TargetID = strings.TrimSpace(copyValue.TargetID)
	copyValue.Kind = strings.TrimSpace(copyValue.Kind)
	copyValue.Code = strings.TrimSpace(copyValue.Code)
	if copyValue.Mode == "" || len([]rune(copyValue.Mode)) > maxInteropMode {
		return nil, projectionDecodeError("interop.mode", "malformed mode")
	}
	switch copyValue.Mode {
	case "off", "auto", "required":
	default:
		return nil, projectionDecodeError("interop.mode", "unsupported mode")
	}
	if copyValue.Status == "" || len([]rune(copyValue.Status)) > maxInteropStatus {
		return nil, projectionDecodeError("interop.status", "malformed status")
	}
	switch copyValue.Status {
	case "local", "delegated", "degraded", "failed":
	default:
		return nil, projectionDecodeError("interop.status", "unsupported status")
	}
	if copyValue.TargetID != "" && (len([]rune(copyValue.TargetID)) > maxInteropTargetID || !interopProjectionTargetPattern.MatchString(copyValue.TargetID)) {
		return nil, projectionDecodeError("interop.target_id", "malformed target id")
	}
	if copyValue.Kind != "" && copyValue.Kind != "mcp" && copyValue.Kind != "a2a" {
		return nil, projectionDecodeError("interop.kind", "unsupported kind")
	}
	if len([]rune(copyValue.Code)) > maxInteropCode {
		return nil, projectionDecodeError("interop.code", "malformed code")
	}
	if copyValue.Code != "" {
		switch copyValue.Code {
		case "disabled", "forbidden", "unavailable", "discovery_failed", "no_evidence", "target_unavailable", "invalid_request":
		default:
			return nil, projectionDecodeError("interop.code", "unsupported code")
		}
	}
	return &copyValue, nil
}

func normalizeProjectionRunID(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", projectionDecodeError("run_id", "missing umbrella run id")
	}
	if len([]rune(value)) > maxProjectionRunID || strings.ContainsAny(value, "/\\\r\n\t") {
		return "", projectionDecodeError("run_id", "malformed umbrella run id")
	}
	return value, nil
}

func normalizeProjectionAgent(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || len([]rune(value)) > maxProjectionAgent || strings.ContainsAny(value, "\r\n\t") {
		return "", projectionDecodeError("agent", "malformed agent slug")
	}
	if _, ok := rxBot.CanonicalAgentTool[value]; !ok {
		return "", projectionDecodeError("agent", "unknown agent slug")
	}
	return value, nil
}

func normalizeProjectionStatus(value string) (string, error) {
	value = strings.ToUpper(strings.TrimSpace(value))
	switch value {
	case "RUNNING", "SUCCEEDED", "FAILED", "INPUT_REQUIRED", "PENDING", "QUEUED", "CANCELLED", "CANCELED", "TIMED_OUT", "TIMEOUT":
		if value == "CANCELED" {
			value = "CANCELLED"
		}
		if value == "TIMEOUT" {
			value = "TIMED_OUT"
		}
		return value, nil
	default:
		if value == "" || len([]rune(value)) > maxProjectionStatus {
			return "", projectionDecodeError("status", "malformed status")
		}
		return "", projectionDecodeError("status", "unsupported status")
	}
}

func boundProjectionField(value string, max int, field string) (string, error) {
	value = strings.TrimSpace(value)
	if len([]rune(value)) > max || strings.ContainsAny(value, "\x00\r\n\t") {
		return "", projectionDecodeError(field, "value is malformed or overlong")
	}
	return value, nil
}

func boundProjectionText(value string, max int, field string) (string, error) {
	if len([]rune(value)) > max || strings.ContainsRune(value, '\x00') {
		return "", projectionDecodeError(field, "value is overlong or malformed")
	}
	return value, nil
}

func parseProjectionTime(value string) (*time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	tm, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil, projectionDecodeError("report_updated_at", "invalid RFC3339 timestamp")
	}
	tm = tm.UTC()
	return &tm, nil
}

func validProjectionStage(value string) bool {
	switch value {
	case "waiting_for_brief_gene", "intermediate", "final":
		return true
	default:
		return false
	}
}

func validProjectionCompleteness(value string) bool {
	switch value {
	case "none", "partial", "complete":
		return true
	default:
		return false
	}
}
