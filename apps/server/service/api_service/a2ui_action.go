package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

var (
	ErrA2uiActionNotFound   = errors.New("a2ui action target not found")
	ErrA2uiActionBadRequest = errors.New("invalid a2ui action envelope")
	ErrA2uiUpstreamProtocol = errors.New("invalid a2ui upstream response")
)

type A2uiActionOutcome struct {
	Status      int
	Body        []byte
	ContentType string
}

func (ps *Service) A2uiAction(
	ctx context.Context,
	username string,
	dialogueID string,
	rawBody []byte,
) (*A2uiActionOutcome, error) {
	env, err := decodeA2uiActionEnvelope(rawBody)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid envelope", ErrA2uiActionBadRequest)
	}
	if err := validateA2uiPayload(env.Widget, env.Payload); err != nil {
		return nil, err
	}

	var rows []model.QuestionAgentLog
	err = model.DB(ctx).
		Where(
			"dialogue_id = ? AND user_name = ? AND delete_at IS NULL",
			dialogueID,
			username,
		).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	var authorizedRow *model.QuestionAgentLog
	privateReplacement := false
	for index := range rows {
		_, private, decodeErr := unmarshalPersistedProjectionWithContext(rows[index].BotProjectionJSON)
		if decodeErr != nil {
			return nil, decodeErr
		}
		if private != nil && private.Replacement != nil {
			replacement := private.Replacement
			if replacement.ActiveStatus == "INPUT_REQUIRED" &&
				replacement.ActiveBotRunID == env.RunID {
				authorizedRow = &rows[index]
				privateReplacement = true
				break
			}
			// While a private replacement is active, the old public run is no
			// longer an actionable A2UI target even though it remains visible.
			continue
		}
		if rows[index].BotRunId == env.RunID {
			authorizedRow = &rows[index]
			break
		}
	}
	if authorizedRow == nil {
		return nil, ErrA2uiActionNotFound
	}
	if rxBot.BotConfig == nil || !rxBot.BotConfig.ProxyEnabled {
		return nil, ErrGatewayDisabled
	}
	if !rxBot.BotConfig.A2uiActionsEnabled {
		return nil, ErrGatewayDisabled
	}

	client := rxBot.NewClient()
	result, err := client.PostA2uiAction(ctx, env.RunID, rawBody)
	if err != nil {
		return nil, err
	}
	if result == nil || validateA2uiUpstreamResponse(result.Status, result.ContentType, result.Body) != nil {
		return nil, ErrA2uiUpstreamProtocol
	}
	if result.Status >= 200 && result.Status < 300 {
		var actionResponse struct {
			Status string `json:"status"`
		}
		if err := json.Unmarshal(result.Body, &actionResponse); err != nil {
			return nil, ErrA2uiUpstreamProtocol
		}
		if actionResponse.Status == "succeeded" {
			record, meta, err := client.GetRunWithMeta(ctx, env.RunID)
			if err != nil {
				return nil, err
			}
			projection, err := DecodeRunProjection(record)
			if err != nil {
				return nil, err
			}
			if projection.Status != statusSucceeded {
				return nil, ErrA2uiUpstreamProtocol
			}
			if privateReplacement {
				err = ps.applyPrivateReplacementRunProjection(
					ctx,
					authorizedRow.Id,
					authorizedRow.UserName,
					env.RunID,
					record,
					meta,
				)
			} else {
				err = ps.applyBotRunProjection(ctx, authorizedRow, record, meta)
			}
			if err != nil {
				return nil, err
			}
		}
	}
	return &A2uiActionOutcome{
		Status:      result.Status,
		Body:        result.Body,
		ContentType: result.ContentType,
	}, nil
}
