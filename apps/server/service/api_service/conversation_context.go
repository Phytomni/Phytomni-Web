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
	maxPersistedReplacementQueryBytes = rxBot.HardMaxUserQueryChars * utf8.UTFMax
	// encoding/json escapes <, >, &, U+2028, and U+2029 as six-byte \uXXXX
	// sequences. Keep the serialized envelope large enough for any semantically
	// valid hard-limit query while the raw UTF-8 byte bound remains unchanged.
	maxPersistedJSONEscapedRuneBytes     = 6
	maxPersistedConversationBytes        = rxBot.HardMaxUserQueryChars*maxPersistedJSONEscapedRuneBytes + 1<<20
	maxPersistedReplacementFileBytes     = 4 << 10
	maxPersistedReplacementPathBytes     = 8 << 10
	maxPersistedReplacementAnswerBytes   = 256 << 10
	maxPersistedReplacementFollowUpBytes = 64 << 10
	maxPersistedRetiredClientTurns       = 8
	maxPersistedActiveA2UIBytes          = 64 << 10
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
	RequestFingerprint   string                      `json:"request_fingerprint,omitempty"`
	ModeLockState        string                      `json:"mode_lock_state,omitempty"`
	Stage                *rxBot.ContextStageMetadata `json:"stage,omitempty"`
	SettlementState      string                      `json:"settlement_state,omitempty"`
	SettlementLedgerHash string                      `json:"settlement_ledger_hash,omitempty"`
	RebuildLedgerVersion string                      `json:"rebuild_ledger_version,omitempty"`
	RebuildLedgerCursor  int64                       `json:"rebuild_ledger_cursor,omitempty"`
	// AssistantSummary is reserved for a future typed Bot-owned metadata
	// summary. V1 settlement currently leaves it empty so display output never
	// becomes replayable conversation context.
	AssistantSummary  string                            `json:"assistant_summary,omitempty"`
	ArtifactRefs      []rxBot.ArtifactRefV1             `json:"artifact_refs,omitempty"`
	InputAttachments  []rxBot.AssetAttachmentRef        `json:"input_attachments,omitempty"`
	InteropMode       string                            `json:"interop_mode,omitempty"`
	InteropTargets    []string                          `json:"interop_targets,omitempty"`
	RetiredIdentities []persistedClientTurnIdentity     `json:"retired_identities,omitempty"`
	Replacement       *persistedConversationReplacement `json:"replacement,omitempty"`
	// ActiveA2UI is the bounded public pause surface for an INPUT_REQUIRED
	// Review row. Replacement pauses stay on Replacement.ActiveA2UI.
	ActiveA2UI json.RawMessage `json:"active_a2ui,omitempty"`
}

type persistedClientTurnIdentity struct {
	ClientTurnID       string `json:"client_turn_id"`
	RequestFingerprint string `json:"request_fingerprint"`
}

type persistedConversationReplacement struct {
	ClientTurnID       string `json:"client_turn_id"`
	RequestFingerprint string `json:"request_fingerprint,omitempty"`
	// Query is the bounded candidate question shown to the caller while an
	// accepted replacement remains private. Histories, reports, and provider
	// payloads are never retained here.
	Query                  string                              `json:"query,omitempty"`
	ToolName               string                              `json:"tool_name"`
	Mode                   string                              `json:"mode"`
	FileName               string                              `json:"file_name,omitempty"`
	UploadPath             string                              `json:"upload_path,omitempty"`
	InputAttachments       []rxBot.AssetAttachmentRef          `json:"input_attachments,omitempty"`
	ArtifactRefs           []rxBot.ArtifactRefV1               `json:"artifact_refs,omitempty"`
	InteropMode            string                              `json:"interop_mode,omitempty"`
	InteropTargets         []string                            `json:"interop_targets,omitempty"`
	ConversationV1         bool                                `json:"conversation_v1,omitempty"`
	ActiveStatus           string                              `json:"active_status,omitempty"`
	ActiveBotRunID         string                              `json:"active_bot_run_id,omitempty"`
	ActiveTaskID           string                              `json:"active_task_id,omitempty"`
	ActiveTrackingDegraded bool                                `json:"active_tracking_degraded,omitempty"`
	ActiveReportRevision   int64                               `json:"active_report_revision,omitempty"`
	ActiveDegradedInterop  bool                                `json:"active_degraded_interop,omitempty"`
	ActiveInterop          *InteropProvenance                  `json:"active_interop,omitempty"`
	ActiveA2UI             json.RawMessage                     `json:"active_a2ui,omitempty"`
	ActiveDelivery         *persistedReplacementActiveDelivery `json:"active_delivery,omitempty"`
	TerminalResult         *persistedReplacementTerminalResult `json:"terminal_result,omitempty"`
}

