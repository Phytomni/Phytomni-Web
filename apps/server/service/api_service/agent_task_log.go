package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"gorm.io/gorm"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

var ErrAgentTaskLogNotFound = errors.New("agent task log not found")

const (
	agentTaskLogTextLimit      = 512 << 10
	agentTaskLogStatePending   = "PENDING"
	agentTaskLogStateAvailable = "AVAILABLE"
	agentTaskLogStateEmpty     = "TERMINAL_EMPTY"
	agentTaskLogStateDegraded  = "DEGRADED"
	agentTaskLogSourceBotRun   = "BOT_RUN"
	agentTaskLogSourceLegacy   = "LEGACY_TASK"
	agentTaskLogRefreshError   = "log_refresh_unavailable"
)

// AnalystAgentLogDTO is the bounded, owner-scoped log response. It contains
// no Bot identifiers, raw payload maps, headers, paths, or credentials.
type AnalystAgentLogDTO struct {
	State                   string  `json:"state"`
	Source                  string  `json:"source"`
	Text                    string  `json:"text"`
	Revision                int64   `json:"revision"`
	Truncated               bool    `json:"truncated"`
	CanRequestLegacyRefresh bool    `json:"can_request_legacy_refresh"`
	ErrorCode               *string `json:"error_code"`
}

// AnalystAgentGetLog reads a modern Bot-run log before considering historical
// task logs. It deliberately does not issue a second status poll: empty modern
// logs are classified using the stored lifecycle projection.
func (ps *Service) AnalystAgentGetLog(ctx context.Context, rowID int, username string) (AnalystAgentLogDTO, error) {
	row, err := loadAgentTaskLogRow(ctx, int64(rowID), username)
	if err != nil {
		return AnalystAgentLogDTO{}, err
	}

	if runID := strings.TrimSpace(row.BotRunId); runID != "" {
		logs, logsErr := ps.agentRunReader().GetRunLogs(ctx, runID)
		if logsErr != nil {
			return AnalystAgentLogDTO{
				State:     agentTaskLogStateDegraded,
				Source:    agentTaskLogSourceBotRun,
				Revision:  publicLogRevision(row.BotReportRevision),
				ErrorCode: agentTaskLogErrorCode(agentTaskLogRefreshError),
			}, nil
		}
		text, truncated := publicBotRunLogText(logs)
		state := agentTaskLogStateAvailable
		if text == "" {
			state = agentTaskLogStatePending
			if lifecycleFromStored(row, lifecycleReconciliationCached, nil).Terminal {
				state = agentTaskLogStateEmpty
			}
		}
		return AnalystAgentLogDTO{
			State:     state,
			Source:    agentTaskLogSourceBotRun,
			Text:      text,
			Revision:  publicLogRevision(row.BotReportRevision),
			Truncated: truncated,
		}, nil
	}

	if strings.TrimSpace(row.TaskId) == "" {
		return AnalystAgentLogDTO{}, ErrAgentTaskLogNotFound
	}
	text, truncated := publicLegacyTaskLogText(row.TaskLog)
	state := agentTaskLogStateAvailable
	if text == "" {
		state = agentTaskLogStatePending
	}
	return AnalystAgentLogDTO{
		State:     state,
		Source:    agentTaskLogSourceLegacy,
		Text:      text,
		Revision:  publicLogRevision(row.BotReportRevision),
		Truncated: truncated,
	}, nil
}

func loadAgentTaskLogRow(ctx context.Context, rowID int64, username string) (*model.QuestionAgentLog, error) {
	var row model.QuestionAgentLog
	result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Select("id, user_name, bot_run_id, task_id, task_log, status, bot_projection_json, bot_report_revision").
		Where("id = ? AND user_name = ?", rowID, username).
		Take(&row)
	if errors.Is(result.Error, gorm.ErrRecordNotFound) || (result.Error == nil && result.RowsAffected == 0) {
		return nil, ErrAgentTaskLogNotFound
	}
	if result.Error != nil {
		return nil, result.Error
	}
	return &row, nil
}

func publicBotRunLogText(logs *rxBot.RunLogsResponse) (string, bool) {
	if logs == nil {
		return "", false
	}
	return publicLogEntriesText(logs.TaskLogs)
}

func publicLegacyTaskLogText(raw string) (string, bool) {
	var entry map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &entry); err == nil {
		return publicLogEntriesText([]map[string]interface{}{entry})
	}
	var entries []map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &entries); err == nil {
		return publicLogEntriesText(entries)
	}
	return boundedPublicLogText(raw)
}

func publicLogEntriesText(entries []map[string]interface{}) (string, bool) {
	parts := make([]string, 0, len(entries)*5)
	truncated := false
	for _, entry := range entries {
		fromLogs, clipped := publicPlatformLogContents(entry)
		truncated = truncated || clipped
		if fromLogs != "" {
			parts = append(parts, fromLogs)
			continue
		}
		for _, key := range []string{"status", "message", "log", "text"} {
			part, clipped := publicLogString(entry[key])
			if part != "" {
				parts = append(parts, part)
			}
			truncated = truncated || clipped
		}
		if formatted, ok := entry["formatted"].(map[string]interface{}); ok {
			part, clipped := publicLogString(formatted["answer"])
			if part != "" {
				parts = append(parts, part)
			}
			truncated = truncated || clipped
		}
	}
	text, clipped := boundedPublicLogText(strings.Join(parts, "\n"))
	return text, truncated || clipped
}

func publicPlatformLogContents(entry map[string]interface{}) (string, bool) {
	rawLogs, ok := entry["logs"].([]interface{})
	if !ok {
		return "", false
	}
	contents := make([]string, 0, len(rawLogs))
	truncated := false
	for _, item := range rawLogs {
		mapped, isMap := item.(map[string]interface{})
		if !isMap {
			continue
		}
		part, clipped := publicLogString(mapped["content"])
		if part != "" {
			contents = append(contents, part)
		}
		truncated = truncated || clipped
	}
	if len(contents) == 0 {
		return "", truncated
	}
	return strings.Join(contents, ""), truncated
}

func publicLogString(value interface{}) (string, bool) {
	text, ok := value.(string)
	if !ok {
		return "", false
	}
	return boundedPublicLogText(text)
}

func boundedPublicLogText(text string) (string, bool) {
	text = strings.ToValidUTF8(text, "")
	if strings.TrimSpace(text) == "" {
		return "", false
	}
	if len(text) <= agentTaskLogTextLimit {
		return text, false
	}
	start := len(text) - agentTaskLogTextLimit
	for start < len(text) && text[start]&0xc0 == 0x80 {
		start++
	}
	return text[start:], true
}

func publicLogRevision(revision int64) int64 {
	if revision < 0 {
		return 0
	}
	return revision
}

func agentTaskLogErrorCode(code string) *string {
	return &code
}
