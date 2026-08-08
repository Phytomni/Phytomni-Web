package api_service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode"

	rxBot "phytomni-server/external/bot"
)

const (
	maxProjectionRunID          = 128
	maxProjectionAgent          = 64
	maxProjectionStatus         = 32
	maxProjectionWorkStage      = 64
	maxProjectionChildTasks     = 256
	maxProjectionReportStage    = 64
	maxProjectionCompleteness   = 32
	maxProjectionDegraded       = rxBot.MaxProjectionFailureMessage
	maxProjectionFailureMessage = rxBot.MaxProjectionFailureMessage
	maxInteropMode              = 16
	maxInteropStatus            = 16
	maxInteropTargetID          = 64
	maxInteropKind              = 8
	maxInteropCode              = 32
	maxInteropMetadataBytes     = 64 << 10
	maxInteropMetadataEntries   = 16
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

// ProjectionDelivery is the bounded delivery state retained by Web. The
// inventory digest and archive resolver reference are server-only and are
// excluded from accidental JSON serialization.
type ProjectionDelivery struct {
	SchemaVersion   int    `json:"schema_version"`
	Required        bool   `json:"required"`
	Status          string `json:"status"`
	Revision        int64  `json:"revision"`
	InventoryDigest string `json:"-"`
	ArchiveName     string `json:"name,omitempty"`
	ArchiveSize     int64  `json:"size_bytes,omitempty"`
	ArchiveRef      string `json:"-"`
	ErrorCode       string `json:"error_code,omitempty"`
	Retryable       bool   `json:"retryable"`
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
	WorkStage          string
	ChildTaskCount     int
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
	ResultArchiveV1    bool
	Delivery           *ProjectionDelivery
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
	if len(record.TaskIDs) > maxProjectionChildTasks {
		return BotRunProjection{}, projectionDecodeError("task_ids", "too many child tasks")
	}

	envelope, err := decodeProjectionEnvelope(record.Result)
	if err != nil {
		return BotRunProjection{}, err
	}
	projection, err := buildProjectionFromEnvelope(runID, agent, status, record.Answer, envelope, len(record.TaskIDs) == 0)
	if err != nil {
		return BotRunProjection{}, err
	}
	projection.ChildTaskCount = len(record.TaskIDs)
	projection.WorkStage = sanitizeRunWorkStage(record.Stage)
	return normalizeCompletedReviewProjection(projection), nil
}

// reviewAnswerCompletesPause resolves one contradictory Review envelope
// defensively. A genuine input-required pause has no visible answer; once an
// answer is non-blank, the accompanying interrupt is stale.
func reviewAnswerCompletesPause(agent, status, answer string) bool {
	return strings.EqualFold(strings.TrimSpace(agent), "review") &&
		strings.EqualFold(strings.TrimSpace(status), "input_required") &&
		strings.TrimSpace(answer) != ""
}

func normalizeCompletedReviewProjection(projection BotRunProjection) BotRunProjection {
	if reviewAnswerCompletesPause(projection.Agent, projection.Status, projection.VisibleReport()) {
		projection.Status = "SUCCEEDED"
	}
	return projection
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
	if len(response.TaskIDs) > maxProjectionChildTasks {
		return BotRunProjection{}, projectionDecodeError("task_ids", "too many child tasks")
	}
	var interopMetadata botInteropMetadata
	if interopAgent(agent) {
		interopMetadata, err = decodeFormattedInteropMetadata(formattedMetadata(response.Result.Formatted))
		if err != nil {
			return BotRunProjection{}, err
		}
	}
	if interopAgent(agent) && interopMetadata.failed(len(response.TaskIDs) == 0) {
		// Bot can return a transport-level running envelope while a required
		// interop plan has already failed. Treat the bounded metadata outcome as
		// terminal so the Web layer never persists an unpollable pseudo-running
		// row.
		status = "FAILED"
	}

	runID, err := normalizeAgentRunResponseID(response)
	if err != nil {
		return BotRunProjection{}, err
	}
	if runID == "" && !response.DegradedTracking && status != "FAILED" {
		return BotRunProjection{}, projectionDecodeError("run_id", "missing umbrella run id")
	}

	projection := BotRunProjection{
		RunID:            runID,
		Agent:            agent,
		Status:           status,
		ChildTaskCount:   len(response.TaskIDs),
		ReportRevision:   -1,
		TrackingDegraded: response.DegradedTracking,
		DegradedInterop:  interopMetadata.DegradedInterop,
		InterOp:          interopMetadata.projection(),
	}
	if response.Result.Formatted != nil {
		answer, err := boundProjectionText(response.Result.Formatted.Answer, rxBot.MaxProjectionReportLength, "formatted.answer")
		if err != nil {
			return BotRunProjection{}, err
		}
		projection.FinalReport = answer
	}
	return normalizeCompletedReviewProjection(projection), nil
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
	Execution          json.RawMessage `json:"execution"`
	Interop            json.RawMessage `json:"interop"`
	DegradedInterop    bool            `json:"degraded_interop"`
}

// botInteropMetadata is the small, safe subset of Bot's formatted metadata
// that Web may retain. Capability labels, latency, task/context ids, peer
// payloads, endpoints, and credentials are intentionally not represented.
type botInteropMetadata struct {
	Status          string
	DegradedInterop bool
	Entries         []botInteropEntry
}

type botInteropEntry struct {
	TargetID string
	Kind     string
	Status   string
	Code     string
}

type botInteropMetadataEnvelope struct {
	Status          string          `json:"status"`
	Interop         json.RawMessage `json:"interop"`
	DegradedInterop bool            `json:"degraded_interop"`
}

type botInteropMetadataEntry struct {
	TargetID string `json:"target_id"`
	Kind     string `json:"kind"`
	Status   string `json:"status"`
	Code     string `json:"code"`
}

// decodeFormattedInteropMetadata decodes Bot's nested
// result.formatted.metadata object. The raw field is capped before decoding,
// and only the bounded target/kind/status/code labels are copied into the
// Web-owned projection.
func decodeFormattedInteropMetadata(raw json.RawMessage) (botInteropMetadata, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return botInteropMetadata{}, nil
	}
	if len([]byte(trimmed)) > maxInteropMetadataBytes {
		return botInteropMetadata{}, projectionDecodeError("formatted.metadata", "value is overlong")
	}
	// Callers may provide either formatted itself or its metadata member. Pull
	// the nested member when present, while retaining support for a direct
	// metadata object in response paths.
	var formatted struct {
		Metadata json.RawMessage `json:"metadata"`
	}
	if err := json.Unmarshal([]byte(trimmed), &formatted); err != nil {
		return botInteropMetadata{}, projectionDecodeError("formatted.metadata", "malformed metadata")
	}
	if len(bytes.TrimSpace(formatted.Metadata)) > 0 && !bytes.Equal(bytes.TrimSpace(formatted.Metadata), []byte("null")) {
		trimmed = string(bytes.TrimSpace(formatted.Metadata))
		if len([]byte(trimmed)) > maxInteropMetadataBytes {
			return botInteropMetadata{}, projectionDecodeError("formatted.metadata", "value is overlong")
		}
	}
	var envelope botInteropMetadataEnvelope
	if err := json.Unmarshal([]byte(trimmed), &envelope); err != nil {
		return botInteropMetadata{}, projectionDecodeError("formatted.metadata", "malformed metadata")
	}
	metadata := botInteropMetadata{
		Status:          strings.ToUpper(strings.TrimSpace(envelope.Status)),
		DegradedInterop: envelope.DegradedInterop,
	}
	if metadata.Status != "" {
		switch metadata.Status {
		case "SUCCESS", "SUCCEEDED", "PARTIAL", "FAILED", "PENDING", "RUNNING", "INPUT_REQUIRED":
		default:
			// Universal metadata is advisory for non-interop agents. Ignore
			// an unknown provider status rather than rejecting an otherwise
			// valid projection; only the explicit FAILED value is terminal.
			metadata.Status = ""
		}
	}
	if len(bytes.TrimSpace(envelope.Interop)) == 0 || bytes.Equal(bytes.TrimSpace(envelope.Interop), []byte("null")) {
		return metadata, nil
	}
	var entries []botInteropMetadataEntry
	if err := json.Unmarshal(envelope.Interop, &entries); err != nil {
		return botInteropMetadata{}, projectionDecodeError("formatted.metadata.interop", "must be an array")
	}
	if len(entries) > maxInteropMetadataEntries {
		return botInteropMetadata{}, projectionDecodeError("formatted.metadata.interop", "too many entries")
	}
	metadata.Entries = make([]botInteropEntry, 0, len(entries))
	for index, entry := range entries {
		targetID := strings.TrimSpace(entry.TargetID)
		kind := strings.TrimSpace(entry.Kind)
		status := strings.ToLower(strings.TrimSpace(entry.Status))
		code := strings.TrimSpace(entry.Code)
		if targetID == "" || len([]rune(targetID)) > maxInteropTargetID || !interopProjectionTargetPattern.MatchString(targetID) {
			return botInteropMetadata{}, projectionDecodeError(fmt.Sprintf("formatted.metadata.interop[%d].target_id", index), "malformed target id")
		}
		if kind != "mcp" && kind != "a2a" {
			return botInteropMetadata{}, projectionDecodeError(fmt.Sprintf("formatted.metadata.interop[%d].kind", index), "unsupported kind")
		}
		switch status {
		case "completed", "input_required", "degraded", "failed":
		default:
			return botInteropMetadata{}, projectionDecodeError(fmt.Sprintf("formatted.metadata.interop[%d].status", index), "unsupported status")
		}
		if len([]rune(code)) > maxInteropCode {
			return botInteropMetadata{}, projectionDecodeError(fmt.Sprintf("formatted.metadata.interop[%d].code", index), "malformed code")
		}
		if code != "" && !validInteropProjectionCode(code) {
			return botInteropMetadata{}, projectionDecodeError(fmt.Sprintf("formatted.metadata.interop[%d].code", index), "unsupported code")
		}
		metadata.Entries = append(metadata.Entries, botInteropEntry{
			TargetID: targetID,
			Kind:     kind,
			Status:   status,
			Code:     code,
		})
	}
	return metadata, nil
}

