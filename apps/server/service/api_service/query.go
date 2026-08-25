package api_service

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
	"phytomni-server/utils"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ErrGatewayDisabled is returned when the Bot proxy is turned off in config.
// The handler maps it to 503 (service unavailable) rather than a generic 500,
// so ops can tell a deliberate-off gateway from a real server failure.
var ErrGatewayDisabled = errors.New("bot gateway is disabled")

// ErrUnknownTool is returned when the requested tool resolves to no Bot slug.
// The handler maps it to 400 (client error) rather than a generic 500, since a
// bad tool name is a caller mistake, not a server fault.
var ErrUnknownTool = errors.New("unknown tool")

// ErrExpertDisabled is retained for historical handler mapping. Expert routing
// is locally always enabled; permission and Bot-route checks still apply.
var ErrExpertDisabled = errors.New("expert mode not available")

// ErrMissingBotRunID is returned when a Web row exists but cannot be synced
// through Bot run state because it has no bot_run_id.
var ErrMissingBotRunID = errors.New("row has no bot_run_id to sync")

// ErrInvalidA2uiSurface marks a malformed native input-required pause. The
// blocking path returns it before persistence so no row can be stranded with
// a run that the browser cannot safely resume.
var ErrInvalidA2uiSurface = errors.New("invalid a2ui input-required surface")

// ErrStreamUnsupported marks a /query streaming request the SSE branch cannot
// serve, including autonomous Expert routing and tools without an approved
// chat-completions stream model. The handler maps pre-frame failures to 400.
var ErrStreamUnsupported = errors.New("streaming not supported for this request")

var (
	ErrInvalidClientTurnID         = errors.New("invalid client turn id")
	ErrConversationModeConflict    = errors.New("conversation mode conflict")
	ErrDuplicateClientTurn         = errors.New("duplicate client turn conflict")
	ErrClientTurnSubmissionPending = errors.New("client turn submission is pending")
	ErrInvalidQueryAttachments     = errors.New("invalid query attachments")
	ErrInvalidAgentResolver        = errors.New("invalid agent resolver")
	ErrQueryAuthentication         = errors.New("query authentication required")
	ErrInvalidConversationStage    = errors.New("invalid conversation context stage")
)

var serviceClientTurnIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)

const (
	recentClientTurnLookupLimit = 200
	turnAllocationTimeout       = time.Second
	turnSubmissionLease         = 5 * time.Second
	maxMySQLTurnWaitSeconds     = 30
)

var sqliteTurnAllocationLocks sync.Map

// ErrInteropRequired means an explicit required delegation could not be
// proven from the authenticated, sanitized discovery snapshot. It is returned
// before any local or Bot agent submission so missing external evidence cannot
// look like a successful local run.
var ErrInteropRequired = errors.New("required interop evidence unavailable")

// ErrInteropTargetForbidden means the requested target id was not present as an
// available, allowlisted target in the Web-owned discovery snapshot.
var ErrInteropTargetForbidden = errors.New("interop target is not allowlisted")

// QuerySurface identifies the authenticated HTTP surface that supplied a query.
// Its zero value is Chat so existing callers retain their established behavior.
type QuerySurface uint8

const (
	QuerySurfaceChat QuerySurface = iota
	QuerySurfaceAgentProduct
)

// QueryInput is the parsed /query multipart form.
type QueryInput struct {
	Query          string
	Id             int64 // the Web app's threading id: 0 = new conversation, else parent row id
	Tool           string
	RefreshId      int64 // !=0 = re-answer an existing turn (UPDATE that row)
	History        string
	Mode           string // "instant" (default) | "expert"
	Attachments    []rxBot.AssetAttachmentRef
	InteropMode    string
	InteropTargets []string
	ClientTurnID   string
	ArtifactIDs    []string
	GeneID         string
	ToID           string
	SpeciesCode    string
	Locale         string
	Surface        QuerySurface
}

type v1SubmissionTarget struct {
	dialogueID string
	parentID   int64
	mode       string
	operation  string
	artifacts  []rxBot.ArtifactRefV1
}

type v1Submission struct {
	row                model.QuestionAgentLog
	turn               *model.ConversationTurnV2
	envelope           *rxBot.ConversationEnvelopeV1
	duplicate          *QueryData
	pending            bool
	requestFingerprint string
	replacement        bool
	userMessageID      string
	assistantMessageID string
}

func conversationV1Enabled(in QueryInput) bool {
	if !rxBot.ConversationContextV1Advertised() {
		return false
	}
	if !serviceClientTurnIDPattern.MatchString(strings.TrimSpace(in.ClientTurnID)) {
		return false
	}
	return in.Surface == QuerySurfaceChat ||
		dedicatedResearchProductSubmission(in)
}

func dedicatedResearchProductSubmission(in QueryInput) bool {
	return in.Surface == QuerySurfaceAgentProduct &&
		IsDedicatedAgentProductTool(in.Tool) &&
		isResearchProductTool(in.Tool)
}

func normalizeV1ChatRouting(in *QueryInput) error {
	in.Mode = strings.ToLower(strings.TrimSpace(in.Mode))
	if in.Mode == "" {
		in.Mode = "instant"
	}
	switch in.Mode {
	case "instant":
		in.Tool = "ChatAgent"
		return nil
	case "expert":
		in.Tool = strings.TrimSpace(in.Tool)
		if in.Tool == "" {
			return nil
		}
		if _, ok := rxBot.SlugFor(in.Tool); !ok {
			return ErrInvalidChatRouting
		}
		return nil
	default:
		return ErrInvalidChatRouting
	}
}

func validateV1ClientTurnID(value string) error {
	return ValidateClientTurnID(strings.TrimSpace(value))
}

// ValidateClientTurnID applies the bounded ASCII identity grammar shared by
// the multipart field and its pre-body transport header.
func ValidateClientTurnID(value string) error {
	if !serviceClientTurnIDPattern.MatchString(value) {
		return ErrInvalidClientTurnID
	}
	return nil
}

func validateV1CurrentMessage(value string) error {
	limit := rxBot.ConfiguredMaxUserQueryChars()
	if limit == 0 {
		limit = rxBot.DefaultMaxUserQueryChars
	}
	return validateCurrentMessageWithin(value, limit)
}

func validateCurrentMessageWithin(value string, limit int) error {
	if err := ValidateCurrentQuery(value, limit); err != nil {
		if errors.Is(err, ErrQueryLimitExceeded) {
			return fmt.Errorf("%w: %w", ErrInvalidChatRouting, ErrQueryLimitExceeded)
		}
		return ErrInvalidChatRouting
	}
	return nil
}

// AllowsEmptyQueryWithAttachments permits only the two remote analysis tools
// to receive an empty query when managed assets are present. Every other
// agent keeps the non-empty query contract.
func AllowsEmptyQueryWithAttachments(in QueryInput) bool {
	if len(in.Attachments) == 0 {
		return false
	}
	if in.Surface == QuerySurfaceAgentProduct {
		switch in.Tool {
		case "AnalystAgent", "analyst", "InSilicoResearchAgent", "research":
			return true
		default:
			return false
		}
	}
	return in.Surface == QuerySurfaceChat && in.Mode == "expert" &&
		(in.Tool == "AnalystAgent" || in.Tool == "analyst" ||
			in.Tool == "InSilicoResearchAgent" || in.Tool == "research")
}

func validateResearchMessageWithin(
	value string,
	limit int,
	allowEmpty bool,
) error {
	if allowEmpty && strings.TrimSpace(value) == "" {
		return nil
	}
	return validateCurrentMessageWithin(value, limit)
}

func validateQueryAttachmentsWithin(refs []rxBot.AssetAttachmentRef, limit int) ([]rxBot.AssetAttachmentRef, error) {
	validated, err := rxBot.ValidateAssetAttachmentRefsWithin(refs, limit)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidQueryAttachments, err)
	}
	return validated, nil
}

func queryOperation(in QueryInput) string {
	if in.RefreshId != 0 {
		return "replace"
	}
	return "append"
}

func (ps *Service) resolveV1SubmissionTarget(
	ctx context.Context,
	username string,
	in QueryInput,
	enforceModeLock bool,
) (v1SubmissionTarget, error) {
	if strings.TrimSpace(username) == "" {
		return v1SubmissionTarget{}, ErrQueryAuthentication
	}
	target := v1SubmissionTarget{
		mode:      in.Mode,
		operation: queryOperation(in),
	}
	if in.Id == 0 && in.RefreshId == 0 {
		target.dialogueID = uuid.NewString()
		if len(in.ArtifactIDs) != 0 {
			return v1SubmissionTarget{}, ErrConversationArtifactOwnership
		}
		return target, nil
	}

	dialogueID, parentID, err := ps.resolveDialogue(ctx, username, in)
	if err != nil {
		return v1SubmissionTarget{}, err
	}
	ledger, err := BuildConversationLedger(ctx, username, dialogueID)
	if err != nil {
		return v1SubmissionTarget{}, err
	}
	effectiveMode := in.Mode
	if enforceModeLock {
		lockedMode := strings.ToLower(strings.TrimSpace(ledger.Mode))
		if lockedMode == "" {
			lockedMode = "instant"
		}
		modeIsProvisionalFailure := ledger.ModeLockState == "provisional" && ledger.RootStatus == "FAILED"
		if !modeIsProvisionalFailure && lockedMode != in.Mode {
			return v1SubmissionTarget{}, ErrConversationModeConflict
		}
		effectiveMode = lockedMode
		if modeIsProvisionalFailure {
			effectiveMode = in.Mode
		}
	}
	artifacts, err := ledger.AuthorizeArtifactIDs(in.ArtifactIDs)
	if err != nil {
		return v1SubmissionTarget{}, err
	}
	target.dialogueID = dialogueID
	target.parentID = parentID
	target.mode = effectiveMode
	target.artifacts = artifacts
	return target, nil
}

