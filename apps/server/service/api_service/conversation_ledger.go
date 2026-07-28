package api_service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"

	"gorm.io/gorm"
)

const (
	maxConversationLedgerHistoryEntries = 200
	maxConversationLedgerMessageRunes   = 32_768
)

var (
	ErrConversationLedgerNotFound    = errors.New("conversation ledger not found")
	ErrConversationArtifactOwnership = errors.New("conversation artifact is not owned by this dialogue")
)

// ConversationLedger is an owner-validated snapshot of one undeleted
// dialogue. Raw assistant answers are reduced to hashes during construction;
// history can expose only previously persisted Bot-controlled summaries.
type ConversationLedger struct {
	ConversationKey string
	DialogueID      string
	RootID          int64
	Mode            string
	Cursor          int64
	Version         string

	rows      []conversationLedgerRow
	artifacts map[string]rxBot.ArtifactRefV1
}

type conversationLedgerRow struct {
	ID      int64
	Status  string
	Query   string
	Context *persistedConversationContext

	fingerprint ledgerFingerprintRow
}

type ledgerFingerprintRow struct {
	ID             int64  `json:"id"`
	ParentID       int64  `json:"parent_id"`
	Status         string `json:"status"`
	ToolName       string `json:"tool_name"`
	Mode           string `json:"mode"`
	ReportRevision int64  `json:"report_revision"`
	UpdatedAtUTC   string `json:"updated_at_utc"`
	QuerySHA256    string `json:"query_sha256"`
	AnswerSHA256   string `json:"answer_sha256"`
}

// BuildConversationLedger authenticates the dialogue through its undeleted
// owner-scoped root, then snapshots that root and its live children by durable
// row ID.
func BuildConversationLedger(
	ctx context.Context,
	username string,
	dialogueID string,
) (ConversationLedger, error) {
	return buildConversationLedgerWithDB(ctx, model.DB(ctx), username, dialogueID)
}

