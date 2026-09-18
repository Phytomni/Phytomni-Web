package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"time"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"

	"gorm.io/gorm"
)

type WebExecutionSnapshotV2 struct {
	rxBot.ExecutionProjectionV2
	Stale         bool       `json:"stale"`
	Source        string     `json:"source"`
	LastContactAt *time.Time `json:"last_contact_at,omitempty"`
}

type WebExecutionEventPageV2 struct {
	rxBot.ExecutionEventPageV2
	Stale  bool   `json:"stale"`
	Source string `json:"source"`
}

type WebExecutionTargetResolutionV2 struct {
	SchemaVersion    int                     `json:"schema_version"`
	ExecutionID      string                  `json:"execution_id"`
	Target           rxBot.ExecutionTargetV2 `json:"target"`
	Resolution       string                  `json:"resolution"`
	MessageID        *int64                  `json:"message_id,omitempty"`
	ArtifactID       string                  `json:"artifact_id,omitempty"`
	Name             string                  `json:"name,omitempty"`
	MediaType        string                  `json:"media_type,omitempty"`
	SizeBytes        int64                   `json:"size_bytes,omitempty"`
	PreviewAvailable bool                    `json:"preview_available"`
	DeliveryURL      string                  `json:"delivery_url,omitempty"`
}

func admissionSnapshot(admission *executionAdmission) WebExecutionSnapshotV2 {
	trackingHealth := admission.TrackingHealth
	if trackingHealth == "" {
		trackingHealth = "pending"
	}
	projection := rxBot.ExecutionProjectionV2{
		SchemaVersion: 2, ExecutionID: admission.ExecutionID,
		Status: admission.Status, LatestSeq: admission.LatestCursor,
		OutputRevision: admission.ContentRevision, OutputOffset: admission.ContentOffset,
		OperationRevision: admission.DispatchRevision,
		TrackingHealth:    trackingHealth, ActiveSpanIDs: []string{}, Todos: []rxBot.ExecutionTodoItemV2{},
		Results: []rxBot.ExecutionResultItemV2{}, Targets: []rxBot.ExecutionTargetV2{},
		FailedWorkUnitIDs: []string{}, Warnings: []rxBot.ExecutionWarningV2{},
	}
	if admission.ProjectionJSON != "" {
		_ = json.Unmarshal([]byte(admission.ProjectionJSON), &projection)
	}
	if projection.SchemaVersion == 0 {
		projection.SchemaVersion = 2
	}
	if projection.ExecutionID == "" {
		projection.ExecutionID = admission.ExecutionID
	}
	// The admission row is the durable Web authority for dispatch and cached
	// projection progress. Re-apply its monotonic values after decoding the
	// optional Bot projection so an older JSON snapshot cannot hide a later
	// dispatch failure or make a terminal execution appear live again.
	projection.LatestSeq = max(projection.LatestSeq, admission.LatestCursor)
	projection.OutputRevision = max(projection.OutputRevision, admission.ContentRevision)
	projection.OutputOffset = max(projection.OutputOffset, admission.ContentOffset)
	projection.OperationRevision = max(projection.OperationRevision, admission.DispatchRevision)
	if admission.TrackingHealth != "" {
		projection.TrackingHealth = admission.TrackingHealth
	}
	if admission.TerminalStatus != nil {
		projection.Status = *admission.TerminalStatus
		projection.Terminal = &rxBot.ExecutionTerminalV2{
			Status:         *admission.TerminalStatus,
			EventID:        "web-terminal",
			ResultRevision: projection.OutputRevision,
		}
	}
	return WebExecutionSnapshotV2{
		ExecutionProjectionV2: projection,
		Stale:                 true,
		Source:                "web_cache",
		LastContactAt:         admission.LastBotContactAt,
	}
}

func (ps *Service) ExecutionSnapshotV2(ctx context.Context, username, executionID string) (*WebExecutionSnapshotV2, error) {
	admission, err := authorizeExecution(ctx, username, executionID)
	if err != nil {
		return nil, err
	}
	if admission.RunID != nil {
		projection, _, botErr := ps.executionRuntimeClient().GetExecutionSnapshotV2(ctx, username, executionID)
		if botErr == nil {
			now := time.Now().UTC()
			return &WebExecutionSnapshotV2{ExecutionProjectionV2: *projection, Source: "bot", LastContactAt: &now}, nil
		}
	}
	fallback := admissionSnapshot(admission)
	return &fallback, nil
}

