package bot

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"phytomni-server/common/citation"
)

const ExecutionRuntimeSchemaV2 = 2

var ErrExecutionServiceTokenMissing = errors.New("bot execution service token is not configured")

var executionV2Identifier = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)
var executionV2ContentDigest = regexp.MustCompile(`^[a-f0-9]{64}$`)

var executionV2Statuses = stringSet([]string{
	"admitted", "queued", "dispatching", "pending", "submitted", "acknowledged",
	"running", "waiting_input", "retry_scheduled", "cancellation_requested",
	"succeeded", "partial", "failed", "cancelled", "timed_out", "skipped", "degraded",
})

var executionV2TrackingHealth = stringSet([]string{"healthy", "degraded", "stale", "contract_degraded"})

var executionV2Sources = stringSet([]string{
	"admission", "runtime", "driver", "graph", "tool", "agent", "provider",
	"supervisor", "checkpoint", "artifact", "message", "compatibility",
})

var executionV2EventTypes = stringSet([]string{
	"execution.admitted", "execution.queued", "execution.dispatching", "execution.started",
	"execution.waiting_input", "execution.resumed", "execution.cancellation_requested",
	"execution.succeeded", "execution.partial", "execution.failed", "execution.cancelled", "execution.timed_out",
	"span.created", "span.started", "span.progress", "span.waiting_input", "span.resumed",
	"span.retry_scheduled", "span.succeeded", "span.partial", "span.failed", "span.cancelled", "span.timed_out", "span.skipped",
	"work_unit.registered", "work_unit.attempt_started", "work_unit.submitted", "work_unit.acknowledged",
	"work_unit.progress", "work_unit.retry_scheduled", "work_unit.cancellation_requested",
	"work_unit.cancellation_confirmed", "work_unit.succeeded", "work_unit.partial", "work_unit.failed",
	"work_unit.cancelled", "work_unit.timed_out", "todo.snapshot", "reasoning.summary", "decision.note",
	"input.required", "input.action_claimed", "input.action_rejected", "input.resolved",
	"artifact.published", "result.published", "message.snapshot", "message.completed",
	"tracking.degraded", "tracking.recovered", "sequence.gap",
})

var executionV2OperationDetailFields = map[string]map[string]string{
	"analyst.collect_outputs":           {"result_count": "integer"},
	"analyst.prepare_analysis":          {},
	"analyst.run_workflow":              {"step_count": "integer"},
	"artifact.package":                  {"artifact_count": "integer"},
	"data.query":                        {"result_count": "integer"},
	"deep_genome.experiment_protocol":   {},
	"deep_genome.gather_context":        {"result_count": "integer"},
	"deep_genome.prepare_plan":          {},
	"deep_genome.run_analysis_branches": {"branch_count": "integer"},
	"deep_genome.synthesize_results":    {"result_count": "integer"},
	"deep_genome.workflow":              {},
	"design.consolidate_candidates":     {"candidate_count": "integer"},
	"design.package_outputs":            {"artifact_count": "integer"},
	"design.run_branches":               {"branch_count": "integer"},
	"design.validate_target":            {"target_validated": "boolean"},
	"gene_network.infer_network":        {"gene_count": "integer", "interaction_count": "integer"},
	"gene_network.prepare_inputs":       {"input_count": "integer"},
	"gene_network.rank_regulators":      {"regulator_count": "integer"},
	"gene_network.synthesize_results":   {"result_count": "integer"},
	"gene_network.validate_target":      {"target_validated": "boolean"},
	"knowledge.search":                  {"repository_count": "integer", "result_count": "integer"},
	"model.generate":                    {},
	"remote.analysis":                   {"provider_state": "provider_state"},
	"remote.reconcile":                  {"provider_state": "provider_state", "result_count": "integer"},
	"remote.submit":                     {"provider_state": "provider_state"},
	"research.collect_evidence":         {"result_count": "integer"},
	"research.decompose_objectives":     {"objective_count": "integer"},
	"research.dispatch_work":            {"task_count": "integer"},
	"research.package_outputs":          {"artifact_count": "integer"},
	"research.synthesize_results":       {"result_count": "integer"},
	"review.citation_check":             {"ordinal": "integer", "total": "integer"},
	"review.draft_dimension":            {"ordinal": "integer", "total": "integer"},
	"review.final_synthesis":            {"total": "integer"},
	"review.retrieve_dimension":         {"ordinal": "integer", "total": "integer"},
	"tool.analyst":                      {},
	"tool.brief_gene":                   {},
	"tool.chat":                         {},
	"tool.data":                         {},
	"tool.deep_genome":                  {},
	"tool.design":                       {},
	"tool.knowledge":                    {},
	"tool.network":                      {},
	"tool.research":                     {},
	"tool.review":                       {},
	"operation.unknown":                 {},
}

type ExecutionAdmissionRequestV2 struct {
	SchemaVersion      int            `json:"schema_version"`
	OwnerRef           string         `json:"owner_ref"`
	ExecutionID        string         `json:"execution_id"`
	FingerprintVersion int            `json:"fingerprint_version"`
	Fingerprint        string         `json:"fingerprint"`
	AgentSlug          string         `json:"agent_slug"`
	Arguments          map[string]any `json:"arguments"`
}

type ExecutionAdmissionResponseV2 struct {
	SchemaVersion      int    `json:"schema_version"`
	ExecutionID        string `json:"execution_id"`
	RunID              string `json:"run_id"`
	AgentSlug          string `json:"agent_slug"`
	Status             string `json:"status"`
	EventCursor        int64  `json:"event_cursor"`
	SupervisorRevision int64  `json:"supervisor_revision"`
	IdempotentReplay   bool   `json:"idempotent_replay"`
}

