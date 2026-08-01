package api_service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"unicode/utf8"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	maxPersistedClientTurnIDBytes     = 128
	maxPersistedAssistantSummaryBytes = 4 << 10
	maxPersistedArtifactRefs          = 50
	maxPersistedArtifactFieldBytes    = 512
	maxPersistedSettlementStateBytes  = 32
	maxPersistedModeLockStateBytes    = 16
	maxPersistedLedgerHashBytes       = 128
	maxPersistedConversationBytes     = 64 << 10
	maxPersistedReplacementQueryBytes = 32 << 10
	maxPersistedReplacementFileBytes  = 4 << 10
	maxPersistedReplacementPathBytes  = 8 << 10
)

var (
	persistedArtifactIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
	persistedLedgerHashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
	persistedTokenPattern      = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_.-]*$`)
	persistedURISchemePattern  = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9+.-]*:`)
)

var ErrInvalidBotConversationContext = errors.New("invalid bot conversation context")

const (
	conversationSettlementAckPending      = "ACK_PENDING"
	conversationSettlementAcked           = "ACKED"
	conversationSettlementRebuildRequired = "REBUILD_REQUIRED"
)

// persistedConversationContext is the private, bounded context extension
// stored alongside the public Bot projection. It is deliberately absent from
// BotRunProjection so response metadata cannot leak through public APIs.
type persistedConversationContext struct {
	ClientTurnID         string                      `json:"client_turn_id,omitempty"`
	ModeLockState        string                      `json:"mode_lock_state,omitempty"`
	Stage                *rxBot.ContextStageMetadata `json:"stage,omitempty"`
	SettlementState      string                      `json:"settlement_state,omitempty"`
	SettlementLedgerHash string                      `json:"settlement_ledger_hash,omitempty"`
	RebuildLedgerVersion string                      `json:"rebuild_ledger_version,omitempty"`
	RebuildLedgerCursor  int64                       `json:"rebuild_ledger_cursor,omitempty"`
	// AssistantSummary is reserved for a future typed Bot-owned metadata
	// summary. V1 settlement currently leaves it empty so display output never
	// becomes replayable conversation context.
	AssistantSummary string                            `json:"assistant_summary,omitempty"`
	ArtifactRefs     []rxBot.ArtifactRefV1             `json:"artifact_refs,omitempty"`
	InputAttachments []rxBot.AssetAttachmentRef        `json:"input_attachments,omitempty"`
	Replacement      *persistedConversationReplacement `json:"replacement,omitempty"`
}

type persistedConversationReplacement struct {
	ClientTurnID     string                     `json:"client_turn_id"`
	Query            string                     `json:"query"`
	ToolName         string                     `json:"tool_name"`
	Mode             string                     `json:"mode"`
	FileName         string                     `json:"file_name,omitempty"`
	UploadPath       string                     `json:"upload_path,omitempty"`
	InputAttachments []rxBot.AssetAttachmentRef `json:"input_attachments,omitempty"`
}

func (value persistedConversationContext) clone() persistedConversationContext {
	copyValue := value
	if value.Stage != nil {
		stage := *value.Stage
		copyValue.Stage = &stage
	}
	copyValue.ArtifactRefs = append([]rxBot.ArtifactRefV1(nil), value.ArtifactRefs...)
	copyValue.InputAttachments = append([]rxBot.AssetAttachmentRef(nil), value.InputAttachments...)
	if value.Replacement != nil {
		replacement := *value.Replacement
		replacement.InputAttachments = append([]rxBot.AssetAttachmentRef(nil), value.Replacement.InputAttachments...)
		copyValue.Replacement = &replacement
	}
	return copyValue
}

