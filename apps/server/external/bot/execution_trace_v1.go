package bot

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
)

var executionTraceTargetIDV1 = regexp.MustCompile(`^trc_[A-Za-z0-9_-]{16,80}$`)

var executionTraceHealthV1 = stringSet([]string{"healthy", "degraded", "unavailable"})
var executionTraceKindsV1 = stringSet([]string{"phase", "tool", "reasoning_summary", "decision"})
var executionTraceStatusesV1 = stringSet([]string{
	"pending", "running", "succeeded", "failed", "cancelled", "timed_out",
})

var executionTraceOperationKindsV1 = stringSet([]string{
	"gene_network.validate_target", "gene_network.prepare_inputs",
	"gene_network.infer_network", "gene_network.rank_regulators",
	"gene_network.synthesize_results", "gene_network.target_validated",
	"gene_network.workflow_selected", "execution.trace.gene_network.reasoning_summary",
	"execution.trace.gene_network.workflow_decision",
})

// ExecutionTraceOperationV1 is the public grouped operation header. It
// deliberately omits work-unit and span identities.
type ExecutionTraceOperationV1 struct {
	OperationID       string                        `json:"operation_id"`
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
	Target            ExecutionTargetV2             `json:"target"`
}

// ExecutionTraceFeedItemV1 is one allowlisted chronological semantic fact.
type ExecutionTraceFeedItemV1 struct {
	SchemaVersion int                           `json:"schema_version"`
	ItemID        string                        `json:"item_id"`
	Seq           int64                         `json:"seq"`
	Kind          string                        `json:"kind"`
	OperationKey  string                        `json:"operation_key"`
	LabelKey      string                        `json:"label_key"`
	FallbackLabel string                        `json:"fallback_label"`
	Status        string                        `json:"status"`
	Attempt       int                           `json:"attempt"`
	OccurredAt    string                        `json:"occurred_at"`
	DurationMS    *int64                        `json:"duration_ms"`
	Progress      *ExecutionOperationProgressV2 `json:"progress"`
	Attempts      []ExecutionOperationAttemptV2 `json:"attempts"`
	Detail        map[string]any                `json:"detail"`
	Summary       *string                       `json:"summary"`
	Target        *ExecutionTargetV2            `json:"target"`
}

// ExecutionTraceResolutionV1 is the only browser-safe trace response shape.
type ExecutionTraceResolutionV1 struct {
	SchemaVersion          int                        `json:"schema_version"`
	Target                 ExecutionTargetV2          `json:"target"`
	Health                 string                     `json:"health"`
	Operation              ExecutionTraceOperationV1  `json:"operation"`
	LastSemanticActivityAt *string                    `json:"last_semantic_activity_at"`
	LastProviderContactAt  *string                    `json:"last_provider_contact_at"`
	Items                  []ExecutionTraceFeedItemV1 `json:"items"`
	NextAfterSeq           int64                      `json:"next_after_seq"`
	HasMore                bool                       `json:"has_more"`
}

// ResolveExecutionTraceV1 fetches one owner-scoped, paged public trace.
func (c *Client) ResolveExecutionTraceV1(
	ctx context.Context,
	owner, executionID, targetID string,
	afterSeq int64,
	limit int,
) (*ExecutionTraceResolutionV1, ResponseMeta, error) {
	if afterSeq < 0 || limit < 1 || limit > 100 {
		return nil, ResponseMeta{}, errors.New("invalid execution trace cursor")
	}
	values := url.Values{
		"after_seq": {strconv.FormatInt(afterSeq, 10)},
		"limit":     {strconv.Itoa(limit)},
	}
	path := "/v2/executions/" + url.PathEscape(executionID) +
		"/targets/trace/" + url.PathEscape(targetID) + "?" + values.Encode()
	var response ExecutionTraceResolutionV1
	meta, err := c.doExecutionV2JSON(ctx, http.MethodGet, path, owner, nil, &response)
	if err == nil {
		err = validateExecutionTraceV1(response, targetID, afterSeq, limit)
	}
	return &response, meta, err
}