// ExecutionStreamSnapshotV2 is the stream-only admission gate. A browser may
// subscribe immediately after minting its execution id, before the concurrent
// message POST has committed the owner admission. Bounded waiting here keeps
// that one canonical subscription alive without changing point-in-time GET
// semantics (unknown snapshot GETs still return 404 immediately).
func (ps *Service) ExecutionStreamSnapshotV2(ctx context.Context, username, executionID string) (*WebExecutionSnapshotV2, error) {
	if _, err := awaitExecutionAdmission(ctx, username, executionID); err != nil {
		return nil, err
	}
	return ps.ExecutionSnapshotV2(ctx, username, executionID)
}

func cachedExecutionEventsV2(ctx context.Context, username, executionID string, afterSeq int64, limit int) (*WebExecutionEventPageV2, error) {
	var rows []model.QuestionAgentExecutionEventV2
	if err := model.DB(ctx).Where("user_name = ? AND execution_id = ? AND seq > ?", username, executionID, afterSeq).
		Order("seq ASC").Limit(limit + 1).Find(&rows).Error; err != nil {
		return nil, err
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	items := make([]rxBot.ExecutionEventV2, 0, len(rows))
	next := afterSeq
	for _, row := range rows {
		var event rxBot.ExecutionEventV2
		if json.Unmarshal([]byte(row.EventJSON), &event) != nil {
			continue
		}
		if err := normalizeProjectedEventCitationReferences(&event); err != nil {
			return nil, err
		}
		items = append(items, event)
		next = event.Seq
	}
	return &WebExecutionEventPageV2{
		ExecutionEventPageV2: rxBot.ExecutionEventPageV2{
			SchemaVersion: 2, ExecutionID: executionID, Items: items,
			NextAfterSeq: next, HasMore: hasMore, Gaps: []rxBot.ExecutionSequenceGapV2{},
		},
		Stale: true, Source: "web_cache",
	}, nil
}

func (ps *Service) ExecutionEventsPageV2(ctx context.Context, username, executionID string, afterSeq int64, limit int) (*WebExecutionEventPageV2, error) {
	admission, err := authorizeExecution(ctx, username, executionID)
	if err != nil {
		return nil, err
	}
	if admission.RunID != nil {
		page, _, botErr := ps.executionRuntimeClient().GetExecutionEventsV2(ctx, username, executionID, afterSeq, limit)
		if botErr == nil {
			for index := range page.Items {
				if err := normalizeProjectedEventCitationReferences(&page.Items[index]); err != nil {
					return nil, err
				}
			}
			return &WebExecutionEventPageV2{ExecutionEventPageV2: *page, Source: "bot"}, nil
		}
	}
	return cachedExecutionEventsV2(ctx, username, executionID, afterSeq, limit)
}

func (ps *Service) ExecutionEventDetailV2(ctx context.Context, username, executionID, eventID string) (*rxBot.ExecutionEventV2, error) {
	admission, err := authorizeExecution(ctx, username, executionID)
	if err != nil {
		return nil, err
	}
	if admission.RunID != nil {
		event, _, botErr := ps.executionRuntimeClient().GetExecutionEventV2(ctx, username, executionID, eventID)
		if botErr == nil {
			if err := normalizeProjectedEventCitationReferences(event); err != nil {
				return nil, err
			}
			return event, nil
		}
	}
	var row model.QuestionAgentExecutionEventV2
	result := model.DB(ctx).Where("user_name = ? AND execution_id = ? AND event_id = ?", username, executionID, eventID).Take(&row)
	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return nil, ErrExecutionRunOwnership
	}
	if result.Error != nil {
		return nil, result.Error
	}
	var event rxBot.ExecutionEventV2
	if err := json.Unmarshal([]byte(row.EventJSON), &event); err != nil {
		return nil, err
	}
	if err := normalizeProjectedEventCitationReferences(&event); err != nil {
		return nil, err
	}
	return &event, nil
}