func turnAllocationKey(username, clientTurnID string) string {
	sum := sha256.Sum256([]byte(username + "\x00" + clientTurnID))
	return fmt.Sprintf("phyto-turn-%x", sum[:20])
}

func withProcessTurnAllocationLock(
	ctx context.Context,
	key string,
	fn func() error,
) error {
	lockValue, _ := sqliteTurnAllocationLocks.LoadOrStore(key, make(chan struct{}, 1))
	lock := lockValue.(chan struct{})
	lockCtx, cancel := context.WithTimeout(ctx, turnAllocationTimeout)
	defer cancel()
	select {
	case lock <- struct{}{}:
		defer func() { <-lock }()
		return fn()
	case <-lockCtx.Done():
		return fmt.Errorf("turn allocation lock: %w", lockCtx.Err())
	}
}

func withMySQLTurnAllocationLockDB(
	ctx context.Context,
	gdb *gorm.DB,
	key string,
	fn func() error,
) error {
	sqlDB, err := gdb.DB()
	if err != nil {
		return err
	}
	lockCtx, cancel := context.WithTimeout(ctx, turnAllocationTimeout)
	defer cancel()
	conn, err := sqlDB.Conn(lockCtx)
	if err != nil {
		return err
	}
	defer conn.Close()

	var acquired int
	if err := conn.QueryRowContext(
		lockCtx,
		"SELECT GET_LOCK(?, ?)",
		key,
		mysqlTurnWaitSeconds(turnAllocationTimeout),
	).Scan(&acquired); err != nil {
		return err
	}
	if acquired != 1 {
		return errors.New("turn allocation lock unavailable")
	}
	defer func() {
		releaseCtx, releaseCancel := context.WithTimeout(
			context.WithoutCancel(ctx),
			turnAllocationTimeout,
		)
		defer releaseCancel()
		_, _ = conn.ExecContext(releaseCtx, "SELECT RELEASE_LOCK(?)", key)
	}()
	return fn()
}

func withTurnAllocationLockDB(
	ctx context.Context,
	gdb *gorm.DB,
	username string,
	clientTurnID string,
	fn func() error,
) error {
	key := turnAllocationKey(username, clientTurnID)
	if gdb.Dialector.Name() == "mysql" {
		return withMySQLTurnAllocationLockDB(ctx, gdb, key, fn)
	}
	return withProcessTurnAllocationLock(ctx, key, fn)
}

func mysqlTurnWaitSeconds(timeout time.Duration) int {
	seconds := int(timeout / time.Second)
	if timeout%time.Second != 0 {
		seconds++
	}
	if seconds < 1 {
		return 1
	}
	if seconds > maxMySQLTurnWaitSeconds {
		return maxMySQLTurnWaitSeconds
	}
	return seconds
}

type clientTurnIdentity uint8

const (
	clientTurnIdentityNone clientTurnIdentity = iota
	clientTurnIdentityBase
	clientTurnIdentityReplacement
	clientTurnIdentityRetired
)

type clientTurnLookup struct {
	row      model.QuestionAgentLog
	private  *persistedConversationContext
	identity clientTurnIdentity
}

type submissionFingerprintArtifact struct {
	ArtifactID  string `json:"artifact_id"`
	DisplayName string `json:"display_name"`
}

type submissionFingerprintPayload struct {
	Version             int                             `json:"version"`
	Operation           string                          `json:"operation"`
	ParentID            int64                           `json:"parent_id"`
	ResolvedParentID    int64                           `json:"resolved_parent_id"`
	RefreshID           int64                           `json:"refresh_id"`
	Surface             QuerySurface                    `json:"surface"`
	Mode                string                          `json:"mode"`
	RequestedTool       string                          `json:"requested_tool"`
	Query               string                          `json:"query"`
	Attachments         []string                        `json:"attachments"`
	InteropMode         string                          `json:"interop_mode"`
	InteropTargets      []string                        `json:"interop_targets"`
	ConversationV1      bool                            `json:"conversation_v1"`
	History             []rxBot.ChatMessage             `json:"history,omitempty"`
	ArtifactIDs         []string                        `json:"artifact_ids,omitempty"`
	AuthorizedArtifacts []submissionFingerprintArtifact `json:"authorized_artifacts,omitempty"`
	GeneID              string                          `json:"gene_id,omitempty"`
	ToID                string                          `json:"to_id,omitempty"`
	SpeciesCode         string                          `json:"species_code,omitempty"`
}

func submissionRequestFingerprint(in QueryInput, target v1SubmissionTarget, conversationV1 bool) string {
	interopMode := in.InteropMode
	interopTargets := append([]string{}, in.InteropTargets...)
	if normalizedMode, normalizedTargets, err := rxBot.ValidateInteropControls(interopMode, interopTargets); err == nil {
		interopMode = normalizedMode
		interopTargets = normalizedTargets
	}
	attachments := make([]string, len(in.Attachments))
	for index := range in.Attachments {
		attachments[index] = in.Attachments[index].AssetID
	}
	requestedTool := in.Tool
	if in.Surface == QuerySurfaceChat && in.Mode == "instant" {
		requestedTool = "ChatAgent"
	}
	payload := submissionFingerprintPayload{
		Version:          1,
		Operation:        target.operation,
		ParentID:         in.Id,
		ResolvedParentID: target.parentID,
		RefreshID:        in.RefreshId,
		Surface:          in.Surface,
		Mode:             target.mode,
		RequestedTool:    requestedTool,
		Query:            in.Query,
		Attachments:      attachments,
		InteropMode:      interopMode,
		InteropTargets:   interopTargets,
		ConversationV1:   conversationV1,
		GeneID:           in.GeneID,
		ToID:             in.ToID,
		SpeciesCode:      in.SpeciesCode,
	}
	if conversationV1 {
		payload.ArtifactIDs = append([]string(nil), in.ArtifactIDs...)
		payload.AuthorizedArtifacts = make([]submissionFingerprintArtifact, len(target.artifacts))
		for index := range target.artifacts {
			payload.AuthorizedArtifacts[index] = submissionFingerprintArtifact{
				ArtifactID:  target.artifacts[index].ArtifactID,
				DisplayName: target.artifacts[index].DisplayName,
			}
		}
	} else if in.Surface == QuerySurfaceChat && fingerprintHistorySentToBot(in) {
		payload.History = parseHistory(in.History)
	}
	encoded, _ := json.Marshal(payload)
	return sha256Hex(encoded)
}

func fingerprintHistorySentToBot(in QueryInput) bool {
	if in.Mode == "instant" || in.Tool == "" {
		return true
	}
	slug, ok := rxBot.SlugFor(in.Tool)
	if !ok {
		return false
	}
	_, ok = rxBot.ChatModelFor(slug)
	return ok
}

func applyClientTurnLookup(
	gdb *gorm.DB,
	username string,
	clientTurnID string,
) *gorm.DB {
	query := gdb.Where("user_name = ? AND delete_at IS NULL", username)
	if gdb.Dialector.Name() == "mysql" {
		const projectionJSON = "CASE WHEN JSON_VALID(bot_projection_json) THEN bot_projection_json ELSE '{}' END"
		return query.Where(
			"JSON_UNQUOTE(JSON_EXTRACT("+projectionJSON+", '$.conversation_context.client_turn_id')) = ? OR "+
				"JSON_UNQUOTE(JSON_EXTRACT("+projectionJSON+", '$.conversation_context.replacement.client_turn_id')) = ? OR "+
				"JSON_CONTAINS(JSON_EXTRACT("+projectionJSON+", '$.conversation_context.retired_identities'), JSON_OBJECT('client_turn_id', ?))",
			clientTurnID,
			clientTurnID,
			clientTurnID,
		).Order("id DESC").Limit(2)
	}
	// SQLite is used only by tests and local development. Scan the complete
	// owner scope so its retired-key semantics match MySQL even after many rows;
	// production MySQL applies the parameterized JSON predicate above.
	return query.Order("id DESC")
}

func findRecentClientTurnWithDB(
	ctx context.Context,
	gdb *gorm.DB,
	username string,
	clientTurnID string,
) (*clientTurnLookup, error) {
	var rows []model.QuestionAgentLog
	if err := applyClientTurnLookup(gdb.WithContext(ctx), username, clientTurnID).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	var match *clientTurnLookup
	for index := range rows {
		_, private, err := unmarshalPersistedProjectionWithContext(rows[index].BotProjectionJSON)
		if err != nil {
			return nil, err
		}
		if private == nil {
			continue
		}
		identities := []clientTurnIdentity(nil)
		if private.ClientTurnID == clientTurnID {
			identities = append(identities, clientTurnIdentityBase)
		}
		if private.Replacement != nil && private.Replacement.ClientTurnID == clientTurnID {
			identities = append(identities, clientTurnIdentityReplacement)
		}
		for _, retired := range private.RetiredIdentities {
			if retired.ClientTurnID == clientTurnID {
				identities = append(identities, clientTurnIdentityRetired)
			}
		}
		for _, identity := range identities {
			if match != nil {
				return nil, ErrDuplicateClientTurn
			}
			match = &clientTurnLookup{row: rows[index], private: private, identity: identity}
		}
	}
	return match, nil
}

