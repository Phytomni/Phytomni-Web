package api_service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"

	"gorm.io/gorm"
)

const (
	executionCommandSchemaVersion = 2
	executionFingerprintVersion   = 2
	expertRouterAgentSlug         = "expert-router"
	statusAdmitted                = "ADMITTED"
	outboxStatePending            = "pending"
)

// canonicalMessageExecutionCommand is private dispatch data. It is never
// returned to a browser and contains only validated references, not file paths
// or credentials.
type canonicalMessageExecutionCommand struct {
	SchemaVersion      int                           `json:"schema_version"`
	ExecutionID        string                        `json:"execution_id"`
	OwnerRef           string                        `json:"owner_ref"`
	FingerprintVersion int                           `json:"fingerprint_version"`
	Fingerprint        string                        `json:"fingerprint"`
	AgentSlug          string                        `json:"agent_slug"`
	DialogueID         string                        `json:"dialogue_id"`
	MessageID          int64                         `json:"message_id"`
	UserMessageID      string                        `json:"user_message_id"`
	AssistantMessageID string                        `json:"assistant_message_id"`
	Operation          string                        `json:"operation"`
	ParentID           int64                         `json:"parent_id"`
	Mode               string                        `json:"mode"`
	RequestedTool      string                        `json:"requested_tool,omitempty"`
	Query              string                        `json:"query"`
	Locale             string                        `json:"locale"`
	Attachments        []rxBot.AssetAttachmentRef    `json:"attachments"`
	ArtifactRefs       []rxBot.ArtifactRefV1         `json:"artifact_refs"`
	AllowedTools       []string                      `json:"allowed_tools"`
	InteropMode        string                        `json:"interop_mode"`
	InteropTargets     []string                      `json:"interop_targets"`
	GeneID             string                        `json:"gene_id,omitempty"`
	ToID               string                        `json:"to_id,omitempty"`
	SpeciesCode        string                        `json:"species_code,omitempty"`
	Conversation       *rxBot.ConversationEnvelopeV1 `json:"conversation,omitempty"`
}

type executionFingerprintPayload struct {
	Version        int                        `json:"version"`
	Operation      string                     `json:"operation"`
	ParentID       int64                      `json:"parent_id"`
	Mode           string                     `json:"mode"`
	RequestedTool  string                     `json:"requested_tool"`
	AgentSlug      string                     `json:"agent_slug"`
	Query          string                     `json:"query"`
	Locale         string                     `json:"locale"`
	Attachments    []rxBot.AssetAttachmentRef `json:"attachments"`
	ArtifactRefs   []rxBot.ArtifactRefV1      `json:"artifact_refs"`
	AllowedTools   []string                   `json:"allowed_tools"`
	InteropMode    string                     `json:"interop_mode"`
	InteropTargets []string                   `json:"interop_targets"`
	GeneID         string                     `json:"gene_id,omitempty"`
	ToID           string                     `json:"to_id,omitempty"`
	SpeciesCode    string                     `json:"species_code,omitempty"`
}

func normalizedLocale(value string) string {
	value = strings.TrimSpace(value)
	if comma := strings.IndexByte(value, ','); comma >= 0 {
		value = value[:comma]
	}
	if semicolon := strings.IndexByte(value, ';'); semicolon >= 0 {
		value = value[:semicolon]
	}
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 35 {
		return "en-US"
	}
	return value
}

