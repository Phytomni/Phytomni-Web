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

var ErrAgentTaskLifecycleNotFound = errors.New("agent task lifecycle not found")

const (
	lifecycleReconciliationCached   = "CACHED"
	lifecycleReconciliationFresh    = "FRESH"
	lifecycleReconciliationDegraded = "DEGRADED"
	lifecycleErrorTransport         = "bot_transport_failed"
	lifecycleErrorContract          = "run_contract_invalid"
	lifecycleArtifactLimit          = 256
)

// AgentTaskLifecycleDTO is the bounded owner-scoped lifecycle response. It
// contains neither Bot identities nor artifact/report content.
type AgentTaskLifecycleDTO struct {
	ID                int64                       `json:"id"`
	Phase             string                      `json:"phase"`
	Terminal          bool                        `json:"terminal"`
	ChildTaskCount    int                         `json:"child_task_count"`
	ChildWorkAccepted bool                        `json:"child_work_accepted"`
	ReportRevision    int64                       `json:"report_revision"`
	ArtifactSummary   AgentTaskArtifactSummaryDTO `json:"artifact_summary"`
	Reconciliation    string                      `json:"reconciliation"`
	TrackingDegraded  bool                        `json:"tracking_degraded"`
	ErrorCode         *string                     `json:"error_code"`
}

// AgentTaskArtifactSummaryDTO exposes only bounded aggregate artifact state.
type AgentTaskArtifactSummaryDTO struct {
	ImageCount           int  `json:"image_count"`
	OutputDirectoryCount int  `json:"output_directory_count"`
	HasReport            bool `json:"has_report"`
}

// AgentTaskLifecycle reads an authenticated task row, reconciles its Bot
// snapshot when the row is pollable, then derives its public state from the
// persisted winner. Bot failures deliberately preserve the last local state.
func (ps *Service) AgentTaskLifecycle(ctx context.Context, rowID int64, username string) (AgentTaskLifecycleDTO, error) {
	row, err := loadAgentTaskLifecycleRow(ctx, rowID, username)
	if err != nil {
		return AgentTaskLifecycleDTO{}, err
	}
	if rowIsTerminal(row.Status) || strings.TrimSpace(row.BotRunId) == "" {
		return lifecycleFromStored(row, lifecycleReconciliationCached, nil), nil
	}

	record, meta, err := ps.agentRunReader().GetRunWithMeta(ctx, row.BotRunId)
	if err != nil {
		return lifecycleFromStored(row, lifecycleReconciliationDegraded, lifecycleErrorCode(lifecycleErrorTransport)), nil
	}
	if !validLifecycleRunRecord(record, row.BotRunId) {
		return lifecycleFromStored(row, lifecycleReconciliationDegraded, lifecycleErrorCode(lifecycleErrorContract)), nil
	}
	if _, err := DecodeRunProjection(record); err != nil {
		return lifecycleFromStored(row, lifecycleReconciliationDegraded, lifecycleErrorCode(lifecycleErrorContract)), nil
	}
	if err := ps.applyBotRunProjection(ctx, row, record, meta); err != nil {
		return AgentTaskLifecycleDTO{}, err
	}

	row, err = loadAgentTaskLifecycleRow(ctx, rowID, username)
	if err != nil {
		return AgentTaskLifecycleDTO{}, err
	}
	return lifecycleFromStored(row, lifecycleReconciliationFresh, nil), nil
}

func loadAgentTaskLifecycleRow(ctx context.Context, rowID int64, username string) (*model.QuestionAgentLog, error) {
	var row model.QuestionAgentLog
	result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Select("id, user_name, bot_run_id, status, answer, download_path, image_paths, bot_projection_json, bot_report_revision").
		Where("id = ? AND user_name = ?", rowID, username).
		Take(&row)
	if errors.Is(result.Error, gorm.ErrRecordNotFound) || result.RowsAffected == 0 {
		return nil, ErrAgentTaskLifecycleNotFound
	}
	if result.Error != nil {
		return nil, result.Error
	}
	return &row, nil
}