func (metadata botInteropMetadata) failed(noTaskIDs bool) bool {
	if metadata.Status == "FAILED" {
		return true
	}
	if !noTaskIDs {
		return false
	}
	for _, entry := range metadata.Entries {
		if entry.Status == "failed" {
			return true
		}
	}
	return false
}

func (metadata botInteropMetadata) projection() *InteropProvenance {
	// Prefer an explicit failure over a degraded or completed entry when Bot
	// reports more than one target. This prevents a successful sibling from
	// masking a required failure in the single Web-facing projection slot.
	selected := botInteropEntry{}
	selectedRank := -1
	for _, entry := range metadata.Entries {
		rank := 0
		switch entry.Status {
		case "completed":
			rank = 4
		case "degraded":
			rank = 3
		case "input_required":
			rank = 2
		case "failed":
			// A failed target is terminal evidence. It must outrank every
			// completed/degraded sibling rather than being masked by the
			// highest-success entry in this single-slot projection.
			rank = 5
		}
		if rank > selectedRank {
			selected = entry
			selectedRank = rank
		}
	}
	if metadata.Status == "FAILED" && (selectedRank < 0 || selected.Status != "failed") {
		return interopProvenancePtr(InteropProvenance{Status: "failed", Code: "interop_failed"})
	}
	if selectedRank >= 0 {
		status := "delegated"
		switch selected.Status {
		case "degraded":
			status = "degraded"
		case "failed":
			status = "failed"
		case "input_required":
			status = "degraded"
		}
		if metadata.DegradedInterop && selected.Status == "completed" {
			status = "degraded"
		}
		code := selected.Code
		if code == "" || (metadata.DegradedInterop && selected.Status == "completed") {
			switch selected.Status {
			case "completed":
				if metadata.DegradedInterop {
					code = "degraded"
				}
			case "degraded":
				code = "degraded"
			case "input_required":
				code = "input_required"
			case "failed":
				code = "interop_failed"
			}
		}
		return interopProvenancePtr(InteropProvenance{
			Status:   status,
			TargetID: selected.TargetID,
			Kind:     selected.Kind,
			Code:     code,
		})
	}
	if metadata.DegradedInterop {
		return interopProvenancePtr(InteropProvenance{Status: "degraded", Code: "degraded"})
	}
	if metadata.Status == "FAILED" {
		return interopProvenancePtr(InteropProvenance{Status: "failed", Code: "interop_failed"})
	}
	return nil
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

func buildProjectionFromEnvelope(runID, agent, status, legacyAnswer string, envelope projectionEnvelope, noTaskIDs bool) (BotRunProjection, error) {
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
	executionDelivery, err := rxBot.DecodeRunExecutionDelivery(envelope.Execution, agent)
	if err != nil {
		return BotRunProjection{}, projectionDecodeError("execution.delivery", err.Error())
	}
	var runArtifacts []rxBot.BoundedRunArtifact
	if !executionDelivery.ResultArchiveV1 {
		runArtifacts, err = rxBot.ParseRunProjectionArtifacts(envelope.Artifacts)
		if err != nil {
			return BotRunProjection{}, projectionDecodeError("artifacts", err.Error())
		}
	}
	var interop *InteropProvenance
	if interopAgent(agent) {
		interop, err = decodeInteropProvenance(envelope.Interop)
		if err != nil {
			return BotRunProjection{}, err
		}
	}
	var formattedInterop botInteropMetadata
	if interopAgent(agent) {
		formattedInterop, err = decodeFormattedInteropMetadata(envelope.Formatted)
		if err != nil {
			return BotRunProjection{}, err
		}
		if formattedInterop.failed(noTaskIDs) {
			status = "FAILED"
		}
		if formattedProjection := formattedInterop.projection(); formattedProjection != nil {
			interop = formattedProjection
		}
	}

	directories := append([]string(nil), executionDelivery.OutputDirs...)
	if !executionDelivery.ResultArchiveV1 {
		directories = make([]string, 0, len(runArtifacts))
	}
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
		Degraded:        envelope.Degraded,
		DegradedReason:  degradedReason,
		Failures:        failures,
		Artifacts:       artifacts,
		ResultArchiveV1: executionDelivery.ResultArchiveV1,
		Delivery:        projectRunDelivery(executionDelivery.Delivery),
		// RequestID intentionally remains empty. A Bot request id is response
		// metadata, not public run state, and is never copied from provider data.
		DegradedInterop: interopAgent(agent) && (envelope.DegradedInterop || formattedInterop.DegradedInterop),
		InterOp:         interop,
	}, nil
}

