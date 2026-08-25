package api_service

import (
	"context"
	"errors"
	"io"
	"time"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"

	"gorm.io/gorm"
)

var ErrExecutionRunOwnership = errors.New("execution run not found")

type executionAdmission struct {
	Username           string     `gorm:"column:user_name;primaryKey"`
	ExecutionID        string     `gorm:"column:execution_id;primaryKey"`
	RequestFingerprint string     `gorm:"column:request_fingerprint"`
	DialogueID         *string    `gorm:"column:dialogue_id"`
	MessageID          *int64     `gorm:"column:message_id"`
	RunID              *string    `gorm:"column:bot_run_id"`
	Status             string     `gorm:"column:status"`
	LatestCursor       int64      `gorm:"column:latest_cursor"`
	ProjectionJSON     string     `gorm:"column:projection_json"`
	FingerprintVersion int        `gorm:"column:fingerprint_version"`
	DispatchRevision   int64      `gorm:"column:dispatch_revision"`
	ProjectionRevision int64      `gorm:"column:projection_revision"`
	ContentRevision    int64      `gorm:"column:content_revision"`
	ContentOffset      int64      `gorm:"column:content_offset"`
	ContextRevision    int64      `gorm:"column:context_revision"`
	TerminalStatus     *string    `gorm:"column:terminal_status"`
	TerminalAt         *time.Time `gorm:"column:terminal_at"`
	LastBotContactAt   *time.Time `gorm:"column:last_bot_contact_at"`
	TrackingHealth     string     `gorm:"column:tracking_health"`
	CreatedAt          time.Time  `gorm:"column:created_at"`
	UpdatedAt          time.Time  `gorm:"column:updated_at"`
}

func (executionAdmission) TableName() string {
	return "question_agent_execution_admissions"
}

func nullableString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func nullableInt64(value int64) *int64 {
	if value == 0 {
		return nil
	}
	return &value
}

func loadExecutionAdmission(ctx context.Context, username, executionID string) (*executionAdmission, error) {
	if username == "" || executionID == "" {
		return nil, ErrExecutionRunOwnership
	}
	var row executionAdmission
	result := model.DB(ctx).Where("user_name = ? AND execution_id = ?", username, executionID).Take(&row)
	if errors.Is(result.Error, gorm.ErrRecordNotFound) || result.RowsAffected == 0 {
		return nil, ErrExecutionRunOwnership
	}
	if result.Error != nil {
		return nil, result.Error
	}
	return &row, nil
}

func (ps *Service) reserveExecutionAdmission(ctx context.Context, username, executionID, fingerprint, dialogueID string, messageID int64) (*executionAdmission, error) {
	if username == "" || executionID == "" || fingerprint == "" {
		return nil, ErrDuplicateClientTurn
	}
	if existing, err := loadExecutionAdmission(ctx, username, executionID); err == nil {
		if existing.RequestFingerprint != fingerprint {
			return nil, ErrDuplicateClientTurn
		}
		return existing, nil
	} else if !errors.Is(err, ErrExecutionRunOwnership) {
		return nil, err
	}
	now := time.Now().UTC()
	row := &executionAdmission{
		Username: username, ExecutionID: executionID, RequestFingerprint: fingerprint,
		DialogueID: nullableString(dialogueID), MessageID: nullableInt64(messageID),
		Status: "admitted", CreatedAt: now, UpdatedAt: now,
	}
	if err := model.DB(ctx).Create(row).Error; err != nil {
		// A concurrent claimant may have committed the same owner/execution key.
		existing, lookupErr := loadExecutionAdmission(ctx, username, executionID)
		if lookupErr != nil {
			return nil, err
		}
		if existing.RequestFingerprint != fingerprint {
			return nil, ErrDuplicateClientTurn
		}
		return existing, nil
	}
	return row, nil
}