// HasExecutionAdmission reports whether the owner already committed the
// canonical V2 admission. It is intentionally Agent-neutral: handlers use it
// only to avoid repeating live capability discovery before an idempotent replay.
func (ps *Service) HasExecutionAdmission(
	ctx context.Context,
	username string,
	executionID string,
) (bool, error) {
	if username == "" || ValidateClientTurnID(executionID) != nil {
		return false, ErrInvalidClientTurnID
	}
	var count int64
	if err := model.DB(ctx).WithContext(ctx).
		Model(&model.QuestionAgentExecutionAdmission{}).
		Where("user_name = ? AND execution_id = ?", username, executionID).
		Count(&count).Error; err != nil {
		return false, err
	}
	if count == 0 {
		return false, nil
	}
	return true, nil
}

func validateDuplicateSubmission(
	row model.QuestionAgentLog,
	private *persistedConversationContext,
	identity clientTurnIdentity,
	in QueryInput,
	target v1SubmissionTarget,
	conversationV1 bool,
) error {
	if identity == clientTurnIdentityRetired {
		return ErrDuplicateClientTurn
	}
	if in.Id != 0 || in.RefreshId != 0 {
		if row.DialogueId != target.dialogueID {
			return ErrDuplicateClientTurn
		}
	}
	requestFingerprint := submissionRequestFingerprint(in, target, conversationV1)
	storedFingerprint := ""
	storedMode := normalizedConversationLedgerMode(row.Mode)
	storedQuery := row.Query
	storedTool := row.ToolName
	storedAttachments := []rxBot.AssetAttachmentRef(nil)
	storedInteropMode := ""
	storedInteropTargets := []string(nil)
	if private != nil {
		storedFingerprint = private.RequestFingerprint
		storedAttachments = private.InputAttachments
		storedInteropMode = private.InteropMode
		storedInteropTargets = private.InteropTargets
	}
	storedOperation := "append"
	if identity == clientTurnIdentityReplacement && private != nil && private.Replacement != nil {
		storedFingerprint = private.Replacement.RequestFingerprint
		storedMode = private.Replacement.Mode
		storedQuery = private.Replacement.Query
		storedTool = private.Replacement.ToolName
		storedAttachments = private.Replacement.InputAttachments
		storedInteropMode = private.Replacement.InteropMode
		storedInteropTargets = private.Replacement.InteropTargets
		storedOperation = "replace"
	}
	if storedFingerprint != "" {
		if storedFingerprint != requestFingerprint {
			return ErrDuplicateClientTurn
		}
		return nil
	}
	// A digestless row predates the complete request fingerprint. Reuse it only
	// for the one reconstructable legacy shape: a simple V0 Chat submission with
	// no history, artifact authorization, resolver arguments, or operation
	// reinterpretation. Every ambiguous dimension fails closed.
	if in.Surface != QuerySurfaceChat || conversationV1 || len(in.History) != 0 ||
		len(in.ArtifactIDs) != 0 || len(target.artifacts) != 0 ||
		in.GeneID != "" || in.ToID != "" || in.SpeciesCode != "" ||
		(identity == clientTurnIdentityBase && target.operation != "append") ||
		(identity == clientTurnIdentityReplacement && target.operation != "replace") {
		return ErrDuplicateClientTurn
	}
	if storedMode != target.mode ||
		sha256Hex([]byte(storedQuery)) != sha256Hex([]byte(in.Query)) ||
		storedOperation != target.operation ||
		!sameAssetAttachmentRefs(storedAttachments, in.Attachments) ||
		!sameInteropControls(storedInteropMode, storedInteropTargets, in.InteropMode, in.InteropTargets) {
		return ErrDuplicateClientTurn
	}
	requestedTool := in.Tool
	if in.Surface == QuerySurfaceChat && in.Mode == "instant" {
		requestedTool = "ChatAgent"
	}
	if storedTool != requestedTool {
		return ErrDuplicateClientTurn
	}
	if target.operation == "replace" && row.Id != in.RefreshId {
		return ErrDuplicateClientTurn
	}
	if target.operation == "append" && row.FId != in.Id {
		return ErrDuplicateClientTurn
	}
	return nil
}

func sameInteropControls(leftMode string, leftTargets []string, rightMode string, rightTargets []string) bool {
	leftMode, leftTargets, leftErr := rxBot.ValidateInteropControls(leftMode, leftTargets)
	rightMode, rightTargets, rightErr := rxBot.ValidateInteropControls(rightMode, rightTargets)
	if leftErr != nil || rightErr != nil || leftMode != rightMode || len(leftTargets) != len(rightTargets) {
		return false
	}
	for index := range leftTargets {
		if leftTargets[index] != rightTargets[index] {
			return false
		}
	}
	return true
}

func sameAssetAttachmentRefs(left, right []rxBot.AssetAttachmentRef) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index].AssetID != right[index].AssetID {
			return false
		}
	}
	return true
}

func (ps *Service) queryDataFromStoredRowWithDB(
	ctx context.Context,
	gdb *gorm.DB,
	username string,
	row model.QuestionAgentLog,
) (*QueryData, error) {
	out := &QueryData{
		Id:                row.Id,
		ToolName:          row.ToolName,
		Answer:            row.Answer,
		FollowUpQuestions: row.FollowUpQuestions,
		Status:            row.Status,
		UploadPath:        row.UploadPath,
		DownloadPath:      row.DownloadPath,
		ServerFilePath:    row.ServerFilePath,
		ComputeResource:   row.ComputeResource,
		ReactionType:      row.ReactionType,
		DialogueId:        row.DialogueId,
		BotRunID:          row.BotRunId,
		TaskId:            row.TaskId,
		ReportRevision:    row.BotReportRevision,
	}
	private, err := loadBotConversationContextWithDB(ctx, gdb, username, row.Id)
	if err != nil {
		return nil, err
	}
	out.Attachments = append([]rxBot.AssetAttachmentRef(nil), private.InputAttachments...)
	if err := ps.decorateConversationQueryData(ctx, username, out); err != nil {
		return nil, err
	}
	return out, nil
}

func queryDataFromReplacementTerminal(
	row model.QuestionAgentLog,
	replacement *persistedConversationReplacement,
) *QueryData {
	if replacement == nil || replacement.TerminalResult == nil {
		return nil
	}
	terminal := replacement.TerminalResult
	out := &QueryData{
		Id:                row.Id,
		ToolName:          terminal.ToolName,
		Answer:            terminal.Answer,
		FollowUpQuestions: terminal.FollowUpQuestions,
		Status:            terminal.Status,
		ReactionType:      "0",
		DialogueId:        row.DialogueId,
		BotRunID:          terminal.BotRunID,
		TaskId:            terminal.TaskID,
		TrackingDegraded:  terminal.TrackingDegraded,
		ReportRevision:    terminal.ReportRevision,
		DegradedInterop:   terminal.DegradedInterop,
		Attachments:       append([]rxBot.AssetAttachmentRef(nil), replacement.InputAttachments...),
	}
	if terminal.Interop != nil {
		interop := *terminal.Interop
		out.InterOp = &interop
	}
	return out
}

func queryDataFromReplacementCandidate(
	row model.QuestionAgentLog,
	replacement *persistedConversationReplacement,
) *QueryData {
	if replacement == nil {
		return nil
	}
	status := replacement.ActiveStatus
	if status == "" {
		status = "SUBMITTING"
	}
	out := &QueryData{
		Id:               row.Id,
		ToolName:         replacement.ToolName,
		Status:           status,
		ReactionType:     "0",
		DialogueId:       row.DialogueId,
		BotRunID:         replacement.ActiveBotRunID,
		TaskId:           replacement.ActiveTaskID,
		TrackingDegraded: replacement.ActiveTrackingDegraded,
		ReportRevision:   replacement.ActiveReportRevision,
		DegradedInterop:  replacement.ActiveDegradedInterop,
		Attachments:      append([]rxBot.AssetAttachmentRef(nil), replacement.InputAttachments...),
	}
	if replacement.ActiveInterop != nil {
		interop := *replacement.ActiveInterop
		out.InterOp = &interop
	}
	if len(replacement.ActiveA2UI) > 0 {
		out.A2UI, _ = DecodeA2uiSurface(replacement.ActiveA2UI)
	}
	return out
}

func boundedReplacementFollowUp(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > maxPersistedReplacementFollowUpBytes {
		return ""
	}
	var questions []string
	if json.Unmarshal([]byte(value), &questions) != nil || questions == nil {
		return ""
	}
	encoded, err := json.Marshal(questions)
	if err != nil || len(encoded) > maxPersistedReplacementFollowUpBytes {
		return ""
	}
	return string(encoded)
}