func projectRunDelivery(delivery *rxBot.RunDelivery) *ProjectionDelivery {
	if delivery == nil {
		return nil
	}
	projected := &ProjectionDelivery{
		SchemaVersion:   delivery.SchemaVersion,
		Required:        delivery.Required,
		Status:          delivery.Status,
		Revision:        delivery.Revision,
		InventoryDigest: delivery.InventoryDigest,
		ErrorCode:       delivery.ErrorCode,
		Retryable:       delivery.Retryable,
	}
	if delivery.Archive != nil {
		projected.ArchiveName = delivery.Archive.Name
		projected.ArchiveSize = delivery.Archive.SizeBytes
		projected.ArchiveRef = delivery.Archive.ObjectRef
	}
	return projected
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
		if !validInteropProjectionCode(copyValue.Code) {
			return nil, projectionDecodeError("interop.code", "unsupported code")
		}
	}
	return &copyValue, nil
}

func validInteropProjectionCode(value string) bool {
	switch value {
	case "disabled", "forbidden", "unavailable", "discovery_failed", "no_evidence", "target_unavailable", "invalid_request", "degraded", "input_required", "interop_failed":
		return true
	default:
		return false
	}
}

func normalizeProjectionRunID(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", projectionDecodeError("run_id", "missing umbrella run id")
	}
	if len([]rune(value)) > maxProjectionRunID ||
		strings.ContainsAny(value, "/\\") ||
		strings.IndexFunc(value, unicode.IsControl) >= 0 {
		return "", projectionDecodeError("run_id", "malformed umbrella run id")
	}
	return value, nil
}

func normalizeAgentRunResponseID(response rxBot.AgentRunResponse) (string, error) {
	nativeID, err := normalizeOptionalAgentRunID(response.ID)
	if err != nil {
		return "", err
	}
	compatibilityID, err := normalizeOptionalAgentRunID(response.RunID)
	if err != nil {
		return "", err
	}
	if nativeID != "" && compatibilityID != "" && nativeID != compatibilityID {
		return "", projectionDecodeError("run_id", "conflicting umbrella run ids")
	}
	if nativeID != "" {
		return nativeID, nil
	}
	return compatibilityID, nil
}

func normalizeOptionalAgentRunID(value *string) (string, error) {
	if value == nil {
		return "", nil
	}
	return normalizeProjectionRunID(*value)
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

func sanitizeRunWorkStage(value string) string {
	normalized, err := normalizeProjectionWorkStage(value)
	if err != nil {
		return ""
	}
	return normalized
}

func normalizeProjectionWorkStage(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	if len([]rune(value)) > maxProjectionWorkStage {
		return "", projectionDecodeError("stage", "malformed stage")
	}
	switch value {
	case "input_resolution", "planning", "execution", "report_assembly":
		return value, nil
	default:
		return "", projectionDecodeError("stage", "unsupported stage")
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