type ExecutionTargetV2 struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

type ExecutionTodoItemV2 struct {
	ID       string `json:"id"`
	LabelKey string `json:"label_key"`
	Status   string `json:"status"`
}

type ExecutionResultItemV2 struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	MediaType string            `json:"media_type"`
	SizeBytes int64             `json:"size_bytes"`
	Target    ExecutionTargetV2 `json:"target"`
}

type ExecutionWarningV2 struct {
	Code       string  `json:"code"`
	WorkUnitID *string `json:"work_unit_id"`
}

type ExecutionInputRequiredV2 struct {
	SurfaceID      string `json:"surface_id"`
	Widget         string `json:"widget"`
	ActionRevision int64  `json:"action_revision"`
}

type ExecutionTerminalV2 struct {
	Status         string `json:"status"`
	EventID        string `json:"event_id"`
	ResultRevision int64  `json:"result_revision"`
}

type ExecutionContextStageV2 struct {
	SchemaVersion                  int    `json:"schema_version"`
	TurnID                         string `json:"turn_id"`
	SelectedAgentID                string `json:"selected_agent_id"`
	RouteSource                    string `json:"route_source"`
	RouteReasonCode                string `json:"route_reason_code"`
	BaseBusinessContextVersion     int64  `json:"base_business_context_version"`
	ProposedBusinessContextVersion int64  `json:"proposed_business_context_version"`
	LastAppliedLedgerCursor        int64  `json:"last_applied_ledger_cursor"`
	ContextTruncated               bool   `json:"context_truncated"`
	ContextRebuilt                 bool   `json:"context_rebuilt"`
}

type ExecutionOperationFailureV2 struct {
	Code      string `json:"code"`
	Retryable bool   `json:"retryable"`
}

type ExecutionOperationRetryV2 struct {
	DelayMS int64 `json:"delay_ms"`
}

type ExecutionOperationAttemptV2 struct {
	Attempt     int                          `json:"attempt"`
	Status      string                       `json:"status"`
	StartedAt   string                       `json:"started_at"`
	CompletedAt *string                      `json:"completed_at"`
	DurationMS  int64                        `json:"duration_ms"`
	Failure     *ExecutionOperationFailureV2 `json:"failure"`
	Retry       *ExecutionOperationRetryV2   `json:"retry"`
}

type ExecutionOperationProgressV2 struct {
	Completed int64  `json:"completed"`
	Total     int64  `json:"total"`
	Unit      string `json:"unit"`
}

type ExecutionOperationSummaryV2 struct {
	Kind string `json:"kind"`
	Text string `json:"text"`
}

type ExecutionOperationRecordV2 struct {
	SchemaVersion     int                           `json:"schema_version"`
	OperationID       string                        `json:"operation_id"`
	WorkUnitID        string                        `json:"work_unit_id"`
	OperationKey      string                        `json:"operation_key"`
	LabelKey          string                        `json:"label_key"`
	FallbackLabel     string                        `json:"fallback_label"`
	Status            string                        `json:"status"`
	StartedAt         string                        `json:"started_at"`
	LastObservationAt string                        `json:"last_observation_at"`
	CompletedAt       *string                       `json:"completed_at"`
	DurationMS        int64                         `json:"duration_ms"`
	CurrentAttempt    int                           `json:"current_attempt"`
	Attempts          []ExecutionOperationAttemptV2 `json:"attempts"`
	Progress          *ExecutionOperationProgressV2 `json:"progress"`
	Detail            map[string]any                `json:"detail"`
	Summary           *ExecutionOperationSummaryV2  `json:"summary"`
	Target            *ExecutionTargetV2            `json:"target"`
}

type ExecutionStageTodoV2 struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

type ExecutionLivenessClocksV2 struct {
	LastExecutionFactAt   *string `json:"last_execution_fact_at"`
	LastProviderContactAt *string `json:"last_provider_contact_at"`
	LastStreamContactAt   *string `json:"last_stream_contact_at"`
}

type ExecutionStageStateV2 struct {
	Stage            string                    `json:"stage"`
	ChildStatus      *string                   `json:"child_status"`
	RootStatus       string                    `json:"root_status"`
	AnswerAvailable  bool                      `json:"answer_available"`
	Todos            []ExecutionStageTodoV2    `json:"todos"`
	PendingStatusKey *string                   `json:"pending_status_key"`
	Clocks           ExecutionLivenessClocksV2 `json:"clocks"`
}

type ExecutionProjectionV2 struct {
	SchemaVersion     int                          `json:"schema_version"`
	ExecutionID       string                       `json:"execution_id"`
	RunID             string                       `json:"run_id,omitempty"`
	AgentSlug         string                       `json:"agent_slug"`
	Status            string                       `json:"status"`
	LatestSeq         int64                        `json:"latest_seq"`
	OutputRevision    int64                        `json:"output_revision"`
	OutputOffset      int64                        `json:"output_offset"`
	OperationRevision int64                        `json:"operation_revision"`
	Operations        []ExecutionOperationRecordV2 `json:"operations"`
	ExecutionStage    *ExecutionStageStateV2       `json:"execution_stage"`
	TrackingHealth    string                       `json:"tracking_health"`
	ActiveSpanIDs     []string                     `json:"active_span_ids"`
	TodoDeclared      bool                         `json:"todo_declared"`
	Todos             []ExecutionTodoItemV2        `json:"todos"`
	Results           []ExecutionResultItemV2      `json:"results"`
	Targets           []ExecutionTargetV2          `json:"targets"`
	FailedWorkUnitIDs []string                     `json:"failed_work_unit_ids"`
	Warnings          []ExecutionWarningV2         `json:"warnings"`
	InputRequired     *ExecutionInputRequiredV2    `json:"input_required"`
	ContextStage      *ExecutionContextStageV2     `json:"context_stage"`
	Terminal          *ExecutionTerminalV2         `json:"terminal"`
}