func validLifecycleRunRecord(record *rxBot.RunRecord, expectedRunID string) bool {
	return record != nil && strings.TrimSpace(record.RunID) == strings.TrimSpace(expectedRunID)
}

func rowIsTerminal(status string) bool {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "SUCCEEDED", "FAILED", "TIMED_OUT", "TIMEOUT", "CANCELLED", "CANCELED":
		return true
	default:
		return false
	}
}

func lifecycleFromStored(row *model.QuestionAgentLog, reconciliation string, errorCode *string) AgentTaskLifecycleDTO {
	projection := lifecycleStoredProjection(row)
	childCount := boundedLifecycleCount(projection.ChildTaskCount)
	phase, terminal := lifecyclePhase(projection.Status, childCount)
	if strings.TrimSpace(projection.Status) == "" {
		phase, terminal = lifecyclePhase(row.Status, childCount)
	}

	revision := projection.ReportRevision
	if revision < 0 {
		revision = 0
	}
	return AgentTaskLifecycleDTO{
		ID:                row.Id,
		Phase:             phase,
		Terminal:          terminal,
		ChildTaskCount:    childCount,
		ChildWorkAccepted: childCount > 0,
		ReportRevision:    revision,
		ArtifactSummary:   lifecycleArtifactSummary(row, projection),
		Reconciliation:    reconciliation,
		TrackingDegraded:  projection.TrackingDegraded,
		ErrorCode:         errorCode,
	}
}

func lifecycleStoredProjection(row *model.QuestionAgentLog) BotRunProjection {
	if row == nil {
		return BotRunProjection{}
	}
	projection, _, err := unmarshalPersistedProjectionWithContext(row.BotProjectionJSON)
	if err != nil {
		return BotRunProjection{ReportRevision: row.BotReportRevision}
	}
	projection.ReportRevision = row.BotReportRevision
	if len(projection.Artifacts.OutputDirs) == 0 {
		projection.Artifacts.OutputDirs = append([]string(nil), projection.Artifacts.Directories...)
	}
	if len(projection.Artifacts.Directories) == 0 {
		projection.Artifacts.Directories = append([]string(nil), projection.Artifacts.OutputDirs...)
	}
	return projection
}

func lifecyclePhase(status string, childCount int) (string, bool) {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "QUEUED", "PENDING", "ACCEPTED":
		return "PREPARING", false
	case "RUNNING":
		if childCount > 0 {
			return "RUNNING", false
		}
		return "PREPARING", false
	case "SUCCEEDED":
		return "SUCCEEDED", true
	case "FAILED", "TIMED_OUT", "TIMEOUT":
		return "FAILED", true
	case "CANCELLED", "CANCELED":
		return "CANCELLED", true
	default:
		return "PREPARING", false
	}
}

func lifecycleArtifactSummary(row *model.QuestionAgentLog, projection BotRunProjection) AgentTaskArtifactSummaryDTO {
	imageCount := boundedLifecycleCount(len(projection.Artifacts.Paths))
	directories := projection.Artifacts.OutputDirs
	if len(directories) == 0 {
		directories = projection.Artifacts.Directories
	}
	directoryCount := boundedLifecycleCount(len(directories))
	if imageCount == 0 {
		imageCount = boundedLifecycleCount(lifecycleLegacyImageCount(row.ImagePaths))
	}
	if directoryCount == 0 && strings.TrimSpace(row.DownloadPath) != "" {
		directoryCount = 1
	}
	return AgentTaskArtifactSummaryDTO{
		ImageCount:           imageCount,
		OutputDirectoryCount: directoryCount,
		HasReport:            strings.TrimSpace(projection.VisibleReport()) != "" || strings.TrimSpace(row.Answer) != "",
	}
}

func lifecycleLegacyImageCount(raw string) int {
	var paths []string
	if err := json.Unmarshal([]byte(raw), &paths); err != nil {
		return 0
	}
	return len(paths)
}

func boundedLifecycleCount(value int) int {
	if value < 0 {
		return 0
	}
	if value > lifecycleArtifactLimit {
		return lifecycleArtifactLimit
	}
	return value
}

func lifecycleErrorCode(code string) *string {
	return &code
}
