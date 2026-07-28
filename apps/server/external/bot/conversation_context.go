package bot

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

const (
	maxConversationCurrentMessageChars = 32_768
	maxConversationRequestIDChars      = 128
	maxConversationAllowedAgents       = 10
	maxConversationHistoryEntries      = 200
	maxConversationArtifactRefs        = 50
	maxConversationSummaryChars        = 4 * 1024
	maxConversationMetadataChars       = 512
	maxContextRouteReasonCodeChars     = 64
)

var (
	conversationTurnIDPattern      = regexp.MustCompile(`^[1-9][0-9]{0,18}$`)
	conversationLedgerPattern      = regexp.MustCompile(`^[a-f0-9]{64}$`)
	conversationArtifactIDPattern  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
	conversationRouteReasonPattern = regexp.MustCompile(`^[A-Z][A-Z0-9_]*$`)
	conversationURISchemePattern   = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9+.-]*:`)
)

// CurrentMessageV1 is the owner-scoped current user message in a V1 envelope.
type CurrentMessageV1 struct {
	Content string `json:"content"`
	Locale  string `json:"locale"`
}

// LedgerEntryV1 is one bounded history item. Content and Summary preserve the
// Bot contract's compatibility shape for full and summary-only entries.
type LedgerEntryV1 struct {
	TurnID  string `json:"turn_id"`
	Role    string `json:"role"`
	Content string `json:"content,omitempty"`
	Summary string `json:"summary,omitempty"`
}

// ArtifactRefV1 identifies an authorized artifact without exposing storage
// paths, bucket names, credentials, or binary content.
type ArtifactRefV1 struct {
	ArtifactID  string `json:"artifact_id"`
	DisplayName string `json:"display_name"`
}

// ConversationEnvelopeV1 is the versioned Go-to-Bot context contract.
type ConversationEnvelopeV1 struct {
	SchemaVersion              int              `json:"schema_version"`
	ConversationKey            string           `json:"conversation_key"`
	DialogueID                 string           `json:"dialogue_id"`
	TurnID                     string           `json:"turn_id"`
	RequestID                  string           `json:"request_id"`
	Operation                  string           `json:"operation"`
	Mode                       string           `json:"mode"`
	CurrentMessage             CurrentMessageV1 `json:"current_message"`
	RequestedAgentID           *string          `json:"requested_agent_id"`
	AllowedAgentIDs            []string         `json:"allowed_agent_ids"`
	LedgerCursor               int64            `json:"ledger_cursor"`
	LedgerVersion              string           `json:"ledger_version"`
	BaseBusinessContextVersion int64            `json:"base_business_context_version"`
	HistoryDelta               []LedgerEntryV1  `json:"history_delta"`
	ArtifactRefs               []ArtifactRefV1  `json:"artifact_refs"`
}

// ContextStageMetadata is the bounded terminal metadata Bot attaches to a V1
// response after selecting and staging an agent result.
type ContextStageMetadata struct {
	SchemaVersion                  int    `json:"schema_version"`
	TurnID                         string `json:"turn_id"`
	SelectedAgentID                string `json:"selected_agent_id"`
	RouteSource                    string `json:"route_source"`
	RouteReasonCode                string `json:"route_reason_code"`
	BaseBusinessContextVersion     int64  `json:"base_business_context_version"`
	ProposedBusinessContextVersion int64  `json:"proposed_business_context_version"`
	LastAppliedLedgerCursor        int64  `json:"last_applied_ledger_cursor"`
	ContextTruncated               bool   `json:"context_truncated"`
	ContextRebuilt                 bool   `json:"context_rebuilt"`
	ContextDegraded                bool   `json:"context_degraded"`
}

// ContextSettlementRequest acknowledges one staged Bot context mutation.
type ContextSettlementRequest struct {
	SchemaVersion   int    `json:"schema_version"`
	ConversationKey string `json:"conversation_key"`
	TurnID          string `json:"turn_id"`
	LedgerVersion   string `json:"ledger_version"`
}

// ContextTombstoneRequest deletes one Bot-owned conversation context.
type ContextTombstoneRequest struct {
	SchemaVersion   int    `json:"schema_version"`
	ConversationKey string `json:"conversation_key"`
}

// ContextMutationResponse is the bounded public result of a context mutation.
type ContextMutationResponse struct {
	SchemaVersion  int    `json:"schema_version"`
	State          string `json:"state"`
	ContextVersion int64  `json:"context_version"`
}

var ErrConversationContextRebuildRequired = errors.New("bot conversation context rebuild required")

func (e *APIError) Is(target error) bool {
	return target == ErrConversationContextRebuildRequired && e != nil && e.Code == "conversation_context_rebuild_required"
}

// IsConversationContextRebuildRequired recognizes Bot's typed one-retry signal.
func IsConversationContextRebuildRequired(err error) bool {
	return errors.Is(err, ErrConversationContextRebuildRequired)
}

func stringLength(value string) int {
	return utf8.RuneCountInString(value)
}

func validTurnID(value string) bool {
	return conversationTurnIDPattern.MatchString(value)
}

func validCanonicalAgent(value string) bool {
	for _, tool := range CanonicalAgentTool {
		if tool == value {
			return true
		}
	}
	return false
}

func validateCurrentMessage(value CurrentMessageV1) error {
	if stringLength(value.Content) < 1 || stringLength(value.Content) > maxConversationCurrentMessageChars {
		return fmt.Errorf("current message content exceeds bounds")
	}
	if value.Locale != "en-US" && value.Locale != "zh-CN" {
		return fmt.Errorf("unsupported conversation locale")
	}
	return nil
}

func validateLedgerEntry(value LedgerEntryV1) error {
	if !validTurnID(value.TurnID) {
		return fmt.Errorf("invalid ledger turn id")
	}
	if value.Role != "user" && value.Role != "assistant" {
		return fmt.Errorf("invalid ledger role")
	}
	if value.Content == "" && value.Summary == "" {
		return fmt.Errorf("ledger entry requires content or summary")
	}
	if stringLength(value.Content) > maxConversationCurrentMessageChars || stringLength(value.Summary) > maxConversationSummaryChars {
		return fmt.Errorf("ledger entry text exceeds bounds")
	}
	return nil
}

func validateArtifactRef(value ArtifactRefV1) error {
	if !conversationArtifactIDPattern.MatchString(value.ArtifactID) {
		return fmt.Errorf("invalid artifact id")
	}
	if stringLength(value.DisplayName) < 1 || stringLength(value.DisplayName) > maxConversationMetadataChars {
		return fmt.Errorf("artifact display name exceeds bounds")
	}
	if strings.ContainsAny(value.DisplayName, `/\\`) || conversationURISchemePattern.MatchString(value.DisplayName) {
		return fmt.Errorf("artifact display name must not contain a path or URI")
	}
	return nil
}

// Validate checks the bounded invariants enforced by Bot's Pydantic DTO.
func (e ConversationEnvelopeV1) Validate() error {
	if e.SchemaVersion != 1 {
		return fmt.Errorf("unsupported conversation schema version")
	}
	if _, err := uuid.Parse(e.ConversationKey); err != nil {
		return fmt.Errorf("invalid conversation key: %w", err)
	}
	if _, err := uuid.Parse(e.DialogueID); err != nil {
		return fmt.Errorf("invalid dialogue id: %w", err)
	}
	if !validTurnID(e.TurnID) {
		return fmt.Errorf("invalid conversation turn id")
	}
	if stringLength(e.RequestID) < 1 || stringLength(e.RequestID) > maxConversationRequestIDChars {
		return fmt.Errorf("request id exceeds bounds")
	}
	if e.Operation != "append" && e.Operation != "replace" && e.Operation != "rebuild" {
		return fmt.Errorf("invalid conversation operation")
	}
	if e.Mode != "instant" && e.Mode != "expert" {
		return fmt.Errorf("invalid conversation mode")
	}
	if err := validateCurrentMessage(e.CurrentMessage); err != nil {
		return err
	}
	if len(e.AllowedAgentIDs) < 1 || len(e.AllowedAgentIDs) > maxConversationAllowedAgents {
		return fmt.Errorf("allowed agent list exceeds bounds")
	}
	seen := make(map[string]struct{}, len(e.AllowedAgentIDs))
	for _, agentID := range e.AllowedAgentIDs {
		if !validCanonicalAgent(agentID) {
			return fmt.Errorf("unknown allowed agent")
		}
		if _, exists := seen[agentID]; exists {
			return fmt.Errorf("duplicate allowed agent")
		}
		seen[agentID] = struct{}{}
	}
	if e.RequestedAgentID != nil {
		if !validCanonicalAgent(*e.RequestedAgentID) {
			return fmt.Errorf("unknown requested agent")
		}
		if _, allowed := seen[*e.RequestedAgentID]; !allowed {
			return fmt.Errorf("requested agent is not allowed")
		}
	}
	_, chatAllowed := seen["ChatAgent"]
	if e.Mode == "instant" && (e.RequestedAgentID != nil && *e.RequestedAgentID != "ChatAgent" || !chatAllowed) {
		return fmt.Errorf("instant conversation requires ChatAgent")
	}
	if e.LedgerCursor < 0 || e.BaseBusinessContextVersion < 0 || !conversationLedgerPattern.MatchString(e.LedgerVersion) {
		return fmt.Errorf("invalid conversation ledger metadata")
	}
	if len(e.HistoryDelta) > maxConversationHistoryEntries {
		return fmt.Errorf("history delta exceeds bounds")
	}
	for _, entry := range e.HistoryDelta {
		if err := validateLedgerEntry(entry); err != nil {
			return err
		}
	}
	if len(e.ArtifactRefs) > maxConversationArtifactRefs {
		return fmt.Errorf("artifact refs exceed bounds")
	}
	for _, ref := range e.ArtifactRefs {
		if err := validateArtifactRef(ref); err != nil {
			return err
		}
	}
	return nil
}

func (e ConversationEnvelopeV1) MarshalJSON() ([]byte, error) {
	if err := e.Validate(); err != nil {
		return nil, err
	}
	if e.HistoryDelta == nil {
		e.HistoryDelta = []LedgerEntryV1{}
	}
	if e.ArtifactRefs == nil {
		e.ArtifactRefs = []ArtifactRefV1{}
	}
	type envelopeAlias ConversationEnvelopeV1
	return json.Marshal(envelopeAlias(e))
}

func strictDecode(data []byte, out interface{}) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return err
	}
	var trailing interface{}
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}

func (e *ConversationEnvelopeV1) UnmarshalJSON(data []byte) error {
	type envelopeAlias ConversationEnvelopeV1
	var decoded envelopeAlias
	if err := strictDecode(data, &decoded); err != nil {
		return err
	}
	value := ConversationEnvelopeV1(decoded)
	if err := value.Validate(); err != nil {
		return err
	}
	*e = value
	return nil
}

// Validate checks bounded response metadata before it can influence Go state.
func (m ContextStageMetadata) Validate() error {
	if m.SchemaVersion != 1 {
		return fmt.Errorf("unsupported context metadata schema version")
	}
	if !validTurnID(m.TurnID) {
		return fmt.Errorf("invalid context metadata turn id")
	}
	if !validCanonicalAgent(m.SelectedAgentID) {
		return fmt.Errorf("unknown selected agent")
	}
	if m.RouteSource != "instant_lock" && m.RouteSource != "explicit_selection" && m.RouteSource != "router" {
		return fmt.Errorf("invalid context route source")
	}
	if stringLength(m.RouteReasonCode) < 1 || stringLength(m.RouteReasonCode) > maxContextRouteReasonCodeChars || !conversationRouteReasonPattern.MatchString(m.RouteReasonCode) {
		return fmt.Errorf("invalid context route reason")
	}
	if m.BaseBusinessContextVersion < 0 || m.ProposedBusinessContextVersion < 0 || m.LastAppliedLedgerCursor < 0 {
		return fmt.Errorf("negative context version")
	}
	return nil
}

func (m ContextStageMetadata) ValidateForTurn(turnID string) error {
	if err := m.Validate(); err != nil {
		return err
	}
	if turnID != "" && m.TurnID != turnID {
		return fmt.Errorf("context metadata turn_id mismatch")
	}
	return nil
}

func (m *ContextStageMetadata) UnmarshalJSON(data []byte) error {
	type metadataAlias ContextStageMetadata
	var decoded metadataAlias
	if err := strictDecode(data, &decoded); err != nil {
		return err
	}
	value := ContextStageMetadata(decoded)
	if err := value.Validate(); err != nil {
		return err
	}
	*m = value
	return nil
}

func (r ContextSettlementRequest) Validate() error {
	if r.SchemaVersion != 1 {
		return fmt.Errorf("unsupported context settlement schema version")
	}
	if _, err := uuid.Parse(r.ConversationKey); err != nil {
		return fmt.Errorf("invalid context settlement conversation key: %w", err)
	}
	if !validTurnID(r.TurnID) || !conversationLedgerPattern.MatchString(r.LedgerVersion) {
		return fmt.Errorf("invalid context settlement identity")
	}
	return nil
}

func (r ContextTombstoneRequest) Validate() error {
	if r.SchemaVersion != 1 {
		return fmt.Errorf("unsupported context tombstone schema version")
	}
	if _, err := uuid.Parse(r.ConversationKey); err != nil {
		return fmt.Errorf("invalid context tombstone conversation key: %w", err)
	}
	return nil
}

func (r ContextMutationResponse) Validate() error {
	if r.SchemaVersion != 1 {
		return fmt.Errorf("unsupported context mutation schema version")
	}
	if r.State != "committed" && r.State != "tombstoned" && r.State != "already_applied" {
		return fmt.Errorf("invalid context mutation state")
	}
	if r.ContextVersion < 0 {
		return fmt.Errorf("negative context mutation version")
	}
	return nil
}

func validateResponseContext(metadata *ContextStageMetadata, turnID string) error {
	if metadata == nil {
		return nil
	}
	return metadata.ValidateForTurn(turnID)
}

// SettleConversationContext acknowledges one staged Bot delta.
func (c *Client) SettleConversationContext(ctx context.Context, req ContextSettlementRequest) (*ContextMutationResponse, error) {
	if err := req.Validate(); err != nil {
		return nil, err
	}
	var out ContextMutationResponse
	if err := c.doJSON(ctx, http.MethodPost, "/v1/conversation-context/settle", req, &out); err != nil {
		return nil, err
	}
	if err := out.Validate(); err != nil {
		return nil, err
	}
	return &out, nil
}

// TombstoneConversationContext deletes one Bot-owned conversation context.
func (c *Client) TombstoneConversationContext(ctx context.Context, req ContextTombstoneRequest) (*ContextMutationResponse, error) {
	if err := req.Validate(); err != nil {
		return nil, err
	}
	var out ContextMutationResponse
	if err := c.doJSON(ctx, http.MethodPost, "/v1/conversation-context/tombstone", req, &out); err != nil {
		return nil, err
	}
	if err := out.Validate(); err != nil {
		return nil, err
	}
	return &out, nil
}