type ExecutionSafeSummaryV2 struct {
	Key  string `json:"key"`
	Text string `json:"text"`
}

type ExecutionEventV2 struct {
	SchemaVersion  int                    `json:"schema_version"`
	EventID        string                 `json:"event_id"`
	ExecutionID    string                 `json:"execution_id"`
	Seq            int64                  `json:"seq"`
	Type           string                 `json:"type"`
	Status         string                 `json:"status"`
	OccurredAt     string                 `json:"occurred_at"`
	Source         string                 `json:"source"`
	SpanID         string                 `json:"span_id"`
	ParentSpanID   *string                `json:"parent_span_id"`
	WorkUnitID     *string                `json:"work_unit_id"`
	Attempt        int                    `json:"attempt"`
	Summary        ExecutionSafeSummaryV2 `json:"summary"`
	PublicPayload  map[string]any         `json:"public_payload"`
	Target         *ExecutionTargetV2     `json:"target"`
	IdempotencyKey *string                `json:"idempotency_key"`
}

type ExecutionSequenceGapV2 struct {
	FirstMissingSeq int64 `json:"first_missing_seq"`
	LastMissingSeq  int64 `json:"last_missing_seq"`
}

type ExecutionEventPageV2 struct {
	SchemaVersion int                      `json:"schema_version"`
	ExecutionID   string                   `json:"execution_id"`
	Items         []ExecutionEventV2       `json:"items"`
	NextAfterSeq  int64                    `json:"next_after_seq"`
	HasMore       bool                     `json:"has_more"`
	Gaps          []ExecutionSequenceGapV2 `json:"gaps"`
}

type ExecutionActionRequestV2 struct {
	ActionID         string         `json:"action_id"`
	ExpectedRevision int64          `json:"expected_revision"`
	SurfaceID        string         `json:"surface_id"`
	Widget           string         `json:"widget"`
	Payload          map[string]any `json:"payload"`
}

type ExecutionCancelRequestV2 struct {
	RequestID        string `json:"request_id"`
	ExpectedRevision int64  `json:"expected_revision"`
	Reason           string `json:"reason"`
}

type ExecutionOperationResponseV2 struct {
	SchemaVersion       int    `json:"schema_version"`
	ExecutionID         string `json:"execution_id"`
	OperationID         string `json:"operation_id,omitempty"`
	RequestID           string `json:"request_id,omitempty"`
	Status              string `json:"status"`
	CancellationOutcome string `json:"cancellation_outcome,omitempty"`
	SupervisorRevision  int64  `json:"supervisor_revision"`
}

type ExecutionTargetResolutionV2 struct {
	SchemaVersion     int               `json:"schema_version"`
	ExecutionID       string            `json:"execution_id"`
	Target            ExecutionTargetV2 `json:"target"`
	Resolution        string            `json:"resolution"`
	DeliveryAvailable bool              `json:"delivery_available"`
	Name              string            `json:"name,omitempty"`
	MediaType         string            `json:"media_type,omitempty"`
	SizeBytes         int64             `json:"size_bytes,omitempty"`
}

type ExecutionTargetContentMetadataV2 struct {
	MediaType string
	FileName  string
}

func executionServiceToken() string {
	if token := strings.TrimSpace(os.Getenv("PHYTOMNI_BOT_SERVICE_TOKEN")); token != "" {
		return token
	}
	// Bot names this same shared credential PHYTOMNI_API_SERVICE_TOKEN.
	// Accepting that canonical name prevents Web and Bot from silently starting
	// with different V2 service-auth configuration in local/process deployments.
	return strings.TrimSpace(os.Getenv("PHYTOMNI_API_SERVICE_TOKEN"))
}

// ValidateExecutionServiceConfiguration fails before Web starts its execution
// workers when the shared Bot service credential is absent. Without this
// boundary check, admissions can be accepted and then deterministically age
// into the outbox dead-letter state without ever reaching Bot.
func ValidateExecutionServiceConfiguration() error {
	if executionServiceToken() == "" {
		return ErrExecutionServiceTokenMissing
	}
	return nil
}

// ValidateExecutionServiceAuthentication verifies that Bot accepts the exact
// credential Web will use before the gateway can admit user messages. A 404
// for the fixed owner-scoped probe is the expected authenticated response.
func (c *Client) ValidateExecutionServiceAuthentication(ctx context.Context) error {
	if err := ValidateExecutionServiceConfiguration(); err != nil {
		return err
	}
	_, _, err := c.GetExecutionSnapshotV2(ctx, "service-probe", "turn-web-service-auth-probe")
	if err == nil {
		return nil
	}
	var apiErr *APIError
	if errors.As(err, &apiErr) && apiErr.Status == http.StatusNotFound {
		return nil
	}
	return fmt.Errorf("bot execution service authentication preflight failed: %w", err)
}

func decodeFiniteV2(raw []byte, out any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return fmt.Errorf("invalid execution runtime v2 response: %w", err)
	}
	if decoder.Decode(new(any)) != io.EOF {
		return errors.New("invalid execution runtime v2 trailing data")
	}
	return nil
}