func requestedAgentForV1(in QueryInput) *string {
	if in.Surface == QuerySurfaceChat && in.Mode == "instant" {
		tool := "ChatAgent"
		return &tool
	}
	if in.Tool == "" {
		return nil
	}
	tool := in.Tool
	return &tool
}

func baseBusinessContextVersion(ledger ConversationLedger, currentRowID int64) int64 {
	var version int64
	for _, row := range ledger.rows {
		if row.ID < currentRowID && row.BusinessContextVersion > version {
			version = row.BusinessContextVersion
		}
		currentReplacement := row.ID == currentRowID &&
			row.Context != nil && row.Context.Replacement != nil
		if row.ID > currentRowID ||
			(row.ID == currentRowID && !currentReplacement) ||
			row.Context == nil || row.Context.Stage == nil ||
			row.Context.SettlementState != conversationSettlementAcked {
			continue
		}
		if row.Context.Stage.ProposedBusinessContextVersion > version {
			version = row.Context.Stage.ProposedBusinessContextVersion
		}
	}
	return version
}

func acknowledgeConversationContext(
	ctx context.Context,
	client *rxBot.Client,
	username string,
	dialogueID string,
	rowID int64,
	ledgerVersion string,
	stage *rxBot.ContextStageMetadata,
) error {
	if stage == nil {
		return ErrInvalidConversationStage
	}
	ackCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
	defer cancel()
	response, err := client.SettleConversationContext(ackCtx, rxBot.ContextSettlementRequest{
		SchemaVersion:   1,
		ConversationKey: dialogueID,
		TurnID:          strconv.FormatInt(rowID, 10),
		LedgerVersion:   ledgerVersion,
	})
	if err != nil {
		return err
	}
	if response.ContextVersion != stage.ProposedBusinessContextVersion {
		return ErrInvalidConversationStage
	}
	return updateConversationSettlementState(
		ackCtx,
		username,
		rowID,
		ledgerVersion,
		conversationSettlementAckPending,
		conversationSettlementAcked,
	)
}

func finalizePendingConversationAcknowledgments(
	ctx context.Context,
	client *rxBot.Client,
	username string,
	ledger ConversationLedger,
	currentRowID int64,
) (bool, error) {
	rebuildRequired := false
	for _, row := range ledger.rows {
		currentReplacement := row.ID == currentRowID &&
			row.Context != nil && row.Context.Replacement != nil
		if row.ID > currentRowID ||
			(row.ID == currentRowID && !currentReplacement) ||
			row.Status != statusSucceeded || row.Context == nil {
			continue
		}
		if row.Context.SettlementState == conversationSettlementRebuildRequired {
			rebuildRequired = true
			continue
		}
		if row.Context.SettlementState != conversationSettlementAckPending {
			continue
		}
		if row.Context.Stage == nil || row.Context.SettlementLedgerHash == "" {
			return false, ErrInvalidBotConversationContext
		}
		if err := acknowledgeConversationContext(
			ctx,
			client,
			username,
			ledger.DialogueID,
			row.ID,
			row.Context.SettlementLedgerHash,
			row.Context.Stage,
		); err != nil {
			if rxBot.IsConversationContextRebuildRequired(err) ||
				errors.Is(err, ErrInvalidConversationStage) {
				if updateErr := updateConversationSettlementState(
					context.WithoutCancel(ctx),
					username,
					row.ID,
					row.Context.SettlementLedgerHash,
					conversationSettlementAckPending,
					conversationSettlementRebuildRequired,
				); updateErr != nil {
					return false, updateErr
				}
				rebuildRequired = true
				continue
			}
			return false, err
		}
	}
	return rebuildRequired, nil
}

func mergeConversationArtifactRefs(
	first []rxBot.ArtifactRefV1,
	second []rxBot.ArtifactRefV1,
) ([]rxBot.ArtifactRefV1, error) {
	merged := make([]rxBot.ArtifactRefV1, 0, len(first)+len(second))
	seen := make(map[string]rxBot.ArtifactRefV1, len(first)+len(second))
	for _, refs := range [][]rxBot.ArtifactRefV1{first, second} {
		for _, ref := range refs {
			if existing, ok := seen[ref.ArtifactID]; ok {
				if existing.DisplayName != ref.DisplayName {
					return nil, ErrConversationArtifactOwnership
				}
				continue
			}
			if len(merged) >= maxPersistedArtifactRefs {
				return nil, ErrConversationArtifactOwnership
			}
			seen[ref.ArtifactID] = ref
			merged = append(merged, ref)
		}
	}
	return merged, nil
}

func applyConversationRebuildEnvelope(
	ctx context.Context,
	username string,
	submission *v1Submission,
	target v1SubmissionTarget,
) error {
	if submission == nil || submission.envelope == nil {
		return ErrInvalidBotConversationContext
	}
	ledger, err := BuildConversationLedger(
		ctx,
		username,
		submission.row.DialogueId,
	)
	if err != nil {
		return err
	}
	rebuild, err := ledger.RebuildBefore(submission.row.Id)
	if err != nil {
		return err
	}
	artifacts, err := mergeConversationArtifactRefs(
		rebuild.ArtifactRefs,
		target.artifacts,
	)
	if err != nil {
		return err
	}
	envelope := *submission.envelope
	envelope.Operation = "rebuild"
	// The rebuild snapshot describes the accepted rows used to reconstruct
	// context, but the current row is incorporated by this turn. Bot therefore
	// stages the current durable row ID as the applied cursor.
	envelope.LedgerCursor = submission.row.Id
	envelope.LedgerVersion = rebuild.Version
	history := append([]rxBot.LedgerEntryV1(nil), rebuild.History...)
	// Bot's rebuild projection removes the trailing current-user slot before
	// dispatch. Include its bounded form so a hard-limit current message cannot
	// exceed Bot's smaller history-entry limit during rebuild.
	history = append(history, rxBot.LedgerEntryV1{
		TurnID:  envelope.TurnID,
		Role:    "user",
		Content: boundConversationLedgerText(envelope.CurrentMessage.Content),
	})
	if len(history) > maxConversationLedgerHistoryEntries {
		history = history[len(history)-maxConversationLedgerHistoryEntries:]
	}
	envelope.HistoryDelta = history
	envelope.ArtifactRefs = artifacts
	if err := envelope.Validate(); err != nil {
		return err
	}
	submission.envelope = &envelope
	return nil
}

func (ps *Service) resolveExistingV1SubmissionWithDB(
	ctx context.Context,
	gdb *gorm.DB,
	username string,
	in QueryInput,
	target v1SubmissionTarget,
	conversationV1 bool,
) (*v1Submission, error) {
	match, err := findRecentClientTurnWithDB(ctx, gdb, username, in.ClientTurnID)
	if err != nil {
		return nil, err
	}
	if match == nil {
		return nil, nil
	}
	if err := validateDuplicateSubmission(
		match.row,
		match.private,
		match.identity,
		in,
		target,
		conversationV1,
	); err != nil {
		return nil, err
	}

	submission := &v1Submission{
		row:                match.row,
		requestFingerprint: submissionRequestFingerprint(in, target, conversationV1),
		replacement:        match.identity == clientTurnIdentityReplacement,
	}
	if match.identity == clientTurnIdentityReplacement {
		if match.private == nil || match.private.Replacement == nil {
			return nil, ErrDuplicateClientTurn
		}
		if match.private.Replacement.TerminalResult != nil {
			submission.duplicate = queryDataFromReplacementTerminal(
				match.row,
				match.private.Replacement,
			)
			return submission, nil
		}
		submission.duplicate = queryDataFromReplacementCandidate(
			match.row,
			match.private.Replacement,
		)
		if match.private.Replacement.ActiveStatus == "" {
			submission.pending = true
		}
		return submission, nil
	}
	if match.row.Status == "SUBMITTING" {
		submission.duplicate, err = ps.queryDataFromStoredRowWithDB(ctx, gdb, username, match.row)
		submission.pending = true
		return submission, err
	}
	submission.duplicate, err = ps.queryDataFromStoredRowWithDB(ctx, gdb, username, match.row)
	return submission, err
}

func (ps *Service) allocateV1SubmissionWithDB(
	ctx context.Context,
	gdb *gorm.DB,
	username string,
	in QueryInput,
	target v1SubmissionTarget,
	permissions AgentPermissionResolution,
	finalizePending bool,
) (*v1Submission, error) {
	return ps.allocateOwnerSubmissionWithDB(
		ctx,
		gdb,
		username,
		in,
		target,
		permissions,
		true,
		finalizePending,
	)
}