func enrichExecutionAdmission(ctx context.Context, username, executionID, fingerprint, dialogueID string, messageID int64, runID, status string) error {
	updates := map[string]any{
		"dialogue_id": nullableString(dialogueID), "message_id": nullableInt64(messageID),
		"bot_run_id": nullableString(runID), "status": status, "updated_at": time.Now().UTC(),
	}
	result := model.DB(ctx).Model(&executionAdmission{}).
		Where("user_name = ? AND execution_id = ? AND request_fingerprint = ?", username, executionID, fingerprint).
		Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}
	existing, err := loadExecutionAdmission(ctx, username, executionID)
	if err != nil {
		return err
	}
	if existing.RequestFingerprint != fingerprint {
		return ErrDuplicateClientTurn
	}
	return nil
}

func authorizeExecution(ctx context.Context, username, executionID string) (*executionAdmission, error) {
	return loadExecutionAdmission(ctx, username, executionID)
}

const executionAdmissionGrace = 30 * time.Second

func awaitExecutionAdmission(ctx context.Context, username, executionID string) (*executionAdmission, error) {
	deadline := time.NewTimer(executionAdmissionGrace)
	defer deadline.Stop()
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		admission, err := authorizeExecution(ctx, username, executionID)
		if err == nil || !errors.Is(err, ErrExecutionRunOwnership) {
			return admission, err
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-deadline.C:
			return nil, ErrExecutionRunOwnership
		case <-ticker.C:
		}
	}
}

func (ps *Service) ExecutionEvents(ctx context.Context, username, executionID string, afterSeq int64, limit int) (*rxBot.ExecutionEventPageV1, error) {
	if _, err := authorizeExecution(ctx, username, executionID); err != nil {
		return nil, err
	}
	return ps.executionEventClient().GetExecutionEvents(ctx, executionID, afterSeq, limit)
}

func (ps *Service) ExecutionEventProjection(ctx context.Context, username, executionID string) (*rxBot.RunEventProjectionV1, error) {
	if _, err := authorizeExecution(ctx, username, executionID); err != nil {
		return nil, err
	}
	projection, err := ps.executionEventClient().GetExecutionEventProjection(ctx, executionID)
	if err != nil {
		return nil, err
	}
	if projection.LatestSeq < 0 {
		return nil, errors.New("invalid execution projection")
	}
	return projection, nil
}

func (ps *Service) ExecutionEvent(ctx context.Context, username, executionID, eventID string) (*rxBot.ExecutionEventV1, error) {
	if eventID == "" {
		return nil, ErrExecutionRunOwnership
	}
	if _, err := authorizeExecution(ctx, username, executionID); err != nil {
		return nil, err
	}
	return ps.executionEventClient().GetExecutionEvent(ctx, executionID, eventID)
}

func (ps *Service) ExecutionEventStream(ctx context.Context, username, executionID string, afterSeq int64) (io.ReadCloser, rxBot.ResponseMeta, error) {
	if _, err := awaitExecutionAdmission(ctx, username, executionID); err != nil {
		return nil, rxBot.ResponseMeta{}, err
	}
	return ps.executionEventClient().OpenExecutionEventStream(ctx, executionID, afterSeq)
}

type executionRunBinding struct {
	MessageID  int64
	Username   string
	DialogueID string
	RunID      string
}

var executionTargetKinds = map[string]struct{}{
	"event": {}, "artifact": {}, "report": {}, "todo": {}, "preview": {}, "download": {},
}

// ExecutionTargetResolution is a browser-safe, owner-authorized target
// descriptor. It never contains a Bot path, storage key, or signed URL.
type ExecutionTargetResolution struct {
	SchemaVersion    int                     `json:"schema_version"`
	Kind             string                  `json:"kind"`
	ID               string                  `json:"id"`
	EventID          string                  `json:"event_id"`
	Name             string                  `json:"name,omitempty"`
	MediaType        string                  `json:"media_type,omitempty"`
	SizeBytes        int64                   `json:"size_bytes,omitempty"`
	MessageID        int64                   `json:"message_id,omitempty"`
	ArtifactID       string                  `json:"artifact_id,omitempty"`
	PreviewAvailable bool                    `json:"preview_available"`
	Event            *rxBot.ExecutionEventV1 `json:"event,omitempty"`
	Todos            []rxBot.PublicTodoItem  `json:"todos,omitempty"`
}