func validExecutionV2Target(target ExecutionTargetV2) bool {
	_, known := knownExecutionTargetKinds[target.Kind]
	if !known || !executionV2Identifier.MatchString(target.ID) {
		return false
	}
	return target.Kind != "trace" || executionTraceTargetIDV1.MatchString(target.ID)
}

func validateExecutionEventV2(event ExecutionEventV2, executionID string) error {
	if event.SchemaVersion != ExecutionRuntimeSchemaV2 || event.ExecutionID != executionID ||
		!executionV2Identifier.MatchString(event.EventID) || event.Seq < 1 || event.Attempt < 1 ||
		!executionV2Identifier.MatchString(event.SpanID) {
		return errors.New("invalid execution event v2 identity")
	}
	if _, ok := executionV2EventTypes[event.Type]; !ok {
		return errors.New("unknown required execution event v2 type")
	}
	if _, ok := executionV2Statuses[event.Status]; !ok {
		return errors.New("invalid execution event v2 status")
	}
	if _, ok := executionV2Sources[event.Source]; !ok {
		return errors.New("invalid execution event v2 source")
	}
	parsedAt, err := time.Parse(time.RFC3339Nano, event.OccurredAt)
	if _, offset := parsedAt.Zone(); err != nil || offset != 0 {
		return errors.New("invalid execution event v2 occurred_at")
	}
	if event.Summary.Key == "" || event.Summary.Text == "" || len([]rune(event.Summary.Text)) > DefaultExecutionEventLimits.MaxSummaryChars {
		return errors.New("invalid execution event v2 summary")
	}
	publicPayload := event.PublicPayload
	if event.Type == "message.snapshot" || event.Type == "message.completed" {
		if err := validateExecutionMessagePayloadV2(publicPayload); err != nil {
			return err
		}
		publicPayload = make(map[string]any, len(event.PublicPayload))
		for key, value := range event.PublicPayload {
			publicPayload[key] = value
		}
		// The message contract independently bounds text to one 8K chunk. Keep
		// every other public string under the shared 512-character safety rule.
		publicPayload["text"] = ""
		// References have already passed their dedicated strict field boundary
		// and were replaced with Web-derived canonical presentation. Its safe,
		// derived resolver links are deliberately outside the generic public
		// payload rule that rejects every URL.
		delete(publicPayload, "references")
	}
	if err := validatePublicEventValue(map[string]any{"key": event.Summary.Key, "text": event.Summary.Text, "payload": publicPayload}); err != nil {
		return err
	}
	if event.Target != nil && !validExecutionV2Target(*event.Target) {
		return errors.New("unknown execution target v2 kind")
	}
	return nil
}

func executionV2PayloadInt64(payload map[string]any, key string) (int64, bool) {
	value, ok := payload[key]
	if !ok {
		return 0, false
	}
	switch typed := value.(type) {
	case float64:
		converted := int64(typed)
		return converted, float64(converted) == typed
	case int64:
		return typed, true
	case int:
		return int64(typed), true
	case json.Number:
		converted, err := typed.Int64()
		return converted, err == nil
	default:
		return 0, false
	}
}

func validateExecutionMessagePayloadV2(payload map[string]any) error {
	required := stringSet([]string{
		"output_revision", "message_id", "source_message_id", "base_offset", "offset",
		"total_length", "chunk_index", "chunk_count", "content_sha256", "text",
	})
	allowed := stringSet([]string{
		"output_revision", "message_id", "source_message_id", "base_offset", "offset",
		"total_length", "chunk_index", "chunk_count", "content_sha256", "text", "references",
	})
	if len(payload) < len(required) || len(payload) > len(allowed) {
		return errors.New("invalid execution message payload fields")
	}
	for key := range payload {
		if _, ok := allowed[key]; !ok {
			return errors.New("invalid execution message payload field")
		}
	}
	for key := range required {
		if _, ok := payload[key]; !ok {
			return errors.New("invalid execution message payload fields")
		}
	}
	messageID, messageOK := payload["message_id"].(string)
	sourceMessageID, sourceOK := payload["source_message_id"].(string)
	text, textOK := payload["text"].(string)
	digest, digestOK := payload["content_sha256"].(string)
	revision, revisionOK := executionV2PayloadInt64(payload, "output_revision")
	baseOffset, baseOK := executionV2PayloadInt64(payload, "base_offset")
	offset, offsetOK := executionV2PayloadInt64(payload, "offset")
	totalLength, totalOK := executionV2PayloadInt64(payload, "total_length")
	chunkIndex, indexOK := executionV2PayloadInt64(payload, "chunk_index")
	chunkCount, countOK := executionV2PayloadInt64(payload, "chunk_count")
	if !messageOK || !sourceOK || !textOK || !digestOK || !revisionOK || !baseOK || !offsetOK || !totalOK || !indexOK || !countOK ||
		!executionV2Identifier.MatchString(messageID) || !executionV2Identifier.MatchString(sourceMessageID) ||
		!executionV2ContentDigest.MatchString(digest) || revision < 0 || baseOffset < 0 ||
		offset != baseOffset+int64(len([]rune(text))) || offset > totalLength || chunkIndex < 0 || chunkCount < 1 || chunkIndex >= chunkCount ||
		len([]rune(text)) > 8192 {
		return errors.New("invalid execution message payload")
	}
	for _, pattern := range forbiddenPublicEventValuePatterns {
		if pattern.MatchString(text) {
			return errors.New("forbidden_public_value")
		}
	}
	if references, ok := payload["references"]; ok {
		normalized, err := normalizeExecutionCitationReferencesV2(references, DefaultExecutionEventLimits.MaxEventBytes)
		if err != nil {
			return err
		}
		payload["references"] = normalized
	}
	return nil
}