func (value persistedConversationContext) validate() error {
	if err := validatePersistedASCII("client_turn_id", value.ClientTurnID, maxPersistedClientTurnIDBytes); err != nil {
		return err
	}
	if !utf8.ValidString(value.AssistantSummary) || len([]byte(value.AssistantSummary)) > maxPersistedAssistantSummaryBytes {
		return persistedContextError("assistant_summary exceeds bounds")
	}
	if err := validatePersistedToken("settlement_state", value.SettlementState, maxPersistedSettlementStateBytes); err != nil {
		return err
	}
	if err := validatePersistedToken("mode_lock_state", value.ModeLockState, maxPersistedModeLockStateBytes); err != nil {
		return err
	}
	if value.ModeLockState != "" && value.ModeLockState != "provisional" && value.ModeLockState != "locked" {
		return persistedContextError("mode_lock_state is invalid")
	}
	if err := validatePersistedASCII("settlement_ledger_hash", value.SettlementLedgerHash, maxPersistedLedgerHashBytes); err != nil {
		return err
	}
	if value.RebuildLedgerVersion != "" &&
		(len(value.RebuildLedgerVersion) != 64 ||
			!persistedLedgerHashPattern.MatchString(value.RebuildLedgerVersion)) {
		return persistedContextError("rebuild_ledger_version is invalid")
	}
	if value.RebuildLedgerCursor < 0 {
		return persistedContextError("rebuild_ledger_cursor is invalid")
	}
	if value.Stage != nil {
		if err := value.Stage.Validate(); err != nil {
			return persistedContextError("stage: " + err.Error())
		}
	}
	if len(value.ArtifactRefs) > maxPersistedArtifactRefs {
		return persistedContextError("artifact_refs exceeds bounds")
	}
	for index, ref := range value.ArtifactRefs {
		if !persistedArtifactIDPattern.MatchString(ref.ArtifactID) {
			return persistedContextError(fmt.Sprintf("artifact_refs[%d].artifact_id is invalid", index))
		}
		if len([]byte(ref.ArtifactID)) > maxPersistedArtifactFieldBytes || len([]byte(ref.DisplayName)) > maxPersistedArtifactFieldBytes || !utf8.ValidString(ref.DisplayName) {
			return persistedContextError(fmt.Sprintf("artifact_refs[%d] metadata exceeds bounds", index))
		}
		if ref.DisplayName == "" || strings.ContainsAny(ref.DisplayName, `/\\`) || persistedURISchemePattern.MatchString(ref.DisplayName) {
			return persistedContextError(fmt.Sprintf("artifact_refs[%d].display_name is invalid", index))
		}
	}
	if _, err := rxBot.ValidateAssetAttachmentRefs(value.InputAttachments); err != nil {
		return persistedContextError("input_attachments: " + err.Error())
	}
	if value.Replacement != nil {
		if err := value.Replacement.validate(); err != nil {
			return err
		}
	}
	return nil
}

func (value persistedConversationReplacement) validate() error {
	if err := validatePersistedASCII(
		"replacement.client_turn_id",
		value.ClientTurnID,
		maxPersistedClientTurnIDBytes,
	); err != nil {
		return err
	}
	if value.ClientTurnID == "" {
		return persistedContextError("replacement.client_turn_id is required")
	}
	if err := validatePersistedUTF8(
		"replacement.query",
		value.Query,
		maxPersistedReplacementQueryBytes,
	); err != nil {
		return err
	}
	if strings.TrimSpace(value.Query) == "" {
		return persistedContextError("replacement.query is required")
	}
	if err := validatePersistedToken("replacement.tool_name", value.ToolName, 64); err != nil {
		return err
	}
	if err := validatePersistedToken("replacement.mode", value.Mode, 16); err != nil {
		return err
	}
	if value.Mode != "instant" && value.Mode != "expert" {
		return persistedContextError("replacement.mode is invalid")
	}
	if err := validatePersistedUTF8(
		"replacement.file_name",
		value.FileName,
		maxPersistedReplacementFileBytes,
	); err != nil {
		return err
	}
	if err := validatePersistedUTF8(
		"replacement.upload_path",
		value.UploadPath,
		maxPersistedReplacementPathBytes,
	); err != nil {
		return err
	}
	if _, err := rxBot.ValidateAssetAttachmentRefs(value.InputAttachments); err != nil {
		return persistedContextError("replacement.input_attachments: " + err.Error())
	}
	return nil
}