func loadExecutionRunBinding(ctx context.Context, username, dialogueID, runID string) (executionRunBinding, error) {
	if username == "" || dialogueID == "" || runID == "" {
		return executionRunBinding{}, ErrExecutionRunOwnership
	}
	var row model.QuestionAgentLog
	result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Select("id").
		Where(
			"user_name = ? AND dialogue_id = ? AND bot_run_id = ? AND delete_at IS NULL",
			username,
			dialogueID,
			runID,
		).
		Take(&row)
	if errors.Is(result.Error, gorm.ErrRecordNotFound) || result.RowsAffected == 0 {
		return executionRunBinding{}, ErrExecutionRunOwnership
	}
	if result.Error != nil {
		return executionRunBinding{}, result.Error
	}
	return executionRunBinding{MessageID: row.Id, Username: username, DialogueID: dialogueID, RunID: runID}, nil
}

func (ps *Service) ConversationRunEvents(ctx context.Context, username, dialogueID, runID string, afterSeq int64, limit int) (*rxBot.ExecutionEventPageV1, error) {
	if _, err := loadExecutionRunBinding(ctx, username, dialogueID, runID); err != nil {
		return nil, err
	}
	return ps.executionEventClient().GetRunEvents(ctx, runID, afterSeq, limit)
}

func (ps *Service) ConversationRunEventProjection(ctx context.Context, username, dialogueID, runID string) (*rxBot.RunEventProjectionV1, error) {
	if _, err := loadExecutionRunBinding(ctx, username, dialogueID, runID); err != nil {
		return nil, err
	}
	projection, err := ps.executionEventClient().GetRunEventProjection(ctx, runID)
	if err != nil {
		return nil, err
	}
	if projection.RunID != runID || projection.LatestSeq < 0 {
		return nil, errors.New("invalid execution projection")
	}
	return projection, nil
}

func (ps *Service) ConversationRunEvent(ctx context.Context, username, dialogueID, runID, eventID string) (*rxBot.ExecutionEventV1, error) {
	if eventID == "" {
		return nil, ErrExecutionRunOwnership
	}
	if _, err := loadExecutionRunBinding(ctx, username, dialogueID, runID); err != nil {
		return nil, err
	}
	return ps.executionEventClient().GetRunEvent(ctx, runID, eventID)
}

// ConversationRunExecutionTarget resolves only targets that occur in the
// owned run's committed ledger. Artifact links are translated to Web opaque
// ids when the existing conversation artifact projection can prove a match.
func (ps *Service) ConversationRunExecutionTarget(ctx context.Context, username, dialogueID, runID, kind, targetID string) (*ExecutionTargetResolution, error) {
	if _, ok := executionTargetKinds[kind]; !ok || targetID == "" {
		return nil, ErrExecutionRunOwnership
	}
	binding, err := loadExecutionRunBinding(ctx, username, dialogueID, runID)
	if err != nil {
		return nil, err
	}
	return ps.resolveExecutionTarget(
		ctx, username, dialogueID, binding.MessageID, kind, targetID,
		func(eventID string) (*rxBot.ExecutionEventV1, error) {
			return ps.executionEventClient().GetRunEvent(ctx, runID, eventID)
		},
		func(after int64) (*rxBot.ExecutionEventPageV1, error) {
			return ps.executionEventClient().GetRunEvents(ctx, runID, after, 200)
		},
	)
}