const maxExecutionCitationBytesV2 = 64 * 1024

var executionCitationSourceFieldsV2 = stringSet([]string{
	"title", "au", "ti", "so", "vl", "bp", "ep", "ar", "py", "di", "pm", "formatted_citation",
})

// NormalizeExecutionCitationReferencesV2 is the single trust boundary for
// citation rows carried by the execution journal. The provider may supply
// bibliographic source fields and may replay an earlier canonical `citation`,
// but Web always discards that presentation and rebuilds it with common/citation.
// Unknown fields (including provider URLs and private file identities) fail
// closed. Null rows remain ordered neutral slots.
func NormalizeExecutionCitationReferencesV2(value any) ([]any, error) {
	return normalizeExecutionCitationReferencesV2(value, maxExecutionCitationBytesV2)
}

func normalizeExecutionCitationReferencesV2(value any, maxInputBytes int) ([]any, error) {
	encoded, err := json.Marshal(value)
	trimmedRoot := bytes.TrimSpace(encoded)
	if err != nil || len(encoded) > maxInputBytes || len(trimmedRoot) == 0 || trimmedRoot[0] != '[' {
		return nil, errors.New("invalid execution citation references")
	}
	var members []json.RawMessage
	if err := json.Unmarshal(encoded, &members); err != nil || len(members) > 64 {
		return nil, errors.New("invalid execution citation references")
	}
	doiMissing := make([]*bool, len(members))
	for index, member := range members {
		trimmed := bytes.TrimSpace(member)
		if bytes.Equal(trimmed, []byte("null")) {
			continue
		}
		var reference map[string]json.RawMessage
		if len(trimmed) == 0 || trimmed[0] != '{' || json.Unmarshal(trimmed, &reference) != nil || reference == nil {
			return nil, errors.New("invalid execution citation reference")
		}
		for key, raw := range reference {
			switch {
			case key == "citation":
				// Incoming presentation is intentionally ignored. Bounding the whole
				// references value above keeps this untrusted compatibility field finite.
				var object map[string]json.RawMessage
				if json.Unmarshal(raw, &object) != nil || object == nil {
					return nil, errors.New("invalid execution citation reference value")
				}
			case key == "doi_missing":
				var flag bool
				if json.Unmarshal(raw, &flag) != nil {
					return nil, errors.New("invalid execution citation reference value")
				}
				doiMissing[index] = &flag
			case hasStringKey(executionCitationSourceFieldsV2, key):
				var text string
				if json.Unmarshal(raw, &text) != nil || validatePublicEventValue(text) != nil {
					return nil, errors.New("invalid execution citation reference value")
				}
			default:
				return nil, errors.New("invalid execution citation reference field")
			}
		}
	}

	normalized, err := citation.NormalizeRows(encoded)
	if err != nil || len(normalized) > maxExecutionCitationBytesV2 {
		return nil, errors.New("invalid execution citation references")
	}
	var references []any
	if err := json.Unmarshal(normalized, &references); err != nil || len(references) != len(members) {
		return nil, errors.New("invalid execution citation references")
	}
	for index, flag := range doiMissing {
		if flag == nil {
			continue
		}
		reference, ok := references[index].(map[string]any)
		if !ok {
			return nil, errors.New("invalid execution citation references")
		}
		reference["doi_missing"] = *flag
	}
	return references, nil
}

func hasStringKey(values map[string]struct{}, key string) bool {
	_, ok := values[key]
	return ok
}

func validateExecutionProjectionV2(value ExecutionProjectionV2, executionID string) error {
	if value.SchemaVersion != ExecutionRuntimeSchemaV2 || value.ExecutionID != executionID || value.LatestSeq < 0 ||
		value.OutputRevision < 0 || value.OutputOffset < 0 || value.OperationRevision < 0 {
		return errors.New("invalid execution projection v2")
	}
	if value.AgentSlug != "" && !executionV2Identifier.MatchString(value.AgentSlug) {
		return errors.New("invalid execution projection v2 agent")
	}
	if _, ok := executionV2Statuses[value.Status]; !ok {
		return errors.New("invalid execution projection v2 status")
	}
	if _, ok := executionV2TrackingHealth[value.TrackingHealth]; !ok {
		return errors.New("invalid execution projection v2 tracking health")
	}
	if len(value.Operations) > 256 {
		return errors.New("too many execution operations v2")
	}
	for _, operation := range value.Operations {
		if err := validateExecutionOperationV2(operation); err != nil {
			return err
		}
	}
	if value.ExecutionStage != nil {
		if err := validateExecutionStageV2(*value.ExecutionStage); err != nil {
			return err
		}
	}
	for _, target := range value.Targets {
		if !validExecutionV2Target(target) {
			return errors.New("unknown execution target v2 kind")
		}
	}
	for _, result := range value.Results {
		if !executionV2Identifier.MatchString(result.ID) || result.Name == "" || result.MediaType == "" || result.SizeBytes < 0 || !validExecutionV2Target(result.Target) {
			return errors.New("invalid execution projection v2 result")
		}
	}
	if value.InputRequired != nil && (!executionV2Identifier.MatchString(value.InputRequired.SurfaceID) || value.InputRequired.Widget == "" || value.InputRequired.ActionRevision < 0) {
		return errors.New("invalid execution projection v2 input")
	}
	if value.ContextStage != nil {
		stage := value.ContextStage
		if stage.SchemaVersion != 1 || stage.TurnID == "" || stage.SelectedAgentID == "" || stage.RouteReasonCode == "" ||
			stage.BaseBusinessContextVersion < 0 || stage.ProposedBusinessContextVersion < 0 || stage.LastAppliedLedgerCursor < 0 {
			return errors.New("invalid execution projection v2 context stage")
		}
		switch stage.RouteSource {
		case "instant_lock", "explicit_selection", "router":
		default:
			return errors.New("invalid execution projection v2 context route")
		}
	}
	if value.Terminal != nil {
		if !executionV2Identifier.MatchString(value.Terminal.EventID) || value.Terminal.ResultRevision < 0 {
			return errors.New("invalid execution projection v2 terminal")
		}
		switch value.Terminal.Status {
		case "succeeded", "partial", "failed", "cancelled", "timed_out":
		default:
			return errors.New("invalid execution projection v2 terminal status")
		}
	}
	return nil
}