func validatePersistedASCII(field, value string, limit int) error {
	if len([]byte(value)) > limit {
		return persistedContextError(fmt.Sprintf("%s exceeds bounds", field))
	}
	for index := 0; index < len(value); index++ {
		if value[index] > 0x7f || value[index] < 0x20 {
			return persistedContextError(fmt.Sprintf("%s must contain printable ASCII", field))
		}
	}
	return nil
}

func validatePersistedToken(field, value string, limit int) error {
	if value == "" {
		return nil
	}
	if len([]byte(value)) > limit || !persistedTokenPattern.MatchString(value) {
		return persistedContextError(fmt.Sprintf("%s is invalid", field))
	}
	return nil
}

func validatePersistedUTF8(field, value string, limit int) error {
	if !utf8.ValidString(value) || len([]byte(value)) > limit {
		return persistedContextError(fmt.Sprintf("%s exceeds bounds", field))
	}
	return nil
}

func persistedContextError(reason string) error {
	return fmt.Errorf("%w: %s", ErrInvalidBotConversationContext, reason)
}

func (value persistedConversationContext) MarshalJSON() ([]byte, error) {
	if err := value.validate(); err != nil {
		return nil, err
	}
	type contextAlias persistedConversationContext
	encoded, err := json.Marshal(contextAlias(value.clone()))
	if err != nil {
		return nil, err
	}
	if len(encoded) > maxPersistedConversationBytes {
		return nil, persistedContextError("serialized context exceeds 64 KiB")
	}
	return encoded, nil
}

