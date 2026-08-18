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
	rxLog "phytomni-server/log"
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
	envelope           *rxBot.ConversationEnvelopeV1
	duplicate          *QueryData
	pending            bool
	requestFingerprint string
	replacement        bool
}

func multiturnV1Enabled(in QueryInput) bool {
	return in.Surface == QuerySurfaceChat && conversationV1Enabled(in)
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

// instantChatConversationStream is the only /v1/chat/completions path Bot
// accepts a V1 conversation envelope on. Expert Knowledge/BriefGene streams
// must omit the envelope or Bot returns 422 ("chat context requires instant
// mode" / "instant context requires a ChatAgent model").
func instantChatConversationStream(in QueryInput, slug string) bool {
	return conversationV1Enabled(in) &&
		strings.EqualFold(strings.TrimSpace(in.Mode), "instant") &&
		slug == "chat"
}

func ownerAllocatedSubmissionEnabled(in QueryInput) bool {
	return conversationV1Enabled(in) || researchOwnerAllocatedSubmission(in) ||
		in.Surface == QuerySurfaceChat &&
			serviceClientTurnIDPattern.MatchString(strings.TrimSpace(in.ClientTurnID))
}

func researchOwnerAllocatedSubmission(in QueryInput) bool {
	return dedicatedResearchProductSubmission(in) ||
		in.Surface == QuerySurfaceChat &&
			in.Mode == "expert" &&
			in.Tool == "InSilicoResearchAgent"
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

func validateQueryAttachments(refs []rxBot.AssetAttachmentRef) ([]rxBot.AssetAttachmentRef, error) {
	return validateQueryAttachmentsWithin(refs, rxBot.DefaultMaxAssetAttachmentRefs)
}

func validateQueryAttachmentsWithin(refs []rxBot.AssetAttachmentRef, limit int) ([]rxBot.AssetAttachmentRef, error) {
	validated, err := rxBot.ValidateAssetAttachmentRefsWithin(refs, limit)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidQueryAttachments, err)
	}
	return validated, nil
}

func attachmentProjectionJSON(refs []rxBot.AssetAttachmentRef) (string, error) {
	if len(refs) == 0 {
		return "", nil
	}
	private := &persistedConversationContext{
		InputAttachments: append([]rxBot.AssetAttachmentRef(nil), refs...),
	}
	return marshalPersistedProjectionWithContext(
		BotRunProjection{ReportRevision: -1},
		private,
	)
}