func canonicalExecutionCommand(
	username string,
	in QueryInput,
	target v1SubmissionTarget,
	agentSlug string,
	allowedTools []string,
	conversation *rxBot.ConversationEnvelopeV1,
) (canonicalMessageExecutionCommand, error) {
	allowed := append([]string(nil), allowedTools...)
	sort.Strings(allowed)
	interopMode, interopTargets, err := rxBot.ValidateInteropControls(in.InteropMode, in.InteropTargets)
	if err != nil {
		return canonicalMessageExecutionCommand{}, err
	}
	requestedTool := strings.TrimSpace(in.Tool)
	if in.Surface == QuerySurfaceChat && strings.EqualFold(in.Mode, "instant") {
		requestedTool = "ChatAgent"
	}
	payload := executionFingerprintPayload{
		Version: executionFingerprintVersion, Operation: target.operation,
		ParentID: target.parentID, Mode: target.mode, RequestedTool: requestedTool,
		AgentSlug: agentSlug, Query: in.Query, Locale: normalizedLocale(in.Locale),
		Attachments:  append([]rxBot.AssetAttachmentRef(nil), in.Attachments...),
		ArtifactRefs: append([]rxBot.ArtifactRefV1(nil), target.artifacts...),
		AllowedTools: allowed, InteropMode: interopMode,
		InteropTargets: append([]string(nil), interopTargets...),
		GeneID:         in.GeneID, ToID: in.ToID, SpeciesCode: in.SpeciesCode,
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return canonicalMessageExecutionCommand{}, err
	}
	digest := sha256.Sum256(encoded)
	fingerprint := hex.EncodeToString(digest[:])
	return canonicalMessageExecutionCommand{
		SchemaVersion: executionCommandSchemaVersion, ExecutionID: in.ClientTurnID,
		OwnerRef: username, FingerprintVersion: executionFingerprintVersion,
		Fingerprint: fingerprint, AgentSlug: agentSlug, DialogueID: target.dialogueID,
		Operation: target.operation, ParentID: target.parentID, Mode: target.mode,
		RequestedTool: requestedTool, Query: in.Query, Locale: payload.Locale,
		Attachments: payload.Attachments, ArtifactRefs: payload.ArtifactRefs,
		AllowedTools: allowed, InteropMode: interopMode,
		InteropTargets: payload.InteropTargets, GeneID: in.GeneID, ToID: in.ToID,
		SpeciesCode: in.SpeciesCode, Conversation: conversation,
	}, nil
}

// executionAdmissionTestHook is test-only fault injection. Production leaves
// it nil; it lets rollback tests prove no shell/admission/outbox partial commit.
var executionAdmissionTestHook func(stage string) error