func (ps *Service) ExecutionOperationDetailV2(ctx context.Context, username, executionID, operationID string) (*rxBot.ExecutionOperationRecordV2, error) {
	admission, err := authorizeExecution(ctx, username, executionID)
	if err != nil {
		return nil, err
	}
	if admission.RunID != nil {
		operation, _, botErr := ps.executionRuntimeClient().GetExecutionOperationV2(ctx, username, executionID, operationID)
		if botErr == nil {
			return operation, nil
		}
	}
	if admission.ProjectionJSON == "" {
		return nil, ErrExecutionRunOwnership
	}
	var projection rxBot.ExecutionProjectionV2
	if err := json.Unmarshal([]byte(admission.ProjectionJSON), &projection); err != nil {
		return nil, err
	}
	for _, operation := range projection.Operations {
		if operation.SchemaVersion == 1 && operation.OperationID == operationID {
			return &operation, nil
		}
	}
	return nil, ErrExecutionRunOwnership
}

func (ps *Service) ExecutionTargetResolutionV2(ctx context.Context, username, executionID, kind, targetID string) (*WebExecutionTargetResolutionV2, error) {
	admission, err := authorizeExecution(ctx, username, executionID)
	if err != nil || admission.RunID == nil {
		return nil, ErrExecutionRunOwnership
	}
	target, _, err := ps.executionRuntimeClient().ResolveExecutionTargetV2(ctx, username, executionID, kind, targetID)
	if err != nil {
		return nil, err
	}
	result := &WebExecutionTargetResolutionV2{
		SchemaVersion: target.SchemaVersion, ExecutionID: target.ExecutionID,
		Target: target.Target, Resolution: target.Resolution,
		Name: target.Name, MediaType: target.MediaType, SizeBytes: target.SizeBytes,
	}
	if target.DeliveryAvailable {
		result.PreviewAvailable = true
		result.DeliveryURL = "/api/v1/executions/" + url.PathEscape(executionID) +
			"/targets/" + url.PathEscape(kind) + "/" + url.PathEscape(targetID) + "/content"
	}
	if admission.MessageID == nil || admission.DialogueID == nil {
		return result, nil
	}
	links, err := ps.conversationArtifactLinks(ctx, username, *admission.DialogueID, *admission.MessageID)
	if err != nil {
		return nil, err
	}
	matchName := ""
	var cached []model.QuestionAgentExecutionEventV2
	if err := model.DB(ctx).Where("user_name = ? AND execution_id = ?", username, executionID).
		Order("seq DESC").Limit(500).Find(&cached).Error; err != nil {
		return nil, err
	}
	for _, row := range cached {
		var event rxBot.ExecutionEventV2
		if json.Unmarshal([]byte(row.EventJSON), &event) != nil || event.Target == nil || event.Target.Kind != kind || event.Target.ID != targetID {
			continue
		}
		matchName, _ = event.PublicPayload["name"].(string)
		break
	}
	for _, link := range links {
		if link.ID != targetID && (matchName == "" || link.Name != matchName) {
			continue
		}
		result.MessageID = admission.MessageID
		result.ArtifactID = link.ID
		result.Name = link.Name
		result.MediaType = link.MediaType
		result.PreviewAvailable = true
		break
	}
	return result, nil
}

func (ps *Service) ExecutionTraceResolutionV1(ctx context.Context, username, executionID, targetID string, afterSeq int64, limit int) (*rxBot.ExecutionTraceResolutionV1, error) {
	admission, err := authorizeExecution(ctx, username, executionID)
	if err != nil || admission.RunID == nil {
		return nil, ErrExecutionRunOwnership
	}
	trace, _, err := ps.executionRuntimeClient().ResolveExecutionTraceV1(
		ctx, username, executionID, targetID, afterSeq, limit,
	)
	if err != nil {
		var apiErr *rxBot.APIError
		if errors.As(err, &apiErr) && apiErr.Status == 404 {
			return nil, ErrExecutionRunOwnership
		}
		return nil, err
	}
	return trace, nil
}