func (ps *Service) allocateOwnerSubmissionWithDB(
	ctx context.Context,
	gdb *gorm.DB,
	username string,
	in QueryInput,
	target v1SubmissionTarget,
	permissions AgentPermissionResolution,
	buildEnvelope bool,
	finalizePending bool,
) (*v1Submission, error) {
	var allocated model.QuestionAgentLog
	var duplicate *QueryData
	var pending bool
	var allocatedReplacement bool
	err := withTurnAllocationLockDB(ctx, gdb, username, in.ClientTurnID, func() error {
		existing, err := ps.resolveExistingV1SubmissionWithDB(
			ctx,
			gdb,
			username,
			in,
			target,
			buildEnvelope,
		)
		if err != nil {
			return err
		}
		if existing != nil {
			allocated = existing.row
			duplicate = existing.duplicate
			pending = existing.pending
			allocatedReplacement = existing.replacement
			return nil
		}

		requestFingerprint := submissionRequestFingerprint(in, target, buildEnvelope)
		privateContext := &persistedConversationContext{
			ClientTurnID:       in.ClientTurnID,
			RequestFingerprint: requestFingerprint,
			InputAttachments:   append([]rxBot.AssetAttachmentRef(nil), in.Attachments...),
			InteropMode:        in.InteropMode,
			InteropTargets:     append([]string(nil), in.InteropTargets...),
		}
		if buildEnvelope {
			privateContext.ModeLockState = "provisional"
			privateContext.SettlementState = "submission_append"
		}

		toolName := in.Tool
		if in.Surface == QuerySurfaceChat && in.Mode == "instant" {
			toolName = "ChatAgent"
		}
		titleQuery := ""
		if target.parentID == 0 && in.RefreshId == 0 {
			titleQuery = conversationTitle(in.Query)
		}
		if target.operation == "replace" {
			var current model.QuestionAgentLog
			if err := gdb.WithContext(ctx).
				Where("id = ? AND user_name = ? AND dialogue_id = ? AND delete_at IS NULL AND status = ?",
					in.RefreshId,
					username,
					target.dialogueID,
					statusSucceeded,
				).
				First(&current).Error; err != nil {
				return err
			}
			projection, currentPrivate, err := unmarshalPersistedProjectionWithContext(
				current.BotProjectionJSON,
			)
			if err != nil {
				return err
			}
			if currentPrivate == nil {
				currentPrivate = &persistedConversationContext{}
			}
			if currentPrivate.ClientTurnID != "" && currentPrivate.RequestFingerprint == "" {
				// A legacy base key without a complete digest cannot be retired
				// safely after promotion, so replacement fails closed.
				return ErrDuplicateClientTurn
			}
			nextPrivate := currentPrivate.clone()
			if prior := nextPrivate.Replacement; prior != nil {
				if prior.TerminalResult == nil || prior.RequestFingerprint == "" ||
					len(nextPrivate.RetiredIdentities) >= maxPersistedRetiredClientTurns {
					return ErrDuplicateClientTurn
				}
				nextPrivate.RetiredIdentities = append(
					nextPrivate.RetiredIdentities,
					persistedClientTurnIdentity{
						ClientTurnID:       prior.ClientTurnID,
						RequestFingerprint: prior.RequestFingerprint,
					},
				)
				nextPrivate.Replacement = nil
			}
			// Reserve one remaining slot for the accepted public base identity,
			// which must become retired if this new candidate later succeeds.
			if len(nextPrivate.RetiredIdentities) >= maxPersistedRetiredClientTurns {
				return ErrDuplicateClientTurn
			}
			nextPrivate.Replacement = &persistedConversationReplacement{
				ClientTurnID:       in.ClientTurnID,
				RequestFingerprint: requestFingerprint,
				Query:              in.Query,
				ToolName:           toolName,
				Mode:               target.mode,
				InputAttachments:   append([]rxBot.AssetAttachmentRef(nil), in.Attachments...),
				ArtifactRefs:       append([]rxBot.ArtifactRefV1(nil), target.artifacts...),
				InteropMode:        in.InteropMode,
				InteropTargets:     append([]string(nil), in.InteropTargets...),
				ConversationV1:     buildEnvelope,
			}
			raw, err := marshalPersistedProjectionWithContext(projection, &nextPrivate)
			if err != nil {
				return err
			}
			result := gdb.WithContext(ctx).Model(&model.QuestionAgentLog{}).
				Where(
					"id = ? AND user_name = ? AND dialogue_id = ? AND delete_at IS NULL AND bot_projection_json = ?",
					in.RefreshId,
					username,
					target.dialogueID,
					current.BotProjectionJSON,
				).
				UpdateColumn("bot_projection_json", raw)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrDuplicateClientTurn
			}
			allocated = current
			allocated.BotProjectionJSON = raw
			allocatedReplacement = true
			return nil
		}

		raw, err := marshalPersistedProjectionWithContext(
			BotRunProjection{ReportRevision: -1},
			privateContext,
		)
		if err != nil {
			return err
		}
		allocated = model.QuestionAgentLog{
			DialogueId:        target.dialogueID,
			FId:               target.parentID,
			BotProjectionJSON: raw,
			BotReportRevision: -1,
			UserName:          username,
			Query:             in.Query,
			TitleQuery:        titleQuery,
			ToolName:          toolName,
			Status:            "SUBMITTING",
			Mode:              target.mode,
			ReactionType:      "0",
			CollectType:       "0",
		}
		return gdb.WithContext(ctx).Create(&allocated).Error
	})
	if err != nil {
		return nil, err
	}
	submission := &v1Submission{
		row:                allocated,
		duplicate:          duplicate,
		pending:            pending,
		requestFingerprint: submissionRequestFingerprint(in, target, buildEnvelope),
		replacement:        allocatedReplacement,
	}
	if duplicate != nil || pending || !buildEnvelope {
		return submission, nil
	}

	ledger, err := buildConversationLedgerWithDB(ctx, gdb, username, allocated.DialogueId)
	if err != nil {
		return nil, err
	}
	rebuildRequired := false
	if finalizePending {
		rebuildRequired, err = finalizePendingConversationAcknowledgments(
			ctx,
			rxBot.NewClient(),
			username,
			ledger,
			allocated.Id,
		)
		if err != nil {
			return nil, err
		}
		ledger, err = buildConversationLedgerWithDB(ctx, gdb, username, allocated.DialogueId)
		if err != nil {
			return nil, err
		}
	}
	if !rebuildRequired && target.operation == "append" && target.parentID != 0 {
		// QuestionAgentLog IDs are global to the database, while Bot's append
		// contract requires the next ledger cursor to be the latest accepted
		// row ID plus one. A different dialogue can consume IDs between two
		// turns here, so enter the typed rebuild path before Bot records an
		// append turn that it cannot accept. A zero parent is the first turn of
		// a new dialogue, so there is no prior ledger cursor to bridge even when
		// unrelated dialogues have already advanced the global row id.
		rebuild, rebuildErr := ledger.RebuildBefore(allocated.Id)
		if rebuildErr != nil {
			return nil, rebuildErr
		}
		rebuildRequired = allocated.Id != rebuild.Cursor+1
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
	envelopeMode := target.mode
	if in.Surface == QuerySurfaceAgentProduct {
		envelopeMode = "expert"
	}
	envelope := &rxBot.ConversationEnvelopeV1{
		SchemaVersion:              1,
		ConversationKey:            ledger.ConversationKey,
		DialogueID:                 allocated.DialogueId,
		TurnID:                     strconv.FormatInt(allocated.Id, 10),
		RequestID:                  requestID,
		Operation:                  target.operation,
		Mode:                       envelopeMode,
		CurrentMessage:             rxBot.CurrentMessageV1{Content: in.Query, Locale: "en-US"},
		RequestedAgentID:           requestedAgentForV1(in),
		AllowedAgentIDs:            allowedAgents,
		LedgerCursor:               allocated.Id,
		LedgerVersion:              ledger.Version,
		BaseBusinessContextVersion: baseBusinessContextVersion(ledger, allocated.Id),
		HistoryDelta:               ledger.HistoryBefore(allocated.Id),
		ArtifactRefs:               append([]rxBot.ArtifactRefV1(nil), target.artifacts...),
	}
	if err := envelope.Validate(); err != nil {
		if settleErr := failV1Submission(context.WithoutCancel(ctx), username, allocated.Id); settleErr != nil {
			return nil, fmt.Errorf("validate conversation envelope: %v; settle submission: %w", err, settleErr)
		}
		return nil, err
	}
	submission.envelope = envelope
	if rebuildRequired {
		if err := applyConversationRebuildEnvelope(
			ctx,
			username,
			submission,
			target,
		); err != nil {
			if settleErr := failV1Submission(
				context.WithoutCancel(ctx),
				username,
				allocated.Id,
			); settleErr != nil {
				return nil, fmt.Errorf(
					"build conversation rebuild envelope: %v; settle submission: %w",
					err,
					settleErr,
				)
			}
			return nil, err
		}
	}
	return submission, nil
}

func failV1Submission(
	ctx context.Context,
	username string,
	rowID int64,
) error {
	replacementConflict := false
	for attempt := 0; attempt < botProjectionCASAttempts; attempt++ {
		projection, private, currentRaw, revision, err := loadPersistedBotProjectionRow(
			ctx,
			username,
			rowID,
		)
		if err != nil {
			return err
		}
		if private != nil && private.Replacement != nil {
			replacementConflict = true
			next := private.clone()
			next.Replacement = nil
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
			continue
		}
		replacementConflict = false
		break
	}
	if replacementConflict {
		return ErrBotProjectionConflict
	}
	result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where("id = ? AND user_name = ? AND status = ?", rowID, username, "SUBMITTING").
		Update("status", "FAILED")
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("submitting row %d not found", rowID)
	}
	return nil
}

