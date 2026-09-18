package api_service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"sort"
	"strings"
	"time"

	rxBot "phytomni-server/external/bot"
	rxLog "phytomni-server/log"
	"phytomni-server/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	executionWorkerLease         = 30 * time.Second
	executionWorkerBatch         = 25
	executionDispatchMaxAttempts = 6
)

type ExecutionWorkerStats struct {
	Claimed      int
	Acknowledged int
	Retried      int
	Reconciled   int
	Rejected     int
	DeadLettered int
	Projected    int
	Error        error
}

func botArgumentsForCommand(command canonicalMessageExecutionCommand) (map[string]any, error) {
	if command.AgentSlug == expertRouterAgentSlug {
		args := map[string]any{
			"__query":                command.Query,
			"__allowed_tools":        append([]string(nil), command.AllowedTools...),
			"__dialogue_id":          command.DialogueID,
			"locale":                 command.Locale,
			"__user_message_id":      command.UserMessageID,
			"__assistant_message_id": command.AssistantMessageID,
		}
		if command.Conversation != nil {
			args["__conversation"] = command.Conversation
		}
		if len(command.Attachments) > 0 {
			args["__attachments"] = append([]rxBot.AssetAttachmentRef(nil), command.Attachments...)
			args["__attachment_owner"] = command.OwnerRef
		}
		return args, nil
	}
	args, err := rxBot.BuildAgentArguments(command.AgentSlug, rxBot.AgentArgumentInput{
		UserQuery: command.Query, HasAttachments: len(command.Attachments) > 0,
		GeneID: command.GeneID, ToID: command.ToID, SpeciesCode: command.SpeciesCode,
		InteropMode: command.InteropMode, InteropTargets: command.InteropTargets,
	})
	if err != nil {
		return nil, err
	}
	args["locale"] = command.Locale
	args["__user_message_id"] = command.UserMessageID
	args["__assistant_message_id"] = command.AssistantMessageID
	if command.Conversation != nil {
		args["__conversation"] = command.Conversation
		args["__query"] = command.Query
		args["__allowed_tools"] = append([]string(nil), command.AllowedTools...)
		args["__dialogue_id"] = command.DialogueID
		if command.RequestedTool != "" {
			args["__forced_tool"] = command.RequestedTool
		}
	}
	// Native upload resolution remains Bot-owned. These opaque identities are
	// private dispatcher metadata and are never accepted as paths by a tool.
	if len(command.Attachments) > 0 {
		args["__attachments"] = append([]rxBot.AssetAttachmentRef(nil), command.Attachments...)
		args["__attachment_owner"] = command.OwnerRef
		args["__agent_slug"] = command.AgentSlug
	}
	return args, nil
}