// persistedReplacementActiveDelivery retains only the bounded identity and
// lifecycle fields needed to wait for required result delivery. Archive names,
// object references, output paths, and report text remain outside the private
// candidate until a ready snapshot is atomically promoted.
type persistedReplacementActiveDelivery struct {
	SchemaVersion   int    `json:"schema_version"`
	Required        bool   `json:"required"`
	Status          string `json:"status"`
	Revision        int64  `json:"revision"`
	InventoryDigest string `json:"inventory_digest,omitempty"`
}

type persistedReplacementTerminalResult struct {
	ToolName          string             `json:"tool_name"`
	ToolUnresolved    bool               `json:"tool_unresolved,omitempty"`
	Answer            string             `json:"answer,omitempty"`
	FollowUpQuestions string             `json:"follow_up_questions,omitempty"`
	Status            string             `json:"status"`
	BotRunID          string             `json:"bot_run_id,omitempty"`
	TaskID            string             `json:"task_id,omitempty"`
	TrackingDegraded  bool               `json:"tracking_degraded,omitempty"`
	ReportRevision    int64              `json:"report_revision,omitempty"`
	DegradedInterop   bool               `json:"degraded_interop,omitempty"`
	Interop           *InteropProvenance `json:"interop,omitempty"`
}

func (value persistedConversationContext) clone() persistedConversationContext {
	copyValue := value
	if value.Stage != nil {
		stage := *value.Stage
		copyValue.Stage = &stage
	}
	copyValue.ArtifactRefs = append([]rxBot.ArtifactRefV1(nil), value.ArtifactRefs...)
	copyValue.InputAttachments = append([]rxBot.AssetAttachmentRef(nil), value.InputAttachments...)
	copyValue.InteropTargets = append([]string(nil), value.InteropTargets...)
	copyValue.RetiredIdentities = append([]persistedClientTurnIdentity(nil), value.RetiredIdentities...)
	copyValue.ActiveA2UI = append(json.RawMessage(nil), value.ActiveA2UI...)
	if value.Replacement != nil {
		replacement := *value.Replacement
		replacement.InputAttachments = append([]rxBot.AssetAttachmentRef(nil), value.Replacement.InputAttachments...)
		replacement.ArtifactRefs = append([]rxBot.ArtifactRefV1(nil), value.Replacement.ArtifactRefs...)
		replacement.InteropTargets = append([]string(nil), value.Replacement.InteropTargets...)
		replacement.ActiveA2UI = append(json.RawMessage(nil), value.Replacement.ActiveA2UI...)
		if value.Replacement.ActiveInterop != nil {
			interop := *value.Replacement.ActiveInterop
			replacement.ActiveInterop = &interop
		}
		if value.Replacement.ActiveDelivery != nil {
			delivery := *value.Replacement.ActiveDelivery
			replacement.ActiveDelivery = &delivery
		}
		if value.Replacement.TerminalResult != nil {
			terminal := *value.Replacement.TerminalResult
			if value.Replacement.TerminalResult.Interop != nil {
				interop := *value.Replacement.TerminalResult.Interop
				terminal.Interop = &interop
			}
			replacement.TerminalResult = &terminal
		}
		copyValue.Replacement = &replacement
	}
	return copyValue
}