func attachmentOwnerSubject(username string, refs []rxBot.AssetAttachmentRef) string {
	if len(refs) == 0 {
		return ""
	}
	return username
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

func clearConversationV1Lifecycle(private *persistedConversationContext) {
	if private == nil {
		return
	}
	private.ModeLockState = ""
	private.Stage = nil
	private.SettlementState = ""
	private.SettlementLedgerHash = ""
	private.RebuildLedgerVersion = ""
	private.RebuildLedgerCursor = 0
	private.AssistantSummary = ""
	private.ArtifactRefs = nil
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

// HasCurrentClientTurn reports whether the owner currently holds clientTurnID
// as a canonical Research base or active Research replacement identity.
// Unrelated Chat identities and retired aliases deliberately do not bypass a
// new Research request's live product admission.
func (ps *Service) HasCurrentClientTurn(
	ctx context.Context,
	username string,
	clientTurnID string,
) (bool, error) {
	if username == "" || ValidateClientTurnID(clientTurnID) != nil {
		return false, ErrInvalidClientTurnID
	}
	match, err := findRecentClientTurnWithDB(
		ctx,
		model.DB(ctx),
		username,
		clientTurnID,
	)
	if err != nil {
		return false, err
	}
	if match == nil {
		return false, nil
	}
	switch match.identity {
	case clientTurnIdentityBase:
		return isResearchProductTool(match.row.ToolName), nil
	case clientTurnIdentityReplacement:
		return match.private != nil && match.private.Replacement != nil &&
			isResearchProductTool(match.private.Replacement.ToolName), nil
	default:
		return false, nil
	}
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

func canonicalImmediateTerminalStatus(status string) (string, bool) {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "FAILED":
		return "FAILED", true
	case "CANCELLED", "CANCELED":
		return "CANCELLED", true
	case "TIMED_OUT", "TIMEOUT":
		return "TIMED_OUT", true
	default:
		return "", false
	}
}

func boundedReplacementTerminalText(value string, limit int) string {
	if !utf8.ValidString(value) || len(value) > limit {
		return ""
	}
	return value
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

func replacementTerminalResult(out *QueryData) *persistedReplacementTerminalResult {
	if out == nil {
		return nil
	}
	terminal := &persistedReplacementTerminalResult{
		ToolName:          out.ToolName,
		Answer:            boundedReplacementTerminalText(out.Answer, maxPersistedReplacementAnswerBytes),
		FollowUpQuestions: boundedReplacementFollowUp(out.FollowUpQuestions),
		Status:            out.Status,
		BotRunID:          out.BotRunID,
		TaskID:            out.TaskId,
		TrackingDegraded:  out.TrackingDegraded,
		ReportRevision:    out.ReportRevision,
		DegradedInterop:   out.DegradedInterop,
	}
	if out.InterOp != nil {
		interop := *out.InterOp
		terminal.Interop = &interop
	}
	return terminal
}

func persistReplacementTerminalResult(
	ctx context.Context,
	username string,
	submission *v1Submission,
	out *QueryData,
) (*QueryData, error) {
	if submission == nil || submission.row.Id == 0 {
		return nil, ErrDuplicateClientTurn
	}
	for attempt := 0; attempt < botProjectionCASAttempts; attempt++ {
		_, private, currentRaw, revision, err := loadPersistedBotProjectionRow(
			ctx,
			username,
			submission.row.Id,
		)
		if err != nil {
			return nil, err
		}
		if private == nil || private.Replacement == nil ||
			private.Replacement.RequestFingerprint != submission.requestFingerprint {
			return nil, ErrDuplicateClientTurn
		}
		projection, _, err := unmarshalPersistedProjectionWithContext(currentRaw)
		if err != nil {
			return nil, err
		}
		next := private.clone()
		replacement := next.Replacement
		replacement.ActiveStatus = ""
		replacement.ActiveBotRunID = ""
		replacement.ActiveTaskID = ""
		replacement.ActiveTrackingDegraded = false
		replacement.ActiveReportRevision = 0
		replacement.ActiveDegradedInterop = false
		replacement.ActiveInterop = nil
		replacement.ActiveA2UI = nil
		replacement.ActiveDelivery = nil
		terminal := replacementTerminalResult(out)
		if terminal != nil && terminal.ToolName == "" {
			terminal.ToolName = replacement.ToolName
			terminal.ToolUnresolved = terminal.ToolName == ""
		}
		replacement.TerminalResult = terminal
		encoded, err := marshalPersistedProjectionWithContext(projection, &next)
		if err != nil {
			return nil, err
		}
		result := model.DB(ctx).WithContext(ctx).Model(&model.QuestionAgentLog{}).
			Where(botProjectionCASPredicate, submission.row.Id, username, revision, currentRaw).
			UpdateColumn("bot_projection_json", encoded)
		if result.Error != nil {
			return nil, result.Error
		}
		if result.RowsAffected == 1 {
			return queryDataFromReplacementTerminal(submission.row, next.Replacement), nil
		}
	}
	return nil, ErrDuplicateClientTurn
}

func persistReplacementActiveResult(
	ctx context.Context,
	username string,
	submission *v1Submission,
	out *QueryData,
) (*QueryData, error) {
	if submission == nil || submission.row.Id == 0 || out == nil ||
		(out.Status != "RUNNING" && out.Status != "INPUT_REQUIRED") {
		return nil, ErrDuplicateClientTurn
	}
	var activeA2UI json.RawMessage
	if out.A2UI != nil {
		encoded, err := json.Marshal(out.A2UI)
		if err != nil || len(encoded) > maxPersistedActiveA2UIBytes {
			return nil, ErrInvalidA2uiSurface
		}
		if _, err := DecodeA2uiSurface(encoded); err != nil {
			return nil, ErrInvalidA2uiSurface
		}
		activeA2UI = encoded
	}
	for attempt := 0; attempt < botProjectionCASAttempts; attempt++ {
		projection, private, currentRaw, revision, err := loadPersistedBotProjectionRow(
			ctx,
			username,
			submission.row.Id,
		)
		if err != nil {
			return nil, err
		}
		if private == nil || private.Replacement == nil ||
			private.Replacement.RequestFingerprint != submission.requestFingerprint {
			return nil, ErrDuplicateClientTurn
		}
		next := private.clone()
		replacement := next.Replacement
		resolvedSlug, ok := rxBot.SlugFor(strings.TrimSpace(out.ToolName))
		if !ok {
			return nil, ErrBotProjectionConflict
		}
		if replacement.ToolName == "" {
			replacement.ToolName = out.ToolName
		} else if requestedSlug, requested := rxBot.SlugFor(strings.TrimSpace(replacement.ToolName)); !requested || requestedSlug != resolvedSlug {
			return nil, ErrBotProjectionConflict
		}
		replacement.ActiveStatus = out.Status
		replacement.ActiveBotRunID = out.BotRunID
		replacement.ActiveTaskID = out.TaskId
		replacement.ActiveTrackingDegraded = out.TrackingDegraded
		replacement.ActiveReportRevision = out.ReportRevision
		replacement.ActiveDegradedInterop = out.DegradedInterop
		replacement.ActiveA2UI = append(json.RawMessage(nil), activeA2UI...)
		replacement.TerminalResult = nil
		if out.InterOp != nil {
			interop := *out.InterOp
			replacement.ActiveInterop = &interop
		} else {
			replacement.ActiveInterop = nil
		}
		encoded, err := marshalPersistedProjectionWithContext(projection, &next)
		if err != nil {
			return nil, err
		}
		result := model.DB(ctx).WithContext(ctx).Model(&model.QuestionAgentLog{}).
			Where(botProjectionCASPredicate, submission.row.Id, username, revision, currentRaw).
			UpdateColumn("bot_projection_json", encoded)
		if result.Error != nil {
			return nil, result.Error
		}
		if result.RowsAffected == 1 {
			out.Id = submission.row.Id
			out.DialogueId = submission.row.DialogueId
			return out, nil
		}
	}
	return nil, ErrDuplicateClientTurn
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

func validateV1ContextStage(
	envelope *rxBot.ConversationEnvelopeV1,
	stage *rxBot.ContextStageMetadata,
	selectedTool string,
) error {
	if envelope == nil || stage == nil {
		return ErrInvalidConversationStage
	}
	if err := stage.ValidateForTurn(envelope.TurnID); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidConversationStage, err)
	}
	if !containsAgentTool(envelope.AllowedAgentIDs, stage.SelectedAgentID) ||
		stage.SelectedAgentID != selectedTool {
		return fmt.Errorf("%w: selected agent", ErrInvalidConversationStage)
	}
	if envelope.RequestedAgentID != nil &&
		stage.SelectedAgentID != *envelope.RequestedAgentID {
		return fmt.Errorf("%w: explicit selection", ErrInvalidConversationStage)
	}
	expectedSource := "router"
	if envelope.Mode == "instant" {
		expectedSource = "instant_lock"
		if stage.SelectedAgentID != "ChatAgent" {
			return fmt.Errorf("%w: instant agent", ErrInvalidConversationStage)
		}
	} else if envelope.RequestedAgentID != nil {
		expectedSource = "explicit_selection"
	}
	if stage.RouteSource != expectedSource ||
		stage.BaseBusinessContextVersion != envelope.BaseBusinessContextVersion ||
		stage.ProposedBusinessContextVersion != envelope.BaseBusinessContextVersion+1 ||
		stage.LastAppliedLedgerCursor != envelope.LedgerCursor {
		return fmt.Errorf("%w: route or version metadata", ErrInvalidConversationStage)
	}
	return nil
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

func (ps *Service) allocateV1Submission(
	ctx context.Context,
	username string,
	in QueryInput,
	target v1SubmissionTarget,
	permissions AgentPermissionResolution,
	finalizePending bool,
) (*v1Submission, error) {
	return ps.allocateV1SubmissionWithDB(
		ctx,
		model.DB(ctx),
		username,
		in,
		target,
		permissions,
		finalizePending,
	)
}

func (ps *Service) allocateOwnerSubmission(
	ctx context.Context,
	username string,
	in QueryInput,
	target v1SubmissionTarget,
	permissions AgentPermissionResolution,
	conversationV1 bool,
) (*v1Submission, error) {
	return ps.allocateOwnerSubmissionWithDB(
		ctx,
		model.DB(ctx),
		username,
		in,
		target,
		permissions,
		conversationV1,
		conversationV1,
	)
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

func (ps *Service) findExistingResearchSubmission(
	ctx context.Context,
	username string,
	in QueryInput,
	target v1SubmissionTarget,
) (*QueryData, error) {
	gdb := model.DB(ctx)
	var existing *v1Submission
	err := withTurnAllocationLockDB(ctx, gdb, username, in.ClientTurnID, func() error {
		var err error
		existing, err = ps.resolveExistingV1SubmissionWithDB(
			ctx,
			gdb,
			username,
			in,
			target,
			conversationV1Enabled(in),
		)
		if err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, nil
	}
	if existing.pending {
		return existing.duplicate, ErrClientTurnSubmissionPending
	}
	if existing.duplicate == nil {
		return nil, ErrClientTurnSubmissionPending
	}
	return existing.duplicate, nil
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
	if !rebuildRequired && target.operation == "append" {
		// QuestionAgentLog IDs are global to the database, while Bot's append
		// contract requires the next ledger cursor to be the latest accepted
		// row ID plus one. A different dialogue can consume IDs between two
		// turns here, so enter the typed rebuild path before Bot records an
		// append turn that it cannot accept.
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
	var current model.QuestionAgentLog
	if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Select("id, user_name, bot_run_id, status, bot_projection_json").
		Where("id = ? AND user_name = ?", rowID, username).
		Take(&current).Error; err == nil && ownerTaskAlreadyCancelled(&current) {
		return nil
	}
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

func v1SubmissionError(
	ctx context.Context,
	username string,
	submission *v1Submission,
	err error,
) error {
	if submission == nil || !isV1DefiniteFailure(err) {
		return err
	}
	if submission.replacement {
		if _, settleErr := persistReplacementTerminalResult(
			context.WithoutCancel(ctx),
			username,
			submission,
			&QueryData{
				Id:         submission.row.Id,
				DialogueId: submission.row.DialogueId,
				Status:     "FAILED",
			},
		); settleErr != nil {
			return fmt.Errorf("%v; settle replacement: %w", err, settleErr)
		}
		return err
	}
	if settleErr := failV1Submission(context.WithoutCancel(ctx), username, submission.row.Id); settleErr != nil {
		return fmt.Errorf("%v; settle submission: %w", err, settleErr)
	}
	return err
}

func prepareV1ConversationRebuildRetry(
	ctx context.Context,
	username string,
	submission *v1Submission,
	target v1SubmissionTarget,
	err error,
) (bool, error) {
	if submission == nil || !rxBot.IsConversationContextRebuildRequired(err) {
		return false, nil
	}
	if submission.envelope == nil || submission.envelope.Operation == "rebuild" {
		if settleErr := failV1Submission(
			context.WithoutCancel(ctx),
			username,
			submission.row.Id,
		); settleErr != nil {
			return false, fmt.Errorf(
				"%v; settle failed rebuild: %w",
				err,
				settleErr,
			)
		}
		return false, err
	}
	if rebuildErr := applyConversationRebuildEnvelope(
		ctx,
		username,
		submission,
		target,
	); rebuildErr != nil {
		if settleErr := failV1Submission(
			context.WithoutCancel(ctx),
			username,
			submission.row.Id,
		); settleErr != nil {
			return false, fmt.Errorf(
				"build rebuild envelope: %v; settle submission: %w",
				rebuildErr,
				settleErr,
			)
		}
		return false, rebuildErr
	}
	return true, nil
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
	Id                int64                      `json:"id"`
	ToolName          string                     `json:"tool_name"`
	Answer            string                     `json:"answer"`
	FollowUpQuestions string                     `json:"follow_up_questions"`
	Status            string                     `json:"status"`
	UploadPath        string                     `json:"upload_path"`
	DownloadPath      string                     `json:"download_path"`
	ServerFilePath    string                     `json:"server_file_path"`
	ComputeResource   string                     `json:"compute_resource"`
	ReactionType      string                     `json:"reaction_type"`
	DialogueId        string                     `json:"dialogue_id"`
	BotRunID          string                     `json:"bot_run_id,omitempty"`
	TaskId            string                     `json:"task_id,omitempty"`
	TrackingDegraded  bool                       `json:"tracking_degraded,omitempty"`
	ReportRevision    int64                      `json:"report_revision,omitempty"`
	RequestID         string                     `json:"request_id,omitempty"`
	A2UI              *A2uiSurfaceDTO            `json:"a2ui,omitempty"`
	DegradedInterop   bool                       `json:"degraded_interop,omitempty"`
	InterOp           *InteropProvenance         `json:"interop,omitempty"`
	Artifacts         []ConversationArtifactLink `json:"artifacts,omitempty"`
	ResultArchiveV1   bool                       `json:"result_archive_v1,omitempty"`
	Delivery          *AgentTaskDeliveryDTO      `json:"delivery,omitempty"`
	Attachments       []rxBot.AssetAttachmentRef `json:"attachments,omitempty"`
	ContextRebuilt    bool                       `json:"context_rebuilt,omitempty"`
	ContextDegraded   bool                       `json:"context_degraded,omitempty"`
	RouteReasonCode   string                     `json:"route_reason_code,omitempty"`
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

func canonicalBotRunID(runID *string) string {
	if runID == nil {
		return ""
	}
	return strings.TrimSpace(*runID)
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

func expertRouteContractError() error {
	return fmt.Errorf("%w: malformed expert response", ErrExpertRouteContract)
}

func validateExpertSubmissionAgent(resolvedSlug, submissionAgent string) error {
	if resolvedSlug == "" || submissionAgent != resolvedSlug {
		return fmt.Errorf("%w: expert agent mismatch", ErrExpertRouteContract)
	}
	return nil
}

func validateDirectSubmissionAgent(expectedSlug, responseAgent string) error {
	canonicalAgent, err := normalizeProjectionAgent(responseAgent)
	if err != nil {
		return err
	}
	if canonicalAgent != expectedSlug {
		return fmt.Errorf("%w: direct agent mismatch", ErrBotProjectionConflict)
	}
	return nil
}

func isExpertEnvelopeDecodeError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, rxBot.ErrBotTimeout) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	var apiErr *rxBot.APIError
	if errors.As(err, &apiErr) {
		return false
	}
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		return false
	}
	var netErr net.Error
	return !errors.As(err, &netErr)
}

func responseReportRevision(values ...*int64) int64 {
	for _, value := range values {
		if value != nil && *value >= 0 {
			return *value
		}
	}
	return 0
}

func responseReportRevisionOrDefault(defaultValue int64, values ...*int64) int64 {
	for _, value := range values {
		if value != nil && *value >= 0 {
			return *value
		}
	}
	return defaultValue
}

func metadataReportRevision(raw json.RawMessage) *int64 {
	if len(bytes.TrimSpace(raw)) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil
	}
	var metadata struct {
		ReportRevision *int64 `json:"report_revision"`
	}
	if err := json.Unmarshal(raw, &metadata); err != nil || metadata.ReportRevision == nil || *metadata.ReportRevision < 0 {
		return nil
	}
	return metadata.ReportRevision
}

func formattedMetadata(formatted *rxBot.Formatted) json.RawMessage {
	if formatted == nil {
		return nil
	}
	return formatted.Metadata
}

func decodeInputRequiredSurface(interrupt *rxBot.AgentRunInterrupt) (*A2uiSurfaceDTO, error) {
	if interrupt == nil || len(bytes.TrimSpace(interrupt.Draft)) == 0 {
		return nil, ErrInvalidA2uiSurface
	}
	entries, ok := decodeA2uiObjectEntries(interrupt.Draft)
	if !ok {
		return nil, ErrInvalidA2uiSurface
	}
	var rawSurface json.RawMessage
	for _, entry := range entries {
		if entry.key == "a2ui" {
			rawSurface = entry.value
			break
		}
	}
	if len(bytes.TrimSpace(rawSurface)) == 0 {
		return nil, ErrInvalidA2uiSurface
	}
	surface, err := DecodeA2uiSurface(rawSurface)
	if err != nil {
		return nil, ErrInvalidA2uiSurface
	}
	return surface, nil
}

func logBotResponseMeta(ctx context.Context, meta rxBot.ResponseMeta) {
	if strings.TrimSpace(meta.BotRequestID) == "" {
		return
	}
	rxLog.SugarContext(ctx).Debugw("Bot response received", "bot_request_id", meta.BotRequestID)
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
	if conversationV1 || researchRequest {
		if err := validateV1ClientTurnID(in.ClientTurnID); err != nil {
			return nil, err
		}
		in.ClientTurnID = strings.TrimSpace(in.ClientTurnID)
	} else if serviceClientTurnIDPattern.MatchString(strings.TrimSpace(in.ClientTurnID)) {
		in.ClientTurnID = strings.TrimSpace(in.ClientTurnID)
	}
	ownerAllocated := ownerAllocatedSubmissionEnabled(in)
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
	researchSubmission := researchOwnerAllocatedSubmission(in)
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
		target, err = ps.resolveV1SubmissionTarget(ctx, username, in, conversationV1)
		if err != nil {
			return nil, err
		}
		in.Mode = target.mode
		requestedSubmissionInput.Mode = target.mode
	}
	findResearchRetry := func() (*QueryData, error) {
		if !researchSubmission {
			return nil, nil
		}
		return ps.findExistingResearchSubmission(
			ctx,
			username,
			requestedSubmissionInput,
			target,
		)
	}
	if researchSubmission {
		existing, lookupErr := findResearchRetry()
		if lookupErr != nil {
			return existing, lookupErr
		}
		if existing != nil {
			return existing, nil
		}
	}
	if researchRequest {
		admission, err = ps.completeRemoteProductAdmission(ctx, admission)
		if err != nil {
			if existing, lookupErr := findResearchRetry(); lookupErr != nil {
				return existing, lookupErr
			} else if existing != nil {
				return existing, nil
			}
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
			if existing, lookupErr := findResearchRetry(); lookupErr != nil {
				return existing, lookupErr
			} else if existing != nil {
				return existing, nil
			}
			return nil, err
		}
		attachments, err = validateQueryAttachmentsWithin(in.Attachments, maxAttachments)
		if err != nil {
			if existing, lookupErr := findResearchRetry(); lookupErr != nil {
				return existing, lookupErr
			} else if existing != nil {
				return existing, nil
			}
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
			if existing, lookupErr := findResearchRetry(); lookupErr != nil {
				return existing, lookupErr
			} else if existing != nil {
				return existing, nil
			}
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

	var submission *v1Submission
	if ownerAllocated {
		submission, err = ps.allocateOwnerSubmission(
			ctx,
			username,
			submissionInput,
			target,
			permissions,
			conversationV1,
		)
		if err != nil {
			return nil, err
		}
		if submission.pending {
			return submission.duplicate, ErrClientTurnSubmissionPending
		}
		if submission.duplicate != nil {
			return submission.duplicate, nil
		}
	}
	contextClient := rxBot.NewClient()

	// 2. Resolve dialogue_id + f_id from the threading model above. Ownership
	//    is enforced by user_name so a caller cannot thread onto, or overwrite,
	//    another user's conversation (real-user isolation lives in Web Go).
	var dialogueID string
	var fID int64
	if ownerAllocated {
		dialogueID = submission.row.DialogueId
		fID = submission.row.FId
	} else {
		dialogueID, fID, err = ps.resolveDialogue(ctx, username, in)
		if err != nil {
			return nil, err
		}
	}
	executionClient := newExecutionBotClient(
		rxBot.BotConfig,
		in.Mode,
		in.Tool,
		slug,
		permissions.AllowedTools,
	)
	_, forcedChatFamily := rxBot.ChatModelFor(slug)
	useExpertContextRoute := in.Mode == "expert" &&
		(in.Tool == "" || (conversationV1 && forcedChatFamily))

	// 3. Dispatch. Web Go never runs an LLM; it forwards free-form query text
	//    and opaque asset references to Bot's resolver.
	out := &QueryData{
		ToolName:        "",
		ReactionType:    "0",
		DialogueId:      dialogueID,
		Status:          "SUCCEEDED",
		RequestID:       requestIDFromContext(ctx),
		DegradedInterop: interop.Degraded,
		InterOp:         queryInteropProvenancePtr(slug, interop),
	}
	if slug != "" {
		out.ToolName = slugToToolName[slug]
	}
	var botRunID, serverID, taskID, logStatus string
	var submissionProjection *BotRunProjection
	var contextStage *rxBot.ContextStageMetadata
	if useExpertContextRoute {
		// Autonomous Expert lets Bot select from the allowlist. A forced V1
		// chat-family turn uses the same endpoint, but requested_agent_id in the
		// envelope bypasses the LLM router and dispatches the selected agent.
		routeRequest := rxBot.RouteQueryRequest{
			UserQuery:    in.Query,
			Attachments:  append([]rxBot.AssetAttachmentRef(nil), in.Attachments...),
			OwnerSubject: attachmentOwnerSubject(username, in.Attachments),
			DialogueID:   dialogueID,
			AllowedTools: append(
				[]string(nil),
				permissions.AllowedTools...,
			),
		}
		if !conversationV1 {
			routeRequest.History = parseHistory(in.History)
		}
		if conversationV1 {
			routeRequest.Conversation = submission.envelope
		}
		var resp *rxBot.RouteQueryResponse
		for {
			var meta rxBot.ResponseMeta
			resp, meta, err = executionClient.RouteQueryWithMeta(ctx, routeRequest)
			logBotResponseMeta(ctx, meta)
			if err == nil {
				break
			}
			if conversationV1 {
				retry, retryErr := prepareV1ConversationRebuildRetry(
					ctx,
					username,
					submission,
					target,
					err,
				)
				if retryErr != nil {
					return nil, retryErr
				}
				if retry {
					routeRequest.Conversation = submission.envelope
					continue
				}
			}
			if isExpertEnvelopeDecodeError(err) {
				return nil, v1SubmissionError(
					ctx,
					username,
					submission,
					expertRouteContractError(),
				)
			}
			return nil, v1SubmissionError(ctx, username, submission, err)
		}
		resolvedSlug, _, err := resolveExpertAgent(resp)
		if err != nil {
			return nil, v1SubmissionError(ctx, username, submission, err)
		}
		resolvedTool, err := validateExpertResolvedTool(resolvedSlug, permissions.AllowedTools, in.Tool)
		if err != nil {
			return nil, v1SubmissionError(ctx, username, submission, err)
		}
		botSubmission, err := DecodeAgentRunSubmission(resp)
		if err != nil {
			var projectionErr *ProjectionDecodeError
			if errors.As(err, &projectionErr) && projectionErr.Field == "run_id" && projectionErr.Reason == "missing umbrella run id" {
				return nil, v1SubmissionError(ctx, username, submission, ErrMissingBotRunID)
			}
			// Keep every malformed upstream envelope on the bounded gateway path;
			// never expose decoder details or fabricate a successful tool.
			return nil, v1SubmissionError(
				ctx,
				username,
				submission,
				expertRouteContractError(),
			)
		}
		if err := validateExpertSubmissionAgent(resolvedSlug, botSubmission.Agent); err != nil {
			return nil, v1SubmissionError(ctx, username, submission, err)
		}
		routeRevision := metadataReportRevision(formattedMetadata(resp.Result.Formatted))
		botSubmission.ReportRevision = responseReportRevisionOrDefault(-1, resp.ReportRevision, resp.Result.ReportRevision, routeRevision)
		botSubmission.TrackingDegraded = botSubmission.TrackingDegraded || resp.DegradedTracking
		submissionProjection = &botSubmission
		contextStage = resp.ConversationContext
		slug = resolvedSlug
		out.ToolName = resolvedTool
		botRunID = botSubmission.RunID
		out.BotRunID = botRunID
		out.TrackingDegraded = botSubmission.TrackingDegraded
		if botSubmission.InterOp != nil {
			if strings.TrimSpace(botSubmission.InterOp.Mode) == "" {
				botSubmission.InterOp.Mode = "off"
			}
			out.InterOp = interopProvenancePtr(*botSubmission.InterOp)
		}
		out.DegradedInterop = out.DegradedInterop || botSubmission.DegradedInterop
		out.ReportRevision = responseReportRevision(resp.ReportRevision, resp.Result.ReportRevision, routeRevision)
		// Reshape by the slug Bot's router CHOSE (never "expert"), so cited/table
		// formatting survives and SyncBotRuns reconciles async runs by agent slug.
		if botSubmission.Status == "SUCCEEDED" {
			if resp.Result.Formatted != nil {
				out.Answer = rxBot.ShapeAnswer(resolvedSlug, resp.Result.Formatted.Answer, resp.Result.Formatted)
				out.FollowUpQuestions = string(resp.Result.Formatted.FollowUpQuestions)
			}
		} else if terminalStatus, terminal := canonicalImmediateTerminalStatus(botSubmission.Status); terminal {
			// A required interop failure may arrive as status=running with
			// formatted.metadata.status=FAILED and no task ids. The projection
			// decoder has already normalized that nested outcome; keep the row
			// terminal and never invent a pollable task.
			out.Status = terminalStatus
			if resp.Result.Formatted != nil {
				out.Answer = rxBot.ShapeAnswer(resolvedSlug, resp.Result.Formatted.Answer, resp.Result.Formatted)
				out.FollowUpQuestions = string(resp.Result.Formatted.FollowUpQuestions)
			}
		} else {
			out.Status = botSubmission.Status
			logStatus = "sync_running"
			if resp.Result.DedupHit {
				taskID = resp.Result.TaskID
			} else if len(resp.TaskIDs) > 0 {
				taskID = resp.TaskIDs[0]
			}
			if taskID != "" {
				out.Answer = "Task created: " + taskID
			}
		}
	} else if chatModel, isChat := rxBot.ChatModelFor(slug); isChat {
		messages := chatMessagesForRequest(in.History, in.Query)
		if conversationV1 {
			messages = []rxBot.ChatMessage{{Role: "user", Content: in.Query}}
		}
		req := rxBot.ChatCompletionRequest{
			Model:        chatModel,
			Messages:     messages,
			DialogueID:   dialogueID,
			Attachments:  append([]rxBot.AssetAttachmentRef(nil), in.Attachments...),
			OwnerSubject: attachmentOwnerSubject(username, in.Attachments),
		}
		if conversationV1 && instantChatConversationStream(in, slug) {
			req.Conversation = submission.envelope
		}
		if slug == "brief_gene" {
			// BriefGene resolves the free-form message into a canonical gene id
			// before invoking the tool; Bot rejects this flag for the other chat
			// models, so it is set for brief_gene alone.
			req.ResolveGeneID = true
		}
		var resp *rxBot.ChatCompletionResponse
		for {
			var meta rxBot.ResponseMeta
			resp, meta, err = executionClient.ChatCompletionWithMeta(ctx, req)
			logBotResponseMeta(ctx, meta)
			if err == nil {
				break
			}
			if conversationV1 {
				retry, retryErr := prepareV1ConversationRebuildRetry(
					ctx,
					username,
					submission,
					target,
					err,
				)
				if retryErr != nil {
					return nil, retryErr
				}
				if retry {
					req.Conversation = submission.envelope
					continue
				}
			}
			return nil, v1SubmissionError(ctx, username, submission, err)
		}
		botRunID = canonicalBotRunID(resp.RunID)
		contextStage = resp.ConversationContext
		out.BotRunID = botRunID
		out.TrackingDegraded = resp.DegradedTracking
		out.ReportRevision = responseReportRevision(resp.ReportRevision, metadataReportRevision(resp.Formatted.Metadata), metadataReportRevision(formattedMetadata(resp.Result.Formatted)))
		reviewAnswer := ""
		if resp.Result.Formatted != nil {
			reviewAnswer = resp.Result.Formatted.Answer
		}
		reviewAnswerCompleted := reviewAnswerCompletesPause(slug, resp.Status, reviewAnswer)
		if terminalStatus, terminal := canonicalImmediateTerminalStatus(resp.Status); terminal {
			out.Status = terminalStatus
			if resp.Result.Formatted != nil {
				out.Answer = rxBot.ShapeAnswer(slug, resp.Result.Formatted.Answer, resp.Result.Formatted)
				out.FollowUpQuestions = string(resp.Result.Formatted.FollowUpQuestions)
			} else {
				out.Answer = rxBot.ShapeAnswer(slug, rxBot.ChatAnswerText(resp), &resp.Formatted)
				out.FollowUpQuestions = string(resp.Formatted.FollowUpQuestions)
			}
		} else if strings.EqualFold(strings.TrimSpace(resp.Status), "input_required") && !reviewAnswerCompleted {
			// Review's native pause is returned from the chat endpoint as an
			// agent.run envelope. Decode only interrupt.draft.a2ui and never
			// assume choices[0] exists for this shape.
			surface, surfaceErr := decodeInputRequiredSurface(resp.Interrupt)
			if surfaceErr != nil {
				return nil, v1SubmissionError(ctx, username, submission, surfaceErr)
			}
			if botRunID == "" {
				return nil, v1SubmissionError(ctx, username, submission, ErrMissingBotRunID)
			}
			out.Status = "INPUT_REQUIRED"
			out.A2UI = surface
		} else {
			// Default-mode chat/completions strips formatted.answer into
			// choices[0].message.content; source it there, then reshape per slug
			// (knowledge/review become {content, doc_list}; chat stays plain). A
			// completed Review result wins over a contradictory stale interrupt.
			if reviewAnswerCompleted || (strings.EqualFold(strings.TrimSpace(resp.Status), "succeeded") && len(resp.Choices) == 0 && resp.Result.Formatted != nil) {
				out.Answer = rxBot.ShapeAnswer(slug, resp.Result.Formatted.Answer, resp.Result.Formatted)
				out.FollowUpQuestions = string(resp.Result.Formatted.FollowUpQuestions)
			} else {
				answerText := rxBot.ChatAnswerText(resp)
				out.Answer = rxBot.ShapeAnswer(slug, answerText, &resp.Formatted)
				out.FollowUpQuestions = string(resp.Formatted.FollowUpQuestions)
			}
		}
	} else {
		// /v1/agents/{slug}/runs serves BOTH synchronous agents (data → 200,
		// status="succeeded", answer already in result.formatted) AND remote
		// agents (analyst, deep_genome, research, design, network → 202,
		// status="running", answer polled later via /query/analyst/update_log).
		// Branch on the returned status;
		// never assume remote, or a sync agent's answer is silently dropped.
		argumentInput := rxBot.AgentArgumentInput{
			UserQuery:      in.Query,
			HasAttachments: len(in.Attachments) > 0,
			GeneID:         in.GeneID,
			ToID:           in.ToID,
			SpeciesCode:    in.SpeciesCode,
		}
		if interopAgent(slug) {
			argumentInput.InteropMode = in.InteropMode
			argumentInput.InteropTargets = in.InteropTargets
		}
		args, err := rxBot.BuildAgentArguments(slug, argumentInput)
		if err != nil {
			return nil, v1SubmissionError(ctx, username, submission, err)
		}
		agentRequest := rxBot.AgentRunRequest{
			Arguments:    args,
			Attachments:  append([]rxBot.AssetAttachmentRef(nil), in.Attachments...),
			OwnerSubject: attachmentOwnerSubject(username, in.Attachments),
			DialogueID:   dialogueID,
		}
		if slug == "research" {
			agentRequest.IdempotencyKey = in.ClientTurnID
		}
		if conversationV1 {
			agentRequest.Conversation = submission.envelope
		}
		var resp *rxBot.AgentRunResponse
		for {
			var meta rxBot.ResponseMeta
			resp, meta, err = executionClient.InvokeAgentWithMeta(ctx, slug, agentRequest)
			logBotResponseMeta(ctx, meta)
			if err == nil {
				break
			}
			if conversationV1 {
				retry, retryErr := prepareV1ConversationRebuildRetry(
					ctx,
					username,
					submission,
					target,
					err,
				)
				if retryErr != nil {
					return nil, retryErr
				}
				if retry {
					agentRequest.Conversation = submission.envelope
					continue
				}
			}
			return nil, v1SubmissionError(ctx, username, submission, err)
		}
		if err := validateDirectSubmissionAgent(slug, resp.Agent); err != nil {
			return nil, v1SubmissionError(ctx, username, submission, err)
		}
		if conversationV1 {
			contextStage = resp.ConversationContext
		}
		botRunID, err = normalizeAgentRunResponseID(*resp)
		if err != nil {
			return nil, v1SubmissionError(ctx, username, submission, err)
		}
		out.BotRunID = botRunID
		out.TrackingDegraded = resp.DegradedTracking
		out.ReportRevision = responseReportRevision(resp.ReportRevision, resp.Result.ReportRevision, metadataReportRevision(formattedMetadata(resp.Result.Formatted)))
		if interopAgent(slug) {
			botSubmission, projectionErr := DecodeAgentRunSubmission(resp)
			if projectionErr != nil {
				var fieldErr *ProjectionDecodeError
				if errors.As(projectionErr, &fieldErr) && fieldErr.Field == "run_id" && fieldErr.Reason == "missing umbrella run id" {
					projectionErr = ErrMissingBotRunID
				}
				return nil, v1SubmissionError(ctx, username, submission, projectionErr)
			}
			botSubmission.ReportRevision = out.ReportRevision
			submissionProjection = &botSubmission
			out.TrackingDegraded = botSubmission.TrackingDegraded
		}
		var (
			interopMetadata botInteropMetadata
			metadataErr     error
		)
		if interopAgent(slug) {
			interopMetadata, metadataErr = decodeFormattedInteropMetadata(formattedMetadata(resp.Result.Formatted))
			if metadataErr != nil {
				return nil, v1SubmissionError(ctx, username, submission, metadataErr)
			}
		}
		if interopAgent(slug) {
			out.DegradedInterop = out.DegradedInterop || interopMetadata.DegradedInterop
			if interopProjection := interopMetadata.projection(); interopProjection != nil {
				interopProjection.Mode = interop.Provenance.Mode
				out.InterOp = interopProjection
			}
		}
		if submissionProjection != nil {
			submissionProjection.DegradedInterop = out.DegradedInterop
			submissionProjection.InterOp = out.InterOp
		}
		responseStatus := strings.ToUpper(strings.TrimSpace(resp.Status))
		if interopAgent(slug) && interopMetadata.failed(len(resp.TaskIDs) == 0 && strings.TrimSpace(resp.Result.TaskID) == "") {
			responseStatus = "FAILED"
		}
		if responseStatus == "SUCCEEDED" {
			// Synchronous agent (e.g. data): the answer is already here.
			if resp.Result.Formatted != nil {
				// Reshape the sync agent payload (data -> {headers, rows}).
				out.Answer = rxBot.ShapeAnswer(slug, resp.Result.Formatted.Answer, resp.Result.Formatted)
				out.FollowUpQuestions = string(resp.Result.Formatted.FollowUpQuestions)
			}
			// out.Status stays "SUCCEEDED".
		} else if terminalStatus, terminal := canonicalImmediateTerminalStatus(responseStatus); terminal {
			// Bot's bounded interop metadata is authoritative for a terminal
			// required failure even when the umbrella response still says running.
			out.Status = terminalStatus
			if resp.Result.Formatted != nil {
				out.Answer = rxBot.ShapeAnswer(slug, resp.Result.Formatted.Answer, resp.Result.Formatted)
				out.FollowUpQuestions = string(resp.Result.Formatted.FollowUpQuestions)
			}
		} else {
			// Remote agents may initially return no child task ids; when present,
			// the first task id is retained for legacy status surfaces. The answer
			// arrives later.
			out.Status = "RUNNING"
			logStatus = "sync_running"
			if resp.Result.DedupHit {
				taskID = resp.Result.TaskID
			} else if len(resp.TaskIDs) > 0 {
				taskID = resp.TaskIDs[0]
			}
			if taskID != "" {
				if slug == "deep_genome" {
					serverID = taskID
					out.Answer = "Server task created: " + serverID
				} else {
					out.Answer = "Task created: " + taskID
				}
			}
		}
	}

	if (out.Status == "RUNNING" || out.Status == "INPUT_REQUIRED") && botRunID == "" {
		// A child task id cannot be used as the Bot run join key. Refuse to
		// persist an unpollable row even when a legacy response has task_ids.
		return nil, v1SubmissionError(ctx, username, submission, ErrMissingBotRunID)
	}
	out.TaskId = taskID
	out.Attachments = append([]rxBot.AssetAttachmentRef(nil), in.Attachments...)
	if submission != nil && submission.replacement && out.Status != statusSucceeded {
		if _, terminal := canonicalImmediateTerminalStatus(out.Status); terminal {
			terminalOut, err := persistReplacementTerminalResult(
				ctx,
				username,
				submission,
				out,
			)
			if err != nil {
				return nil, err
			}
			return terminalOut, nil
		}
		if out.Status == "RUNNING" || out.Status == "INPUT_REQUIRED" {
			return persistReplacementActiveResult(ctx, username, submission, out)
		}
	}

	if conversationV1 && out.Status == statusSucceeded {
		settlementState := conversationSettlementRebuildRequired
		if contextStage != nil {
			if err := validateV1ContextStage(
				submission.envelope,
				contextStage,
				out.ToolName,
			); err != nil {
				return nil, v1SubmissionError(ctx, username, submission, err)
			}
			if !contextStage.ContextDegraded {
				settlementState = conversationSettlementAckPending
			}
		}
		private := persistedConversationContext{
			ClientTurnID:       in.ClientTurnID,
			RequestFingerprint: submission.requestFingerprint,
			Stage:              contextStage,
			SettlementState:    settlementState,
			AssistantSummary:   v1AssistantSummary(contextStage),
			ArtifactRefs:       append([]rxBot.ArtifactRefV1(nil), target.artifacts...),
			InputAttachments:   append([]rxBot.AssetAttachmentRef(nil), in.Attachments...),
		}
		if submission.envelope.Operation == "rebuild" {
			private.RebuildLedgerVersion = submission.envelope.LedgerVersion
			private.RebuildLedgerCursor = submission.envelope.LedgerCursor
		}
		out.Id = submission.row.Id
		out.UploadPath = submission.row.UploadPath
		private.SettlementLedgerHash = submission.envelope.LedgerVersion
		ledgerVersion, err := settleBlockingConversationContext(
			ctx,
			username,
			dialogueID,
			submission.row.Id,
			out,
			in.Mode,
			submissionProjection,
			private,
			in.Query,
		)
		if err != nil {
			return nil, err
		}
		if settlementState == conversationSettlementAckPending {
			// The visible answer is already durable. A lost acknowledgment is
			// retried before the next envelope and must not hide this success.
			_ = acknowledgeConversationContext(
				ctx,
				contextClient,
				username,
				dialogueID,
				submission.row.Id,
				ledgerVersion,
				contextStage,
			)
		}
		if err := ps.decorateConversationQueryData(ctx, username, out); err != nil {
			return nil, err
		}
		return out, nil
	}

	// 4. Persist the Web row (INSERT new, or UPDATE on refresh).
	titleQuery := ""
	if fID == 0 && in.RefreshId == 0 {
		titleQuery = conversationTitle(in.Query) // first turn of a new conversation is its title
	}
	attachmentProjection, err := attachmentProjectionJSON(in.Attachments)
	if err != nil {
		return nil, err
	}
	row := model.QuestionAgentLog{
		DialogueId:        dialogueID,
		FId:               fID,
		ServerId:          serverID,
		BotRunId:          botRunID,
		UserName:          username,
		Query:             in.Query,
		TitleQuery:        titleQuery,
		Answer:            out.Answer,
		FollowUpQuestions: out.FollowUpQuestions,
		TaskId:            taskID,
		TaskLog:           "",
		BotProjectionJSON: attachmentProjection,
		DownloadPath:      "",
		ComputeResource:   "",
		ServerFilePath:    "", // not the task id; the output file path is filled by update_log once the remote task emits it
		ToolName:          out.ToolName,
		Status:            out.Status,
		LogStatus:         logStatus,
		Mode:              in.Mode,
		ReactionType:      "0",
		CollectType:       "0",
	}
	if ownerAllocated {
		row.BotProjectionJSON = ""
	}

	var id int64
	if ownerAllocated {
		id, err = ps.persistOwnerAllocatedQuestionLog(
			ctx,
			username,
			submission,
			&row,
			conversationV1,
		)
	} else {
		id, err = ps.persistQuestionLog(ctx, username, in.RefreshId, &row)
	}
	if err != nil {
		return nil, err
	}
	out.Id = id
	ps.adoptOwnerCancelIfPresent(ctx, username, id, out, botRunID)
	if conversationV1 && (out.Status == "RUNNING" || out.Status == "INPUT_REQUIRED") {
		lockCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
		err := lockConversationRootMode(lockCtx, username, dialogueID)
		cancel()
		if err != nil {
			return nil, err
		}
	}
	if submissionProjection != nil {
		// The row now exists, so the accepted Bot submission can enter the
		// same owner-scoped projection store used by polling/reconciliation.
		if err := SaveBotRunProjection(ctx, username, id, *submissionProjection); err != nil {
			return nil, err
		}
	}
	return out, nil
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

func chatMessagesForRequest(history, query string) []rxBot.ChatMessage {
	messages := parseHistory(history)
	return append(messages, rxBot.ChatMessage{Role: "user", Content: query})
}

const botProjectionApplyAttempts = 3

func replacementTaskID(replacement *persistedConversationReplacement, rec *rxBot.RunRecord) string {
	if rec != nil && len(rec.TaskIDs) > 0 && strings.TrimSpace(rec.TaskIDs[0]) != "" {
		return strings.TrimSpace(rec.TaskIDs[0])
	}
	if replacement == nil {
		return ""
	}
	return replacement.ActiveTaskID
}

func privatePendingReplacementDelivery(projection BotRunProjection) *persistedReplacementActiveDelivery {
	if !projectionHasPendingRequiredDelivery(projection) {
		return nil
	}
	return &persistedReplacementActiveDelivery{
		SchemaVersion:   projection.Delivery.SchemaVersion,
		Required:        projection.Delivery.Required,
		Status:          projection.Delivery.Status,
		Revision:        projection.Delivery.Revision,
		InventoryDigest: projection.Delivery.InventoryDigest,
	}
}

func privateActiveReplacementProjection(
	replacement *persistedConversationReplacement,
	agent string,
) BotRunProjection {
	projection := BotRunProjection{
		RunID:            replacement.ActiveBotRunID,
		Agent:            agent,
		Status:           replacement.ActiveStatus,
		ReportRevision:   replacement.ActiveReportRevision,
		TrackingDegraded: replacement.ActiveTrackingDegraded,
		DegradedInterop:  replacement.ActiveDegradedInterop,
		InterOp:          replacement.ActiveInterop,
		ResultArchiveV1:  replacement.ActiveDelivery != nil,
	}
	if replacement.ActiveDelivery != nil {
		projection.Delivery = &ProjectionDelivery{
			SchemaVersion:   replacement.ActiveDelivery.SchemaVersion,
			Required:        replacement.ActiveDelivery.Required,
			Status:          replacement.ActiveDelivery.Status,
			Revision:        replacement.ActiveDelivery.Revision,
			InventoryDigest: replacement.ActiveDelivery.InventoryDigest,
		}
	}
	return projection
}

func projectionHasFailedRequiredDelivery(projection BotRunProjection) bool {
	return projection.ResultArchiveV1 && projection.Delivery != nil &&
		projection.Delivery.Required && projection.Delivery.Status == "failed"
}

func replacementTerminalResultFromProjection(
	replacement *persistedConversationReplacement,
	projection BotRunProjection,
	rec *rxBot.RunRecord,
) *persistedReplacementTerminalResult {
	answer := ""
	followUp := ""
	formatted, _, hasFormatted := rxBot.ParseRunFormatted(rec.Result)
	if visible := strings.TrimSpace(projection.VisibleReport()); visible != "" {
		if hasFormatted {
			answer = rxBot.ShapeAnswer(projection.Agent, projection.VisibleReport(), formatted)
			followUp = string(formatted.FollowUpQuestions)
		} else {
			answer = rxBot.ShapeAnswer(projection.Agent, projection.VisibleReport(), nil)
		}
	}
	terminal := &persistedReplacementTerminalResult{
		ToolName:          replacement.ToolName,
		Answer:            boundedReplacementTerminalText(answer, maxPersistedReplacementAnswerBytes),
		FollowUpQuestions: boundedReplacementFollowUp(followUp),
		Status:            projection.Status,
		BotRunID:          projection.RunID,
		TaskID:            replacementTaskID(replacement, rec),
		TrackingDegraded:  projection.TrackingDegraded,
		ReportRevision:    projection.ReportRevision,
		DegradedInterop:   projection.DegradedInterop,
	}
	if projection.InterOp != nil {
		interop := *projection.InterOp
		terminal.Interop = &interop
	}
	return terminal
}

func promotedReplacementContext(
	private *persistedConversationContext,
	replacement *persistedConversationReplacement,
) (persistedConversationContext, error) {
	if private == nil || replacement == nil || replacement.ClientTurnID == "" ||
		replacement.RequestFingerprint == "" {
		return persistedConversationContext{}, ErrDuplicateClientTurn
	}
	retired := append([]persistedClientTurnIdentity(nil), private.RetiredIdentities...)
	if private.ClientTurnID != "" {
		if private.RequestFingerprint == "" || len(retired) >= maxPersistedRetiredClientTurns {
			return persistedConversationContext{}, ErrDuplicateClientTurn
		}
		retired = append(retired, persistedClientTurnIdentity{
			ClientTurnID:       private.ClientTurnID,
			RequestFingerprint: private.RequestFingerprint,
		})
	}
	next := persistedConversationContext{
		ClientTurnID:       replacement.ClientTurnID,
		RequestFingerprint: replacement.RequestFingerprint,
		InputAttachments:   append([]rxBot.AssetAttachmentRef(nil), replacement.InputAttachments...),
		InteropMode:        replacement.InteropMode,
		InteropTargets:     append([]string(nil), replacement.InteropTargets...),
		RetiredIdentities:  retired,
	}
	if replacement.ConversationV1 {
		next.ModeLockState = "locked"
		next.SettlementState = conversationSettlementRebuildRequired
		next.ArtifactRefs = append([]rxBot.ArtifactRefV1(nil), replacement.ArtifactRefs...)
	}
	return next, nil
}

// applyPrivateReplacementRunProjection reconciles an accepted replacement
// without exposing its candidate over the prior public row. Only a successful
// run promotes the complete bounded public projection; nonterminal and failed
// states remain in the private candidate envelope.
func (ps *Service) applyPrivateReplacementRunProjection(
	ctx context.Context,
	rowID int64,
	username string,
	expectedRunID string,
	rec *rxBot.RunRecord,
	meta rxBot.ResponseMeta,
) error {
	if rowID <= 0 || username == "" || rec == nil || expectedRunID == "" {
		return ErrBotProjectionConflict
	}
	projection, err := DecodeRunProjection(rec)
	if err != nil {
		return err
	}
	if projection.RunID != expectedRunID {
		return ErrBotProjectionConflict
	}
	projection.RequestID = strings.TrimSpace(meta.BotRequestID)
	logBotResponseMeta(ctx, meta)

	for attempt := 0; attempt < botProjectionCASAttempts; attempt++ {
		var stored model.QuestionAgentLog
		if err := model.DB(ctx).WithContext(ctx).
			Where("id = ? AND user_name = ? AND delete_at IS NULL", rowID, username).
			First(&stored).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrBotProjectionNotFound
			}
			return err
		}
		publicProjection, private, err := unmarshalPersistedProjectionWithContext(stored.BotProjectionJSON)
		if err != nil {
			return err
		}
		if private == nil || private.Replacement == nil ||
			private.Replacement.ActiveBotRunID != expectedRunID ||
			private.Replacement.ActiveStatus == "" {
			return ErrBotProjectionConflict
		}
		replacement := private.Replacement
		expectedAgent, ok := rxBot.SlugFor(strings.TrimSpace(replacement.ToolName))
		if !ok || projection.Agent != expectedAgent {
			return ErrBotProjectionConflict
		}
		projection, _, err = MergeBotRunProjection(
			privateActiveReplacementProjection(replacement, expectedAgent),
			projection,
		)
		if err != nil {
			return fmt.Errorf("%w: private replacement projection transition", ErrBotProjectionConflict)
		}
		next := private.clone()
		nextReplacement := next.Replacement
		pendingDelivery := projectionHasPendingRequiredDelivery(projection)
		if projectionHasFailedRequiredDelivery(projection) {
			// Delivery failure is terminal for the candidate, but the generated
			// report and output paths do not become private replacement state.
			projection.Status = "FAILED"
			projection.IntermediateReport = ""
			projection.FinalReport = ""
			projection.Artifacts = ProjectionArtifacts{}
		}

		if projection.Status == statusSucceeded && !pendingDelivery {
			promotedPrivate, err := promotedReplacementContext(private, replacement)
			if err != nil {
				return err
			}
			encoded, err := marshalPersistedProjectionWithContext(projection, &promotedPrivate)
			if err != nil {
				return err
			}
			updates := map[string]interface{}{
				"answer":              "",
				"bot_projection_json": encoded,
				"bot_report_revision": projection.ReportRevision,
				"bot_run_id":          projection.RunID,
				"compute_resource":    "",
				"download_path":       "",
				"file_name":           "",
				"follow_up_questions": "",
				"image_paths":         "",
				"log_status":          "",
				"mode":                replacement.Mode,
				"query":               replacement.Query,
				"server_file_path":    "",
				"server_id":           "",
				"status":              statusSucceeded,
				"task_id":             replacementTaskID(replacement, rec),
				"task_log":            "",
				"tool_name":           replacement.ToolName,
				"upload_path":         "",
			}
			for key, value := range botProjectionLegacyUpdates(projection, projection, rec, true) {
				updates[key] = value
			}
			err = model.DB(ctx).WithContext(ctx).Transaction(func(tx *gorm.DB) error {
				result := tx.Model(&model.QuestionAgentLog{}).
					Where(botProjectionCASPredicate, stored.Id, username, stored.BotReportRevision, stored.BotProjectionJSON).
					Updates(updates)
				if result.Error != nil {
					return result.Error
				}
				if result.RowsAffected != 1 {
					return ErrBotProjectionConflict
				}
				return invalidateConversationContextsAfter(ctx, tx, username, stored.DialogueId, stored.Id)
			})
			if errors.Is(err, ErrBotProjectionConflict) {
				continue
			}
			return err
		}

		if terminalStatus, terminal := canonicalImmediateTerminalStatus(projection.Status); terminal {
			projection.Status = terminalStatus
			nextReplacement.ActiveStatus = ""
			nextReplacement.ActiveBotRunID = ""
			nextReplacement.ActiveTaskID = ""
			nextReplacement.ActiveTrackingDegraded = false
			nextReplacement.ActiveReportRevision = 0
			nextReplacement.ActiveDegradedInterop = false
			nextReplacement.ActiveA2UI = nil
			nextReplacement.ActiveInterop = nil
			nextReplacement.ActiveDelivery = nil
			nextReplacement.TerminalResult = replacementTerminalResultFromProjection(
				replacement,
				projection,
				rec,
			)
		} else {
			nextStatus := "RUNNING"
			if projection.Status == "INPUT_REQUIRED" && !pendingDelivery {
				nextStatus = "INPUT_REQUIRED"
			}
			nextReplacement.ActiveStatus = nextStatus
			nextReplacement.ActiveBotRunID = projection.RunID
			nextReplacement.ActiveTaskID = replacementTaskID(replacement, rec)
			nextReplacement.ActiveTrackingDegraded = projection.TrackingDegraded
			nextReplacement.ActiveReportRevision = projection.ReportRevision
			nextReplacement.ActiveDegradedInterop = projection.DegradedInterop
			nextReplacement.ActiveDelivery = privatePendingReplacementDelivery(projection)
			if projection.InterOp != nil {
				interop := *projection.InterOp
				nextReplacement.ActiveInterop = &interop
			}
			if nextStatus != "INPUT_REQUIRED" {
				nextReplacement.ActiveA2UI = nil
			}
		}
		encoded, err := marshalPersistedProjectionWithContext(publicProjection, &next)
		if err != nil {
			return err
		}
		result := model.DB(ctx).WithContext(ctx).Model(&model.QuestionAgentLog{}).
			Where(botProjectionCASPredicate, stored.Id, username, stored.BotReportRevision, stored.BotProjectionJSON).
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

// applyBotRunProjection is the single Bot-run reconciliation path used by the
// cron poller and the legacy update-log endpoint. It decodes the bounded run
// projection once, merges it through the owner-scoped revision CAS, and only
// writes non-blank compatibility columns so partial/older snapshots cannot
// erase a report or invent an artifact URL.
func (ps *Service) applyBotRunProjection(ctx context.Context, row *model.QuestionAgentLog, rec *rxBot.RunRecord, meta rxBot.ResponseMeta) error {
	if row == nil || rec == nil {
		return errors.New("bot projection requires a row and run record")
	}
	if strings.TrimSpace(row.UserName) == "" {
		return errors.New("bot projection row has no owner")
	}

	statusPresent := strings.TrimSpace(rec.Status) != ""
	decodeRecord := *rec
	if !statusPresent {
		// Update-log is a best-effort compatibility endpoint. Preserve its
		// historical behavior for a response with no status by decoding against
		// the already-persisted state, while deliberately omitting a status write.
		decodeRecord.Status = row.Status
		if strings.TrimSpace(decodeRecord.Status) == "" {
			decodeRecord.Status = "running"
		}
	}
	projection, err := DecodeRunProjection(&decodeRecord)
	if err != nil {
		return err
	}
	if projection.RunID != strings.TrimSpace(row.BotRunId) {
		return fmt.Errorf("bot projection run id %q does not match row", projection.RunID)
	}
	projection.RequestID = strings.TrimSpace(meta.BotRequestID)
	logBotResponseMeta(ctx, meta)

	for attempt := 0; attempt < botProjectionApplyAttempts; attempt++ {
		if err := saveBotRunProjectionForRun(ctx, row.UserName, row.Id, row.BotRunId, projection); err != nil {
			return err
		}
		// SaveBotRunProjection may have merged an equal/older snapshot into a
		// newer concurrent projection. Read the CAS winner back before touching
		// legacy answer/artifact columns; otherwise a stale poll could overwrite
		// the durable projection's visible report even though the JSON CAS was
		// correctly rejected.
		storedProjection, err := LoadBotRunProjection(ctx, row.UserName, row.Id)
		if err != nil {
			return err
		}
		updates := botProjectionLegacyUpdates(projection, storedProjection, rec, statusPresent)
		if len(updates) == 0 {
			return nil
		}
		result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
			Where("id = ? AND user_name = ? AND bot_report_revision = ? AND bot_run_id = ?", row.Id, row.UserName, storedProjection.ReportRevision, row.BotRunId).
			Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 1 {
			return nil
		}
	}
	return ErrBotProjectionConflict
}

func botProjectionLegacyUpdates(incoming, stored BotRunProjection, rec *rxBot.RunRecord, statusPresent bool) map[string]interface{} {
	updates := make(map[string]interface{})
	if statusPresent && stored.Status != "" {
		businessStatus := stored.Status
		if projectionHasPendingRequiredDelivery(stored) && !isProjectionFailureStatus(stored.Status) {
			businessStatus = businessStatusForPendingDelivery(stored.Status)
		}
		updates["status"] = businessStatus
	}

	visible := strings.TrimSpace(stored.VisibleReport())
	if visible != "" {
		formatted, _, hasFormatted := rxBot.ParseRunFormatted(rec.Result)
		if strings.TrimSpace(incoming.VisibleReport()) != visible {
			hasFormatted = false
		}
		if hasFormatted {
			if shaped := rxBot.ShapeAnswer(stored.Agent, stored.VisibleReport(), formatted); shaped != "" {
				updates["answer"] = shaped
			}
		} else if shaped := rxBot.ShapeAnswer(stored.Agent, stored.VisibleReport(), nil); shaped != "" {
			updates["answer"] = shaped
		}
		if hasFormatted && len(formatted.FollowUpQuestions) > 0 && strings.TrimSpace(string(formatted.FollowUpQuestions)) != "" && strings.TrimSpace(string(formatted.FollowUpQuestions)) != "null" {
			updates["follow_up_questions"] = string(formatted.FollowUpQuestions)
		}
	}

	if !stored.ResultArchiveV1 {
		if len(stored.Artifacts.Directories) > 0 && strings.TrimSpace(stored.Artifacts.Directories[0]) != "" {
			updates["download_path"] = stored.Artifacts.Directories[0]
		}
		if len(stored.Artifacts.Paths) > 0 {
			if encoded, err := json.Marshal(stored.Artifacts.Paths); err == nil {
				updates["image_paths"] = string(encoded)
			}
		}
	}
	return updates
}

func taskLogMatchesID(log map[string]interface{}, taskID string) bool {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return false
	}
	for _, key := range []string{"task_id", "id"} {
		value, ok := log[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case string:
			if strings.TrimSpace(typed) == taskID {
				return true
			}
		case json.Number:
			if typed.String() == taskID {
				return true
			}
		case float64:
			if fmt.Sprintf("%g", typed) == taskID {
				return true
			}
		}
	}
	return false
}

func taskLogHasExplicitID(log map[string]interface{}) bool {
	for _, key := range []string{"task_id", "id"} {
		if _, ok := log[key]; ok {
			return true
		}
	}
	return false
}

func encodeMatchingTaskLog(logs *rxBot.RunLogsResponse, taskID string) (string, bool) {
	if logs == nil {
		return "", false
	}
	for index, log := range logs.TaskLogs {
		if taskLogMatchesID(log, taskID) {
			encoded, err := json.Marshal(log)
			if err != nil || len(encoded) == 0 {
				return "", false
			}
			return string(encoded), true
		}
		// Prefer an explicit child id over positional inference. If Bot gives a
		// different explicit id, the entry cannot belong to this update-log task
		// even when its array index happens to line up.
		if _, hasTaskID := log["task_id"]; hasTaskID {
			continue
		}
		if _, hasID := log["id"]; hasID {
			continue
		}
		if index >= len(logs.TaskIDs) || strings.TrimSpace(logs.TaskIDs[index]) != strings.TrimSpace(taskID) {
			continue
		}
		encoded, err := json.Marshal(log)
		if err != nil || len(encoded) == 0 {
			return "", false
		}
		return string(encoded), true
	}
	// Bot's reconciled payload is allowed to omit the child id because the
	// sibling `task_ids` array carries the identity. A single returned log is
	// therefore safe to associate with the update-log task; with multiple
	// sparse logs, only the index-aligned branch above is deterministic.
	if len(logs.TaskLogs) == 1 && len(logs.TaskIDs) == 1 && strings.TrimSpace(logs.TaskIDs[0]) == strings.TrimSpace(taskID) && !taskLogHasExplicitID(logs.TaskLogs[0]) {
		encoded, err := json.Marshal(logs.TaskLogs[0])
		if err == nil && len(encoded) > 0 {
			return string(encoded), true
		}
	}
	return "", false
}

// QueryAnalystUpdateLog syncs a finished remote task's result back into the
// Web row. The Web app posts both task_id and compute_resource.
func (ps *Service) QueryAnalystUpdateLog(ctx context.Context, username, taskID, computeResource string) (string, error) {
	if rxBot.BotConfig == nil || !rxBot.BotConfig.ProxyEnabled {
		return "", ErrGatewayDisabled
	}
	var row model.QuestionAgentLog
	if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where("user_name = ? AND task_id = ?", username, taskID).First(&row).Error; err != nil {
		return "", err
	}
	if row.BotRunId == "" {
		return "", ErrMissingBotRunID
	}
	client := rxBot.NewClient()
	rec, meta, err := client.GetRunWithMeta(ctx, row.BotRunId)
	if err != nil {
		return "", err
	}
	if err := ps.applyBotRunProjection(ctx, &row, rec, meta); err != nil {
		return "", err
	}

	updates := map[string]interface{}{
		"compute_resource": computeResource,
		"log_status":       "sync_succeeded",
	}
	if logs, logsErr := client.GetRunLogs(ctx, row.BotRunId); logsErr == nil {
		if taskLog, ok := encodeMatchingTaskLog(logs, taskID); ok {
			updates["task_log"] = taskLog
		}
	} else {
		// Run logs are a compatibility enrichment. Bot documents a sparse,
		// best-effort logs response; a log-service outage must not discard the
		// already-reconciled run projection.
		rxLog.SugarContext(ctx).Warnw("Bot run logs unavailable", "run_id", row.BotRunId, "err", logsErr)
	}
	if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where("id = ? AND user_name = ?", row.Id, row.UserName).
		Updates(updates).Error; err != nil {
		return "", err
	}

	projection, projectionErr := LoadBotRunProjection(ctx, username, row.Id)
	if projectionErr != nil {
		return "", projectionErr
	}
	if strings.TrimSpace(projection.VisibleReport()) == "" {
		return "", nil
	}
	formatted, _, hasFormatted := rxBot.ParseRunFormatted(rec.Result)
	if hasFormatted {
		return rxBot.ShapeAnswer(projection.Agent, projection.VisibleReport(), formatted), nil
	}
	return rxBot.ShapeAnswer(projection.Agent, projection.VisibleReport(), nil), nil
}

// persistOwnerAllocatedQuestionLog settles a preallocated owner row without
// replacing its private key envelope. A staged replacement is promoted to the
// public row and resets the stale Bot lifecycle projection atomically.
func (ps *Service) persistOwnerAllocatedQuestionLog(
	ctx context.Context,
	username string,
	submission *v1Submission,
	row *model.QuestionAgentLog,
	conversationV1 bool,
) (int64, error) {
	if submission == nil || submission.row.Id == 0 {
		return 0, ErrDuplicateClientTurn
	}
	id := submission.row.Id
	err := model.DB(ctx).WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var stored model.QuestionAgentLog
		if err := tx.Where(
			"id = ? AND user_name = ? AND dialogue_id = ? AND delete_at IS NULL",
			id,
			username,
			submission.row.DialogueId,
		).First(&stored).Error; err != nil {
			return err
		}
		projection, private, err := unmarshalPersistedProjectionWithContext(
			stored.BotProjectionJSON,
		)
		if err != nil {
			return err
		}
		if private == nil {
			return ErrDuplicateClientTurn
		}
		if ownerTaskAlreadyCancelled(&stored) {
			updates := map[string]interface{}{}
			if strings.TrimSpace(row.BotRunId) != "" && strings.TrimSpace(stored.BotRunId) == "" {
				updates["bot_run_id"] = row.BotRunId
			}
			if strings.TrimSpace(row.Answer) != "" && strings.TrimSpace(stored.Answer) == "" {
				updates["answer"] = row.Answer
			}
			if strings.TrimSpace(row.FollowUpQuestions) != "" &&
				strings.TrimSpace(stored.FollowUpQuestions) == "" {
				updates["follow_up_questions"] = row.FollowUpQuestions
			}
			if strings.TrimSpace(row.ToolName) != "" {
				updates["tool_name"] = row.ToolName
			}
			if len(updates) == 0 {
				return nil
			}
			result := tx.Model(&model.QuestionAgentLog{}).
				Where(
					"id = ? AND user_name = ? AND dialogue_id = ? AND delete_at IS NULL AND bot_projection_json = ?",
					id,
					username,
					submission.row.DialogueId,
					stored.BotProjectionJSON,
				).
				Updates(updates)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrDuplicateClientTurn
			}
			return nil
		}
		replacement := private.Replacement
		next := private.clone()
		if replacement != nil {
			projection = BotRunProjection{ReportRevision: -1}
			retired := append([]persistedClientTurnIdentity(nil), private.RetiredIdentities...)
			if private.ClientTurnID != "" {
				if private.RequestFingerprint == "" || len(retired) >= maxPersistedRetiredClientTurns {
					return ErrDuplicateClientTurn
				}
				retired = append(retired, persistedClientTurnIdentity{
					ClientTurnID:       private.ClientTurnID,
					RequestFingerprint: private.RequestFingerprint,
				})
			}
			next = persistedConversationContext{
				ClientTurnID:       replacement.ClientTurnID,
				RequestFingerprint: replacement.RequestFingerprint,
				InputAttachments:   append([]rxBot.AssetAttachmentRef(nil), replacement.InputAttachments...),
				InteropMode:        replacement.InteropMode,
				InteropTargets:     append([]string(nil), replacement.InteropTargets...),
				RetiredIdentities:  retired,
			}
			if conversationV1 {
				next.ModeLockState = "locked"
				next.SettlementState = "submission_append"
			}
		} else {
			if conversationV1 {
				next.ModeLockState = "locked"
			} else {
				clearConversationV1Lifecycle(&next)
			}
		}
		raw, err := marshalPersistedProjectionWithContext(projection, &next)
		if err != nil {
			return err
		}
		updates := map[string]interface{}{
			"answer":              row.Answer,
			"bot_projection_json": raw,
			"bot_report_revision": projection.ReportRevision,
			"bot_run_id":          row.BotRunId,
			"collect_type":        row.CollectType,
			"compute_resource":    row.ComputeResource,
			"dialogue_id":         row.DialogueId,
			"download_path":       row.DownloadPath,
			"f_id":                row.FId,
			"follow_up_questions": row.FollowUpQuestions,
			"log_status":          row.LogStatus,
			"mode":                row.Mode,
			"query":               row.Query,
			"reaction_type":       row.ReactionType,
			"server_file_path":    row.ServerFilePath,
			"server_id":           row.ServerId,
			"status":              row.Status,
			"task_id":             row.TaskId,
			"task_log":            row.TaskLog,
			"title_query":         row.TitleQuery,
			"tool_name":           row.ToolName,
		}
		if row.FileName != "" {
			updates["file_name"] = row.FileName
		}
		if row.UploadPath != "" {
			updates["upload_path"] = row.UploadPath
		}
		if replacement != nil {
			if replacement.FileName != "" {
				updates["file_name"] = replacement.FileName
			}
			if replacement.UploadPath != "" {
				updates["upload_path"] = replacement.UploadPath
			}
		}
		if replacement != nil && row.TitleQuery == "" {
			delete(updates, "title_query")
		}
		result := tx.Model(&model.QuestionAgentLog{}).
			Where(
				"id = ? AND user_name = ? AND dialogue_id = ? AND delete_at IS NULL AND bot_projection_json = ?",
				id,
				username,
				submission.row.DialogueId,
				stored.BotProjectionJSON,
			).
			Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrDuplicateClientTurn
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return id, nil
}

// persistQuestionLog writes one QuestionAgentLog row, shared by the blocking
// Query and streaming QueryStream paths: a plain INSERT on a fresh turn, or a
// two-step UPDATE on refresh (struct Updates for the row, then an explicit map
// Updates to clear the transitional task columns — server_id/task_id/
// log_status/server_file_path — which struct Updates would skip as zero
// values, stranding a prior agent type's identifiers on a re-answered turn).
// It returns the row id (the refresh id on update, the new autoincrement id on
// insert). Callers build `row` with their own column values; this helper owns
// only the persistence branch so the two paths cannot drift.
func (ps *Service) persistQuestionLog(ctx context.Context, username string, refreshID int64, row *model.QuestionAgentLog) (int64, error) {
	if refreshID != 0 {
		if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
			Where("id = ? AND user_name = ?", refreshID, username).Updates(row).Error; err != nil {
			return 0, err
		}
		if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
			Where("id = ? AND user_name = ?", refreshID, username).
			Updates(map[string]interface{}{
				"server_id":        row.ServerId,
				"task_id":          row.TaskId,
				"log_status":       row.LogStatus,
				"server_file_path": "",
			}).Error; err != nil {
			return 0, err
		}
		return refreshID, nil
	}
	if err := model.DB(ctx).Create(row).Error; err != nil {
		return 0, err
	}
	return row.Id, nil
}

func nonterminalStreamRetryStatus(status string) bool {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "SUBMITTING", "PENDING", "QUEUED", "PREPARING", "RESOLVING_INPUTS", "PLANNING", "RUNNING", "INPUT_REQUIRED", "FINALIZING":
		return true
	default:
		return false
	}
}

func forwardStoredAGUIEvent(
	forward func([]byte) error,
	eventType string,
	payload map[string]interface{},
) error {
	payload["type"] = eventType
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	frame := make([]byte, 0, len(eventType)+len(encoded)+16)
	frame = append(frame, "event: "...)
	frame = append(frame, eventType...)
	frame = append(frame, '\n')
	frame = append(frame, "data: "...)
	frame = append(frame, encoded...)
	frame = append(frame, '\n', '\n')
	if forward == nil {
		return nil
	}
	return forward(frame)
}

const storedStreamReplayChunkBytes = 64 << 10

func forEachStoredUTF8Chunk(value string, emit func(string) error) error {
	if value == "" || !utf8.ValidString(value) {
		return nil
	}
	for len(value) > 0 {
		end := len(value)
		if end > storedStreamReplayChunkBytes {
			end = storedStreamReplayChunkBytes
			for end > 0 && !utf8.ValidString(value[:end]) {
				end--
			}
		}
		if end == 0 {
			return nil
		}
		if err := emit(value[:end]); err != nil {
			return err
		}
		value = value[end:]
	}
	return nil
}

func replayStoredStreamSnapshot(out *QueryData, forward func([]byte) error) error {
	if out == nil {
		return ErrDuplicateClientTurn
	}
	runID := strings.TrimSpace(out.BotRunID)
	if err := validatePersistedASCII("stream replay run id", runID, maxProjectionRunID); err != nil {
		runID = ""
	}
	if runID != "" {
		if err := forwardStoredAGUIEvent(forward, "RunStarted", map[string]interface{}{
			"run_id":      runID,
			"dialogue_id": out.DialogueId,
		}); err != nil {
			return err
		}
	}
	if err := forEachStoredUTF8Chunk(out.Answer, func(chunk string) error {
		return forwardStoredAGUIEvent(forward, "TextMessageContent", map[string]interface{}{
			"delta": chunk,
		})
	}); err != nil {
		return err
	}
	if followUp := strings.TrimSpace(out.FollowUpQuestions); followUp != "" && len(followUp) <= maxPersistedReplacementFollowUpBytes {
		var questions []string
		if json.Unmarshal([]byte(followUp), &questions) == nil && questions != nil {
			if err := forwardStoredAGUIEvent(forward, "Custom", map[string]interface{}{
				"name":  "phyto.follow_up",
				"value": questions,
			}); err != nil {
				return err
			}
		}
	}
	if strings.EqualFold(strings.TrimSpace(out.Status), statusSucceeded) {
		payload := map[string]interface{}{}
		if runID != "" {
			payload["run_id"] = runID
		}
		return forwardStoredAGUIEvent(forward, "RunFinished", payload)
	}
	return forwardStoredAGUIEvent(forward, "RunError", map[string]interface{}{
		"code": "stored_run_terminal",
	})
}

// QueryStream is the SSE variant of Query for chat-family slugs. V1 and keyed
// V0 allocate an owner row before opening Bot. Fresh keyed V0 submissions then
// promote that row to RUNNING, while a keyed replacement keeps the prior public
// result visible and stages its active run privately until RunFinished. Keyless
// legacy V0 still creates or refreshes its RUNNING row before onReady. All paths
// publish the durable identity through onReady, then forward each raw frame
// while teeing it into an accumulator. RunStarted is persisted before it is
// forwarded, so the A2UI dialogue + user + run authorization boundary is live
// before an interactive frame reaches the browser. A forward() error stops
// forwarding but never aborts the Bot read or durable finalization.
func (ps *Service) QueryStream(
	ctx context.Context,
	username string,
	in QueryInput,
	onReady func(StreamIdentity),
	forward func(frame []byte) error,
) (*QueryData, error) {
	conversationV1 := multiturnV1Enabled(in)
	attachments, err := validateQueryAttachments(in.Attachments)
	if err != nil {
		return nil, err
	}
	in.Attachments = attachments
	if conversationV1 {
		if err := validateV1ClientTurnID(in.ClientTurnID); err != nil {
			return nil, err
		}
		if err := validateV1CurrentMessage(in.Query); err != nil {
			return nil, err
		}
		in.ClientTurnID = strings.TrimSpace(in.ClientTurnID)
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
	if !conversationV1 && serviceClientTurnIDPattern.MatchString(strings.TrimSpace(in.ClientTurnID)) {
		in.ClientTurnID = strings.TrimSpace(in.ClientTurnID)
	}
	ownerAllocated := ownerAllocatedSubmissionEnabled(in)
	if in.Mode == "expert" && strings.TrimSpace(in.Tool) == "" {
		// Autonomous Expert still requires RouteQuery and has no streaming
		// primitive. Only a forced, stream-capable chat-family tool may continue.
		return nil, fmt.Errorf("%w: autonomous expert mode", ErrStreamUnsupported)
	}
	if rxBot.BotConfig == nil || !rxBot.BotConfig.ProxyEnabled {
		return nil, ErrGatewayDisabled
	}
	// Enforce the effective routed tool before any upload, dialogue lookup, or
	// Bot stream. Instant is locked to ChatAgent; forced Expert retains its
	// selected canonical tool and the same server-side permission boundary.
	permissions, err := ps.ResolveAgentPermissions(ctx, username)
	if err != nil {
		return nil, fmt.Errorf("resolve agent permissions: %w", err)
	}
	effectiveTool := "ChatAgent"
	if in.Mode == "expert" {
		effectiveTool = in.Tool
	}
	if !containsAgentTool(permissions.AllowedTools, effectiveTool) {
		return nil, permissionFailure(permissions, effectiveTool)
	}
	var target v1SubmissionTarget
	if ownerAllocated {
		target, err = ps.resolveV1SubmissionTarget(ctx, username, in, conversationV1)
		if err != nil {
			return nil, err
		}
		in.Mode = target.mode
	}
	slug, ok := rxBot.SlugFor(in.Tool)
	if !ok {
		return nil, fmt.Errorf("%w %q", ErrUnknownTool, in.Tool)
	}
	resolvedTool := slugToToolName[slug]
	if in.Mode == "instant" && resolvedTool != "ChatAgent" {
		return nil, ErrInvalidChatRouting
	}
	if in.Mode == "expert" && resolvedTool != in.Tool {
		return nil, ErrInvalidChatRouting
	}
	chatModel, streamCapable := rxBot.StreamModelFor(slug)
	if !streamCapable {
		// Slugs without an approved stream model stay on their blocking path.
		return nil, fmt.Errorf("%w: tool %q has no Bot streaming primitive (handoff P1)", ErrStreamUnsupported, in.Tool)
	}
	if err := ps.requireAdvertisedStreamingCapability(ctx, slug); err != nil {
		return nil, err
	}

	var submission *v1Submission
	if ownerAllocated {
		submission, err = ps.allocateOwnerSubmission(
			ctx,
			username,
			in,
			target,
			permissions,
			conversationV1,
		)
		if err != nil {
			return nil, err
		}
		if submission.pending {
			if onReady != nil {
				onReady(StreamIdentity{
					DialogueID: submission.row.DialogueId,
					MessageID:  submission.row.Id,
				})
			}
			return submission.duplicate, ErrClientTurnSubmissionPending
		}
		if submission.duplicate != nil {
			if nonterminalStreamRetryStatus(submission.duplicate.Status) {
				return nil, ErrClientTurnSubmissionPending
			}
			if onReady != nil {
				onReady(StreamIdentity{
					DialogueID: submission.row.DialogueId,
					MessageID:  submission.row.Id,
				})
			}
			if err := replayStoredStreamSnapshot(submission.duplicate, forward); err != nil {
				return nil, err
			}
			return submission.duplicate, nil
		}
	}
	streamReplacement := submission != nil && submission.replacement
	contextClient := rxBot.NewClient()

	var dialogueID string
	var fID int64
	if ownerAllocated {
		dialogueID = submission.row.DialogueId
		fID = submission.row.FId
	} else {
		dialogueID, fID, err = ps.resolveDialogue(ctx, username, in)
		if err != nil {
			return nil, err
		}
	}
	streamClient := newExecutionBotClient(
		rxBot.BotConfig,
		in.Mode,
		in.Tool,
		slug,
		permissions.AllowedTools,
	)

	req := rxBot.ChatCompletionRequest{
		Model:        chatModel,
		Messages:     chatMessagesForRequest(in.History, in.Query),
		DialogueID:   dialogueID,
		Attachments:  append([]rxBot.AssetAttachmentRef(nil), in.Attachments...),
		OwnerSubject: attachmentOwnerSubject(username, in.Attachments),
	}
	instantConversation := conversationV1 && instantChatConversationStream(in, slug)
	if instantConversation {
		req.Messages = []rxBot.ChatMessage{{Role: "user", Content: in.Query}}
		req.Conversation = submission.envelope
	}
	if slug == "brief_gene" {
		// Keep the direct streaming request identical to the blocking BriefGene
		// route: only this model opts into free-form gene-id resolution.
		req.ResolveGeneID = true
	}
	var rc io.ReadCloser
	for {
		var meta rxBot.ResponseMeta
		rc, meta, err = streamClient.ChatCompletionStreamWithMeta(ctx, req)
		logBotResponseMeta(ctx, meta)
		if err == nil {
			break
		}
		if instantConversation {
			retry, retryErr := prepareV1ConversationRebuildRetry(
				ctx,
				username,
				submission,
				target,
				err,
			)
			if retryErr != nil {
				return nil, retryErr
			}
			if retry {
				req.Conversation = submission.envelope
				continue
			}
		}
		// Pre-first-byte failure (auth / unsupported) surfaces as a normal
		// error so the handler can still return a non-SSE status.
		return nil, v1SubmissionError(ctx, username, submission, err)
	}
	defer rc.Close()

	// The row must exist before any Bot frame is forwarded. Besides making the
	// response identity authoritative, this closes the former A2UI window where
	// a widget was visible while its authorization tuple did not exist yet.
	var id int64
	if conversationV1 || streamReplacement {
		id = submission.row.Id
	} else {
		titleQuery := ""
		if fID == 0 && in.RefreshId == 0 {
			titleQuery = conversationTitle(in.Query)
		}
		row := model.QuestionAgentLog{
			DialogueId:        dialogueID,
			FId:               fID,
			UserName:          username,
			Query:             in.Query,
			TitleQuery:        titleQuery,
			Answer:            "",
			FollowUpQuestions: "",
			ToolName:          slugToToolName[slug],
			Status:            "RUNNING",
			Mode:              in.Mode,
			ReactionType:      "0",
			CollectType:       "0",
		}
		if ownerAllocated {
			id, err = ps.persistOwnerAllocatedQuestionLog(
				ctx,
				username,
				submission,
				&row,
				false,
			)
		} else {
			row.BotProjectionJSON, err = attachmentProjectionJSON(in.Attachments)
			if err == nil {
				id, err = ps.beginQuestionStream(ctx, username, in.RefreshId, &row)
			}
		}
		if err != nil {
			return nil, err
		}
	}
	identity := StreamIdentity{DialogueID: dialogueID, MessageID: id}
	if onReady != nil {
		onReady(identity)
	}

	// Forward + tee, splitting the SSE body on blank-line frame separators. The
	// split token includes its original separator so the bytes reaching Web are
	// exactly the bytes Bot sent; only the accumulator parses a copy.
	expectedTurnID := ""
	if instantConversation {
		expectedTurnID = submission.envelope.TurnID
	}
	acc := rxBot.NewAGUIAccumulator(expectedTurnID)
	scanner := bufio.NewScanner(rc)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	scanner.Split(splitSSEFrames)
	forwarding := true
	persistedRunID := ""
	var streamErr error
	for scanner.Scan() {
		frame := scanner.Bytes()
		if ev, ok := rxBot.ParseAGUIFrame(frame); ok {
			acc.Observe(ev)
			if acc.ProtocolErr() != nil && streamErr == nil {
				streamErr = fmt.Errorf(
					"%w: %v",
					ErrInvalidConversationStage,
					acc.ProtocolErr(),
				)
			}
			if ev.Type == "RunStarted" && acc.RunID() == "" {
				streamErr = errors.New("RunStarted event is missing run_id")
				break
			}
			if ev.Type == "RunStarted" && acc.RunID() != persistedRunID {
				if streamReplacement {
					// Keep a replacement run inside the bounded private candidate;
					// the previously accepted public projection remains visible until
					// this stream proves RunFinished.
					_, err := persistReplacementActiveResult(ctx, username, submission, &QueryData{
						Id:           id,
						ToolName:     slugToToolName[slug],
						ReactionType: "0",
						DialogueId:   dialogueID,
						Status:       "RUNNING",
						BotRunID:     acc.RunID(),
						Attachments:  append([]rxBot.AssetAttachmentRef(nil), in.Attachments...),
					})
					if err != nil {
						streamErr = err
						break
					}
				} else {
					// Persist the cross-service join key before the browser can receive
					// RunStarted (and therefore before any later interactive frame).
					if err := ps.setQuestionStreamRunID(ctx, username, identity, acc.RunID()); err != nil {
						streamErr = err
						break
					}
				}
				persistedRunID = acc.RunID()
			}
		}
		// Forward the raw frame, including Bot's original separator, to the
		// browser. Never re-encode or normalize an AG-UI frame in the gateway.
		out := append([]byte(nil), frame...)
		if forwarding && forward != nil {
			if err := forward(out); err != nil {
				forwarding = false
			}
		}
	}

	// Ground the persisted status in what actually happened on the wire, not a
	// hardcoded optimism: a mid-stream read error (network drop, ctx cancel,
	// frame over the 1MB scanner cap) or a RunError event both mean the answer
	// is partial/failed. A blank status would strand the row out of the GA
	// cron's WHERE status='RUNNING' poll set, so use "FAILED" (a terminal
	// non-RUNNING state) rather than "" for these paths.
	status := statusSucceeded
	if scanErr := scanner.Err(); scanErr != nil {
		status = "FAILED"
		if streamErr == nil {
			streamErr = scanErr
		}
	} else if streamErr != nil || acc.Err() != nil {
		status = "FAILED"
	}
	if streamReplacement && status == statusSucceeded && !acc.Finished() {
		status = "FAILED"
		streamErr = fmt.Errorf(
			"%w: missing RunFinished",
			ErrInvalidConversationStage,
		)
	}
	if instantConversation && status == statusSucceeded {
		switch {
		case !acc.Finished():
			status = "FAILED"
			streamErr = fmt.Errorf(
				"%w: missing RunFinished",
				ErrInvalidConversationStage,
			)
		case acc.RunID() == "":
			status = "FAILED"
			streamErr = fmt.Errorf(
				"%w: missing run identity",
				ErrInvalidConversationStage,
			)
		case acc.ContextStage() == nil:
			status = "FAILED"
			streamErr = fmt.Errorf(
				"%w: missing phyto.context_staged",
				ErrInvalidConversationStage,
			)
		default:
			if err := validateV1ContextStage(
				submission.envelope,
				acc.ContextStage(),
				"ChatAgent",
			); err != nil {
				status = "FAILED"
				streamErr = err
			}
		}
	}
	// A Bot RunError is already terminal on the wire. Suppress any synthetic
	// handler error even if the transport reports a late read error after that
	// frame; the browser must see exactly one terminal error event.
	if acc.Err() != nil {
		streamErr = nil
	}
	retainSubmitting := instantConversation && streamErr != nil && acc.Err() == nil && !isV1DefiniteFailure(streamErr)

	// Finalize the row opened above. WithoutCancel preserves request-scoped DB
	// values while ensuring request cancellation cannot interrupt a terminal
	// settlement already proven by the complete Bot stream.
	out := &QueryData{
		Id:           id,
		ToolName:     slugToToolName[slug],
		ReactionType: "0",
		DialogueId:   dialogueID,
		Status:       status,
		BotRunID:     acc.RunID(),
		Attachments:  append([]rxBot.AssetAttachmentRef(nil), in.Attachments...),
	}
	if !conversationV1 || status == statusSucceeded {
		out.Answer = rxBot.ShapeAnswer(slug, acc.AnswerText(), nil)
		out.FollowUpQuestions = acc.FollowUpJSON()
	}
	if retainSubmitting {
		out.Status = "SUBMITTING"
		return out, streamErr
	}
	finalizeCtx, cancelFinalize := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
	defer cancelFinalize()
	if streamReplacement && status != statusSucceeded {
		if acc.Err() != nil {
			return persistReplacementTerminalResult(
				finalizeCtx,
				username,
				submission,
				out,
			)
		}
		// A read or protocol failure after RunStarted is ambiguous. Leave the
		// private active identity durable so an exact retry fails closed rather
		// than promoting a partial answer or dispatching a second Bot run.
		out.Status = "RUNNING"
		return out, streamErr
	}
	if instantConversation {
		if status != statusSucceeded {
			if err := failV1Submission(finalizeCtx, username, id); err != nil {
				return nil, err
			}
			return out, streamErr
		}
		stage := acc.ContextStage()
		settlementState := conversationSettlementAckPending
		if stage.ContextDegraded {
			settlementState = conversationSettlementRebuildRequired
		}
		private := persistedConversationContext{
			ClientTurnID:       in.ClientTurnID,
			RequestFingerprint: submission.requestFingerprint,
			Stage:              stage,
			SettlementState:    settlementState,
			AssistantSummary:   v1AssistantSummary(stage),
			ArtifactRefs:       append([]rxBot.ArtifactRefV1(nil), target.artifacts...),
			InputAttachments:   append([]rxBot.AssetAttachmentRef(nil), in.Attachments...),
		}
		if submission.envelope.Operation == "rebuild" {
			private.RebuildLedgerVersion = submission.envelope.LedgerVersion
			private.RebuildLedgerCursor = submission.envelope.LedgerCursor
		}
		private.SettlementLedgerHash = submission.envelope.LedgerVersion
		ledgerVersion, err := settleBlockingConversationContext(
			finalizeCtx,
			username,
			dialogueID,
			id,
			out,
			in.Mode,
			nil,
			private,
			in.Query,
		)
		if err != nil {
			return nil, err
		}
		if settlementState == conversationSettlementAckPending {
			_ = acknowledgeConversationContext(
				ctx,
				contextClient,
				username,
				dialogueID,
				id,
				ledgerVersion,
				stage,
			)
		}
		if err := ps.decorateConversationQueryData(finalizeCtx, username, out); err != nil {
			return nil, err
		}
		return out, nil
	}
	if streamReplacement {
		row := model.QuestionAgentLog{
			DialogueId:        dialogueID,
			FId:               fID,
			BotRunId:          acc.RunID(),
			UserName:          username,
			Query:             in.Query,
			Answer:            out.Answer,
			FollowUpQuestions: out.FollowUpQuestions,
			ToolName:          out.ToolName,
			Status:            out.Status,
			Mode:              in.Mode,
			ReactionType:      "0",
			CollectType:       "0",
		}
		if _, err := ps.persistOwnerAllocatedQuestionLog(
			finalizeCtx,
			username,
			submission,
			&row,
			false,
		); err != nil {
			return nil, err
		}
		return out, nil
	}
	if err := ps.finalizeQuestionStream(finalizeCtx, username, identity, acc.RunID(), out); err != nil {
		return nil, err
	}
	ps.adoptOwnerCancelIfPresent(finalizeCtx, username, id, out, acc.RunID())
	if streamErr != nil {
		return out, streamErr
	}
	return out, nil
}

func (ps *Service) requireAdvertisedStreamingCapability(ctx context.Context, slug string) error {
	response, err := ps.agentCatalogReader().GetAgents(ctx)
	if err != nil {
		return fmt.Errorf("%w: fetch Bot agent catalog: %v", ErrStreamUnsupported, err)
	}
	if _, err := rxBot.ValidateWebAgentDescriptors(response); err != nil {
		return fmt.Errorf("%w: validate Bot agent catalog: %v", ErrStreamUnsupported, err)
	}
	capability, ok := rxBot.FindAgentCapability(response, slug)
	if !ok || !capability.Streaming {
		return fmt.Errorf("%w: Bot agent %q does not advertise streaming", ErrStreamUnsupported, slug)
	}
	return nil
}

// beginQuestionStream creates a fresh row or moves a refresh target into
// RUNNING before the first frame. Refresh explicitly clears the prior answer
// and bot_run_id because GORM struct updates skip zero values; retaining either
// would expose stale content or authorize actions against the previous run.
func (ps *Service) beginQuestionStream(ctx context.Context, username string, refreshID int64, row *model.QuestionAgentLog) (int64, error) {
	if refreshID == 0 {
		if err := model.DB(ctx).Create(row).Error; err != nil {
			return 0, err
		}
		return row.Id, nil
	}
	updates := map[string]interface{}{
		"answer":              "",
		"bot_run_id":          "",
		"collect_type":        row.CollectType,
		"f_id":                row.FId,
		"follow_up_questions": "",
		"log_status":          "",
		"mode":                row.Mode,
		"query":               row.Query,
		"reaction_type":       row.ReactionType,
		"server_file_path":    "",
		"server_id":           "",
		"status":              row.Status,
		"task_id":             "",
		"title_query":         row.TitleQuery,
		"tool_name":           row.ToolName,
	}
	if row.FileName != "" {
		updates["file_name"] = row.FileName
	}
	if row.UploadPath != "" {
		updates["upload_path"] = row.UploadPath
	}
	if row.BotProjectionJSON != "" {
		updates["bot_projection_json"] = row.BotProjectionJSON
		updates["bot_report_revision"] = row.BotReportRevision
	}
	result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where("id = ? AND user_name = ? AND dialogue_id = ?", refreshID, username, row.DialogueId).
		Updates(updates)
	if result.Error != nil {
		return 0, result.Error
	}
	if result.RowsAffected != 1 {
		var count int64
		if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
			Where("id = ? AND user_name = ? AND dialogue_id = ?", refreshID, username, row.DialogueId).
			Count(&count).Error; err != nil {
			return 0, err
		}
		if count != 1 {
			return 0, fmt.Errorf("stream row %d not found", refreshID)
		}
	}
	return refreshID, nil
}

func (ps *Service) setQuestionStreamRunID(ctx context.Context, username string, identity StreamIdentity, runID string) error {
	result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where("id = ? AND user_name = ? AND dialogue_id = ?", identity.MessageID, username, identity.DialogueID).
		Update("bot_run_id", runID)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("stream row %d not found", identity.MessageID)
	}
	var stored model.QuestionAgentLog
	if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Select("id, user_name, bot_run_id, status, bot_projection_json").
		Where("id = ? AND user_name = ?", identity.MessageID, username).
		Take(&stored).Error; err == nil && ownerTaskAlreadyCancelled(&stored) {
		ps.cancelKnownOwnerRun(ctx, runID)
	}
	return nil
}

func (ps *Service) finalizeQuestionStream(
	ctx context.Context,
	username string,
	identity StreamIdentity,
	runID string,
	out *QueryData,
) error {
	var stored model.QuestionAgentLog
	if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Select("id, user_name, bot_run_id, status, answer, bot_projection_json").
		Where("id = ? AND user_name = ? AND dialogue_id = ?", identity.MessageID, username, identity.DialogueID).
		Take(&stored).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return fmt.Errorf("stream row %d not found", identity.MessageID)
		}
		return err
	}
	updates := map[string]interface{}{
		"answer":              out.Answer,
		"bot_run_id":          runID,
		"follow_up_questions": out.FollowUpQuestions,
	}
	if !ownerTaskAlreadyCancelled(&stored) {
		updates["status"] = out.Status
	}
	result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where("id = ? AND user_name = ? AND dialogue_id = ?", identity.MessageID, username, identity.DialogueID).
		Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("stream row %d not found", identity.MessageID)
	}
	return nil
}

func (ps *Service) adoptOwnerCancelIfPresent(
	ctx context.Context,
	username string,
	rowID int64,
	out *QueryData,
	runID string,
) {
	if out == nil || rowID <= 0 || strings.TrimSpace(username) == "" {
		return
	}
	row, err := loadAgentTaskLifecycleRow(ctx, rowID, username)
	if err != nil || !ownerTaskAlreadyCancelled(row) {
		return
	}
	out.Status = "CANCELLED"
	cancelID := strings.TrimSpace(row.BotRunId)
	if cancelID == "" {
		cancelID = strings.TrimSpace(runID)
	}
	ps.cancelKnownOwnerRun(ctx, cancelID)
}

func (ps *Service) cancelKnownOwnerRun(ctx context.Context, runID string) {
	runID = strings.TrimSpace(runID)
	if runID == "" || ps.agentRunCanceller() == nil {
		return
	}
	_, _, _ = ps.agentRunCanceller().CancelRunWithMeta(context.WithoutCancel(ctx), runID)
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