// ExecutionTarget resolves a typed target through the owner-scoped public
// execution admission. It remains usable before dialogue/message/run binding
// is enriched, while artifact preview mapping activates only after the owned
// message exists.
func (ps *Service) ExecutionTarget(ctx context.Context, username, executionID, kind, targetID string) (*ExecutionTargetResolution, error) {
	if _, ok := executionTargetKinds[kind]; !ok || targetID == "" {
		return nil, ErrExecutionRunOwnership
	}
	admission, err := authorizeExecution(ctx, username, executionID)
	if err != nil {
		return nil, err
	}
	dialogueID := ""
	messageID := int64(0)
	if admission.DialogueID != nil {
		dialogueID = *admission.DialogueID
	}
	if admission.MessageID != nil {
		messageID = *admission.MessageID
	}
	return ps.resolveExecutionTarget(
		ctx, username, dialogueID, messageID, kind, targetID,
		func(eventID string) (*rxBot.ExecutionEventV1, error) {
			return ps.executionEventClient().GetExecutionEvent(ctx, executionID, eventID)
		},
		func(after int64) (*rxBot.ExecutionEventPageV1, error) {
			return ps.executionEventClient().GetExecutionEvents(ctx, executionID, after, 200)
		},
	)
}

func (ps *Service) resolveExecutionTarget(
	ctx context.Context,
	username, dialogueID string,
	messageID int64,
	kind, targetID string,
	getEvent func(string) (*rxBot.ExecutionEventV1, error),
	getPage func(int64) (*rxBot.ExecutionEventPageV1, error),
) (*ExecutionTargetResolution, error) {
	if kind == "event" {
		event, err := getEvent(targetID)
		if err != nil {
			return nil, err
		}
		return &ExecutionTargetResolution{SchemaVersion: 1, Kind: kind, ID: targetID, EventID: event.EventID, MessageID: messageID, PreviewAvailable: true, Event: event}, nil
	}

	var matched *rxBot.ExecutionEventV1
	after := int64(0)
	for scanned := 0; scanned < 10_000; {
		page, err := getPage(after)
		if err != nil {
			return nil, err
		}
		for index := range page.Items {
			event := &page.Items[index]
			if event.Target != nil && event.Target.Kind == kind && event.Target.ID == targetID {
				matched = event
				break
			}
		}
		if matched != nil || !page.HasMore || page.NextAfterSeq <= after {
			break
		}
		scanned += len(page.Items)
		after = page.NextAfterSeq
	}
	if matched == nil {
		return nil, ErrExecutionRunOwnership
	}
	resolution := &ExecutionTargetResolution{
		SchemaVersion: 1, Kind: kind, ID: targetID, EventID: matched.EventID, MessageID: messageID, Event: matched,
	}
	if kind == "todo" {
		if items, ok := matched.Payload["items"].([]any); ok {
			for _, raw := range items {
				item, ok := raw.(map[string]any)
				if !ok {
					continue
				}
				id, _ := item["id"].(string)
				labelKey, _ := item["label_key"].(string)
				status, _ := item["status"].(string)
				if id != "" && labelKey != "" && status != "" {
					resolution.Todos = append(resolution.Todos, rxBot.PublicTodoItem{ID: id, LabelKey: labelKey, Status: status})
				}
			}
		}
		resolution.PreviewAvailable = true
		return resolution, nil
	}
	resolution.Name, _ = matched.Payload["name"].(string)
	resolution.MediaType, _ = matched.Payload["media_type"].(string)
	if size, ok := matched.Payload["size_bytes"].(float64); ok && size >= 0 {
		resolution.SizeBytes = int64(size)
	} else if size, ok := matched.Payload["size_bytes"].(int64); ok && size >= 0 {
		resolution.SizeBytes = size
	}
	if dialogueID != "" && messageID != 0 {
		links, artifactErr := ps.conversationArtifactLinks(ctx, username, dialogueID, messageID)
		if artifactErr != nil {
			return resolution, nil
		}
		for _, link := range links {
			if link.Name == resolution.Name {
				resolution.ArtifactID = link.ID
				resolution.PreviewAvailable = true
				break
			}
		}
	}
	return resolution, nil
}

func (ps *Service) ConversationRunEventStream(ctx context.Context, username, dialogueID, runID string, afterSeq int64) (io.ReadCloser, rxBot.ResponseMeta, error) {
	if _, err := loadExecutionRunBinding(ctx, username, dialogueID, runID); err != nil {
		return nil, rxBot.ResponseMeta{}, err
	}
	return ps.executionEventClient().OpenRunEventStream(ctx, runID, afterSeq)
}