func validateExecutionOperationV2(value ExecutionOperationRecordV2) error {
	if value.SchemaVersion != 1 || !executionV2Identifier.MatchString(value.OperationID) ||
		!executionV2Identifier.MatchString(value.WorkUnitID) || value.OperationKey == "" ||
		value.LabelKey == "" || value.FallbackLabel == "" || value.DurationMS < 0 ||
		value.CurrentAttempt < 1 || len(value.Attempts) > 8 || len(value.Detail) > 16 {
		return errors.New("invalid execution operation v2")
	}
	if _, ok := stringSet([]string{"queued", "running", "retrying", "succeeded", "partial", "failed", "cancelled", "timed_out"})[value.Status]; !ok {
		return errors.New("invalid execution operation v2 status")
	}
	if !validExecutionTimestampV2(value.StartedAt) || !validExecutionTimestampV2(value.LastObservationAt) ||
		(value.CompletedAt != nil && !validExecutionTimestampV2(*value.CompletedAt)) {
		return errors.New("invalid execution operation v2 timestamp")
	}
	for _, attempt := range value.Attempts {
		if attempt.Attempt < 1 || attempt.DurationMS < 0 || !validExecutionTimestampV2(attempt.StartedAt) ||
			(attempt.CompletedAt != nil && !validExecutionTimestampV2(*attempt.CompletedAt)) {
			return errors.New("invalid execution operation attempt v2")
		}
		if _, ok := stringSet([]string{"running", "retry_scheduled", "succeeded", "failed", "cancelled", "timed_out"})[attempt.Status]; !ok {
			return errors.New("invalid execution operation attempt v2 status")
		}
		if attempt.Failure != nil && attempt.Failure.Code == "" {
			return errors.New("invalid execution operation failure v2")
		}
		if attempt.Retry != nil && attempt.Retry.DelayMS < 0 {
			return errors.New("invalid execution operation retry v2")
		}
	}
	if value.Progress != nil && (value.Progress.Completed < 0 || value.Progress.Total < 1 ||
		value.Progress.Completed > value.Progress.Total || value.Progress.Unit == "") {
		return errors.New("invalid execution operation progress v2")
	}
	if value.Summary != nil {
		if _, ok := stringSet([]string{"operation", "decision", "reasoning"})[value.Summary.Kind]; !ok ||
			value.Summary.Text == "" || len([]rune(value.Summary.Text)) > DefaultExecutionEventLimits.MaxSummaryChars {
			return errors.New("invalid execution operation summary v2")
		}
	}
	if value.Target != nil && !validExecutionV2Target(*value.Target) {
		return errors.New("invalid execution operation target v2")
	}
	allowedDetail, knownOperation := executionV2OperationDetailFields[value.OperationKey]
	if !knownOperation {
		return errors.New("unknown execution operation v2")
	}
	for key, detail := range value.Detail {
		fieldType, allowed := allowedDetail[key]
		if !allowed {
			return errors.New("invalid execution operation detail v2")
		}
		switch fieldType {
		case "boolean":
			if _, ok := detail.(bool); !ok {
				return errors.New("invalid execution operation detail v2")
			}
		case "integer":
			integer, ok := executionV2PayloadInt64(value.Detail, key)
			if !ok || integer < 0 {
				return errors.New("invalid execution operation detail v2")
			}
		case "provider_state":
			state, ok := detail.(string)
			if !ok {
				return errors.New("invalid execution operation detail v2")
			}
			if _, ok := stringSet([]string{"submitted", "queued", "running", "consolidating", "terminal"})[state]; !ok {
				return errors.New("invalid execution operation detail v2")
			}
		default:
			return errors.New("invalid execution operation detail v2")
		}
	}
	return validatePublicEventValue(value.Detail)
}

func validateExecutionStageV2(value ExecutionStageStateV2) error {
	stages := stringSet([]string{"orchestration", "scientific_execution", "consolidation", "response_settlement"})
	rootStatuses := stringSet([]string{"running", "succeeded", "partial", "failed", "cancelled", "timed_out"})
	if _, ok := stages[value.Stage]; !ok {
		return errors.New("invalid execution stage v2")
	}
	if _, ok := rootStatuses[value.RootStatus]; !ok || len(value.Todos) != 4 {
		return errors.New("invalid execution stage state v2")
	}
	for _, todo := range value.Todos {
		if _, ok := stringSet([]string{"planning", "analysis", "consolidation", "response"})[todo.ID]; !ok {
			return errors.New("invalid execution stage todo v2")
		}
		if _, ok := stringSet([]string{"pending", "in_progress", "completed", "failed", "skipped"})[todo.Status]; !ok {
			return errors.New("invalid execution stage todo v2")
		}
	}
	for _, clock := range []*string{value.Clocks.LastExecutionFactAt, value.Clocks.LastProviderContactAt, value.Clocks.LastStreamContactAt} {
		if clock != nil && !validExecutionTimestampV2(*clock) {
			return errors.New("invalid execution liveness clock v2")
		}
	}
	return nil
}

