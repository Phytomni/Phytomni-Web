package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"time"

	"gorm.io/gorm"

	"phytomni-server/model"
)

var (
	ErrBotProjectionNotFound = errors.New("bot projection row not found")
	ErrBotProjectionConflict = errors.New("bot projection compare-and-swap conflict")
)

const botProjectionCASAttempts = 3

// persistedProjection is the deliberately narrow JSON representation kept in
// question_agent_logs. RequestID and RawPayload are transport/provider
// metadata and must never cross this persistence boundary.
type persistedProjection struct {
	RunID              string                       `json:"run_id,omitempty"`
	Agent              string                       `json:"agent,omitempty"`
	Status             string                       `json:"status,omitempty"`
	ReportStage        string                       `json:"report_stage,omitempty"`
	ReportCompleteness string                       `json:"report_completeness,omitempty"`
	ReportRevision     int64                        `json:"report_revision"`
	ReportUpdatedAt    *time.Time                   `json:"report_updated_at,omitempty"`
	IntermediateReport string                       `json:"intermediate_report,omitempty"`
	FinalReport        string                       `json:"final_report,omitempty"`
	Progress           persistedProjectionProgress  `json:"progress,omitempty"`
	Degraded           bool                         `json:"degraded,omitempty"`
	DegradedReason     string                       `json:"degraded_reason,omitempty"`
	Failures           []string                     `json:"failures,omitempty"`
	Artifacts          persistedProjectionArtifacts `json:"artifacts,omitempty"`
	TrackingDegraded   bool                         `json:"tracking_degraded,omitempty"`
	DegradedInterop    bool                         `json:"degraded_interop,omitempty"`
	InterOp            *InteropProvenance           `json:"interop,omitempty"`
}

type persistedProjectionProgress struct {
	Completed       int64  `json:"completed,omitempty"`
	Total           int64  `json:"total,omitempty"`
	Failed          int64  `json:"failed,omitempty"`
	Pending         int64  `json:"pending,omitempty"`
	BriefGeneStatus string `json:"brief_gene_status,omitempty"`
}

type persistedProjectionArtifacts struct {
	Directories []string `json:"directories,omitempty"`
	OutputDirs  []string `json:"output_dirs,omitempty"`
	Paths       []string `json:"paths,omitempty"`
}

type botProjectionRow struct {
	BotProjectionJSON string `gorm:"column:bot_projection_json"`
	BotReportRevision int64  `gorm:"column:bot_report_revision"`
}

// MergeBotRunProjection combines a poll snapshot with the row currently in
// storage. Report revisions are monotonic: an older snapshot is ignored, an
// equal snapshot may advance metadata, and a newer snapshot wins while blank
// fields never erase already-visible content.
func MergeBotRunProjection(current, incoming BotRunProjection) (BotRunProjection, bool, error) {
	if current.RunID != "" && incoming.RunID != "" && current.RunID != incoming.RunID {
		return BotRunProjection{}, false, errors.New("bot projection run id mismatch")
	}
	if current.InterOp != nil {
		normalized, err := normalizeInteropProvenance(current.InterOp)
		if err != nil {
			return BotRunProjection{}, false, err
		}
		current.InterOp = normalized
	}
	if incoming.InterOp != nil {
		normalized, err := normalizeInteropProvenance(incoming.InterOp)
		if err != nil {
			return BotRunProjection{}, false, err
		}
		incoming.InterOp = normalized
	}

	merged := cloneBotRunProjection(current)
	if merged.RunID == "" {
		merged.RunID = incoming.RunID
	}
	if incoming.ReportRevision < current.ReportRevision {
		return merged, false, nil
	}

	newer := incoming.ReportRevision > current.ReportRevision
	mergeProjectionMetadata(&merged, incoming)
	if newer {
		merged.ReportRevision = incoming.ReportRevision
	}
	return merged, !reflect.DeepEqual(merged, current), nil
}

