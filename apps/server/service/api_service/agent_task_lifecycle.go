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
	Delivery          *AgentTaskDeliveryDTO       `json:"delivery,omitempty"`
	Children          []AgentTaskChildDTO         `json:"children,omitempty"`
	ErrorCode         *string                     `json:"error_code"`
}

// AgentTaskChildDTO exposes one bounded child without Bot identities.
type AgentTaskChildDTO struct {
	Ordinal   int     `json:"ordinal"`
	Phase     string  `json:"phase"`
	Kind      string  `json:"kind"`
	ErrorCode *string `json:"error_code"`
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

// AgentTaskLifecycle is a pure owner-scoped projection read. Background
// workers are the sole authority for Bot reconciliation and message writes;
// repeated browser GETs therefore cannot advance provider or lifecycle state.
func (ps *Service) AgentTaskLifecycle(ctx context.Context, rowID int64, username string) (AgentTaskLifecycleDTO, error) {
	_ = ps
	if dto, found, err := lifecycleFromExecutionV2(ctx, rowID, username); err != nil {
		return AgentTaskLifecycleDTO{}, err
	} else if found {
		return dto, nil
	}
	row, err := loadAgentTaskLifecycleRow(ctx, rowID, username)
	if err != nil {
		return AgentTaskLifecycleDTO{}, err
	}
	return lifecycleFromStored(row, lifecycleReconciliationCached, nil), nil
}

func lifecycleFromExecutionV2(
	ctx context.Context,
	turnID int64,
	username string,
) (AgentTaskLifecycleDTO, bool, error) {
	gdb := model.DB(ctx).WithContext(ctx)
	if !gdb.Migrator().HasTable(&model.ConversationTurnV2{}) ||
		!gdb.Migrator().HasTable(&model.QuestionAgentExecutionAdmission{}) {
		return AgentTaskLifecycleDTO{}, false, nil
	}
	var turn model.ConversationTurnV2
	result := gdb.Where("id = ? AND user_name = ? AND delete_at IS NULL", turnID, username).Take(&turn)
	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return AgentTaskLifecycleDTO{}, false, nil
	}
	if result.Error != nil {
		return AgentTaskLifecycleDTO{}, false, result.Error
	}
	var admission model.QuestionAgentExecutionAdmission
	if err := gdb.Where("user_name = ? AND execution_id = ?", username, turn.ExecutionID).
		Take(&admission).Error; err != nil {
		return AgentTaskLifecycleDTO{}, false, err
	}
	status := admission.Status
	if strings.TrimSpace(status) == "" {
		status = turn.Status
	}
	phase, terminal := lifecyclePhase(status, "")
	if admission.TerminalStatus != nil {
		phase, _ = lifecyclePhase(*admission.TerminalStatus, "")
		terminal = true
	}
	resultCount := 0
	hasReport := false
	if strings.TrimSpace(admission.ProjectionJSON) != "" {
		var projection rxBot.ExecutionProjectionV2
		if err := json.Unmarshal([]byte(admission.ProjectionJSON), &projection); err != nil {
			return AgentTaskLifecycleDTO{}, false, err
		}
		resultCount = boundedLifecycleCount(len(projection.Results))
	}
	var visibleMessages int64
	if gdb.Migrator().HasTable(&model.ConversationMessageV2{}) {
		if err := gdb.Model(&model.ConversationMessageV2{}).
			Where("user_name = ? AND execution_id = ? AND role = ? AND content <> '' AND delete_at IS NULL", username, turn.ExecutionID, "assistant").
			Count(&visibleMessages).Error; err != nil {
			return AgentTaskLifecycleDTO{}, false, err
		}
		hasReport = visibleMessages > 0
	}
	return AgentTaskLifecycleDTO{
		ID: turn.ID, Phase: phase, Terminal: terminal,
		ChildTaskCount: resultCount, ChildWorkAccepted: resultCount > 0,
		ReportRevision: admission.ProjectionRevision,
		ArtifactSummary: AgentTaskArtifactSummaryDTO{
			OutputDirectoryCount: resultCount, HasReport: hasReport,
		},
		Reconciliation:   lifecycleReconciliationCached,
		TrackingDegraded: strings.EqualFold(admission.TrackingHealth, "degraded"),
	}, true, nil
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

func lifecycleFromStored(row *model.QuestionAgentLog, reconciliation string, errorCode *string) AgentTaskLifecycleDTO {
	projection := lifecycleStoredProjection(row)
	children := lifecycleChildren(projection.Children)
	childCount := lifecycleChildTaskCount(projection.ChildTaskCount, len(children))
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
		Children:          children,
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

func deliveryFailureKeepsScientificSuccess(errorCode string) bool {
	return errorCode == "no_user_deliverables" ||
		errorCode == "artifact_manifest_invalid" ||
		errorCode == "archive_inventory_limit_exceeded"
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
		if deliveryFailureKeepsScientificSuccess(projection.Delivery.ErrorCode) && phase == "SUCCEEDED" {
			return "SUCCEEDED", true
		}
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
	case "ADMITTED", "QUEUED", "PENDING", "ACCEPTED":
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
		HasReport:            projection.VisibleReport() != "" || validStoredReportAnswer(projection.Agent, row.Answer),
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

func lifecycleChildTaskCount(storedCount, childCount int) int {
	return boundedLifecycleCount(projectionChildTaskCount(storedCount, childCount))
}

func lifecycleChildren(children []BotRunChild) []AgentTaskChildDTO {
	if len(children) == 0 {
		return nil
	}
	if len(children) > lifecycleArtifactLimit {
		children = children[:lifecycleArtifactLimit]
	}
	out := make([]AgentTaskChildDTO, len(children))
	for i, child := range children {
		out[i] = AgentTaskChildDTO{
			Ordinal:   child.Ordinal,
			Phase:     child.Phase,
			Kind:      child.Kind,
			ErrorCode: cloneLifecycleErrorCode(child.ErrorCode),
		}
	}
	return out
}

func cloneLifecycleErrorCode(value *string) *string {
	if value == nil {
		return nil
	}
	code := *value
	return &code
}