func validExecutionTimestampV2(value string) bool {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return false
	}
	_, offset := parsed.Zone()
	return offset == 0
}

func (c *Client) doExecutionV2JSON(ctx context.Context, method, path, owner string, body, out any) (ResponseMeta, error) {
	token := executionServiceToken()
	if token == "" {
		return ResponseMeta{}, ErrExecutionServiceTokenMissing
	}
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return ResponseMeta{}, err
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return ResponseMeta{}, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Service-Token", token)
	req.Header.Set("X-Phyto-Execution-Schema", "2")
	if owner != "" {
		req.Header.Set("X-Phyto-Owner", owner)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return ResponseMeta{}, wrapTransportError(err)
	}
	defer resp.Body.Close()
	meta := responseMeta(resp)
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return meta, wrapTransportError(err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return meta, preferBotRequestID(botError(method, path, resp.StatusCode, raw), meta.BotRequestID)
	}
	if out != nil {
		if err := decodeFiniteV2(raw, out); err != nil {
			return meta, err
		}
	}
	return meta, nil
}

func (c *Client) AdmitExecutionV2(ctx context.Context, request ExecutionAdmissionRequestV2) (*ExecutionAdmissionResponseV2, ResponseMeta, error) {
	var response ExecutionAdmissionResponseV2
	meta, err := c.doExecutionV2JSON(ctx, http.MethodPost, "/v2/executions", request.OwnerRef, request, &response)
	if err == nil && (response.SchemaVersion != 2 || response.ExecutionID != request.ExecutionID) {
		err = errors.New("invalid execution admission identity")
	}
	return &response, meta, err
}

func (c *Client) GetExecutionSnapshotV2(ctx context.Context, owner, executionID string) (*ExecutionProjectionV2, ResponseMeta, error) {
	path := "/v2/executions/" + url.PathEscape(executionID)
	var response ExecutionProjectionV2
	meta, err := c.doExecutionV2JSON(ctx, http.MethodGet, path, owner, nil, &response)
	if err == nil {
		supported := response.Operations[:0]
		for _, operation := range response.Operations {
			if operation.SchemaVersion == 1 {
				supported = append(supported, operation)
			}
		}
		response.Operations = supported
		err = validateExecutionProjectionV2(response, executionID)
	}
	return &response, meta, err
}

func (c *Client) GetExecutionOperationV2(ctx context.Context, owner, executionID, operationID string) (*ExecutionOperationRecordV2, ResponseMeta, error) {
	path := "/v2/executions/" + url.PathEscape(executionID) + "/operations/" + url.PathEscape(operationID)
	var response ExecutionOperationRecordV2
	meta, err := c.doExecutionV2JSON(ctx, http.MethodGet, path, owner, nil, &response)
	if err == nil {
		err = validateExecutionOperationV2(response)
		if err == nil && response.OperationID != operationID {
			err = errors.New("invalid execution operation v2 identity")
		}
	}
	return &response, meta, err
}

func (c *Client) GetExecutionEventsV2(ctx context.Context, owner, executionID string, afterSeq int64, limit int) (*ExecutionEventPageV2, ResponseMeta, error) {
	values := url.Values{"after_seq": {strconv.FormatInt(afterSeq, 10)}, "limit": {strconv.Itoa(limit)}}
	path := "/v2/executions/" + url.PathEscape(executionID) + "/events?" + values.Encode()
	var response ExecutionEventPageV2
	meta, err := c.doExecutionV2JSON(ctx, http.MethodGet, path, owner, nil, &response)
	if err == nil {
		if response.SchemaVersion != ExecutionRuntimeSchemaV2 || response.ExecutionID != executionID || response.NextAfterSeq < afterSeq || len(response.Items) > 200 {
			err = errors.New("invalid execution event page v2")
		} else {
			previous := afterSeq
			for _, event := range response.Items {
				if validateErr := validateExecutionEventV2(event, executionID); validateErr != nil || event.Seq <= previous {
					err = errors.New("invalid execution event page v2")
					break
				}
				previous = event.Seq
			}
			if err == nil && len(response.Items) > 0 && response.NextAfterSeq != previous {
				err = errors.New("invalid execution event page v2 cursor")
			}
		}
	}
	return &response, meta, err
}

func (c *Client) GetExecutionEventV2(ctx context.Context, owner, executionID, eventID string) (*ExecutionEventV2, ResponseMeta, error) {
	path := "/v2/executions/" + url.PathEscape(executionID) + "/events/" + url.PathEscape(eventID)
	var response ExecutionEventV2
	meta, err := c.doExecutionV2JSON(ctx, http.MethodGet, path, owner, nil, &response)
	if err == nil {
		err = validateExecutionEventV2(response, executionID)
		if err == nil && response.EventID != eventID {
			err = errors.New("invalid execution event v2 identity")
		}
	}
	return &response, meta, err
}

func (c *Client) ResolveExecutionTargetV2(ctx context.Context, owner, executionID, kind, targetID string) (*ExecutionTargetResolutionV2, ResponseMeta, error) {
	path := "/v2/executions/" + url.PathEscape(executionID) + "/targets/" + url.PathEscape(kind) + "/" + url.PathEscape(targetID)
	var response ExecutionTargetResolutionV2
	meta, err := c.doExecutionV2JSON(ctx, http.MethodGet, path, owner, nil, &response)
	if err == nil && (response.SchemaVersion != ExecutionRuntimeSchemaV2 || response.ExecutionID != executionID || response.Resolution != "authorized" || response.Target.Kind != kind || response.Target.ID != targetID || !validExecutionV2Target(response.Target)) {
		err = errors.New("invalid execution target resolution v2")
	}
	return &response, meta, err
}