// isV1DefiniteFailure distinguishes a completed Bot rejection or malformed
// response from a transport outcome whose request may already have reached
// Bot. Only the former is safe to terminally settle before a retry.
func isV1DefiniteFailure(err error) bool {
	if err == nil || errors.Is(err, rxBot.ErrBotTimeout) ||
		errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) ||
		errors.Is(err, io.ErrUnexpectedEOF) {
		return false
	}
	var apiErr *rxBot.APIError
	if errors.As(err, &apiErr) {
		if apiErr.Retryable || apiErr.Status == 408 || apiErr.Status == 425 || apiErr.Status == 429 {
			return false
		}
		return apiErr.Status >= 400 && apiErr.Status < 500
	}
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		return false
	}
	var netErr net.Error
	return !errors.As(err, &netErr)
}

// IsDedicatedAgentProductTool reports whether tool has its own route-owned
// product-run surface.
func IsDedicatedAgentProductTool(tool string) bool {
	switch tool {
	case "AnalystAgent", "analyst", "InSilicoResearchAgent", "DigitalDesignAgent", "GeneNetworkAgent":
		return true
	default:
		return false
	}
}

// QueryData is the response payload the Web app reads off response.data. The
// content fields are relayed from Bot; id/reaction are Web-owned.
type QueryData struct {
	Id                 int64                      `json:"id"`
	ToolName           string                     `json:"tool_name"`
	Answer             string                     `json:"answer"`
	FollowUpQuestions  string                     `json:"follow_up_questions"`
	Status             string                     `json:"status"`
	UploadPath         string                     `json:"upload_path"`
	DownloadPath       string                     `json:"download_path"`
	ServerFilePath     string                     `json:"server_file_path"`
	ComputeResource    string                     `json:"compute_resource"`
	ReactionType       string                     `json:"reaction_type"`
	DialogueId         string                     `json:"dialogue_id"`
	BotRunID           string                     `json:"bot_run_id,omitempty"`
	TaskId             string                     `json:"task_id,omitempty"`
	TrackingDegraded   bool                       `json:"tracking_degraded,omitempty"`
	ReportRevision     int64                      `json:"report_revision,omitempty"`
	RequestID          string                     `json:"request_id,omitempty"`
	A2UI               *A2uiSurfaceDTO            `json:"a2ui,omitempty"`
	DegradedInterop    bool                       `json:"degraded_interop,omitempty"`
	InterOp            *InteropProvenance         `json:"interop,omitempty"`
	Artifacts          []ConversationArtifactLink `json:"artifacts,omitempty"`
	ResultArchiveV1    bool                       `json:"result_archive_v1,omitempty"`
	Delivery           *AgentTaskDeliveryDTO      `json:"delivery,omitempty"`
	Attachments        []rxBot.AssetAttachmentRef `json:"attachments,omitempty"`
	ContextRebuilt     bool                       `json:"context_rebuilt,omitempty"`
	ContextDegraded    bool                       `json:"context_degraded,omitempty"`
	RouteReasonCode    string                     `json:"route_reason_code,omitempty"`
	SchemaVersion      int                        `json:"schema_version,omitempty"`
	ExecutionID        string                     `json:"execution_id,omitempty"`
	UserMessageID      string                     `json:"user_message_id,omitempty"`
	AssistantMessageID string                     `json:"assistant_message_id,omitempty"`
	EventCursor        int64                      `json:"event_cursor,omitempty"`
	Accepted           bool                       `json:"-"`
}

func (ps *Service) decorateConversationQueryData(
	ctx context.Context,
	username string,
	out *QueryData,
) error {
	if out == nil || out.Id <= 0 || out.DialogueId == "" {
		return nil
	}
	links, err := ps.conversationArtifactLinks(ctx, username, out.DialogueId, out.Id)
	if err != nil {
		return err
	}
	out.Artifacts = links
	projection, projectionErr := LoadBotRunProjection(ctx, username, out.Id)
	if projectionErr == nil {
		out.ResultArchiveV1 = projection.ResultArchiveV1
		out.Delivery = agentTaskDeliveryDTO(projection)
	} else if !errors.Is(projectionErr, ErrBotProjectionNotFound) {
		return projectionErr
	}
	private, err := LoadBotConversationContext(ctx, username, out.Id)
	if err != nil {
		return err
	}
	out.Attachments = append([]rxBot.AssetAttachmentRef(nil), private.InputAttachments...)
	if private.Stage != nil {
		out.ContextRebuilt = private.Stage.ContextRebuilt
		out.ContextDegraded = private.Stage.ContextDegraded
		out.RouteReasonCode = private.Stage.RouteReasonCode
	}
	if private.SettlementState == conversationSettlementRebuildRequired {
		out.ContextDegraded = true
	}
	var admission model.QuestionAgentExecutionAdmission
	admissionErr := model.DB(ctx).Where(
		"user_name = ? AND message_id = ?", username, out.Id,
	).Take(&admission).Error
	if admissionErr == nil {
		out.SchemaVersion = executionCommandSchemaVersion
		out.ExecutionID = admission.ExecutionID
		out.EventCursor = admission.LatestCursor
	} else if !errors.Is(admissionErr, gorm.ErrRecordNotFound) {
		return admissionErr
	}
	return nil
}

// StreamIdentity is the Web-owned identity of a streamed assistant message.
// QueryStream publishes it only after the RUNNING row is durable, before any
// Bot frame can reach the browser. The handler exposes these values as response
// headers so the frontend never has to infer an A2UI route from a parent row.
type StreamIdentity struct {
	DialogueID string
	MessageID  int64
}

// slugToToolName maps a Bot slug back to the tool_name the Web app renders by.
var slugToToolName = map[string]string{
	"chat":        "ChatAgent",
	"knowledge":   "KnowledgeAgent",
	"data":        "DataAgent",
	"analyst":     "AnalystAgent",
	"review":      "ReviewAgent",
	"deep_genome": "DeepGenomeAgent",
	"brief_gene":  "BriefGeneAgent",
	"research":    "InSilicoResearchAgent",
	"design":      "DigitalDesignAgent",
	"network":     "GeneNetworkAgent",
}

// ExpertModeEnabled reports that Expert routing is locally always enabled.
// Permission and Bot-route checks still apply to the selected tool.
func (ps *Service) ExpertModeEnabled() bool {
	return true
}

func requestIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	if id, ok := utils.RequestID(ctx); ok {
		return strings.TrimSpace(id)
	}
	return ""
}

type interopDecision struct {
	Mode       string
	Targets    []string
	Provenance InteropProvenance
	Degraded   bool
}

func interopAgent(slug string) bool {
	return slug == "research" || slug == "design"
}

func interopErrorCode(err error) string {
	switch {
	case errors.Is(err, ErrInteropDisabled):
		return "disabled"
	case errors.Is(err, ErrInteropForbidden):
		return "forbidden"
	case errors.Is(err, ErrInteropUnavailable):
		return "unavailable"
	default:
		return "discovery_failed"
	}
}

func localInteropDecision(mode string) interopDecision {
	return interopDecision{
		Mode: mode,
		Provenance: InteropProvenance{
			Mode:   mode,
			Status: "local",
		},
	}
}

func degradedInteropDecision(mode, targetID, code string) interopDecision {
	return interopDecision{
		Mode:     "off",
		Degraded: true,
		Provenance: InteropProvenance{
			Mode:     mode,
			Status:   "degraded",
			TargetID: targetID,
			Code:     code,
		},
	}
}

func failedInteropDecision(mode, targetID, code string) interopDecision {
	return interopDecision{
		Mode: "off",
		Provenance: InteropProvenance{
			Mode:     mode,
			Status:   "failed",
			TargetID: targetID,
			Code:     code,
		},
	}
}

func queryInteropProvenancePtr(slug string, decision interopDecision) *InteropProvenance {
	if !interopAgent(slug) {
		return nil
	}
	return interopProvenancePtr(decision.Provenance)
}