func (ps *Service) claimExecutionOutbox(ctx context.Context, workerID string) (*model.QuestionAgentExecutionOutbox, error) {
	now := time.Now().UTC()
	var claimed model.QuestionAgentExecutionOutbox
	err := model.DB(ctx).Transaction(func(tx *gorm.DB) error {
		var row model.QuestionAgentExecutionOutbox
		err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Where("(state IN ? AND next_attempt_at <= ?) OR (state = ? AND lease_until < ?)", []string{"pending", "retry"}, now, "processing", now).
			Order("next_attempt_at ASC, id ASC").Take(&row).Error
		if err != nil {
			return err
		}
		wasExpiredLease := row.State == "processing" && row.LeaseUntil != nil && row.LeaseUntil.Before(now)
		leaseUntil := now.Add(executionWorkerLease)
		result := tx.WithContext(ctx).Model(&model.QuestionAgentExecutionOutbox{}).
			Where("user_name = ? AND execution_id = ? AND revision = ?", row.UserName, row.ExecutionID, row.Revision).
			Updates(map[string]any{
				"state": "processing", "attempts": row.Attempts + 1,
				"lease_owner": workerID, "lease_until": leaseUntil, "revision": row.Revision + 1, "updated_at": now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		row.State, row.Attempts, row.Revision, row.UpdatedAt = "processing", row.Attempts+1, row.Revision+1, now
		row.LeaseOwner, row.LeaseUntil = &workerID, &leaseUntil
		if wasExpiredLease {
			observeExecutionMetricV2(metricLeaseStolen)
		}
		claimed = row
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &claimed, nil
}

type dispatchClassification string

const (
	dispatchRetry     dispatchClassification = "retry"
	dispatchReconcile dispatchClassification = "reconcile"
	dispatchReject    dispatchClassification = "reject"
)

type dispatchBoundaryState string

const (
	dispatchBoundaryNotEntered     dispatchBoundaryState = "not_entered"
	dispatchBoundaryEntered        dispatchBoundaryState = "entered"
	dispatchBoundaryDurablyClaimed dispatchBoundaryState = "durably_claimed"
)

type classifiedDispatchFailure struct {
	Classification dispatchClassification
	Code           string
	BoundaryState  dispatchBoundaryState
}

func classifyDispatchFailure(err error, boundary dispatchBoundaryState) classifiedDispatchFailure {
	if errors.Is(err, rxBot.ErrExecutionServiceTokenMissing) {
		return classifiedDispatchFailure{dispatchRetry, "service_auth_unavailable", dispatchBoundaryNotEntered}
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, rxBot.ErrBotTimeout) {
		return classifiedDispatchFailure{dispatchRetry, "transport_timeout", boundary}
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return classifiedDispatchFailure{dispatchRetry, "transport_connection_failed", boundary}
	}
	var apiErr *rxBot.APIError
	if errors.As(err, &apiErr) {
		code := boundedDispatchCode(apiErr.Code)
		if code == "conversation_context_turn_in_progress" || code == "execution_already_reserved" {
			return classifiedDispatchFailure{dispatchReconcile, code, dispatchBoundaryDurablyClaimed}
		}
		if apiErr.Status == 429 {
			return classifiedDispatchFailure{dispatchRetry, "provider_rate_limited", boundary}
		}
		if apiErr.Status == 408 || apiErr.Status == 425 || apiErr.Status >= 500 || apiErr.Retryable {
			return classifiedDispatchFailure{dispatchRetry, "provider_unavailable", boundary}
		}
		if apiErr.Status >= 400 && apiErr.Status < 500 {
			if code == "" {
				code = "invalid_command"
			}
			return classifiedDispatchFailure{dispatchReject, code, boundary}
		}
	}
	return classifiedDispatchFailure{dispatchReconcile, "dispatch_unknown_after_boundary", boundary}
}

func boundedDispatchCode(code string) string {
	code = strings.TrimSpace(code)
	if len(code) > 64 {
		code = code[:64]
	}
	return code
}

func dispatchBackoff(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	delay := time.Second << min(attempt-1, 6)
	if delay > time.Minute {
		return time.Minute
	}
	return delay
}

func (ps *Service) settleDispatchFailure(
	ctx context.Context,
	row *model.QuestionAgentExecutionOutbox,
	failure classifiedDispatchFailure,
) (string, error) {
	now := time.Now().UTC()
	state := string(failure.Classification)
	if failure.Classification == dispatchReject {
		state = "rejected"
	}
	if failure.Classification == dispatchRetry && row.Attempts >= executionDispatchMaxAttempts {
		state = "reconcile"
	}
	updates := map[string]any{
		"state":              state,
		"classification":     string(failure.Classification),
		"boundary_state":     string(failure.BoundaryState),
		"first_error_code":   gorm.Expr("COALESCE(first_error_code, ?)", nullableString(failure.Code)),
		"last_error_code":    nullableString(failure.Code),
		"last_error_message": nil, "lease_owner": nil, "lease_until": nil, "updated_at": now,
		"revision": row.Revision + 1,
	}
	if state == "retry" {
		updates["next_attempt_at"] = now.Add(dispatchBackoff(row.Attempts))
	} else if state == "reconcile" {
		updates["next_reconcile_at"] = now
	}
	err := model.DB(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.WithContext(ctx).Model(&model.QuestionAgentExecutionOutbox{}).
			Where("user_name = ? AND execution_id = ? AND state = ? AND lease_owner = ? AND revision = ?", row.UserName, row.ExecutionID, "processing", *row.LeaseOwner, row.Revision).
			Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		admissionUpdates := map[string]any{"tracking_health": "degraded", "updated_at": now}
		if state == "rejected" {
			terminal := "failed"
			admissionUpdates["status"] = terminal
			admissionUpdates["terminal_status"] = terminal
			admissionUpdates["terminal_at"] = now
		}
		if err := tx.WithContext(ctx).Model(&model.QuestionAgentExecutionAdmission{}).
			Where("user_name = ? AND execution_id = ?", row.UserName, row.ExecutionID).
			Updates(admissionUpdates).Error; err != nil {
			return err
		}
		if state == "rejected" {
			if err := tx.WithContext(ctx).Model(&model.ConversationTurnV2{}).
				Where("user_name = ? AND execution_id = ? AND delete_at IS NULL", row.UserName, row.ExecutionID).
				Updates(map[string]any{"status": "failed", "updated_at": now}).Error; err != nil {
				return err
			}
			return tx.WithContext(ctx).Model(&model.ConversationMessageV2{}).
				Where("user_name = ? AND execution_id = ? AND message_type = ?", row.UserName, row.ExecutionID, "assistant").
				Updates(map[string]any{"status": "failed", "updated_at": now}).Error
		}
		return nil
	})
	return state, err
}

func (ps *Service) DispatchExecutionOutboxOnce(ctx context.Context, workerID string) (ExecutionWorkerStats, error) {
	stats := ExecutionWorkerStats{}
	for stats.Claimed < executionWorkerBatch {
		row, err := ps.claimExecutionOutbox(ctx, workerID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return stats, nil
		}
		if err != nil {
			return stats, err
		}
		stats.Claimed++
		observeExecutionMetricV2(metricDispatchClaimed)
		var command canonicalMessageExecutionCommand
		if err := json.Unmarshal([]byte(row.CommandJSON), &command); err != nil || command.ExecutionID != row.ExecutionID || command.OwnerRef != row.UserName {
			state, settleErr := ps.settleDispatchFailure(ctx, row, classifiedDispatchFailure{
				Classification: dispatchReject, Code: "poison_command", BoundaryState: dispatchBoundaryNotEntered,
			})
			if settleErr != nil {
				return stats, settleErr
			}
			if state == "rejected" {
				stats.Rejected++
				observeExecutionMetricV2(metricDispatchRejected)
			}
			continue
		}
		arguments, err := botArgumentsForCommand(command)
		if err != nil {
			state, settleErr := ps.settleDispatchFailure(ctx, row, classifiedDispatchFailure{
				Classification: dispatchReject, Code: "invalid_command", BoundaryState: dispatchBoundaryNotEntered,
			})
			if settleErr != nil {
				return stats, settleErr
			}
			if state == "rejected" {
				stats.Rejected++
				observeExecutionMetricV2(metricDispatchRejected)
			}
			continue
		}
		response, _, err := ps.executionRuntimeClient().AdmitExecutionV2(ctx, rxBot.ExecutionAdmissionRequestV2{
			SchemaVersion: 2, OwnerRef: row.UserName, ExecutionID: row.ExecutionID,
			FingerprintVersion: command.FingerprintVersion, Fingerprint: command.Fingerprint,
			AgentSlug: command.AgentSlug, Arguments: arguments,
		})
		if err != nil {
			failure := classifyDispatchFailure(err, dispatchBoundaryEntered)
			state, settleErr := ps.settleDispatchFailure(ctx, row, failure)
			if settleErr != nil {
				return stats, settleErr
			}
			switch state {
			case "retry":
				stats.Retried++
				observeExecutionMetricV2(metricDispatchRetried)
			case "reconcile":
				stats.Reconciled++
				observeExecutionMetricV2(metricDispatchReconciled)
			case "rejected":
				stats.Rejected++
				observeExecutionMetricV2(metricDispatchRejected)
			}
			continue
		}
		now := time.Now().UTC()
		err = model.DB(ctx).Transaction(func(tx *gorm.DB) error {
			result := tx.WithContext(ctx).Model(&model.QuestionAgentExecutionOutbox{}).
				Where("user_name = ? AND execution_id = ? AND state = ? AND lease_owner = ? AND revision = ?", row.UserName, row.ExecutionID, "processing", *row.LeaseOwner, row.Revision).
				Updates(map[string]any{"state": "acknowledged", "acknowledged_at": now, "lease_owner": nil, "lease_until": nil, "revision": row.Revision + 1, "updated_at": now})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return gorm.ErrRecordNotFound
			}
			if err := tx.WithContext(ctx).Model(&model.QuestionAgentExecutionAdmission{}).
				Where("user_name = ? AND execution_id = ? AND request_fingerprint = ?", row.UserName, row.ExecutionID, command.Fingerprint).
				Updates(map[string]any{
					"bot_run_id": nullableString(response.RunID), "status": response.Status,
					"dispatch_revision": response.SupervisorRevision, "last_bot_contact_at": now,
					"tracking_health": "healthy", "updated_at": now,
				}).Error; err != nil {
				return err
			}
			return tx.WithContext(ctx).Model(&model.ConversationTurnV2{}).
				Where("user_name = ? AND execution_id = ? AND delete_at IS NULL", row.UserName, row.ExecutionID).
				Updates(map[string]any{"status": response.Status, "updated_at": now}).Error
		})
		if err != nil {
			return stats, err
		}
		stats.Acknowledged++
		observeExecutionMetricV2(metricDispatchAcknowledged)
	}
	return stats, nil
}

func parseEventTime(value string) time.Time {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Now().UTC()
	}
	return parsed.UTC()
}

type projectedMessageContent struct {
	MessageID   string
	Text        string
	Revision    int64
	Offset      int64
	TotalLength int64
	ContentSHA  string
	Complete    bool
	SourceEvent *string
	References  []model.ConversationCitationReferenceV2
}

type projectedMessageChunk struct {
	index       int64
	baseOffset  int64
	offset      int64
	count       int64
	totalLength int64
	text        string
	digest      string
	eventID     string
	completed   bool
}

func payloadInt64(payload map[string]any, key string) (int64, bool) {
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

func legacyDerivedAssistantMessageID(executionID string) string {
	digest := fmt.Sprintf("%x", sha256.Sum256([]byte(executionID)))
	return "msg:assistant:" + digest[:32]
}

func reconstructProjectedMessage(events []rxBot.ExecutionEventV2, executionID, expectedMessageID string) (*projectedMessageContent, error) {
	chunksByRevision := map[int64]map[int64]projectedMessageChunk{}
	var latestRevision int64
	var projectedMessageID string
	var projectedReferences []model.ConversationCitationReferenceV2
	for _, event := range events {
		if event.Type != "message.snapshot" && event.Type != "message.completed" {
			continue
		}
		if event.ExecutionID != executionID {
			return nil, errors.New("message event execution identity mismatch")
		}
		payload := event.PublicPayload
		messageID, _ := payload["message_id"].(string)
		if messageID == "" {
			messageID = expectedMessageID
		}
		if messageID == "" || expectedMessageID != "" && messageID != expectedMessageID && messageID != legacyDerivedAssistantMessageID(executionID) {
			return nil, errors.New("message event identity mismatch")
		}
		if projectedMessageID == "" {
			projectedMessageID = messageID
			if expectedMessageID != "" {
				projectedMessageID = expectedMessageID
			}
		}
		sourceMessageID, _ := payload["source_message_id"].(string)
		if sourceMessageID == "" {
			sourceMessageID = messageID
		}
		if sourceMessageID != messageID {
			return nil, errors.New("message event source identity mismatch")
		}
		text, ok := payload["text"].(string)
		if !ok {
			return nil, errors.New("message event text missing")
		}
		revision, ok := payloadInt64(payload, "output_revision")
		if !ok || revision < 1 {
			return nil, errors.New("message event revision invalid")
		}
		baseOffset, hasBase := payloadInt64(payload, "base_offset")
		offset, hasOffset := payloadInt64(payload, "offset")
		totalLength, hasTotal := payloadInt64(payload, "total_length")
		chunkIndex, hasIndex := payloadInt64(payload, "chunk_index")
		chunkCount, hasCount := payloadInt64(payload, "chunk_count")
		digest, hasDigest := payload["content_sha256"].(string)
		if event.Type == "message.completed" {
			if rawReferences, present := payload["references"]; present {
				references, err := decodeProjectedCitationReferences(rawReferences)
				if err != nil {
					return nil, err
				}
				projectedReferences = references
			}
		}
		if !hasBase && hasOffset && !hasTotal && !hasIndex && !hasCount && !hasDigest {
			// Compatibility with bounded V2 events emitted before reconstructible
			// message facts were introduced. This path is read-only and does not
			// create a second projection model.
			baseOffset, totalLength, chunkIndex, chunkCount = 0, int64(len([]rune(text))), 0, 1
			digest = fmt.Sprintf("%x", sha256.Sum256([]byte(text)))
			hasBase, hasTotal, hasIndex, hasCount, hasDigest = true, true, true, true, true
		}
		if !hasBase || !hasOffset || !hasTotal || !hasIndex || !hasCount || !hasDigest ||
			baseOffset < 0 || offset != baseOffset+int64(len([]rune(text))) || totalLength < offset ||
			chunkIndex < 0 || chunkCount < 1 || chunkIndex >= chunkCount || len(digest) != 64 {
			return nil, errors.New("message event chunk metadata invalid")
		}
		if chunksByRevision[revision] == nil {
			chunksByRevision[revision] = map[int64]projectedMessageChunk{}
		}
		chunk := projectedMessageChunk{index: chunkIndex, baseOffset: baseOffset, offset: offset, count: chunkCount, totalLength: totalLength, text: text, digest: digest, eventID: event.EventID, completed: event.Type == "message.completed"}
		if existing, exists := chunksByRevision[revision][chunkIndex]; exists && existing != chunk {
			return nil, errors.New("conflicting message event chunk")
		}
		chunksByRevision[revision][chunkIndex] = chunk
		if revision > latestRevision {
			latestRevision = revision
		}
	}
	if latestRevision == 0 {
		return nil, nil
	}
	chunks := chunksByRevision[latestRevision]
	indices := make([]int64, 0, len(chunks))
	for index := range chunks {
		indices = append(indices, index)
	}
	sort.Slice(indices, func(i, j int) bool { return indices[i] < indices[j] })
	var builder strings.Builder
	var offset, totalLength, chunkCount int64
	var expectedIndex int64
	var digest string
	var finalEvent *string
	for _, index := range indices {
		chunk := chunks[index]
		if chunk.index != expectedIndex {
			break
		}
		if chunk.baseOffset != offset {
			break
		}
		if digest == "" {
			digest, totalLength, chunkCount = chunk.digest, chunk.totalLength, chunk.count
		} else if digest != chunk.digest || totalLength != chunk.totalLength || chunkCount != chunk.count {
			return nil, errors.New("message event chunk contract drift")
		}
		builder.WriteString(chunk.text)
		offset = chunk.offset
		expectedIndex++
		if chunk.completed {
			eventID := chunk.eventID
			finalEvent = &eventID
		}
	}
	text := builder.String()
	complete := finalEvent != nil && int64(len(chunks)) == chunkCount && offset == totalLength
	if complete && fmt.Sprintf("%x", sha256.Sum256([]byte(text))) != digest {
		return nil, errors.New("message content digest mismatch")
	}
	return &projectedMessageContent{MessageID: projectedMessageID, Text: text, Revision: latestRevision, Offset: offset, TotalLength: totalLength, ContentSHA: digest, Complete: complete, SourceEvent: finalEvent, References: projectedReferences}, nil
}

func decodeProjectedCitationReferences(value any) ([]model.ConversationCitationReferenceV2, error) {
	normalized, err := rxBot.NormalizeExecutionCitationReferencesV2(value)
	if err != nil {
		return nil, errors.New("invalid projected citation references")
	}
	encoded, err := json.Marshal(normalized)
	if err != nil || len(encoded) > 64*1024 {
		return nil, errors.New("invalid projected citation references")
	}
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.DisallowUnknownFields()
	var references []model.ConversationCitationReferenceV2
	if err := decoder.Decode(&references); err != nil || len(references) > 64 {
		return nil, errors.New("invalid projected citation references")
	}
	return references, nil
}

func normalizeProjectedEventCitationReferences(event *rxBot.ExecutionEventV2) error {
	if event == nil || (event.Type != "message.snapshot" && event.Type != "message.completed") {
		return nil
	}
	references, present := event.PublicPayload["references"]
	if !present {
		return nil
	}
	normalized, err := rxBot.NormalizeExecutionCitationReferencesV2(references)
	if err != nil {
		return err
	}
	event.PublicPayload["references"] = normalized
	return nil
}

func projectedTimelineFactType(event rxBot.ExecutionEventV2) string {
	switch event.Type {
	case "todo.snapshot":
		return "todo"
	case "reasoning.summary", "decision.note":
		return "public_summary"
	case "artifact.published", "result.published":
		return "result"
	default:
		if event.Source == "tool" || event.WorkUnitID != nil {
			return "tool"
		}
		return "activity"
	}
}

func timelineFactContent(event rxBot.ExecutionEventV2) string {
	if event.Type == "reasoning.summary" || event.Type == "decision.note" {
		if text, ok := event.PublicPayload["text"].(string); ok && text != "" {
			return text
		}
	}
	return event.Summary.Text
}

func materializeProjectedTimelineFact(
	ctx context.Context,
	tx *gorm.DB,
	admission model.QuestionAgentExecutionAdmission,
	event rxBot.ExecutionEventV2,
	now time.Time,
) error {
	if event.Type == "message.snapshot" || event.Type == "message.completed" || admission.DialogueID == nil {
		return nil
	}
	var existing int64
	if err := tx.WithContext(ctx).Model(&model.ConversationMessageV2{}).
		Where("user_name = ? AND execution_id = ? AND source_event_id = ?", admission.UserName, admission.ExecutionID, event.EventID).
		Count(&existing).Error; err != nil || existing > 0 {
		return err
	}
	var currentIndex struct{ Value int64 }
	if err := tx.WithContext(ctx).Model(&model.ConversationMessageV2{}).
		Select("COALESCE(MAX(message_index), -1) AS value").
		Where("user_name = ? AND dialogue_id = ? AND delete_at IS NULL", admission.UserName, *admission.DialogueID).
		Scan(&currentIndex).Error; err != nil {
		return err
	}
	identity := fmt.Sprintf("%x", sha256.Sum256([]byte(admission.UserName+"\x00"+admission.ExecutionID+"\x00"+event.EventID)))
	messageID := "evtmsg-" + identity[:40]
	content := timelineFactContent(event)
	contentLength := int64(len([]rune(content)))
	sourceEventID := event.EventID
	var parentMessageID *string
	if admission.AssistantMessageID != nil {
		parent := *admission.AssistantMessageID
		parentMessageID = &parent
	}
	var toolCallID *string
	if event.WorkUnitID != nil {
		value := *event.WorkUnitID
		toolCallID = &value
	}
	targetJSON := ""
	if event.Target != nil {
		encoded, err := json.Marshal(event.Target)
		if err != nil {
			return err
		}
		targetJSON = string(encoded)
	}
	item := model.ConversationMessageV2{
		MessageID: messageID, UserName: admission.UserName, DialogueID: *admission.DialogueID,
		MessageIndex: currentIndex.Value + 1, ExecutionID: admission.ExecutionID,
		SourceMessageID: event.EventID, ParentMessageID: parentMessageID,
		MessageType: projectedTimelineFactType(event), Role: "tool", Visibility: "collapsed",
		SourceEventID: &sourceEventID, ToolCallID: toolCallID,
		ContentRevision: event.Seq, ContentOffset: contentLength, ContentLength: contentLength,
		Content: content, TargetJSON: targetJSON, Status: event.Status,
		OccurredAt: parseEventTime(event.OccurredAt), CreatedAt: now, UpdatedAt: now,
	}
	return tx.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&item).Error
}

func (ps *Service) claimProjectionAdmission(ctx context.Context, workerID string) (*model.QuestionAgentExecutionAdmission, error) {
	now := time.Now().UTC()
	var claimed model.QuestionAgentExecutionAdmission
	err := model.DB(ctx).Transaction(func(tx *gorm.DB) error {
		var row model.QuestionAgentExecutionAdmission
		err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Where("terminal_status IS NULL AND (bot_run_id IS NOT NULL OR EXISTS (SELECT 1 FROM question_agent_execution_outbox o WHERE o.user_name = question_agent_execution_admissions.user_name AND o.execution_id = question_agent_execution_admissions.execution_id AND o.state = ?)) AND (next_projection_at IS NULL OR next_projection_at <= ?) AND (projection_lease_until IS NULL OR projection_lease_until < ?)", "reconcile", now, now).
			Order("updated_at ASC").Take(&row).Error
		if err != nil {
			return err
		}
		leaseUntil := now.Add(executionWorkerLease)
		result := tx.WithContext(ctx).Model(&model.QuestionAgentExecutionAdmission{}).
			Where("user_name = ? AND execution_id = ? AND projection_attempts = ? AND (next_projection_at IS NULL OR next_projection_at <= ?) AND (projection_lease_until IS NULL OR projection_lease_until < ?)", row.UserName, row.ExecutionID, row.ProjectionAttempts, now, now).
			Updates(map[string]any{
				"projection_lease_owner": workerID,
				"projection_lease_until": leaseUntil,
				"projection_attempts":    row.ProjectionAttempts + 1,
				"updated_at":             now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		row.ProjectionLeaseOwner = &workerID
		row.ProjectionLeaseUntil = &leaseUntil
		row.ProjectionAttempts++
		claimed = row
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &claimed, nil
}

func (ps *Service) projectAdmission(ctx context.Context, admission model.QuestionAgentExecutionAdmission) error {
	page, _, err := ps.executionRuntimeClient().GetExecutionEventsV2(ctx, admission.UserName, admission.ExecutionID, admission.LatestCursor, 200)
	if err != nil {
		return err
	}
	snapshot, _, err := ps.executionRuntimeClient().GetExecutionSnapshotV2(ctx, admission.UserName, admission.ExecutionID)
	if err != nil {
		return err
	}
	if admission.BotRunID != nil && snapshot.RunID != "" && *admission.BotRunID != snapshot.RunID {
		return errors.New("execution Bot correlation changed")
	}
	projectionJSON, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	contextPending := snapshot.ContextStage != nil &&
		snapshot.ContextStage.ProposedBusinessContextVersion > admission.ContextRevision
	err = model.DB(ctx).Transaction(func(tx *gorm.DB) error {
		for index := range page.Items {
			if err := normalizeProjectedEventCitationReferences(&page.Items[index]); err != nil {
				return err
			}
			event := page.Items[index]
			encoded, err := json.Marshal(event)
			if err != nil {
				return err
			}
			cached := model.QuestionAgentExecutionEventV2{
				UserName: admission.UserName, ExecutionID: admission.ExecutionID,
				Seq: event.Seq, EventID: event.EventID, EventType: event.Type,
				EventJSON: string(encoded), OccurredAt: parseEventTime(event.OccurredAt), CreatedAt: now,
			}
			if err := tx.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&cached).Error; err != nil {
				return err
			}
			if err := materializeProjectedTimelineFact(ctx, tx, admission, event, now); err != nil {
				return err
			}
		}
		var cachedRows []model.QuestionAgentExecutionEventV2
		if err := tx.WithContext(ctx).
			Where("user_name = ? AND execution_id = ?", admission.UserName, admission.ExecutionID).
			Order("seq ASC").Find(&cachedRows).Error; err != nil {
			return err
		}
		cachedEvents := make([]rxBot.ExecutionEventV2, 0, len(cachedRows))
		for _, cached := range cachedRows {
			var event rxBot.ExecutionEventV2
			if err := json.Unmarshal([]byte(cached.EventJSON), &event); err != nil {
				return fmt.Errorf("decode cached execution event %s: %w", cached.EventID, err)
			}
			cachedEvents = append(cachedEvents, event)
		}
		expectedAssistantID := ""
		if admission.AssistantMessageID != nil {
			expectedAssistantID = *admission.AssistantMessageID
		}
		messageContent, err := reconstructProjectedMessage(cachedEvents, admission.ExecutionID, expectedAssistantID)
		if err != nil {
			return err
		}
		var messageRevision, messageOffset int64
		if messageContent != nil {
			messageRevision, messageOffset = messageContent.Revision, messageContent.Offset
		}
		updates := map[string]any{
			"status": snapshot.Status, "latest_cursor": page.NextAfterSeq,
			"projection_revision": snapshot.LatestSeq, "projection_json": string(projectionJSON),
			"dispatch_revision": gorm.Expr(
				"CASE WHEN dispatch_revision < ? THEN ? ELSE dispatch_revision END",
				snapshot.OperationRevision,
				snapshot.OperationRevision,
			),
			"content_revision": max(snapshot.OutputRevision, messageRevision),
			"content_offset":   max(snapshot.OutputOffset, messageOffset),
			"tracking_health":  snapshot.TrackingHealth, "last_bot_contact_at": now,
			"projection_lease_owner": nil, "projection_lease_until": nil, "updated_at": now,
		}
		if snapshot.RunID != "" {
			updates["bot_run_id"] = gorm.Expr("COALESCE(bot_run_id, ?)", snapshot.RunID)
		}
		nextProjectionAt := now.Add(500 * time.Millisecond)
		if page.HasMore {
			nextProjectionAt = now
		}
		updates["next_projection_at"] = nextProjectionAt
		if snapshot.Terminal != nil && !contextPending && !page.HasMore && page.NextAfterSeq >= snapshot.LatestSeq {
			updates["terminal_status"] = snapshot.Terminal.Status
			updates["terminal_at"] = now
		}
		result := tx.WithContext(ctx).Model(&model.QuestionAgentExecutionAdmission{}).
			Where("user_name = ? AND execution_id = ? AND latest_cursor <= ? AND projection_lease_owner = ? AND projection_attempts = ?", admission.UserName, admission.ExecutionID, page.NextAfterSeq, *admission.ProjectionLeaseOwner, admission.ProjectionAttempts).
			Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		if admission.AssistantMessageID != nil {
			timelineUpdates := map[string]any{
				"status":     snapshot.Status,
				"updated_at": now,
			}
			timelineQuery := tx.WithContext(ctx).Model(&model.ConversationMessageV2{}).
				Where("user_name = ? AND execution_id = ? AND message_id = ?", admission.UserName, admission.ExecutionID, *admission.AssistantMessageID)
			if messageContent != nil {
				timelineUpdates["content"] = messageContent.Text
				timelineUpdates["content_revision"] = messageContent.Revision
				timelineUpdates["content_offset"] = messageContent.Offset
				timelineUpdates["content_length"] = messageContent.TotalLength
				timelineUpdates["content_sha256"] = messageContent.ContentSHA
				if messageContent.References != nil {
					encodedReferences, err := json.Marshal(messageContent.References)
					if err != nil {
						return err
					}
					timelineUpdates["references_json"] = string(encodedReferences)
				}
				timelineQuery = timelineQuery.Where("content_revision < ? OR (content_revision = ? AND content_offset <= ?)", messageContent.Revision, messageContent.Revision, messageContent.Offset)
			}
			if result := timelineQuery.Updates(timelineUpdates); result.Error != nil {
				return result.Error
			}
		}
		if err := tx.WithContext(ctx).Model(&model.ConversationTurnV2{}).
			Where("user_name = ? AND execution_id = ? AND delete_at IS NULL", admission.UserName, admission.ExecutionID).
			Updates(map[string]any{"status": snapshot.Status, "updated_at": now}).Error; err != nil {
			return err
		}
		if err := tx.WithContext(ctx).Model(&model.QuestionAgentExecutionOutbox{}).
			Where("user_name = ? AND execution_id = ? AND state = ?", admission.UserName, admission.ExecutionID, "reconcile").
			Updates(map[string]any{
				"state": "acknowledged", "acknowledged_at": now,
				"next_reconcile_at": nil, "updated_at": now,
				"revision": gorm.Expr("revision + 1"),
			}).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil || !contextPending {
		return err
	}
	return ps.acknowledgeProjectedContext(ctx, admission, snapshot)
}

func (ps *Service) acknowledgeProjectedContext(
	ctx context.Context,
	admission model.QuestionAgentExecutionAdmission,
	snapshot *rxBot.ExecutionProjectionV2,
) error {
	stage := snapshot.ContextStage
	if stage == nil || stage.ProposedBusinessContextVersion <= admission.ContextRevision {
		return nil
	}
	var outbox model.QuestionAgentExecutionOutbox
	if err := model.DB(ctx).WithContext(ctx).
		Where("user_name = ? AND execution_id = ?", admission.UserName, admission.ExecutionID).
		Take(&outbox).Error; err != nil {
		return err
	}
	var command canonicalMessageExecutionCommand
	if err := json.Unmarshal([]byte(outbox.CommandJSON), &command); err != nil ||
		command.Conversation == nil || command.Conversation.TurnID != stage.TurnID {
		return errors.New("invalid projected context binding")
	}
	envelope := command.Conversation
	if _, err := ps.executionRuntimeClient().SettleConversationContext(
		ctx,
		rxBot.ContextSettlementRequest{
			SchemaVersion: 1, ConversationKey: envelope.ConversationKey,
			TurnID: envelope.TurnID, LedgerVersion: envelope.LedgerVersion,
		},
	); err != nil {
		return err
	}
	updates := map[string]any{
		"context_revision": stage.ProposedBusinessContextVersion,
		"updated_at":       time.Now().UTC(),
	}
	if snapshot.Terminal != nil {
		updates["terminal_status"] = snapshot.Terminal.Status
		updates["terminal_at"] = time.Now().UTC()
	}
	return model.DB(ctx).WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.QuestionAgentExecutionAdmission{}).
			Where("user_name = ? AND execution_id = ? AND context_revision < ?",
				admission.UserName, admission.ExecutionID, stage.ProposedBusinessContextVersion).
			Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		var turn model.ConversationTurnV2
		if err := tx.Where("user_name = ? AND execution_id = ? AND delete_at IS NULL", admission.UserName, admission.ExecutionID).
			Take(&turn).Error; err != nil {
			return err
		}
		private, err := decodeConversationTurnContext(turn.ContextJSON)
		if err != nil {
			return err
		}
		if private == nil {
			private = &persistedConversationContext{}
		}
		next := private.clone()
		next.Stage = &rxBot.ContextStageMetadata{
			SchemaVersion: stage.SchemaVersion, TurnID: stage.TurnID,
			SelectedAgentID: stage.SelectedAgentID, RouteSource: stage.RouteSource,
			RouteReasonCode:                stage.RouteReasonCode,
			BaseBusinessContextVersion:     stage.BaseBusinessContextVersion,
			ProposedBusinessContextVersion: stage.ProposedBusinessContextVersion,
			LastAppliedLedgerCursor:        stage.LastAppliedLedgerCursor,
			ContextTruncated:               stage.ContextTruncated, ContextRebuilt: stage.ContextRebuilt,
		}
		next.SettlementState = conversationSettlementAcked
		next.ModeLockState = "locked"
		encoded, err := json.Marshal(next)
		if err != nil {
			return err
		}
		return tx.Model(&model.ConversationTurnV2{}).
			Where("id = ? AND user_name = ? AND execution_id = ?", turn.ID, admission.UserName, admission.ExecutionID).
			Updates(map[string]any{"context_json": string(encoded), "updated_at": time.Now().UTC()}).Error
	})
}

func (ps *Service) ProjectExecutionsOnce(ctx context.Context) (ExecutionWorkerStats, error) {
	stats := ExecutionWorkerStats{}
	workerID := fmt.Sprintf("projector-%d", time.Now().UnixNano())
	for stats.Claimed < executionWorkerBatch {
		admission, err := ps.claimProjectionAdmission(ctx, workerID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return stats, stats.Error
		}
		if err != nil {
			return stats, err
		}
		stats.Claimed++
		observeExecutionMetricV2(metricProjectionClaimed)
		if err := ps.projectAdmission(ctx, *admission); err != nil {
			rxLog.SugarContext(ctx).Warnw(
				"execution projection retry deferred",
				"execution_id", admission.ExecutionID,
				"projection_attempt", admission.ProjectionAttempts,
				"error", err,
			)
			_ = model.DB(ctx).Model(&model.QuestionAgentExecutionAdmission{}).
				Where("user_name = ? AND execution_id = ? AND projection_lease_owner = ? AND projection_attempts = ?", admission.UserName, admission.ExecutionID, workerID, admission.ProjectionAttempts).
				Updates(map[string]any{"tracking_health": "degraded", "projection_lease_owner": nil, "projection_lease_until": nil, "next_projection_at": time.Now().UTC().Add(dispatchBackoff(admission.ProjectionAttempts)), "updated_at": time.Now().UTC()}).Error
			stats.Error = fmt.Errorf("project %s: %w", admission.ExecutionID, err)
			observeExecutionMetricV2(metricProjectionFailed)
			continue
		}
		stats.Projected++
		observeExecutionMetricV2(metricProjectionCommitted)
	}
	return stats, stats.Error
}

func RunExecutionWorkers(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 250 * time.Millisecond
	}
	workerID := fmt.Sprintf("web-%d", time.Now().UnixNano())
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	service := NewService()
	for {
		_, _ = service.DispatchExecutionOutboxOnce(ctx, workerID)
		_, _ = service.ProjectExecutionsOnce(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
