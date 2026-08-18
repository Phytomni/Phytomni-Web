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

var (
	ErrAgentTaskLifecycleNotFound = errors.New("agent task lifecycle not found")
	ErrAgentTaskCancelConflict    = errors.New("agent task cancellation is no longer available")
)

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
	Delivery          *AgentTaskDeliveryDTO       `json:"delivery,omitempty"`
	ErrorCode         *string                     `json:"error_code"`
}

// AgentTaskDeliveryDTO exposes only browser-renderable delivery state. Storage
// references, inventory identity, and provider diagnostics remain server-side.
type AgentTaskDeliveryDTO struct {
	SchemaVersion int     `json:"schema_version"`
	Required      bool    `json:"required"`
	Status        string  `json:"status"`
	Revision      int64   `json:"revision"`
	Name          *string `json:"name"`
	SizeBytes     *int64  `json:"size_bytes"`
	ErrorCode     *string `json:"error_code"`
	Retryable     bool    `json:"retryable"`
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
	storedProjection := lifecycleStoredProjection(row)
	pendingDelivery := projectionHasPendingRequiredDelivery(storedProjection) &&
		!isProjectionFailureStatus(lifecycleScientificStatus(row, storedProjection))
	if (!pendingDelivery && (rowIsTerminal(row.Status) || rowIsTerminal(storedProjection.Status))) || strings.TrimSpace(row.BotRunId) == "" {
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
	phase, terminal := lifecyclePhase(lifecycleScientificStatus(row, projection), projection.WorkStage)
	phase, terminal = lifecycleDeliveryPhase(phase, terminal, projection)

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
		Delivery:          agentTaskDeliveryDTO(projection),
		ErrorCode:         errorCode,
	}
}

func lifecycleScientificStatus(row *model.QuestionAgentLog, projection BotRunProjection) string {
	if strings.TrimSpace(projection.Status) != "" {
		return projection.Status
	}
	if row == nil {
		return ""
	}
	return row.Status
}

func lifecycleDeliveryPhase(phase string, terminal bool, projection BotRunProjection) (string, bool) {
	if !projection.ResultArchiveV1 || projection.Delivery == nil || !projection.Delivery.Required ||
		phase == "FAILED" || phase == "TIMED_OUT" || phase == "CANCELLED" {
		return phase, terminal
	}
	switch projection.Delivery.Status {
	case "pending":
		if phase == "SUCCEEDED" || phase == "FINALIZING" {
			return "FINALIZING", false
		}
		return "RUNNING", false
	case "failed":
		return "FAILED", true
	default:
		return phase, terminal
	}
}

func agentTaskDeliveryDTO(projection BotRunProjection) *AgentTaskDeliveryDTO {
	if !projection.ResultArchiveV1 || projection.Delivery == nil {
		return nil
	}
	delivery := projection.Delivery
	dto := &AgentTaskDeliveryDTO{
		SchemaVersion: delivery.SchemaVersion,
		Required:      delivery.Required,
		Status:        delivery.Status,
		Revision:      delivery.Revision,
		Retryable:     delivery.Retryable,
	}
	if delivery.ArchiveName != "" {
		name := delivery.ArchiveName
		dto.Name = &name
	}
	if delivery.ArchiveSize > 0 {
		size := delivery.ArchiveSize
		dto.SizeBytes = &size
	}
	if delivery.ErrorCode != "" {
		code := delivery.ErrorCode
		dto.ErrorCode = &code
	}
	return dto
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

func lifecyclePhase(status, workStage string) (string, bool) {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "QUEUED", "PENDING", "ACCEPTED":
		return "PREPARING", false
	case "RUNNING":
		switch workStage {
		case "input_resolution":
			return "RESOLVING_INPUTS", false
		case "planning":
			return "PLANNING", false
		case "report_assembly":
			return "FINALIZING", false
		case "execution":
			return "RUNNING", false
		}
		return "RUNNING", false
	case "SUCCEEDED":
		return "SUCCEEDED", true
	case "FAILED":
		return "FAILED", true
	case "TIMED_OUT", "TIMEOUT":
		return "TIMED_OUT", true
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
	directoryCount := boundedLifecycleCount(projection.OutputDirectoryCount)
	if storedCount := boundedLifecycleCount(len(directories)); storedCount > directoryCount {
		directoryCount = storedCount
	}
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
