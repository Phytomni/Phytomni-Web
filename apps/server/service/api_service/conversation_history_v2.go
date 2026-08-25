package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"

	"gorm.io/gorm"
)

// ConversationExecutionHistoryV2 is the last Web-committed execution view
// needed to paint a conversation before any live continuation is attached.
// It is deliberately database-only: a history GET never advances Bot state.
type ConversationExecutionHistoryV2 struct {
	ExecutionID        string                       `json:"execution_id"`
	UserMessageID      string                       `json:"user_message_id,omitempty"`
	AssistantMessageID string                       `json:"assistant_message_id,omitempty"`
	Status             string                       `json:"status"`
	EventCursor        int64                        `json:"event_cursor"`
	ProjectionRevision int64                        `json:"projection_revision"`
	ContentRevision    int64                        `json:"content_revision"`
	ContentOffset      int64                        `json:"content_offset"`
	TrackingHealth     string                       `json:"tracking_health"`
	Stale              bool                         `json:"stale"`
	Projection         *rxBot.ExecutionProjectionV2 `json:"projection"`
	Events             []rxBot.ExecutionEventV2     `json:"events"`
}

// ConversationHistoryV2 is the canonical ordered V2 hydration envelope.
type ConversationHistoryV2 struct {
	SchemaVersion  int                              `json:"schema_version"`
	ConversationID string                           `json:"conversation_id"`
	Messages       []model.ConversationMessageV2    `json:"messages"`
	Executions     []ConversationExecutionHistoryV2 `json:"executions"`
}

func stringPointerValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func persistedExecutionProjectionV2(admission model.QuestionAgentExecutionAdmission) (*rxBot.ExecutionProjectionV2, error) {
	raw := strings.TrimSpace(admission.ProjectionJSON)
	if raw == "" || raw == "{}" || raw == "null" {
		return nil, nil
	}
	var projection rxBot.ExecutionProjectionV2
	if err := json.Unmarshal([]byte(raw), &projection); err != nil {
		return nil, err
	}
	if projection.SchemaVersion != executionCommandSchemaVersion || projection.ExecutionID != admission.ExecutionID {
		return nil, errors.New("persisted execution projection identity mismatch")
	}
	return &projection, nil
}

// ConversationHistoryV2 reads only owner-scoped materialized facts. The Bot
// journal remains authoritative, while this projection remains usable during
// Bot outage and projector reconnect.
func (ps *Service) ConversationHistoryV2(ctx context.Context, username, dialogueID string) (*ConversationHistoryV2, error) {
	history := &ConversationHistoryV2{
		SchemaVersion:  executionCommandSchemaVersion,
		ConversationID: dialogueID,
		Messages:       []model.ConversationMessageV2{},
		Executions:     []ConversationExecutionHistoryV2{},
	}
	if err := model.DB(ctx).WithContext(ctx).
		Where("user_name = ? AND dialogue_id = ? AND delete_at IS NULL AND visibility <> ?", username, dialogueID, "internal").
		Order("message_index ASC").Find(&history.Messages).Error; err != nil {
		return nil, err
	}
	var admissions []model.QuestionAgentExecutionAdmission
	if err := model.DB(ctx).WithContext(ctx).
		Where("user_name = ? AND dialogue_id = ?", username, dialogueID).
		Order("created_at ASC").Find(&admissions).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	for _, admission := range admissions {
		projection, err := persistedExecutionProjectionV2(admission)
		if err != nil {
			return nil, err
		}
		var eventRows []model.QuestionAgentExecutionEventV2
		if err := model.DB(ctx).WithContext(ctx).
			Where("user_name = ? AND execution_id = ?", username, admission.ExecutionID).
			Order("seq ASC").Find(&eventRows).Error; err != nil {
			return nil, err
		}
		events := make([]rxBot.ExecutionEventV2, 0, len(eventRows))
		for _, row := range eventRows {
			var event rxBot.ExecutionEventV2
			if err := json.Unmarshal([]byte(row.EventJSON), &event); err != nil {
				return nil, err
			}
			if event.ExecutionID != admission.ExecutionID || event.EventID != row.EventID || event.Seq != row.Seq {
				return nil, errors.New("persisted execution event identity mismatch")
			}
			events = append(events, event)
		}
		history.Executions = append(history.Executions, ConversationExecutionHistoryV2{
			ExecutionID: admission.ExecutionID, UserMessageID: stringPointerValue(admission.UserMessageID),
			AssistantMessageID: stringPointerValue(admission.AssistantMessageID), Status: admission.Status,
			EventCursor: admission.LatestCursor, ProjectionRevision: admission.ProjectionRevision,
			ContentRevision: admission.ContentRevision, ContentOffset: admission.ContentOffset,
			TrackingHealth: admission.TrackingHealth, Stale: admission.TrackingHealth != "healthy",
			Projection: projection, Events: events,
		})
	}
	return history, nil
}
