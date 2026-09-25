package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const conversationTurnSequenceName = "conversation"

func allocateConversationTurnIDV2(ctx context.Context, tx *gorm.DB) (int64, error) {
	now := time.Now().UTC()
	var legacyMax, turnMax int64
	if tx.Migrator().HasTable(&model.QuestionAgentLog{}) {
		if err := tx.WithContext(ctx).Model(&model.QuestionAgentLog{}).
			Select("COALESCE(MAX(id), 0)").Scan(&legacyMax).Error; err != nil {
			return 0, err
		}
	}
	if err := tx.WithContext(ctx).Model(&model.ConversationTurnV2{}).
		Select("COALESCE(MAX(id), 0)").Scan(&turnMax).Error; err != nil {
		return 0, err
	}
	seed := max(legacyMax, turnMax)
	sequence := model.ConversationTurnSequenceV2{
		Name: conversationTurnSequenceName, LastID: seed, UpdatedAt: now,
	}
	if err := tx.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&sequence).Error; err != nil {
		return 0, err
	}
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("name = ?", conversationTurnSequenceName).Take(&sequence).Error; err != nil {
		return 0, err
	}
	if sequence.LastID < seed {
		sequence.LastID = seed
	}
	next := sequence.LastID + 1
	result := tx.WithContext(ctx).Model(&model.ConversationTurnSequenceV2{}).
		Where("name = ? AND last_id = ?", conversationTurnSequenceName, sequence.LastID).
		Updates(map[string]any{"last_id": next, "updated_at": now})
	if result.Error != nil {
		return 0, result.Error
	}
	if result.RowsAffected != 1 {
		return 0, ErrDuplicateClientTurn
	}
	return next, nil
}