func validateExecutionTraceV1(value ExecutionTraceResolutionV1, targetID string, afterSeq int64, limit int) error {
	if value.SchemaVersion != 1 || value.Target.Kind != "trace" || value.Target.ID != targetID ||
		!validExecutionV2Target(value.Target) || value.NextAfterSeq < afterSeq || len(value.Items) > limit || len(value.Items) > 100 {
		return errors.New("invalid execution trace v1")
	}
	if _, ok := executionTraceHealthV1[value.Health]; !ok {
		return errors.New("invalid execution trace health v1")
	}
	if err := validateExecutionTraceOperationV1(value.Operation, value.Target); err != nil {
		return err
	}
	for _, timestamp := range []*string{value.LastSemanticActivityAt, value.LastProviderContactAt} {
		if timestamp != nil && !validExecutionTimestampV2(*timestamp) {
			return errors.New("invalid execution trace clock v1")
		}
	}
	previous := afterSeq
	for _, item := range value.Items {
		if err := validateExecutionTraceItemV1(item); err != nil || item.Seq <= previous {
			return errors.New("invalid execution trace item v1")
		}
		previous = item.Seq
	}
	if len(value.Items) > 0 && value.NextAfterSeq != previous {
		return errors.New("invalid execution trace cursor v1")
	}
	return nil
}

func validateExecutionTraceOperationV1(value ExecutionTraceOperationV1, target ExecutionTargetV2) error {
	if !executionV2Identifier.MatchString(value.OperationID) || value.OperationKey != "remote.analysis" ||
		value.LabelKey == "" || value.FallbackLabel == "" || value.DurationMS < 0 || value.CurrentAttempt < 1 ||
		len(value.Attempts) > 8 || len(value.Detail) > 16 || value.Target != target ||
		!validExecutionTimestampV2(value.StartedAt) || !validExecutionTimestampV2(value.LastObservationAt) {
		return errors.New("invalid execution trace operation v1")
	}
	if _, ok := executionV2Statuses[value.Status]; !ok {
		return errors.New("invalid execution trace operation status v1")
	}
	if value.CompletedAt != nil && !validExecutionTimestampV2(*value.CompletedAt) {
		return errors.New("invalid execution trace operation clock v1")
	}
	return validateExecutionTraceDetailV1(value.OperationKey, value.Detail)
}

func validateExecutionTraceItemV1(value ExecutionTraceFeedItemV1) error {
	if value.SchemaVersion != 1 || !executionV2Identifier.MatchString(value.ItemID) || value.Seq < 1 ||
		value.LabelKey == "" || value.FallbackLabel == "" || value.Attempt < 1 || value.Attempt > 20 ||
		!validExecutionTimestampV2(value.OccurredAt) || len(value.Attempts) > 8 || len(value.Detail) > 16 {
		return errors.New("invalid execution trace item v1")
	}
	if _, ok := executionTraceKindsV1[value.Kind]; !ok {
		return errors.New("invalid execution trace kind v1")
	}
	if _, ok := executionTraceStatusesV1[value.Status]; !ok {
		return errors.New("invalid execution trace status v1")
	}
	if _, ok := executionTraceOperationKindsV1[value.OperationKey]; !ok {
		return errors.New("invalid execution trace operation key v1")
	}
	if value.DurationMS != nil && *value.DurationMS < 0 {
		return errors.New("invalid execution trace duration v1")
	}
	if value.Target != nil && !validExecutionV2Target(*value.Target) {
		return errors.New("invalid execution trace target v1")
	}
	if value.Summary != nil {
		if *value.Summary == "" || validatePublicEventValue(*value.Summary) != nil {
			return errors.New("invalid execution trace summary v1")
		}
	}
	return validateExecutionTraceDetailV1(value.OperationKey, value.Detail)
}

func validateExecutionTraceDetailV1(operationKey string, detail map[string]any) error {
	allowed, ok := executionV2OperationDetailFields[operationKey]
	if !ok {
		if operationKey == "gene_network.target_validated" || operationKey == "gene_network.workflow_selected" ||
			operationKey == "execution.trace.gene_network.reasoning_summary" || operationKey == "execution.trace.gene_network.workflow_decision" {
			return validatePublicEventValue(detail)
		}
		return errors.New("unknown execution trace detail v1")
	}
	for key, raw := range detail {
		kind, found := allowed[key]
		if !found {
			return errors.New("invalid execution trace detail v1")
		}
		switch kind {
		case "integer":
			value, valid := executionV2PayloadInt64(detail, key)
			if !valid || value < 0 || value > 1_000_000 {
				return errors.New("invalid execution trace integer v1")
			}
		case "boolean":
			if _, valid := raw.(bool); !valid {
				return errors.New("invalid execution trace boolean v1")
			}
		case "provider_state":
			state, valid := raw.(string)
			if !valid || !knownProviderStateV2(state) {
				return errors.New("invalid execution trace provider state v1")
			}
		default:
			return errors.New("invalid execution trace detail type v1")
		}
	}
	return validatePublicEventValue(detail)
}

func knownProviderStateV2(value string) bool {
	_, ok := stringSet([]string{"submitted", "queued", "running", "consolidating", "terminal"})[value]
	return ok
}