func buildConversationLedgerWithDB(
	ctx context.Context,
	gdb *gorm.DB,
	username string,
	dialogueID string,
) (ConversationLedger, error) {
	var root model.QuestionAgentLog
	err := gdb.WithContext(ctx).
		Where(
			"dialogue_id = ? AND f_id = 0 AND user_name = ? AND delete_at IS NULL",
			dialogueID,
			username,
		).
		Order("id ASC").
		First(&root).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ConversationLedger{}, ErrConversationLedgerNotFound
	}
	if err != nil {
		return ConversationLedger{}, err
	}

	var storedRows []model.QuestionAgentLog
	err = gdb.WithContext(ctx).
		Where(
			"dialogue_id = ? AND user_name = ? AND delete_at IS NULL AND (id = ? OR f_id = ?)",
			dialogueID,
			username,
			root.Id,
			root.Id,
		).
		Order("id ASC").
		Find(&storedRows).Error
	if err != nil {
		return ConversationLedger{}, err
	}
	if len(storedRows) == 0 || storedRows[0].Id != root.Id {
		return ConversationLedger{}, ErrConversationLedgerNotFound
	}

	ledger := ConversationLedger{
		ConversationKey: dialogueID,
		DialogueID:      dialogueID,
		RootID:          root.Id,
		Mode:            normalizedConversationLedgerMode(root.Mode),
		rows:            make([]conversationLedgerRow, 0, len(storedRows)),
		artifacts:       make(map[string]rxBot.ArtifactRefV1),
	}
	for _, stored := range storedRows {
		_, privateContext, err := unmarshalPersistedProjectionWithContext(
			stored.BotProjectionJSON,
		)
		if err != nil {
			return ConversationLedger{}, err
		}
		if privateContext != nil {
			cloned := privateContext.clone()
			privateContext = &cloned
		}
		row := conversationLedgerRow{
			ID:      stored.Id,
			Status:  stored.Status,
			Query:   stored.Query,
			Context: privateContext,
			fingerprint: ledgerFingerprintRow{
				ID:             stored.Id,
				ParentID:       stored.FId,
				Status:         stored.Status,
				ToolName:       stored.ToolName,
				Mode:           stored.Mode,
				ReportRevision: stored.BotReportRevision,
				UpdatedAtUTC:   stored.UpdatedAt.UTC().Format(time.RFC3339Nano),
				QuerySHA256:    sha256Hex([]byte(stored.Query)),
				AnswerSHA256:   sha256Hex([]byte(stored.Answer)),
			},
		}
		ledger.rows = append(ledger.rows, row)
		if row.ID > ledger.Cursor {
			ledger.Cursor = row.ID
		}
		if row.Status == statusSucceeded && row.Context != nil {
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

// HistoryBefore returns bounded accepted history preceding currentRowID.
// Assistant entries are emitted only when Bot previously persisted a summary.
func (ledger ConversationLedger) HistoryBefore(currentRowID int64) []rxBot.LedgerEntryV1 {
	history := make([]rxBot.LedgerEntryV1, 0)
	for _, row := range ledger.rows {
		if row.ID >= currentRowID || row.Status != statusSucceeded {
			continue
		}
		if content := boundConversationLedgerText(row.Query); content != "" {
			history = append(history, rxBot.LedgerEntryV1{
				TurnID:  strconv.FormatInt(row.ID, 10),
				Role:    "user",
				Content: content,
			})
		}
		if row.Context != nil && row.Context.AssistantSummary != "" {
			history = append(history, rxBot.LedgerEntryV1{
				TurnID:  strconv.FormatInt(row.ID, 10),
				Role:    "assistant",
				Summary: row.Context.AssistantSummary,
			})
		}
	}
	if len(history) > maxConversationLedgerHistoryEntries {
		history = history[len(history)-maxConversationLedgerHistoryEntries:]
	}
	return history
}

// AuthorizeArtifactIDs resolves requested opaque IDs only from accepted rows
// in this already owner-scoped ledger. It fails closed without partial output.
func (ledger ConversationLedger) AuthorizeArtifactIDs(
	artifactIDs []string,
) ([]rxBot.ArtifactRefV1, error) {
	if len(artifactIDs) > maxPersistedArtifactRefs {
		return nil, ErrConversationArtifactOwnership
	}
	refs := make([]rxBot.ArtifactRefV1, 0, len(artifactIDs))
	seen := make(map[string]struct{}, len(artifactIDs))
	for _, artifactID := range artifactIDs {
		if _, duplicate := seen[artifactID]; duplicate {
			continue
		}
		ref, allowed := ledger.artifacts[artifactID]
		if !allowed {
			return nil, ErrConversationArtifactOwnership
		}
		seen[artifactID] = struct{}{}
		refs = append(refs, ref)
	}
	return refs, nil
}

func (ledger *ConversationLedger) addAuthorizedArtifacts(
	refs []rxBot.ArtifactRefV1,
) error {
	for _, ref := range refs {
		existing, exists := ledger.artifacts[ref.ArtifactID]
		if exists && existing.DisplayName != ref.DisplayName {
			return fmt.Errorf(
				"%w: conflicting artifact display metadata",
				ErrInvalidBotConversationContext,
			)
		}
		ledger.artifacts[ref.ArtifactID] = ref
	}
	return nil
}

func (ledger ConversationLedger) fingerprintRows() []ledgerFingerprintRow {
	rows := make([]ledgerFingerprintRow, len(ledger.rows))
	for index, row := range ledger.rows {
		rows[index] = row.fingerprint
	}
	return rows
}

func fingerprintConversationLedger(rows []ledgerFingerprintRow) (string, error) {
	canonical, err := json.Marshal(rows)
	if err != nil {
		return "", err
	}
	return sha256Hex(canonical), nil
}

func sha256Hex(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}

func normalizedConversationLedgerMode(mode string) string {
	if strings.TrimSpace(mode) == "" {
		return "instant"
	}
	return mode
}

func boundConversationLedgerText(value string) string {
	if utf8.RuneCountInString(value) <= maxConversationLedgerMessageRunes {
		return value
	}
	runes := []rune(value)
	return string(runes[:maxConversationLedgerMessageRunes])
}