func (value persistedConversationContext) validate() error {
	if err := validatePersistedASCII("client_turn_id", value.ClientTurnID, maxPersistedClientTurnIDBytes); err != nil {
		return err
	}
	if err := validatePersistedFingerprint("request_fingerprint", value.RequestFingerprint); err != nil {
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
	if len(value.RetiredIdentities) > maxPersistedRetiredClientTurns {
		return persistedContextError("retired_identities exceeds bounds")
	}
	seenClientTurns := make(map[string]struct{}, len(value.RetiredIdentities)+2)
	if value.ClientTurnID != "" {
		seenClientTurns[value.ClientTurnID] = struct{}{}
	}
	for index, identity := range value.RetiredIdentities {
		if err := identity.validate(fmt.Sprintf("retired_identities[%d]", index)); err != nil {
			return err
		}
		if _, exists := seenClientTurns[identity.ClientTurnID]; exists {
			return persistedContextError("retired_identities contains a duplicate client_turn_id")
		}
		seenClientTurns[identity.ClientTurnID] = struct{}{}
	}
	if value.Replacement != nil {
		if _, exists := seenClientTurns[value.Replacement.ClientTurnID]; exists {
			return persistedContextError("replacement.client_turn_id is already reserved")
		}
		if err := value.Replacement.validate(); err != nil {
			return err
		}
	}
	if len(value.ActiveA2UI) > maxPersistedActiveA2UIBytes {
		return persistedContextError("active_a2ui exceeds bounds")
	}
	if len(value.ActiveA2UI) > 0 {
		if _, err := DecodeA2uiSurface(value.ActiveA2UI); err != nil {
			return persistedContextError("active_a2ui is invalid")
		}
	}
	return nil
}

func (value persistedClientTurnIdentity) validate(field string) error {
	if err := validatePersistedASCII(field+".client_turn_id", value.ClientTurnID, maxPersistedClientTurnIDBytes); err != nil {
		return err
	}
	if value.ClientTurnID == "" {
		return persistedContextError(field + ".client_turn_id is required")
	}
	if err := validatePersistedFingerprint(field+".request_fingerprint", value.RequestFingerprint); err != nil {
		return err
	}
	if value.RequestFingerprint == "" {
		return persistedContextError(field + ".request_fingerprint is required")
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
	if err := validatePersistedFingerprint("replacement.request_fingerprint", value.RequestFingerprint); err != nil {
		return err
	}
	if err := validatePersistedUTF8(
		"replacement.query",
		value.Query,
		maxPersistedReplacementQueryBytes,
	); err != nil {
		return err
	}
	if utf8.RuneCountInString(value.Query) > rxBot.HardMaxUserQueryChars {
		return persistedContextError("replacement.query exceeds bounds")
	}
	if value.RequestFingerprint == "" && strings.TrimSpace(value.Query) == "" {
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
	if len(value.ArtifactRefs) > maxPersistedArtifactRefs {
		return persistedContextError("replacement.artifact_refs exceeds bounds")
	}
	for index, ref := range value.ArtifactRefs {
		if !persistedArtifactIDPattern.MatchString(ref.ArtifactID) ||
			len([]byte(ref.DisplayName)) > maxPersistedArtifactFieldBytes ||
			!utf8.ValidString(ref.DisplayName) || ref.DisplayName == "" ||
			strings.ContainsAny(ref.DisplayName, `/\\`) || persistedURISchemePattern.MatchString(ref.DisplayName) {
			return persistedContextError(fmt.Sprintf("replacement.artifact_refs[%d] is invalid", index))
		}
	}
	if value.TerminalResult != nil && value.ActiveStatus != "" {
		return persistedContextError("replacement cannot be active and terminal")
	}
	if value.ActiveStatus != "" {
		if value.ActiveStatus != "RUNNING" && value.ActiveStatus != "INPUT_REQUIRED" {
			return persistedContextError("replacement.active_status is invalid")
		}
		if err := validatePersistedASCII("replacement.active_bot_run_id", value.ActiveBotRunID, maxProjectionRunID); err != nil {
			return err
		}
		if value.ActiveBotRunID == "" {
			return persistedContextError("replacement.active_bot_run_id is required")
		}
		if err := validatePersistedASCII("replacement.active_task_id", value.ActiveTaskID, maxProjectionRunID); err != nil {
			return err
		}
		if value.ActiveReportRevision < -1 {
			return persistedContextError("replacement.active_report_revision is invalid")
		}
		if value.ActiveDelivery != nil {
			if value.ActiveStatus != "RUNNING" {
				return persistedContextError("replacement.active_delivery requires running")
			}
			if err := value.ActiveDelivery.validate(); err != nil {
				return err
			}
		}
		if value.ActiveInterop != nil {
			if _, err := normalizeInteropProvenance(value.ActiveInterop); err != nil {
				return persistedContextError("replacement.active_interop is invalid")
			}
		}
		if len(value.ActiveA2UI) > maxPersistedActiveA2UIBytes {
			return persistedContextError("replacement.active_a2ui exceeds bounds")
		}
		if len(value.ActiveA2UI) > 0 {
			if value.ActiveStatus != "INPUT_REQUIRED" {
				return persistedContextError("replacement.active_a2ui requires input_required")
			}
			if _, err := DecodeA2uiSurface(value.ActiveA2UI); err != nil {
				return persistedContextError("replacement.active_a2ui is invalid")
			}
		}
	} else if value.ActiveBotRunID != "" || value.ActiveTaskID != "" || len(value.ActiveA2UI) > 0 || value.ActiveInterop != nil || value.ActiveDelivery != nil {
		return persistedContextError("replacement active metadata has no status")
	}
	if value.TerminalResult != nil {
		if value.TerminalResult.ToolUnresolved && value.ToolName != "" {
			return persistedContextError("replacement.terminal_result unresolved tool conflicts with candidate")
		}
		if err := value.TerminalResult.validate(); err != nil {
			return err
		}
	}
	return nil
}

func (value persistedReplacementActiveDelivery) validate() error {
	if value.SchemaVersion != 1 || !value.Required || value.Status != "pending" || value.Revision < 0 {
		return persistedContextError("replacement.active_delivery is invalid")
	}
	if value.InventoryDigest != "" {
		const prefix = "sha256:"
		if !strings.HasPrefix(value.InventoryDigest, prefix) ||
			!persistedLedgerHashPattern.MatchString(strings.TrimPrefix(value.InventoryDigest, prefix)) {
			return persistedContextError("replacement.active_delivery.inventory_digest is invalid")
		}
	}
	return nil
}

func (value persistedReplacementTerminalResult) validate() error {
	if err := validatePersistedToken("replacement.terminal_result.tool_name", value.ToolName, 64); err != nil {
		return err
	}
	if value.ToolName == "" && !value.ToolUnresolved {
		return persistedContextError("replacement.terminal_result.tool_name is required")
	}
	if value.ToolName != "" && value.ToolUnresolved {
		return persistedContextError("replacement.terminal_result.tool_name conflicts with unresolved marker")
	}
	if err := validatePersistedUTF8("replacement.terminal_result.answer", value.Answer, maxPersistedReplacementAnswerBytes); err != nil {
		return err
	}
	if err := validatePersistedUTF8("replacement.terminal_result.follow_up_questions", value.FollowUpQuestions, maxPersistedReplacementFollowUpBytes); err != nil {
		return err
	}
	if value.FollowUpQuestions != "" && boundedReplacementFollowUp(value.FollowUpQuestions) == "" {
		return persistedContextError("replacement.terminal_result.follow_up_questions is invalid")
	}
	if err := validatePersistedToken("replacement.terminal_result.status", value.Status, maxProjectionStatus); err != nil {
		return err
	}
	switch value.Status {
	case "FAILED", "CANCELLED", "TIMED_OUT":
	default:
		return persistedContextError("replacement.terminal_result.status is invalid")
	}
	if err := validatePersistedASCII("replacement.terminal_result.bot_run_id", value.BotRunID, maxProjectionRunID); err != nil {
		return err
	}
	if err := validatePersistedASCII("replacement.terminal_result.task_id", value.TaskID, maxProjectionRunID); err != nil {
		return err
	}
	if value.ReportRevision < -1 {
		return persistedContextError("replacement.terminal_result.report_revision is invalid")
	}
	if value.Interop != nil {
		if _, err := normalizeInteropProvenance(value.Interop); err != nil {
			return persistedContextError("replacement.terminal_result.interop is invalid")
		}
	}
	return nil
}

func validatePersistedFingerprint(field, value string) error {
	if value == "" {
		return nil
	}
	if !persistedLedgerHashPattern.MatchString(value) {
		return persistedContextError(field + " is invalid")
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
		return nil, persistedContextError("serialized context exceeds bounds")
	}
	return encoded, nil
}

func (value *persistedConversationContext) UnmarshalJSON(data []byte) error {
	if len(data) > maxPersistedConversationBytes {
		return persistedContextError("serialized context exceeds bounds")
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
	replacementQuery string,
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
			private.RetiredIdentities = append(
				[]persistedClientTurnIdentity(nil),
				currentPrivate.RetiredIdentities...,
			)
			if currentPrivate.ClientTurnID != "" {
				if currentPrivate.RequestFingerprint == "" ||
					len(private.RetiredIdentities) >= maxPersistedRetiredClientTurns {
					return ErrBotProjectionConflict
				}
				private.RetiredIdentities = append(
					private.RetiredIdentities,
					persistedClientTurnIdentity{
						ClientTurnID:       currentPrivate.ClientTurnID,
						RequestFingerprint: currentPrivate.RequestFingerprint,
					},
				)
			}
		} else {
			if stored.Status != "SUBMITTING" && stored.Status != "RUNNING" {
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
			updates["query"] = replacementQuery
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
		expectedStatus := stored.Status
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

func encodePersistedActiveA2UI(surface *A2uiSurfaceDTO) (json.RawMessage, error) {
	if surface == nil {
		return nil, nil
	}
	encoded, err := json.Marshal(surface)
	if err != nil || len(encoded) > maxPersistedActiveA2UIBytes {
		return nil, ErrInvalidA2uiSurface
	}
	if _, err := DecodeA2uiSurface(encoded); err != nil {
		return nil, ErrInvalidA2uiSurface
	}
	return encoded, nil
}

func decodeConversationActiveA2UI(private persistedConversationContext) *A2uiSurfaceDTO {
	if len(private.ActiveA2UI) == 0 {
		return nil
	}
	surface, err := DecodeA2uiSurface(private.ActiveA2UI)
	if err != nil {
		return nil
	}
	return surface
}

func persistConversationActiveA2UI(
	ctx context.Context,
	username string,
	rowID int64,
	out *QueryData,
) error {
	if out == nil || rowID <= 0 || out.Status != "INPUT_REQUIRED" || out.A2UI == nil {
		return nil
	}
	encoded, err := encodePersistedActiveA2UI(out.A2UI)
	if err != nil {
		return err
	}
	private, err := LoadBotConversationContext(ctx, username, rowID)
	if err != nil {
		return err
	}
	private.ActiveA2UI = encoded
	return SaveBotConversationContext(ctx, username, rowID, private)
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