// findExecutionAdmission resolves an idempotent replay from the canonical V2
// admission ledger. Capability discovery and provider availability are facts
// for a new command; an already committed command must not fall back to the
// legacy message projection or require a live Bot round trip to be replayed.
func (ps *Service) findExecutionAdmission(
	ctx context.Context,
	username string,
	in QueryInput,
	target v1SubmissionTarget,
	permissions AgentPermissionResolution,
	conversationV1 bool,
	agentSlug string,
) (*QueryData, error) {
	command, err := canonicalExecutionCommand(
		username, in, target, agentSlug, permissions.AllowedTools, nil,
	)
	if err != nil {
		return nil, err
	}
	var admission model.QuestionAgentExecutionAdmission
	lookup := model.DB(ctx).WithContext(ctx).Where(
		"user_name = ? AND execution_id = ?", username, in.ClientTurnID,
	).Take(&admission)
	if errors.Is(lookup.Error, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if lookup.Error != nil {
		return nil, lookup.Error
	}
	observeExecutionMetricV2(metricAdmissionDuplicate)
	if admission.FingerprintVersion != command.FingerprintVersion ||
		admission.RequestFingerprint != command.Fingerprint {
		return nil, ErrDuplicateClientTurn
	}
	if admission.TurnID != nil {
		var turn model.ConversationTurnV2
		if err := model.DB(ctx).WithContext(ctx).Where(
			"id = ? AND user_name = ? AND delete_at IS NULL", *admission.TurnID, username,
		).Take(&turn).Error; err != nil {
			return nil, err
		}
		out := queryDataFromConversationTurnV2(turn)
		out.RequestID = requestIDFromContext(ctx)
		out.SchemaVersion = executionCommandSchemaVersion
		out.ExecutionID = admission.ExecutionID
		out.UserMessageID = stringValue(admission.UserMessageID)
		out.AssistantMessageID = stringValue(admission.AssistantMessageID)
		out.EventCursor = admission.LatestCursor
		out.Accepted = true
		return out, nil
	}
	// Bounded read compatibility for admissions committed before V2 turn
	// metadata existed. New admissions never populate MessageID.
	if admission.MessageID == nil {
		return nil, ErrDuplicateClientTurn
	}
	var row model.QuestionAgentLog
	if err := model.DB(ctx).WithContext(ctx).Where(
		"id = ? AND user_name = ? AND delete_at IS NULL", *admission.MessageID, username,
	).Take(&row).Error; err != nil {
		return nil, err
	}
	return &QueryData{
		Id: row.Id, ToolName: row.ToolName, Answer: row.Answer,
		FollowUpQuestions: row.FollowUpQuestions, Status: row.Status,
		DialogueId: row.DialogueId, BotRunID: row.BotRunId,
		TaskId: row.TaskId, ReactionType: row.ReactionType,
		RequestID:          requestIDFromContext(ctx),
		SchemaVersion:      executionCommandSchemaVersion,
		ExecutionID:        admission.ExecutionID,
		UserMessageID:      stringValue(admission.UserMessageID),
		AssistantMessageID: stringValue(admission.AssistantMessageID),
		EventCursor:        admission.LatestCursor,
		Accepted:           true,
	}, nil
}

func (ps *Service) admitExecutionCommand(
	ctx context.Context,
	username string,
	in QueryInput,
	target v1SubmissionTarget,
	permissions AgentPermissionResolution,
	conversationV1 bool,
	agentSlug string,
) (*v1Submission, error) {
	if username == "" || !serviceClientTurnIDPattern.MatchString(in.ClientTurnID) || agentSlug == "" {
		return nil, ErrInvalidClientTurnID
	}
	baseCommand, err := canonicalExecutionCommand(
		username, in, target, agentSlug, permissions.AllowedTools, nil,
	)
	if err != nil {
		return nil, err
	}
	var admitted *v1Submission
	err = model.DB(ctx).Transaction(func(tx *gorm.DB) error {
		var existingAdmission model.QuestionAgentExecutionAdmission
		lookup := tx.WithContext(ctx).Where(
			"user_name = ? AND execution_id = ?", username, in.ClientTurnID,
		).Take(&existingAdmission)
		if lookup.Error == nil {
			observeExecutionMetricV2(metricAdmissionDuplicate)
			if existingAdmission.FingerprintVersion != baseCommand.FingerprintVersion ||
				existingAdmission.RequestFingerprint != baseCommand.Fingerprint {
				return ErrDuplicateClientTurn
			}
			if existingAdmission.TurnID != nil {
				var turn model.ConversationTurnV2
				if err := tx.WithContext(ctx).Where(
					"id = ? AND user_name = ? AND delete_at IS NULL", *existingAdmission.TurnID, username,
				).Take(&turn).Error; err != nil {
					return err
				}
				admitted = &v1Submission{
					turn: &turn, userMessageID: stringValue(existingAdmission.UserMessageID),
					assistantMessageID: stringValue(existingAdmission.AssistantMessageID),
					duplicate:          queryDataFromConversationTurnV2(turn),
					requestFingerprint: baseCommand.Fingerprint,
				}
				return nil
			}
			if existingAdmission.MessageID == nil {
				return ErrDuplicateClientTurn
			}
			var row model.QuestionAgentLog
			if err := tx.WithContext(ctx).Where(
				"id = ? AND user_name = ? AND delete_at IS NULL", *existingAdmission.MessageID, username,
			).Take(&row).Error; err != nil {
				return err
			}
			admitted = &v1Submission{
				row: row, userMessageID: stringValue(existingAdmission.UserMessageID),
				assistantMessageID: stringValue(existingAdmission.AssistantMessageID),
				duplicate: &QueryData{Id: row.Id, ToolName: row.ToolName, Answer: row.Answer,
					FollowUpQuestions: row.FollowUpQuestions, Status: row.Status,
					DialogueId: row.DialogueId, BotRunID: row.BotRunId,
					TaskId: row.TaskId, ReactionType: row.ReactionType},
				requestFingerprint: baseCommand.Fingerprint,
			}
			return nil
		}
		if lookup.Error != nil && !errors.Is(lookup.Error, gorm.ErrRecordNotFound) {
			return lookup.Error
		}
		turn, err := allocateConversationTurnV2(ctx, tx, username, in, target)
		if err != nil {
			return err
		}
		admitted = &v1Submission{turn: turn, requestFingerprint: baseCommand.Fingerprint}
		command := baseCommand
		if conversationV1 {
			envelope, err := buildExecutionConversationEnvelope(
				ctx, tx, username, in, target, permissions, *turn,
			)
			if err != nil {
				return err
			}
			admitted.envelope = envelope
			command.Conversation = envelope
		}
		if executionAdmissionTestHook != nil {
			if err := executionAdmissionTestHook("after_message"); err != nil {
				return err
			}
		}
		command.MessageID = turn.ID
		command.DialogueID = turn.DialogueID
		now := time.Now().UTC()
		userMessageID := "msg-" + uuid.NewString()
		assistantMessageID := "msg-" + uuid.NewString()
		command.UserMessageID = userMessageID
		command.AssistantMessageID = assistantMessageID
		var currentIndex struct {
			Value int64
		}
		if err := tx.WithContext(ctx).Model(&model.ConversationMessageV2{}).
			Select("COALESCE(MAX(message_index), -1) AS value").
			Where("user_name = ? AND dialogue_id = ?", username, turn.DialogueID).
			Scan(&currentIndex).Error; err != nil {
			return err
		}
		turnID := turn.ID
		parentMessageID := userMessageID
		items := []model.ConversationMessageV2{
			{
				MessageID: userMessageID, UserName: username, DialogueID: turn.DialogueID,
				MessageIndex: currentIndex.Value + 1, ExecutionID: in.ClientTurnID,
				TurnID: &turnID, SourceMessageID: userMessageID,
				MessageType: "user", Role: "user", Visibility: "user",
				Content: in.Query, Status: "completed", OccurredAt: now, CreatedAt: now, UpdatedAt: now,
			},
			{
				MessageID: assistantMessageID, UserName: username, DialogueID: turn.DialogueID,
				MessageIndex: currentIndex.Value + 2, ExecutionID: in.ClientTurnID,
				TurnID: &turnID, SourceMessageID: assistantMessageID,
				ParentMessageID: &parentMessageID, MessageType: "assistant", Role: "assistant",
				Visibility: "user", Content: "", Status: "admitted",
				OccurredAt: now, CreatedAt: now, UpdatedAt: now,
			},
		}
		if err := tx.WithContext(ctx).Create(&items).Error; err != nil {
			return err
		}
		admitted.userMessageID = userMessageID
		admitted.assistantMessageID = assistantMessageID
		encoded, err := json.Marshal(command)
		if err != nil {
			return err
		}
		admission := model.QuestionAgentExecutionAdmission{
			UserName: username, ExecutionID: in.ClientTurnID,
			RequestFingerprint: command.Fingerprint,
			FingerprintVersion: command.FingerprintVersion,
			DialogueID:         nullableString(turn.DialogueID),
			TurnID:             nullableInt64(turn.ID), Status: "admitted",
			UserMessageID:      nullableString(userMessageID),
			AssistantMessageID: nullableString(assistantMessageID),
			TrackingHealth:     "pending", CreatedAt: now, UpdatedAt: now,
		}
		if err := tx.WithContext(ctx).Create(&admission).Error; err != nil {
			if !errors.Is(err, gorm.ErrDuplicatedKey) {
				return err
			}
			return ErrDuplicateClientTurn
		}
		outbox := model.QuestionAgentExecutionOutbox{
			UserName: username, ExecutionID: in.ClientTurnID,
			CommandJSON: string(encoded), State: outboxStatePending,
			NextAttemptAt: now, CreatedAt: now, UpdatedAt: now,
		}
		if err := tx.WithContext(ctx).Create(&outbox).Error; err != nil {
			return err
		}
		admitted.turn.Status = "admitted"
		observeExecutionMetricV2(metricAdmissionCommitted)
		return nil
	})
	return admitted, err
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