func conversationTurnContextJSON(in QueryInput, target v1SubmissionTarget) (string, error) {
	value := persistedConversationContext{
		ClientTurnID:       in.ClientTurnID,
		ModeLockState:      "provisional",
		SettlementState:    "submission_append",
		InputAttachments:   append([]rxBot.AssetAttachmentRef(nil), in.Attachments...),
		ArtifactRefs:       append([]rxBot.ArtifactRefV1(nil), target.artifacts...),
		InteropMode:        in.InteropMode,
		InteropTargets:     append([]string(nil), in.InteropTargets...),
		RequestFingerprint: submissionRequestFingerprint(in, target, true),
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func decodeConversationTurnContext(raw string) (*persistedConversationContext, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var value persistedConversationContext
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return nil, err
	}
	return &value, nil
}

func toolNameForTurn(in QueryInput) string {
	if in.Surface == QuerySurfaceChat && in.Mode == "instant" {
		return "ChatAgent"
	}
	return in.Tool
}

func queryDataFromConversationTurnV2(turn model.ConversationTurnV2) *QueryData {
	reaction := turn.ReactionType
	if reaction == "" {
		reaction = "0"
	}
	return &QueryData{
		Id: turn.ID, ToolName: turn.ToolName, Status: strings.ToUpper(turn.Status),
		DialogueId: turn.DialogueID, ReactionType: reaction,
	}
}

func allocateConversationTurnV2(
	ctx context.Context,
	tx *gorm.DB,
	username string,
	in QueryInput,
	target v1SubmissionTarget,
) (*model.ConversationTurnV2, error) {
	now := time.Now().UTC()
	contextJSON, err := conversationTurnContextJSON(in, target)
	if err != nil {
		return nil, err
	}
	toolName := toolNameForTurn(in)
	if target.operation == "replace" {
		var current model.ConversationTurnV2
		lookup := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND user_name = ? AND dialogue_id = ? AND delete_at IS NULL", in.RefreshId, username, target.dialogueID).
			Take(&current)
		if errors.Is(lookup.Error, gorm.ErrRecordNotFound) {
			var legacy model.QuestionAgentLog
			if err := tx.WithContext(ctx).Where(
				"id = ? AND user_name = ? AND dialogue_id = ? AND delete_at IS NULL AND status = ?",
				in.RefreshId, username, target.dialogueID, statusSucceeded,
			).Take(&legacy).Error; err != nil {
				return nil, err
			}
			current = model.ConversationTurnV2{
				ID: legacy.Id, UserName: username, DialogueID: legacy.DialogueId,
				ParentID: legacy.FId, TitleQuery: legacy.TitleQuery,
				ReactionType: legacy.ReactionType, CollectType: legacy.CollectType,
				CreatedAt: legacy.CreatedAt,
			}
		} else if lookup.Error != nil {
			return nil, lookup.Error
		} else if !conversationStatusSucceeded(current.Status) {
			return nil, gorm.ErrRecordNotFound
		}
		current.ExecutionID = in.ClientTurnID
		current.Operation = "replace"
		current.Query = in.Query
		current.ToolName = toolName
		current.Mode = target.mode
		current.Status = "admitted"
		current.ContextJSON = contextJSON
		current.UpdatedAt = now
		if current.ReactionType == "" {
			current.ReactionType = "0"
		}
		if current.CollectType == "" {
			current.CollectType = "0"
		}
		if current.CreatedAt.IsZero() {
			current.CreatedAt = now
		}
		if err := tx.WithContext(ctx).Save(&current).Error; err != nil {
			return nil, err
		}
		if err := tx.WithContext(ctx).Model(&model.ConversationMessageV2{}).
			Where("user_name = ? AND delete_at IS NULL AND (turn_id = ? OR legacy_message_id = ?)", username, current.ID, current.ID).
			Updates(map[string]any{"delete_at": now, "updated_at": now}).Error; err != nil {
			return nil, err
		}
		return &current, nil
	}

	turnID, err := allocateConversationTurnIDV2(ctx, tx)
	if err != nil {
		return nil, err
	}
	title := ""
	if target.parentID == 0 {
		title = conversationTitle(in.Query)
	}
	turn := model.ConversationTurnV2{
		ID: turnID, UserName: username, ExecutionID: in.ClientTurnID,
		DialogueID: target.dialogueID, ParentID: target.parentID, Operation: "append",
		Query: in.Query, TitleQuery: title, ToolName: toolName, Mode: target.mode,
		Status: "admitted", ReactionType: "0", CollectType: "0", ContextJSON: contextJSON,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := tx.WithContext(ctx).Create(&turn).Error; err != nil {
		return nil, err
	}
	return &turn, nil
}

func conversationStatusSucceeded(value string) bool {
	return strings.EqualFold(strings.TrimSpace(value), statusSucceeded) || strings.EqualFold(strings.TrimSpace(value), "succeeded")
}

func (ps *Service) resolveExecutionSubmissionTarget(
	ctx context.Context,
	username string,
	in QueryInput,
	enforceModeLock bool,
) (v1SubmissionTarget, error) {
	if strings.TrimSpace(username) == "" {
		return v1SubmissionTarget{}, ErrQueryAuthentication
	}
	target := v1SubmissionTarget{mode: in.Mode, operation: queryOperation(in)}
	if in.Id == 0 && in.RefreshId == 0 {
		target.dialogueID = uuid.NewString()
		if len(in.ArtifactIDs) != 0 {
			return v1SubmissionTarget{}, ErrConversationArtifactOwnership
		}
		return target, nil
	}

	lookupID := in.Id
	if in.RefreshId != 0 {
		lookupID = in.RefreshId
	}
	if !model.DB(ctx).Migrator().HasTable(&model.ConversationTurnV2{}) {
		return ps.resolveV1SubmissionTarget(ctx, username, in, enforceModeLock)
	}
	var turn model.ConversationTurnV2
	err := model.DB(ctx).WithContext(ctx).
		Where("id = ? AND user_name = ? AND delete_at IS NULL", lookupID, username).
		Take(&turn).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// Existing V1 conversations remain resumable through a read-only adapter.
		return ps.resolveV1SubmissionTarget(ctx, username, in, enforceModeLock)
	}
	if err != nil {
		return v1SubmissionTarget{}, err
	}
	ledger, err := buildExecutionConversationLedgerWithDB(ctx, model.DB(ctx), username, turn.DialogueID)
	if err != nil {
		return v1SubmissionTarget{}, err
	}
	mode := strings.ToLower(strings.TrimSpace(ledger.Mode))
	if mode == "" {
		mode = "instant"
	}
	if enforceModeLock && mode != in.Mode {
		return v1SubmissionTarget{}, ErrConversationModeConflict
	}
	artifacts, err := ledger.AuthorizeArtifactIDs(in.ArtifactIDs)
	if err != nil {
		return v1SubmissionTarget{}, err
	}
	target.dialogueID = turn.DialogueID
	target.parentID = ledger.RootID
	target.mode = mode
	target.artifacts = artifacts
	return target, nil
}

func buildExecutionConversationLedgerWithDB(
	ctx context.Context,
	tx *gorm.DB,
	username string,
	dialogueID string,
) (ConversationLedger, error) {
	rowsByID := make(map[int64]conversationLedgerRow)
	modes := make(map[int64]string)
	parents := make(map[int64]int64)

	var legacy []model.QuestionAgentLog
	if tx.Migrator().HasTable(&model.QuestionAgentLog{}) {
		if err := tx.WithContext(ctx).Where(
			"dialogue_id = ? AND user_name = ? AND delete_at IS NULL", dialogueID, username,
		).Order("id ASC").Find(&legacy).Error; err != nil {
			return ConversationLedger{}, err
		}
	}
	for _, stored := range legacy {
		_, private, err := unmarshalPersistedProjectionWithContext(stored.BotProjectionJSON)
		if err != nil {
			return ConversationLedger{}, err
		}
		row := conversationLedgerRow{
			ID: stored.Id, Status: stored.Status, Query: stored.Query, Context: private,
			fingerprint: ledgerFingerprintRow{
				ID: stored.Id, ParentID: stored.FId, Status: stored.Status,
				ToolName: stored.ToolName, Mode: stored.Mode,
				ReportRevision: stored.BotReportRevision,
				UpdatedAtUTC:   stored.UpdatedAt.UTC().Format(time.RFC3339Nano),
				QuerySHA256:    sha256Hex([]byte(stored.Query)), AnswerSHA256: sha256Hex([]byte(stored.Answer)),
			},
		}
		if private != nil && private.Stage != nil && private.SettlementState == conversationSettlementAcked {
			row.BusinessContextVersion = private.Stage.ProposedBusinessContextVersion
		}
		rowsByID[stored.Id], modes[stored.Id], parents[stored.Id] = row, stored.Mode, stored.FId
	}

	var turns []model.ConversationTurnV2
	if err := tx.WithContext(ctx).Where(
		"dialogue_id = ? AND user_name = ? AND delete_at IS NULL", dialogueID, username,
	).Order("id ASC").Find(&turns).Error; err != nil {
		return ConversationLedger{}, err
	}
	for _, turn := range turns {
		private, err := decodeConversationTurnContext(turn.ContextJSON)
		if err != nil {
			return ConversationLedger{}, err
		}
		var admission model.QuestionAgentExecutionAdmission
		contextVersion := int64(0)
		projectionRevision := int64(0)
		if err := tx.WithContext(ctx).Where(
			"user_name = ? AND execution_id = ?", username, turn.ExecutionID,
		).Take(&admission).Error; err == nil {
			contextVersion = admission.ContextRevision
			projectionRevision = admission.ProjectionRevision
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return ConversationLedger{}, err
		}
		row := conversationLedgerRow{
			ID: turn.ID, Status: turn.Status, Query: turn.Query, Context: private,
			BusinessContextVersion: contextVersion,
			fingerprint: ledgerFingerprintRow{
				ID: turn.ID, ParentID: turn.ParentID, Status: turn.Status,
				ToolName: turn.ToolName, Mode: turn.Mode, ReportRevision: projectionRevision,
				UpdatedAtUTC: turn.UpdatedAt.UTC().Format(time.RFC3339Nano),
				QuerySHA256:  sha256Hex([]byte(turn.Query)), AnswerSHA256: sha256Hex(nil),
			},
		}
		rowsByID[turn.ID], modes[turn.ID], parents[turn.ID] = row, turn.Mode, turn.ParentID
	}
	if len(rowsByID) == 0 {
		return ConversationLedger{}, ErrConversationLedgerNotFound
	}
	ids := make([]int64, 0, len(rowsByID))
	for id := range rowsByID {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	rootID := int64(0)
	for _, id := range ids {
		if parents[id] == 0 {
			rootID = id
			break
		}
	}
	if rootID == 0 {
		return ConversationLedger{}, ErrConversationLedgerNotFound
	}
	root := rowsByID[rootID]
	ledger := ConversationLedger{
		ConversationKey: dialogueID, DialogueID: dialogueID, RootID: rootID,
		RootStatus: root.Status, Mode: normalizedConversationLedgerMode(modes[rootID]),
		ModeLockState: "locked", rows: make([]conversationLedgerRow, 0, len(ids)),
		artifacts: make(map[string]rxBot.ArtifactRefV1),
	}
	if root.Context != nil && root.Context.ModeLockState == "provisional" {
		ledger.ModeLockState = "provisional"
	}
	for _, id := range ids {
		row := rowsByID[id]
		ledger.rows = append(ledger.rows, row)
		ledger.Cursor = max(ledger.Cursor, id)
		if conversationStatusSucceeded(row.Status) && row.Context != nil {
			if err := ledger.addAuthorizedArtifacts(row.Context.ArtifactRefs); err != nil {
				return ConversationLedger{}, err
			}
		}
	}
	version, err := fingerprintConversationLedger(ledger.fingerprintRows())
	if err != nil {
		return ConversationLedger{}, err
	}
	ledger.Version = version
	return ledger, nil
}

func buildExecutionConversationEnvelope(
	ctx context.Context,
	tx *gorm.DB,
	username string,
	in QueryInput,
	target v1SubmissionTarget,
	permissions AgentPermissionResolution,
	turn model.ConversationTurnV2,
) (*rxBot.ConversationEnvelopeV1, error) {
	ledger, err := buildExecutionConversationLedgerWithDB(ctx, tx, username, turn.DialogueID)
	if err != nil {
		return nil, err
	}
	requestID := requestIDFromContext(ctx)
	if requestID == "" {
		requestID = uuid.NewString()
	}
	allowedAgents := append([]string(nil), permissions.AllowedTools...)
	if in.Surface == QuerySurfaceAgentProduct {
		allowedAgents = []string{in.Tool}
	} else if in.Mode == "instant" {
		allowedAgents = []string{"ChatAgent"}
	}
	mode := target.mode
	if in.Surface == QuerySurfaceAgentProduct {
		mode = "expert"
	}
	envelope := &rxBot.ConversationEnvelopeV1{
		SchemaVersion: 1, ConversationKey: ledger.ConversationKey,
		DialogueID: turn.DialogueID, TurnID: strconv.FormatInt(turn.ID, 10), RequestID: requestID,
		Operation: target.operation, Mode: mode,
		CurrentMessage:   rxBot.CurrentMessageV1{Content: in.Query, Locale: normalizedLocale(in.Locale)},
		RequestedAgentID: requestedAgentForV1(in), AllowedAgentIDs: allowedAgents,
		LedgerCursor: turn.ID, LedgerVersion: ledger.Version,
		BaseBusinessContextVersion: baseBusinessContextVersion(ledger, turn.ID),
		HistoryDelta:               ledger.HistoryBefore(turn.ID),
		ArtifactRefs:               append([]rxBot.ArtifactRefV1(nil), target.artifacts...),
	}
	if target.operation == "append" && target.parentID != 0 {
		rebuild, rebuildErr := ledger.RebuildBefore(turn.ID)
		if rebuildErr != nil {
			return nil, rebuildErr
		}
		if turn.ID != rebuild.Cursor+1 {
			envelope.Operation = "rebuild"
			envelope.LedgerVersion = rebuild.Version
			envelope.HistoryDelta = append(rebuild.History, rxBot.LedgerEntryV1{
				TurnID: envelope.TurnID, Role: "user", Content: boundConversationLedgerText(in.Query),
			})
			envelope.ArtifactRefs, err = mergeConversationArtifactRefs(rebuild.ArtifactRefs, target.artifacts)
			if err != nil {
				return nil, err
			}
		}
	}
	if err := envelope.Validate(); err != nil {
		return nil, err
	}
	return envelope, nil
}