// SaveBotRunProjection stores a projection only when the row still has the
// revision observed by this attempt. A stale writer retries from a fresh row
// and is bounded to three attempts before returning ErrBotProjectionConflict.
func SaveBotRunProjection(ctx context.Context, username string, rowID int64, incoming BotRunProjection) error {
	for attempt := 0; attempt < botProjectionCASAttempts; attempt++ {
		current, err := loadBotRunProjectionRow(ctx, username, rowID)
		if err != nil {
			return err
		}

		merged, changed, err := MergeBotRunProjection(current, incoming)
		if err != nil {
			return err
		}
		if !changed {
			return nil
		}

		encoded, err := marshalPersistedProjection(merged)
		if err != nil {
			return err
		}
		result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
			Where("id = ? AND user_name = ? AND bot_report_revision = ?", rowID, username, current.ReportRevision).
			Updates(map[string]interface{}{
				"bot_projection_json": encoded,
				"bot_report_revision": merged.ReportRevision,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 1 {
			return nil
		}
	}
	return ErrBotProjectionConflict
}

// LoadBotRunProjection reads a projection only through the authenticated
// owner's row predicate. Missing rows and cross-owner rows intentionally share
// ErrBotProjectionNotFound so callers cannot use this endpoint as an id probe.
func LoadBotRunProjection(ctx context.Context, username string, rowID int64) (BotRunProjection, error) {
	return loadBotRunProjectionRow(ctx, username, rowID)
}

func loadBotRunProjectionRow(ctx context.Context, username string, rowID int64) (BotRunProjection, error) {
	var row botProjectionRow
	result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Select("bot_projection_json, bot_report_revision").
		Where("id = ? AND user_name = ?", rowID, username).
		Take(&row)
	if errors.Is(result.Error, gorm.ErrRecordNotFound) || result.RowsAffected == 0 {
		return BotRunProjection{}, ErrBotProjectionNotFound
	}
	if result.Error != nil {
		return BotRunProjection{}, result.Error
	}

	projection, err := unmarshalPersistedProjection(row.BotProjectionJSON)
	if err != nil {
		return BotRunProjection{}, err
	}
	// The indexed revision is the CAS source of truth. Keep old rows with an
	// empty JSON payload readable through the legacy -1 sentinel as well.
	projection.ReportRevision = row.BotReportRevision
	if len(projection.Artifacts.OutputDirs) == 0 && len(projection.Artifacts.Directories) > 0 {
		projection.Artifacts.OutputDirs = append([]string(nil), projection.Artifacts.Directories...)
	}
	if len(projection.Artifacts.Directories) == 0 && len(projection.Artifacts.OutputDirs) > 0 {
		projection.Artifacts.Directories = append([]string(nil), projection.Artifacts.OutputDirs...)
	}
	return projection, nil
}

func mergeProjectionMetadata(dst *BotRunProjection, incoming BotRunProjection) {
	if strings.TrimSpace(incoming.Agent) != "" {
		dst.Agent = incoming.Agent
	}
	if strings.TrimSpace(incoming.Status) != "" {
		dst.Status = incoming.Status
	}
	if strings.TrimSpace(incoming.ReportStage) != "" {
		dst.ReportStage = incoming.ReportStage
	}
	if strings.TrimSpace(incoming.ReportCompleteness) != "" {
		dst.ReportCompleteness = incoming.ReportCompleteness
	}
	if incoming.ReportUpdatedAt != nil {
		t := *incoming.ReportUpdatedAt
		dst.ReportUpdatedAt = &t
	}
	if strings.TrimSpace(incoming.IntermediateReport) != "" {
		dst.IntermediateReport = incoming.IntermediateReport
	}
	if strings.TrimSpace(incoming.FinalReport) != "" {
		dst.FinalReport = incoming.FinalReport
	}
	mergeProjectionProgress(&dst.Progress, incoming.Progress)
	// A true degradation marker is sticky. A false value in a partial/older
	// snapshot is a zero-value omission, not permission to erase the marker.
	dst.Degraded = dst.Degraded || incoming.Degraded
	dst.TrackingDegraded = dst.TrackingDegraded || incoming.TrackingDegraded
	dst.DegradedInterop = dst.DegradedInterop || incoming.DegradedInterop
	if incoming.InterOp != nil {
		dst.InterOp = interopProvenancePtr(*incoming.InterOp)
	}
	if strings.TrimSpace(incoming.DegradedReason) != "" {
		dst.DegradedReason = incoming.DegradedReason
	}
	if len(incoming.Failures) > 0 {
		dst.Failures = append([]string(nil), incoming.Failures...)
	}
	if len(incoming.Artifacts.Directories) > 0 {
		dst.Artifacts.Directories = append([]string(nil), incoming.Artifacts.Directories...)
	}
	if len(incoming.Artifacts.OutputDirs) > 0 {
		dst.Artifacts.OutputDirs = append([]string(nil), incoming.Artifacts.OutputDirs...)
	}
	if len(incoming.Artifacts.Paths) > 0 {
		dst.Artifacts.Paths = append([]string(nil), incoming.Artifacts.Paths...)
	}
}

func mergeProjectionProgress(dst *ProjectionProgress, incoming ProjectionProgress) {
	if incoming.Completed != 0 {
		dst.Completed = incoming.Completed
	}
	if incoming.Total != 0 {
		dst.Total = incoming.Total
	}
	if incoming.Failed != 0 {
		dst.Failed = incoming.Failed
	}
	if incoming.Pending != 0 {
		dst.Pending = incoming.Pending
	}
	if strings.TrimSpace(incoming.BriefGeneStatus) != "" {
		dst.BriefGeneStatus = incoming.BriefGeneStatus
	}
}

func cloneBotRunProjection(in BotRunProjection) BotRunProjection {
	out := in
	if in.ReportUpdatedAt != nil {
		t := *in.ReportUpdatedAt
		out.ReportUpdatedAt = &t
	}
	out.Failures = append([]string(nil), in.Failures...)
	out.Artifacts.Directories = append([]string(nil), in.Artifacts.Directories...)
	out.Artifacts.OutputDirs = append([]string(nil), in.Artifacts.OutputDirs...)
	out.Artifacts.Paths = append([]string(nil), in.Artifacts.Paths...)
	out.RawPayload = append([]byte(nil), in.RawPayload...)
	if in.InterOp != nil {
		out.InterOp = interopProvenancePtr(*in.InterOp)
	}
	return out
}

func marshalPersistedProjection(projection BotRunProjection) (string, error) {
	interop, err := normalizeInteropProvenance(projection.InterOp)
	if err != nil {
		return "", err
	}
	encoded, err := json.Marshal(persistedProjection{
		RunID:              projection.RunID,
		Agent:              projection.Agent,
		Status:             projection.Status,
		ReportStage:        projection.ReportStage,
		ReportCompleteness: projection.ReportCompleteness,
		ReportRevision:     projection.ReportRevision,
		ReportUpdatedAt:    cloneProjectionTime(projection.ReportUpdatedAt),
		IntermediateReport: projection.IntermediateReport,
		FinalReport:        projection.FinalReport,
		Progress: persistedProjectionProgress{
			Completed:       projection.Progress.Completed,
			Total:           projection.Progress.Total,
			Failed:          projection.Progress.Failed,
			Pending:         projection.Progress.Pending,
			BriefGeneStatus: projection.Progress.BriefGeneStatus,
		},
		Degraded:       projection.Degraded,
		DegradedReason: projection.DegradedReason,
		Failures:       append([]string(nil), projection.Failures...),
		Artifacts: persistedProjectionArtifacts{
			Directories: append([]string(nil), projection.Artifacts.Directories...),
			OutputDirs:  append([]string(nil), projection.Artifacts.OutputDirs...),
			Paths:       append([]string(nil), projection.Artifacts.Paths...),
		},
		TrackingDegraded: projection.TrackingDegraded,
		DegradedInterop:  projection.DegradedInterop,
		InterOp:          interop,
	})
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func unmarshalPersistedProjection(raw string) (BotRunProjection, error) {
	if strings.TrimSpace(raw) == "" || strings.TrimSpace(raw) == "null" {
		return BotRunProjection{}, nil
	}
	var stored persistedProjection
	if err := json.Unmarshal([]byte(raw), &stored); err != nil {
		return BotRunProjection{}, fmt.Errorf("decode bot projection: %w", err)
	}
	interop, err := normalizeInteropProvenance(stored.InterOp)
	if err != nil {
		return BotRunProjection{}, err
	}
	return BotRunProjection{
		RunID:              stored.RunID,
		Agent:              stored.Agent,
		Status:             stored.Status,
		ReportStage:        stored.ReportStage,
		ReportCompleteness: stored.ReportCompleteness,
		ReportRevision:     stored.ReportRevision,
		ReportUpdatedAt:    cloneProjectionTime(stored.ReportUpdatedAt),
		IntermediateReport: stored.IntermediateReport,
		FinalReport:        stored.FinalReport,
		Progress: ProjectionProgress{
			Completed:       stored.Progress.Completed,
			Total:           stored.Progress.Total,
			Failed:          stored.Progress.Failed,
			Pending:         stored.Progress.Pending,
			BriefGeneStatus: stored.Progress.BriefGeneStatus,
		},
		Degraded:       stored.Degraded,
		DegradedReason: stored.DegradedReason,
		Failures:       append([]string(nil), stored.Failures...),
		Artifacts: ProjectionArtifacts{
			Directories: append([]string(nil), stored.Artifacts.Directories...),
			OutputDirs:  append([]string(nil), stored.Artifacts.OutputDirs...),
			Paths:       append([]string(nil), stored.Artifacts.Paths...),
		},
		TrackingDegraded: stored.TrackingDegraded,
		DegradedInterop:  stored.DegradedInterop,
		InterOp:          interop,
	}, nil
}

func cloneProjectionTime(in *time.Time) *time.Time {
	if in == nil {
		return nil
	}
	t := *in
	return &t
}