func (ps *Service) OpenExecutionTargetContentV2(ctx context.Context, username, executionID, kind, targetID string) (io.ReadCloser, rxBot.ExecutionTargetContentMetadataV2, error) {
	admission, err := authorizeExecution(ctx, username, executionID)
	if err != nil || admission.RunID == nil {
		return nil, rxBot.ExecutionTargetContentMetadataV2{}, ErrExecutionRunOwnership
	}
	resolution, _, err := ps.executionRuntimeClient().ResolveExecutionTargetV2(ctx, username, executionID, kind, targetID)
	if err != nil || resolution == nil || !resolution.DeliveryAvailable {
		if err != nil {
			return nil, rxBot.ExecutionTargetContentMetadataV2{}, err
		}
		return nil, rxBot.ExecutionTargetContentMetadataV2{}, ErrExecutionRunOwnership
	}
	body, metadata, _, err := ps.executionRuntimeClient().OpenExecutionTargetContentV2(ctx, username, executionID, kind, targetID)
	return body, metadata, err
}

func (ps *Service) ExecutionActionV2(ctx context.Context, username, executionID string, request rxBot.ExecutionActionRequestV2) (*rxBot.ExecutionOperationResponseV2, error) {
	admission, err := authorizeExecution(ctx, username, executionID)
	if err != nil || admission.RunID == nil {
		return nil, ErrExecutionRunOwnership
	}
	response, _, err := ps.executionRuntimeClient().PostExecutionActionV2(ctx, username, executionID, request)
	return response, err
}

func (ps *Service) ExecutionCancelV2(ctx context.Context, username, executionID string, request rxBot.ExecutionCancelRequestV2) (*rxBot.ExecutionOperationResponseV2, error) {
	admission, err := authorizeExecution(ctx, username, executionID)
	if err != nil {
		return nil, err
	}
	if admission.RunID == nil {
		now := time.Now().UTC()
		err = model.DB(ctx).Transaction(func(tx *gorm.DB) error {
			if err := tx.WithContext(ctx).Model(&model.QuestionAgentExecutionOutbox{}).
				Where("user_name = ? AND execution_id = ? AND state IN ?", username, executionID, []string{"pending", "retry"}).
				Updates(map[string]any{"state": "cancelled", "updated_at": now}).Error; err != nil {
				return err
			}
			if err := tx.WithContext(ctx).Model(&model.QuestionAgentExecutionAdmission{}).
				Where("user_name = ? AND execution_id = ? AND terminal_status IS NULL", username, executionID).
				Updates(map[string]any{"status": "cancelled", "terminal_status": "cancelled", "terminal_at": now, "updated_at": now}).Error; err != nil {
				return err
			}
			return tx.WithContext(ctx).Model(&model.ConversationMessageV2{}).
				Where("user_name = ? AND execution_id = ? AND message_type = ?", username, executionID, "assistant").
				Updates(map[string]any{"status": "cancelled", "updated_at": now}).Error
		})
		if err != nil {
			return nil, err
		}
		return &rxBot.ExecutionOperationResponseV2{
			SchemaVersion: 2, ExecutionID: executionID, RequestID: request.RequestID,
			Status: "cancelled", CancellationOutcome: "confirmed",
		}, nil
	}
	response, _, err := ps.executionRuntimeClient().CancelExecutionV2(ctx, username, executionID, request)
	return response, err
}

func (ps *Service) OpenExecutionStreamV2(ctx context.Context, username, executionID string, afterSeq, afterRevision, afterOffset int64) (io.ReadCloser, error) {
	admission, err := authorizeExecution(ctx, username, executionID)
	if err != nil || admission.RunID == nil {
		return nil, ErrExecutionRunOwnership
	}
	body, _, err := ps.executionRuntimeClient().OpenExecutionStreamV2(ctx, username, executionID, afterSeq, afterRevision, afterOffset)
	return body, err
}

func (ps *Service) ExecutionAdmissionBinding(ctx context.Context, username, executionID string) (*executionAdmission, error) {
	return authorizeExecution(ctx, username, executionID)
}
