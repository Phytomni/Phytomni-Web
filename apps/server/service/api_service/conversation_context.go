package api_service

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"unicode/utf8"

	rxBot "phytomni-server/external/bot"
)

const (
	maxPersistedClientTurnIDBytes     = 128
	maxPersistedAssistantSummaryBytes = 4 << 10
	maxPersistedArtifactRefs          = 50
	maxPersistedArtifactFieldBytes    = 512
	maxPersistedSettlementStateBytes  = 32
	maxPersistedLedgerHashBytes       = 128
	maxPersistedConversationBytes     = 64 << 10
)

var (
	persistedArtifactIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
	persistedTokenPattern      = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_.-]*$`)
	persistedURISchemePattern  = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9+.-]*:`)
)

var ErrInvalidBotConversationContext = errors.New("invalid bot conversation context")

// persistedConversationContext is the private, bounded context extension
// stored alongside the public Bot projection. It is deliberately absent from
// BotRunProjection so response metadata cannot leak through public APIs.
type persistedConversationContext struct {
	ClientTurnID         string                      `json:"client_turn_id,omitempty"`
	Stage                *rxBot.ContextStageMetadata `json:"stage,omitempty"`
	SettlementState      string                      `json:"settlement_state,omitempty"`
	SettlementLedgerHash string                      `json:"settlement_ledger_hash,omitempty"`
	AssistantSummary     string                      `json:"assistant_summary,omitempty"`
	ArtifactRefs         []rxBot.ArtifactRefV1       `json:"artifact_refs,omitempty"`
}

func (value persistedConversationContext) clone() persistedConversationContext {
	copyValue := value
	if value.Stage != nil {
		stage := *value.Stage
		copyValue.Stage = &stage
	}
	copyValue.ArtifactRefs = append([]rxBot.ArtifactRefV1(nil), value.ArtifactRefs...)
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
	if err := validatePersistedASCII("settlement_ledger_hash", value.SettlementLedgerHash, maxPersistedLedgerHashBytes); err != nil {
		return err
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