// prepareInterop applies the Web-owned delegation policy before any upload,
// dialogue write, or Bot agent submission. Discovery is advisory evidence only;
// endpoint/credential/peer payloads never enter this decision.
func (ps *Service) prepareInterop(ctx context.Context, username, slug, mode string, targets []string) (interopDecision, error) {
	if !interopAgent(slug) {
		return localInteropDecision("off"), nil
	}
	normalizedMode, normalizedTargets, err := rxBot.ValidateInteropControls(mode, targets)
	if err != nil {
		decision := failedInteropDecision(mode, "", "invalid_request")
		return decision, fmt.Errorf("%w: invalid interop controls", ErrInteropTargetForbidden)
	}
	if normalizedMode == "off" {
		return localInteropDecision("off"), nil
	}
	if len(normalizedTargets) == 0 {
		if normalizedMode == "required" {
			return failedInteropDecision(normalizedMode, "", "no_evidence"), ErrInteropRequired
		}
		return degradedInteropDecision(normalizedMode, "", "no_evidence"), nil
	}

	caps, discoveryErr := ps.InteropCapabilities(ctx, username)
	if discoveryErr != nil {
		if normalizedMode == "required" {
			return failedInteropDecision(normalizedMode, normalizedTargets[0], interopErrorCode(discoveryErr)), ErrInteropRequired
		}
		return degradedInteropDecision(normalizedMode, normalizedTargets[0], interopErrorCode(discoveryErr)), nil
	}

	available := make(map[string]InteropTarget)
	failed := make(map[string]InteropTarget)
	for _, target := range caps.Targets {
		switch target.Status {
		case "available":
			available[target.TargetID] = target
		case "failed":
			failed[target.TargetID] = target
		}
	}
	var firstAvailable InteropTarget
	for index, targetID := range normalizedTargets {
		if target, ok := available[targetID]; ok {
			if index == 0 {
				firstAvailable = target
			}
			continue
		}
		if target, ok := failed[targetID]; ok {
			code := target.Code
			if code == "" {
				code = "target_unavailable"
			}
			if normalizedMode == "required" {
				return failedInteropDecision(normalizedMode, targetID, code), ErrInteropRequired
			}
			return degradedInteropDecision(normalizedMode, targetID, code), nil
		}
		// A syntactically valid but undiscovered id is outside the runtime
		// allowlist. Do not silently drop it or submit a local pseudo-success.
		return failedInteropDecision(normalizedMode, targetID, "target_unavailable"), ErrInteropTargetForbidden
	}
	if firstAvailable.TargetID == "" {
		return failedInteropDecision(normalizedMode, "", "no_evidence"), ErrInteropRequired
	}
	return interopDecision{
		Mode:    normalizedMode,
		Targets: append([]string(nil), normalizedTargets...),
		Provenance: InteropProvenance{
			Mode:     normalizedMode,
			Status:   "delegated",
			TargetID: firstAvailable.TargetID,
			Kind:     firstAvailable.Kind,
		},
	}, nil
}

// resolveExpertAgent validates the Bot router's selected slug against both
// Web-owned canonical maps before any tool name, answer shape, or projection
// lifecycle is derived from the response. Expert is a cross-service boundary:
// a missing/unknown/malformed slug must never fall back to ChatAgent.
func resolveExpertAgent(resp *rxBot.RouteQueryResponse) (string, string, error) {
	if resp == nil {
		return "", "", fmt.Errorf("%w: missing expert response", ErrExpertRouteContract)
	}
	rawSlug := resp.Agent
	slug := strings.TrimSpace(rawSlug)
	if slug == "" || rawSlug != slug || strings.ContainsAny(rawSlug, "\r\n\t") {
		return "", "", fmt.Errorf("%w: malformed expert agent", ErrExpertRouteContract)
	}
	canonicalTool, ok := rxBot.CanonicalAgentTool[slug]
	if !ok || slugToToolName[slug] != canonicalTool {
		return "", "", fmt.Errorf("%w: unsupported expert agent", ErrExpertRouteContract)
	}
	return slug, canonicalTool, nil
}

// validateExpertResolvedTool re-checks the Bot router's selected native slug
// against the server-owned constraints that accompanied the request. The
// returned canonical tool is the only tool identity Query may shape or store;
// no browser value or raw upstream field is trusted past this boundary.
func validateExpertResolvedTool(resolvedSlug string, allowedTools []string, forcedTool string) (string, error) {
	resolvedTool, ok := slugToToolName[resolvedSlug]
	if !ok || !containsAgentTool(allowedTools, resolvedTool) {
		return "", ErrExpertRouteContract
	}
	if forcedTool != "" && resolvedTool != forcedTool {
		return "", ErrExpertRouteContract
	}
	return resolvedTool, nil
}

func validateExpertSubmissionAgent(resolvedSlug, submissionAgent string) error {
	if resolvedSlug == "" || submissionAgent != resolvedSlug {
		return fmt.Errorf("%w: expert agent mismatch", ErrExpertRouteContract)
	}
	return nil
}

func formattedMetadata(formatted *rxBot.Formatted) json.RawMessage {
	if formatted == nil {
		return nil
	}
	return formatted.Metadata
}

// Query is the gateway orchestration: dispatch opaque asset references to the
// resolved agent, persist a Web-side row (Bot owns the content; Web keeps the
// ownership/threading record plus a transitional content fallback), and return
// exactly what the Web app consumes.
//
// Threading model (reconstructed from the surviving read paths QueryList /
// AnswerCheck, not from the deleted Python service):
//   - parent rows have f_id = 0 and carry the conversation title_query;
//   - child rows have f_id = <parent row id> and share the parent dialogue_id.
//
// So Id=0 starts a new conversation (fresh dialogue_id), Id=N appends a child
// to parent N, and RefreshId!=0 re-answers an existing row in place.
func (ps *Service) Query(ctx context.Context, username string, in QueryInput) (*QueryData, error) {
	conversationV1 := conversationV1Enabled(in)
	researchCandidate := isResearchProductTool(in.Tool) &&
		(in.Surface == QuerySurfaceAgentProduct ||
			in.Surface == QuerySurfaceChat && strings.EqualFold(strings.TrimSpace(in.Mode), "expert"))
	attachmentLimit := rxBot.DefaultMaxAssetAttachmentRefs
	if researchCandidate {
		attachmentLimit = rxBot.HardMaxAssetAttachmentRefs
	}
	attachments, err := validateQueryAttachmentsWithin(in.Attachments, attachmentLimit)
	if err != nil {
		return nil, err
	}
	in.Attachments = attachments
	// QuerySurface is exported, so no non-Chat caller may select an arbitrary
	// tool. The only non-Chat surface is the route-owned dedicated product run.
	if in.Surface == QuerySurfaceChat {
		if conversationV1 {
			if err := normalizeV1ChatRouting(&in); err != nil {
				return nil, err
			}
		} else {
			decision, err := ValidateChatRouting(in.Mode, in.Tool)
			if err != nil {
				return nil, err
			}
			in.Mode = decision.Mode
			in.Tool = decision.ForcedTool
		}
	} else if in.Surface != QuerySurfaceAgentProduct || !IsDedicatedAgentProductTool(in.Tool) {
		return nil, ErrRemoteProductForbidden
	}
	researchRequest := isResearchProductTool(in.Tool) &&
		(in.Surface == QuerySurfaceAgentProduct || in.Mode == "expert")
	// The Service boundary owns the one public execution identity rule for all
	// transports. Browser turns retain their supplied UUID; compatibility and
	// internal callers that omit it are admitted under a server-minted identity
	// instead of selecting a synchronous execution path.
	if strings.TrimSpace(in.ClientTurnID) == "" {
		in.ClientTurnID = "turn-" + uuid.NewString()
	}
	if err := validateV1ClientTurnID(in.ClientTurnID); err != nil {
		return nil, err
	}
	in.ClientTurnID = strings.TrimSpace(in.ClientTurnID)
	ownerAllocated := true
	if !researchRequest && conversationV1 {
		if err := validateV1CurrentMessage(in.Query); err != nil {
			return nil, err
		}
	}
	if researchRequest {
		if err := validateResearchMessageWithin(
			in.Query,
			rxBot.HardMaxUserQueryChars,
			AllowsEmptyQueryWithAttachments(in),
		); err != nil {
			return nil, err
		}
	}
	if rxBot.BotConfig == nil || !rxBot.BotConfig.ProxyEnabled {
		return nil, ErrGatewayDisabled
	}
	var permissions AgentPermissionResolution
	var admission remoteProductAdmission
	if in.Surface == QuerySurfaceChat {
		permissions, err = ps.ResolveAgentPermissions(ctx, username)
		if err != nil {
			return nil, fmt.Errorf("resolve agent permissions: %w", err)
		}
	}
	// Dedicated products retain their route-owned check. Chat always derives its
	// effective capability set from the resolution above, including forced Expert
	// selections, rather than treating a browser hint as a product route.
	if in.Surface == QuerySurfaceAgentProduct {
		if admission, err = ps.ensureRemoteProductAccess(ctx, username, in.Tool); err != nil {
			return nil, err
		}
	}
	if in.Surface == QuerySurfaceChat {
		if in.Mode == "instant" && !containsAgentTool(permissions.AllowedTools, "ChatAgent") {
			return nil, permissionFailure(permissions, "ChatAgent")
		}
		if in.Mode == "expert" {
			if len(permissions.AllowedTools) == 0 {
				return nil, permissionFailure(permissions, "")
			}
			if in.Tool != "" && !containsAgentTool(permissions.AllowedTools, in.Tool) {
				return nil, permissionFailure(permissions, in.Tool)
			}
			if in.Tool == "InSilicoResearchAgent" {
				if admission, err = ps.ensureRemoteProductAccess(ctx, username, in.Tool); err != nil {
					return nil, err
				}
			}
		}
	}
	requestedInteropMode := in.InteropMode
	requestedInteropTargets := append([]string(nil), in.InteropTargets...)
	requestedSubmissionInput := in
	if ownerAllocated {
		normalizedMode, normalizedTargets, normalizeErr := rxBot.ValidateInteropControls(
			requestedInteropMode,
			requestedInteropTargets,
		)
		if normalizeErr != nil {
			return nil, fmt.Errorf("%w: invalid interop controls", ErrInteropTargetForbidden)
		}
		requestedSubmissionInput.InteropMode = normalizedMode
		requestedSubmissionInput.InteropTargets = normalizedTargets
	}
	var target v1SubmissionTarget
	if ownerAllocated {
		target, err = ps.resolveExecutionSubmissionTarget(ctx, username, in, conversationV1)
		if err != nil {
			return nil, err
		}
		in.Mode = target.mode
		requestedSubmissionInput.Mode = target.mode
	}
	preAdmissionSlug := ""
	if in.Mode == "expert" && in.Tool == "" {
		preAdmissionSlug = expertRouterAgentSlug
	} else {
		var ok bool
		preAdmissionSlug, ok = rxBot.SlugFor(in.Tool)
		if !ok {
			return nil, fmt.Errorf("%w %q", ErrUnknownTool, in.Tool)
		}
	}
	existing, lookupErr := ps.findExecutionAdmission(
		ctx,
		username,
		requestedSubmissionInput,
		target,
		permissions,
		conversationV1,
		preAdmissionSlug,
	)
	if lookupErr != nil {
		return nil, lookupErr
	}
	if existing != nil {
		return existing, nil
	}
	if researchRequest {
		admission, err = ps.completeRemoteProductAdmission(ctx, admission)
		if err != nil {
			return nil, err
		}
		maxQueryChars, maxAttachments, ok := researchInputLimits(admission)
		if !ok {
			return nil, ErrResearchInputIncompatible
		}
		if err := validateResearchMessageWithin(
			in.Query,
			maxQueryChars,
			AllowsEmptyQueryWithAttachments(in),
		); err != nil {
			return nil, err
		}
		attachments, err = validateQueryAttachmentsWithin(in.Attachments, maxAttachments)
		if err != nil {
			return nil, err
		}
		in.Attachments = attachments
	}
	// 1. Web-owned alias -> Bot slug. Empty tool defaults to the chat agent.
	// A forced Expert selection resolves its own slug and dispatches directly,
	// exactly as instant mode does; only autonomous Expert (no forced tool)
	// leaves slug empty and delegates agent choice to Bot's router. The forced
	// tool already passed the server-owned effective allowlist above.
	var slug string
	if in.Mode != "expert" || in.Tool != "" {
		var ok bool
		slug, ok = rxBot.SlugFor(in.Tool)
		if !ok {
			return nil, fmt.Errorf("%w %q", ErrUnknownTool, in.Tool)
		}
	}
	interop := localInteropDecision("off")
	// A forced Expert selection dispatches directly (like instant), so it must
	// pass the same server-owned interop authorization: prepareInterop authorizes
	// research/design targets against the runtime allowlist and returns "off" for
	// every non-interop agent. Only autonomous Expert (no forced tool) skips this;
	// its router request never forwards interop controls.
	if in.Mode != "expert" || in.Tool != "" {
		interop, err = ps.prepareInterop(ctx, username, slug, in.InteropMode, in.InteropTargets)
		if err != nil {
			failed := &QueryData{
				Status:          "FAILED",
				DegradedInterop: interop.Degraded,
				InterOp:         queryInteropProvenancePtr(slug, interop),
			}
			return failed, err
		}
		in.InteropMode = interop.Mode
		in.InteropTargets = append([]string(nil), interop.Targets...)
	}
	submissionInput := in
	if ownerAllocated {
		submissionInput = requestedSubmissionInput
	}

	admissionAgentSlug := slug
	if in.Mode == "expert" && in.Tool == "" {
		admissionAgentSlug = expertRouterAgentSlug
	}
	submission, err := ps.admitExecutionCommand(
		ctx,
		username,
		submissionInput,
		target,
		permissions,
		conversationV1,
		admissionAgentSlug,
	)
	if err != nil {
		return nil, err
	}
	accepted := &QueryData{
		RequestID:     requestIDFromContext(ctx),
		SchemaVersion: executionCommandSchemaVersion, ExecutionID: in.ClientTurnID,
		UserMessageID: submission.userMessageID, AssistantMessageID: submission.assistantMessageID,
		EventCursor: 0, Accepted: true,
		Attachments: append([]rxBot.AssetAttachmentRef(nil), in.Attachments...),
	}
	if submission.turn != nil {
		turnData := queryDataFromConversationTurnV2(*submission.turn)
		accepted.Id = turnData.Id
		accepted.ToolName = turnData.ToolName
		accepted.Status = turnData.Status
		accepted.DialogueId = turnData.DialogueId
		accepted.ReactionType = turnData.ReactionType
	} else {
		accepted.Id = submission.row.Id
		accepted.ToolName = submission.row.ToolName
		accepted.Answer = submission.row.Answer
		accepted.FollowUpQuestions = submission.row.FollowUpQuestions
		accepted.Status = submission.row.Status
		accepted.DialogueId = submission.row.DialogueId
		accepted.BotRunID = submission.row.BotRunId
		accepted.TaskId = submission.row.TaskId
		accepted.ReactionType = submission.row.ReactionType
	}
	if accepted.ReactionType == "" {
		accepted.ReactionType = "0"
	}
	return accepted, nil
}