func (c *Client) OpenExecutionTargetContentV2(ctx context.Context, owner, executionID, kind, targetID string) (io.ReadCloser, ExecutionTargetContentMetadataV2, ResponseMeta, error) {
	token := executionServiceToken()
	if token == "" {
		return nil, ExecutionTargetContentMetadataV2{}, ResponseMeta{}, ErrExecutionServiceTokenMissing
	}
	path := "/v2/executions/" + url.PathEscape(executionID) + "/targets/" + url.PathEscape(kind) + "/" + url.PathEscape(targetID) + "/content"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, ExecutionTargetContentMetadataV2{}, ResponseMeta{}, err
	}
	req.Header.Set("Accept", "application/octet-stream, */*")
	req.Header.Set("X-Service-Token", token)
	req.Header.Set("X-Phyto-Owner", owner)
	req.Header.Set("X-Phyto-Execution-Schema", "2")
	downloadHTTP := *c.http
	downloadHTTP.Timeout = 0
	resp, err := downloadHTTP.Do(req)
	if err != nil {
		return nil, ExecutionTargetContentMetadataV2{}, ResponseMeta{}, wrapTransportError(err)
	}
	meta := responseMeta(resp)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		resp.Body.Close()
		if readErr != nil {
			return nil, ExecutionTargetContentMetadataV2{}, meta, readErr
		}
		return nil, ExecutionTargetContentMetadataV2{}, meta, botError(http.MethodGet, path, resp.StatusCode, raw)
	}
	mediaType, _, parseErr := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if parseErr != nil || mediaType == "" || len(mediaType) > 128 {
		resp.Body.Close()
		return nil, ExecutionTargetContentMetadataV2{}, meta, errors.New("invalid execution target content type")
	}
	disposition, params, parseErr := mime.ParseMediaType(resp.Header.Get("Content-Disposition"))
	fileName := params["filename"]
	if parseErr != nil || (disposition != "attachment" && disposition != "inline") || fileName == "" || len(fileName) > 256 || strings.ContainsAny(fileName, "/\\\r\n") {
		resp.Body.Close()
		return nil, ExecutionTargetContentMetadataV2{}, meta, errors.New("invalid execution target content disposition")
	}
	return resp.Body, ExecutionTargetContentMetadataV2{MediaType: mediaType, FileName: fileName}, meta, nil
}

func (c *Client) PostExecutionActionV2(ctx context.Context, owner, executionID string, request ExecutionActionRequestV2) (*ExecutionOperationResponseV2, ResponseMeta, error) {
	path := "/v2/executions/" + url.PathEscape(executionID) + "/actions"
	var response ExecutionOperationResponseV2
	meta, err := c.doExecutionV2JSON(ctx, http.MethodPost, path, owner, request, &response)
	if err == nil && (response.SchemaVersion != ExecutionRuntimeSchemaV2 || response.ExecutionID != executionID || response.OperationID != request.ActionID || response.SupervisorRevision < 0) {
		err = errors.New("invalid execution action response v2")
	}
	return &response, meta, err
}

func (c *Client) CancelExecutionV2(ctx context.Context, owner, executionID string, request ExecutionCancelRequestV2) (*ExecutionOperationResponseV2, ResponseMeta, error) {
	path := "/v2/executions/" + url.PathEscape(executionID) + "/cancel"
	var response ExecutionOperationResponseV2
	meta, err := c.doExecutionV2JSON(ctx, http.MethodPost, path, owner, request, &response)
	if err == nil && (response.SchemaVersion != ExecutionRuntimeSchemaV2 || response.ExecutionID != executionID || response.RequestID != request.RequestID || response.SupervisorRevision < 0) {
		err = errors.New("invalid execution cancellation response v2")
	}
	return &response, meta, err
}

func (c *Client) OpenExecutionStreamV2(ctx context.Context, owner, executionID string, afterSeq, afterRevision, afterOffset int64) (io.ReadCloser, ResponseMeta, error) {
	token := executionServiceToken()
	if token == "" {
		return nil, ResponseMeta{}, ErrExecutionServiceTokenMissing
	}
	values := url.Values{
		"after_seq": {strconv.FormatInt(afterSeq, 10)}, "after_revision": {strconv.FormatInt(afterRevision, 10)},
		"after_offset": {strconv.FormatInt(afterOffset, 10)},
	}
	path := "/v2/executions/" + url.PathEscape(executionID) + "/events/stream?" + values.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, ResponseMeta{}, err
	}
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("X-Service-Token", token)
	req.Header.Set("X-Phyto-Owner", owner)
	req.Header.Set("X-Phyto-Execution-Schema", "2")
	streamHTTP := *c.http
	streamHTTP.Timeout = 0
	resp, err := streamHTTP.Do(req)
	if err != nil {
		return nil, ResponseMeta{}, wrapTransportError(err)
	}
	meta := responseMeta(resp)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		resp.Body.Close()
		if readErr != nil {
			return nil, meta, readErr
		}
		return nil, meta, botError(http.MethodGet, path, resp.StatusCode, raw)
	}
	mediaType, _, parseErr := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if parseErr != nil || mediaType != "text/event-stream" {
		resp.Body.Close()
		return nil, meta, errors.New("invalid execution runtime v2 stream content type")
	}
	return resp.Body, meta, nil
}
