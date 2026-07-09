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
)

const a2uiDisabledMsg = "a2ui " + "disabled"

func a2uiFlagOffStubBody() []byte {
	return []byte(`{"status":403,"error":{"type":"forbidden","code":403,"message":"` + a2uiDisabledMsg + `"}}`)
}

type A2uiActionEnvelope struct {
	SurfaceID string          `json:"surface_id"`
	Widget    string          `json:"widget"`
	ActionID  string          `json:"action_id"`
	RunID     string          `json:"run_id"`
	Payload   json.RawMessage `json:"payload"`
}

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
	var env A2uiActionEnvelope
	if err := json.Unmarshal(rawBody, &env); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrA2uiActionBadRequest, err)
	}
	if env.SurfaceID == "" || env.Widget == "" || env.ActionID == "" || env.RunID == "" {
		return nil, fmt.Errorf("%w: missing required fields", ErrA2uiActionBadRequest)
	}

	var count int64
	err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where(
			"dialogue_id = ? AND user_name = ? AND bot_run_id = ? AND delete_at IS NULL",
			dialogueID,
			username,
			env.RunID,
		).
		Count(&count).Error
	if err != nil {
		return nil, err
	}
	if count == 0 {
		return nil, ErrA2uiActionNotFound
	}
	if rxBot.BotConfig == nil || !rxBot.BotConfig.ProxyEnabled {
		return nil, ErrGatewayDisabled
	}
	if !rxBot.BotConfig.A2uiActionsEnabled {
		return &A2uiActionOutcome{
			Status:      403,
			Body:        a2uiFlagOffStubBody(),
			ContentType: "application/json",
		}, nil
	}

	result, err := rxBot.NewClient().PostA2uiAction(ctx, env.RunID, rawBody)
	if err != nil {
		return nil, err
	}
	contentType := result.ContentType
	if contentType == "" {
		contentType = "application/json"
	}
	return &A2uiActionOutcome{
		Status:      result.Status,
		Body:        result.Body,
		ContentType: contentType,
	}, nil
}