// resolveDialogue returns the dialogue_id and f_id for this turn, scoping every
// lookup to the authenticated user_name so a caller can only refresh or thread
// onto their own rows.
func (ps *Service) resolveDialogue(ctx context.Context, username string, in QueryInput) (string, int64, error) {
	if in.RefreshId != 0 {
		var row model.QuestionAgentLog
		if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
			Where(
				"id = ? AND user_name = ? AND delete_at IS NULL",
				in.RefreshId,
				username,
			).First(&row).Error; err != nil {
			return "", 0, err
		}
		var root model.QuestionAgentLog
		if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
			Where(
				"dialogue_id = ? AND f_id = 0 AND user_name = ? AND delete_at IS NULL",
				row.DialogueId,
				username,
			).First(&root).Error; err != nil {
			return "", 0, err
		}
		return row.DialogueId, row.FId, nil
	}
	if in.Id == 0 {
		return uuid.NewString(), 0, nil
	}
	var parent model.QuestionAgentLog
	if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where(
			"id = ? AND user_name = ? AND delete_at IS NULL",
			in.Id,
			username,
		).First(&parent).Error; err != nil {
		return "", 0, err
	}
	var root model.QuestionAgentLog
	if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where(
			"dialogue_id = ? AND f_id = 0 AND user_name = ? AND delete_at IS NULL",
			parent.DialogueId,
			username,
		).First(&root).Error; err != nil {
		return "", 0, err
	}
	return parent.DialogueId, in.Id, nil
}

// parseHistory converts the flat history JSON string the Web app sends into the
// structured [{role, content}] array Bot's router consumes. Best-effort: a
// malformed/empty string yields nil (no history), never an error.
func parseHistory(s string) []rxBot.ChatMessage {
	if s == "" || s == "[]" {
		return nil
	}
	var msgs []rxBot.ChatMessage
	if json.Unmarshal([]byte(s), &msgs) != nil {
		return nil
	}
	clean := make([]rxBot.ChatMessage, 0, len(msgs))
	for _, msg := range msgs {
		role := strings.ToLower(strings.TrimSpace(msg.Role))
		content := strings.TrimSpace(msg.Content)
		if (role != "user" && role != "assistant") || content == "" || utf8.RuneCountInString(content) > maxQueryHistoryContentRunes {
			continue
		}
		clean = append(clean, rxBot.ChatMessage{Role: role, Content: content})
	}
	if len(clean) > maxQueryHistoryMessages {
		clean = clean[len(clean)-maxQueryHistoryMessages:]
	}
	return clean
}

// QueryStream is a compatibility presentation over the canonical V2
// admission and execution event stream. It never dispatches or settles Agent
// work itself.
func (ps *Service) QueryStream(
	ctx context.Context,
	username string,
	in QueryInput,
	onReady func(StreamIdentity),
	forward func(frame []byte) error,
) (*QueryData, error) {
	accepted, err := ps.Query(ctx, username, in)
	if err != nil {
		return nil, err
	}
	if onReady != nil {
		onReady(StreamIdentity{
			DialogueID: accepted.DialogueId,
			MessageID:  accepted.Id,
		})
	}
	stream, _, err := ps.ExecutionEventStream(
		ctx,
		username,
		accepted.ExecutionID,
		accepted.EventCursor,
	)
	if err != nil {
		return accepted, err
	}
	defer stream.Close()

	scanner := bufio.NewScanner(stream)
	scanner.Buffer(make([]byte, 64*1024), 2*1024*1024)
	scanner.Split(splitSSEFrames)
	for scanner.Scan() {
		frame := append([]byte(nil), scanner.Bytes()...)
		if err := forward(frame); err != nil {
			return accepted, err
		}
	}
	if err := scanner.Err(); err != nil {
		return accepted, err
	}
	return accepted, nil
}

// splitSSEFrames is a bufio.SplitFunc that yields one SSE frame per call,
// splitting on the blank-line (LF or CRLF) separator. The trailing separator is
// included in the token so forwarding can preserve Bot's bytes exactly.
func splitSSEFrames(data []byte, atEOF bool) (advance int, token []byte, err error) {
	if i := bytes.Index(data, []byte("\r\n\r\n")); i >= 0 {
		return i + 4, data[:i+4], nil
	}
	if i := bytes.Index(data, []byte("\n\n")); i >= 0 {
		return i + 2, data[:i+2], nil
	}
	if atEOF && len(data) > 0 {
		return len(data), data, nil
	}
	return 0, nil, nil
}