func (value *persistedConversationContext) UnmarshalJSON(data []byte) error {
	if len(data) > maxPersistedConversationBytes {
		return persistedContextError("serialized context exceeds 64 KiB")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	type contextAlias persistedConversationContext
	var decoded contextAlias
	if err := decoder.Decode(&decoded); err != nil {
		return persistedContextError("malformed context")
	}
	var trailing interface{}
	if err := decoder.Decode(&trailing); err == nil || !errors.Is(err, io.EOF) {
		return persistedContextError("multiple JSON values")
	}
	validated := persistedConversationContext(decoded)
	if err := validated.validate(); err != nil {
		return err
	}
	*value = validated
	return nil
}

// v1AssistantSummary is the V1 context boundary. Answer/report/table prose is
// display output only; until Bot provides a typed metadata-only summary, V1
// persists no assistant summary while retaining stage and artifact metadata.
func v1AssistantSummary(_ *rxBot.ContextStageMetadata) string {
	return ""
}

func settleBlockingConversationContext(
	ctx context.Context,
	username string,
	dialogueID string,
	rowID int64,
	out *QueryData,
	mode string,
	projection *BotRunProjection,
	private persistedConversationContext,
) (string, error) {
	stagedLedgerVersion := private.SettlementLedgerHash
	if stagedLedgerVersion == "" {
		return "", ErrInvalidBotConversationContext
	}
	err := model.DB(ctx).WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var stored struct {
			BotProjectionJSON string `gorm:"column:bot_projection_json"`
			BotReportRevision int64  `gorm:"column:bot_report_revision"`
			Status            string `gorm:"column:status"`
		}
		result := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Model(&model.QuestionAgentLog{}).
			Select("bot_projection_json, bot_report_revision, status").
			Where(
				"id = ? AND user_name = ? AND dialogue_id = ? AND delete_at IS NULL",
				rowID,
				username,
				dialogueID,
			).
			First(&stored)
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return ErrBotProjectionNotFound
		}
		if result.Error != nil {
			return result.Error
		}

		current, currentPrivate, err := unmarshalPersistedProjectionWithContext(
			stored.BotProjectionJSON,
		)
		if err != nil {
			return err
		}
		replacement := currentPrivate != nil && currentPrivate.Replacement != nil
		if replacement {
			if stored.Status != statusSucceeded ||
				currentPrivate.Replacement.ClientTurnID != private.ClientTurnID {
				return ErrBotProjectionConflict
			}
		} else {
			if stored.Status != "SUBMITTING" {
				return ErrBotProjectionConflict
			}
			if currentPrivate != nil && private.ClientTurnID == "" {
				private.ClientTurnID = currentPrivate.ClientTurnID
			}
		}
		if replacement {
			current = BotRunProjection{ReportRevision: -1}
		} else {
			current.ReportRevision = stored.BotReportRevision
		}
		if projection != nil {
			current, _, err = MergeBotRunProjection(current, *projection)
			if err != nil {
				return err
			}
		}
		private.SettlementLedgerHash = ""
		private.ModeLockState = "locked"
		raw, err := marshalPersistedProjectionWithContext(current, &private)
		if err != nil {
			return err
		}
		updates := map[string]interface{}{
			"answer":              out.Answer,
			"bot_projection_json": raw,
			"bot_report_revision": current.ReportRevision,
			"bot_run_id":          out.BotRunID,
			"follow_up_questions": out.FollowUpQuestions,
			"log_status":          "",
			"mode":                mode,
			"status":              out.Status,
			"task_id":             out.TaskId,
			"tool_name":           out.ToolName,
		}
		if replacement {
			updates["query"] = currentPrivate.Replacement.Query
			// New reference-only submissions leave the legacy columns untouched.
			// Preserve the assignments only for an older private replacement that
			// still carries historical file metadata.
			if currentPrivate.Replacement.FileName != "" {
				updates["file_name"] = currentPrivate.Replacement.FileName
			}
			if currentPrivate.Replacement.UploadPath != "" {
				updates["upload_path"] = currentPrivate.Replacement.UploadPath
			}
			updates["server_id"] = ""
			updates["server_file_path"] = ""
			updates["download_path"] = ""
		}
		expectedStatus := "SUBMITTING"
		if replacement {
			expectedStatus = statusSucceeded
		}
		settled := tx.Model(&model.QuestionAgentLog{}).
			Where(
				"id = ? AND user_name = ? AND dialogue_id = ? AND status = ?",
				rowID,
				username,
				dialogueID,
				expectedStatus,
			).
			Updates(updates)
		if settled.Error != nil {
			return settled.Error
		}
		if settled.RowsAffected != 1 {
			return ErrBotProjectionConflict
		}
		if err := lockConversationRootModeWithDB(ctx, tx, username, dialogueID); err != nil {
			return err
		}
		if replacement {
			if err := invalidateConversationContextsAfter(
				ctx,
				tx,
				username,
				dialogueID,
				rowID,
			); err != nil {
				return err
			}
		}

		if _, err := buildConversationLedgerWithDB(
			ctx,
			tx,
			username,
			dialogueID,
		); err != nil {
			return err
		}
		private.SettlementLedgerHash = stagedLedgerVersion
		raw, err = marshalPersistedProjectionWithContext(current, &private)
		if err != nil {
			return err
		}
		finalized := tx.Model(&model.QuestionAgentLog{}).
			Where("id = ? AND user_name = ? AND dialogue_id = ?", rowID, username, dialogueID).
			UpdateColumn("bot_projection_json", raw)
		if finalized.Error != nil {
			return finalized.Error
		}
		if finalized.RowsAffected != 1 {
			return ErrBotProjectionConflict
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	return stagedLedgerVersion, nil
}

func lockConversationRootModeWithDB(
	ctx context.Context,
	tx *gorm.DB,
	username string,
	dialogueID string,
) error {
	var root struct {
		ID                int64  `gorm:"column:id"`
		BotProjectionJSON string `gorm:"column:bot_projection_json"`
		BotReportRevision int64  `gorm:"column:bot_report_revision"`
	}
	result := tx.WithContext(ctx).
		Model(&model.QuestionAgentLog{}).
		Select("id, bot_projection_json, bot_report_revision").
		Where(
			"dialogue_id = ? AND f_id = 0 AND user_name = ? AND delete_at IS NULL",
			dialogueID,
			username,
		).
		Order("id ASC").
		First(&root)
	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return ErrBotProjectionNotFound
	}
	if result.Error != nil {
		return result.Error
	}
	projection, private, err := unmarshalPersistedProjectionWithContext(root.BotProjectionJSON)
	if err != nil {
		return err
	}
	if private == nil {
		private = &persistedConversationContext{}
	}
	if private.ModeLockState == "locked" {
		return nil
	}
	next := private.clone()
	next.ModeLockState = "locked"
	encoded, err := marshalPersistedProjectionWithContext(projection, &next)
	if err != nil {
		return err
	}
	updated := tx.Model(&model.QuestionAgentLog{}).
		Where(botProjectionCASPredicate, root.ID, username, root.BotReportRevision, root.BotProjectionJSON).
		UpdateColumn("bot_projection_json", encoded)
	if updated.Error != nil {
		return updated.Error
	}
	if updated.RowsAffected != 1 {
		return ErrBotProjectionConflict
	}
	return nil
}

func lockConversationRootMode(
	ctx context.Context,
	username string,
	dialogueID string,
) error {
	return model.DB(ctx).WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return lockConversationRootModeWithDB(ctx, tx, username, dialogueID)
	})
}

func invalidateConversationContextsAfter(
	ctx context.Context,
	tx *gorm.DB,
	username string,
	dialogueID string,
	rowID int64,
) error {
	var rows []struct {
		ID                int64  `gorm:"column:id"`
		BotProjectionJSON string `gorm:"column:bot_projection_json"`
		BotReportRevision int64  `gorm:"column:bot_report_revision"`
	}
	if err := tx.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Model(&model.QuestionAgentLog{}).
		Select("id, bot_projection_json, bot_report_revision").
		Where(
			"user_name = ? AND dialogue_id = ? AND id > ? AND delete_at IS NULL AND status = ?",
			username,
			dialogueID,
			rowID,
			statusSucceeded,
		).
		Order("id ASC").
		Find(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		projection, private, err := unmarshalPersistedProjectionWithContext(
			row.BotProjectionJSON,
		)
		if err != nil {
			return err
		}
		if private == nil {
			continue
		}
		next := private.clone()
		next.Stage = nil
		next.SettlementState = conversationSettlementRebuildRequired
		next.SettlementLedgerHash = ""
		next.RebuildLedgerVersion = ""
		next.RebuildLedgerCursor = 0
		next.AssistantSummary = ""
		next.Replacement = nil
		encoded, err := marshalPersistedProjectionWithContext(projection, &next)
		if err != nil {
			return err
		}
		result := tx.Model(&model.QuestionAgentLog{}).
			Where(botProjectionCASPredicate, row.ID, username, row.BotReportRevision, row.BotProjectionJSON).
			UpdateColumn("bot_projection_json", encoded)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrBotProjectionConflict
		}
	}
	return nil
}

func updateConversationSettlementState(
	ctx context.Context,
	username string,
	rowID int64,
	ledgerVersion string,
	from string,
	to string,
) error {
	for attempt := 0; attempt < botProjectionCASAttempts; attempt++ {
		projection, private, currentRaw, revision, err := loadPersistedBotProjectionRow(
			ctx,
			username,
			rowID,
		)
		if err != nil {
			return err
		}
		if private == nil || private.SettlementLedgerHash != ledgerVersion {
			return ErrInvalidBotConversationContext
		}
		if private.SettlementState == to {
			return nil
		}
		if private.SettlementState != from {
			return ErrInvalidBotConversationContext
		}
		next := private.clone()
		next.SettlementState = to
		encoded, err := marshalPersistedProjectionWithContext(projection, &next)
		if err != nil {
			return err
		}
		result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
			Where(botProjectionCASPredicate, rowID, username, revision, currentRaw).
			UpdateColumn("bot_projection_json", encoded)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 1 {
			return nil
		}
	}
	return ErrBotProjectionConflict
}
