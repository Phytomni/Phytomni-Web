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

const (
	botProjectionCASAttempts  = 3
	botProjectionCASPredicate = "id = ? AND user_name = ? AND bot_report_revision = ? AND CAST(COALESCE(bot_projection_json, '') AS CHAR) = ?"
)

// persistedProjection is the deliberately narrow JSON representation kept in
// question_agent_logs. RequestID and RawPayload are transport/provider
// metadata and must never cross this persistence boundary.
type persistedProjection struct {
	RunID                string                        `json:"run_id,omitempty"`
	Agent                string                        `json:"agent,omitempty"`
	Status               string                        `json:"status,omitempty"`
	WorkStage            string                        `json:"work_stage,omitempty"`
	ChildTaskCount       int                           `json:"child_task_count,omitempty"`
	Children             []BotRunChild                 `json:"children,omitempty"`
	ReportStage          string                        `json:"report_stage,omitempty"`
	ReportCompleteness   string                        `json:"report_completeness,omitempty"`
	ReportRevision       int64                         `json:"report_revision"`
	ReportUpdatedAt      *time.Time                    `json:"report_updated_at,omitempty"`
	IntermediateReport   string                        `json:"intermediate_report,omitempty"`
	FinalReport          string                        `json:"final_report,omitempty"`
	Progress             persistedProjectionProgress   `json:"progress,omitempty"`
	Degraded             bool                          `json:"degraded,omitempty"`
	DegradedReason       string                        `json:"degraded_reason,omitempty"`
	Failures             []string                      `json:"failures,omitempty"`
	Artifacts            persistedProjectionArtifacts  `json:"artifacts,omitempty"`
	OutputDirectoryCount int                           `json:"output_directory_count,omitempty"`
	ResultArchiveV1      bool                          `json:"result_archive_v1,omitempty"`
	Delivery             *persistedProjectionDelivery  `json:"delivery,omitempty"`
	TrackingDegraded     bool                          `json:"tracking_degraded,omitempty"`
	DegradedInterop      bool                          `json:"degraded_interop,omitempty"`
	InterOp              *InteropProvenance            `json:"interop,omitempty"`
	ConversationContext  *persistedConversationContext `json:"conversation_context,omitempty"`
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

type persistedProjectionDelivery struct {
	SchemaVersion   int    `json:"schema_version"`
	Required        bool   `json:"required"`
	Status          string `json:"status"`
	Revision        int64  `json:"revision"`
	InventoryDigest string `json:"inventory_digest"`
	ArchiveName     string `json:"name,omitempty"`
	ArchiveSize     int64  `json:"size_bytes,omitempty"`
	ArchiveRef      string `json:"archive_ref,omitempty"`
	ErrorCode       string `json:"error_code,omitempty"`
	Retryable       bool   `json:"retryable"`
}

type botProjectionRow struct {
	BotProjectionJSON string `gorm:"column:bot_projection_json"`
	BotReportRevision int64  `gorm:"column:bot_report_revision"`
}

type botProjectionRunRow struct {
	BotProjectionJSON string `gorm:"column:bot_projection_json"`
	BotReportRevision int64  `gorm:"column:bot_report_revision"`
	BotRunID          string `gorm:"column:bot_run_id"`
}

// MergeBotRunProjection combines a poll snapshot with the row currently in
// storage. Report revisions are monotonic: an older snapshot is ignored, an
// equal snapshot may advance metadata, and a newer snapshot wins while blank
// fields never erase already-visible content.
func MergeBotRunProjection(current, incoming BotRunProjection) (BotRunProjection, bool, error) {
	if current.RunID != "" && incoming.RunID != "" && current.RunID != incoming.RunID {
		return BotRunProjection{}, false, errors.New("bot projection run id mismatch")
	}
	currentWorkStage, err := normalizeProjectionWorkStage(current.WorkStage)
	if err != nil {
		return BotRunProjection{}, false, err
	}
	incomingWorkStage, err := normalizeProjectionWorkStage(incoming.WorkStage)
	if err != nil {
		return BotRunProjection{}, false, err
	}
	current.WorkStage = currentWorkStage
	incoming.WorkStage = incomingWorkStage
	if current.InterOp != nil {
		normalized, err := normalizeInteropProvenance(current.InterOp)
		if err != nil {
			return BotRunProjection{}, false, err
		}
		current.InterOp = normalized
	}
	if incoming.InterOp != nil {
		incomingInterop := *incoming.InterOp
		// Bot's nested formatted metadata does not repeat the caller's
		// interop_mode. Preserve the mode recorded at submission when a poll
		// snapshot supplies only target/kind/status/code; legacy snapshots use
		// the safe local default.
		if strings.TrimSpace(incomingInterop.Mode) == "" {
			if current.InterOp != nil && strings.TrimSpace(current.InterOp.Mode) != "" {
				incomingInterop.Mode = current.InterOp.Mode
			} else {
				incomingInterop.Mode = "off"
			}
		}
		normalized, err := normalizeInteropProvenance(&incomingInterop)
		if err != nil {
			return BotRunProjection{}, false, err
		}
		incoming.InterOp = normalized
	}

	merged := cloneBotRunProjection(current)
	if merged.RunID == "" {
		merged.RunID = incoming.RunID
	}
	if incoming.ReportRevision >= current.ReportRevision {
		newer := incoming.ReportRevision > current.ReportRevision
		mergeProjectionMetadata(&merged, incoming)
		if newer {
			merged.ReportRevision = incoming.ReportRevision
		}
	}
	if err := mergeProjectionDelivery(&merged, current, incoming); err != nil {
		return BotRunProjection{}, false, err
	}
	return merged, !reflect.DeepEqual(merged, current), nil
}

func mergeProjectionDelivery(dst *BotRunProjection, current, incoming BotRunProjection) error {
	currentActive := current.ResultArchiveV1 || current.Delivery != nil
	incomingActive := incoming.ResultArchiveV1 || incoming.Delivery != nil
	if incoming.ResultArchiveV1 && incoming.Delivery == nil {
		return errors.New("active result archive projection has no delivery")
	}
	if currentActive && strings.EqualFold(strings.TrimSpace(incoming.Status), "SUCCEEDED") && !incomingActive {
		return errors.New("active result archive success has no delivery")
	}
	if !incomingActive {
		dst.ResultArchiveV1 = currentActive
		return nil
	}
	if incoming.Delivery == nil {
		return errors.New("result archive delivery is missing")
	}

	dst.ResultArchiveV1 = true
	if current.Delivery == nil {
		dst.Delivery = cloneProjectionDelivery(incoming.Delivery)
		return nil
	}

	currentDelivery := current.Delivery
	incomingDelivery := incoming.Delivery
	// Older delivery snapshots are stale regardless of their immutable
	// descriptor. Check their revision before validating the digest.
	if incomingDelivery.Revision < currentDelivery.Revision {
		return nil
	}
	if currentDelivery.InventoryDigest != "" && incomingDelivery.InventoryDigest != "" &&
		currentDelivery.InventoryDigest != incomingDelivery.InventoryDigest {
		return errors.New("result archive inventory digest mutation")
	}

	if incomingDelivery.Revision == currentDelivery.Revision {
		switch currentDelivery.Status {
		case "ready", "failed":
			return nil
		case "pending":
			switch incomingDelivery.Status {
			case "pending":
				if currentDelivery.InventoryDigest == "" && incomingDelivery.InventoryDigest != "" {
					dst.Delivery = cloneProjectionDelivery(incomingDelivery)
				}
				return nil
			case "ready", "failed":
				dst.Delivery = cloneProjectionDelivery(incomingDelivery)
				return nil
			default:
				return errors.New("invalid result archive delivery transition")
			}
		default:
			return errors.New("invalid stored result archive delivery status")
		}
	}

	if currentDelivery.Status != "failed" || !currentDelivery.Retryable || incomingDelivery.Status != "pending" ||
		currentDelivery.InventoryDigest == "" || incomingDelivery.InventoryDigest != currentDelivery.InventoryDigest {
		return errors.New("invalid result archive retry transition")
	}
	dst.Delivery = cloneProjectionDelivery(incomingDelivery)
	return nil
}

// SaveBotRunProjection stores a projection only when the row still has the
// revision observed by this attempt. A stale writer retries from a fresh row
// and is bounded to three attempts before returning ErrBotProjectionConflict.
func SaveBotRunProjection(ctx context.Context, username string, rowID int64, incoming BotRunProjection) error {
	_, err := saveBotRunProjection(ctx, username, rowID, incoming)
	return err
}

// saveBotRunProjection reports whether this caller applied a projection update.
// A no-op merge remains successful for ordinary projection saves, but retry
// callers use the result to avoid changing business state after a concurrent
// writer has already installed the same projection.
func saveBotRunProjection(ctx context.Context, username string, rowID int64, incoming BotRunProjection) (bool, error) {
	for attempt := 0; attempt < botProjectionCASAttempts; attempt++ {
		current, privateContext, currentRaw, currentRevision, err := loadPersistedBotProjectionRow(ctx, username, rowID)
		if err != nil {
			return false, err
		}

		merged, changed, err := MergeBotRunProjection(current, incoming)
		if err != nil {
			return false, err
		}
		if !changed {
			return false, nil
		}

		encoded, err := marshalPersistedProjectionWithContext(merged, privateContext)
		if err != nil {
			return false, err
		}
		result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
			Where(botProjectionCASPredicate, rowID, username, currentRevision, currentRaw).
			Updates(map[string]interface{}{
				"bot_projection_json": encoded,
				"bot_report_revision": merged.ReportRevision,
			})
		if result.Error != nil {
			return false, result.Error
		}
		if result.RowsAffected == 1 {
			return true, nil
		}
	}
	return false, ErrBotProjectionConflict
}

// saveBotRunProjectionForRun extends the projection CAS with the live public
// run identity. It is used by poll reconciliation so a delayed snapshot for an
// old run cannot install a projection after a replacement has promoted a new
// run on the same row.
func saveBotRunProjectionForRun(
	ctx context.Context,
	username string,
	rowID int64,
	expectedRunID string,
	incoming BotRunProjection,
) error {
	for attempt := 0; attempt < botProjectionCASAttempts; attempt++ {
		var stored botProjectionRunRow
		result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
			Select("bot_projection_json, bot_report_revision, bot_run_id").
			Where("id = ? AND user_name = ?", rowID, username).
			First(&stored)
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return ErrBotProjectionNotFound
		}
		if result.Error != nil {
			return result.Error
		}
		if strings.TrimSpace(stored.BotRunID) != expectedRunID {
			return ErrBotProjectionConflict
		}
		current, privateContext, err := unmarshalPersistedProjectionWithContext(stored.BotProjectionJSON)
		if err != nil {
			return err
		}
		current.ReportRevision = stored.BotReportRevision
		merged, changed, err := MergeBotRunProjection(current, incoming)
		if err != nil {
			return err
		}
		if !changed {
			return nil
		}
		encoded, err := marshalPersistedProjectionWithContext(merged, privateContext)
		if err != nil {
			return err
		}
		result = model.DB(ctx).Model(&model.QuestionAgentLog{}).
			Where(botProjectionCASPredicate+" AND bot_run_id = ?", rowID, username, stored.BotReportRevision, stored.BotProjectionJSON, expectedRunID).
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

// SaveBotConversationContext updates only the bounded private extension for an
// owner-scoped row. The report revision is used solely as a storage CAS
// predicate; it is never treated as a business-context version.
func SaveBotConversationContext(ctx context.Context, username string, rowID int64, incoming persistedConversationContext) error {
	if err := incoming.validate(); err != nil {
		return err
	}
	for attempt := 0; attempt < botProjectionCASAttempts; attempt++ {
		current, _, currentRaw, currentRevision, err := loadPersistedBotProjectionRow(ctx, username, rowID)
		if err != nil {
			return err
		}
		encoded, err := marshalPersistedProjectionWithContext(current, &incoming)
		if err != nil {
			return err
		}
		if encoded == currentRaw {
			return nil
		}
		result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
			Where(botProjectionCASPredicate, rowID, username, currentRevision, currentRaw).
			Updates(map[string]interface{}{"bot_projection_json": encoded})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 1 {
			return nil
		}
	}
	return ErrBotProjectionConflict
}

// LoadBotConversationContext reads the private extension through the same
// owner predicate as the public projection. An existing row without the
// extension returns the zero context rather than a not-found error.
func LoadBotConversationContext(ctx context.Context, username string, rowID int64) (persistedConversationContext, error) {
	return loadBotConversationContextWithDB(ctx, model.DB(ctx), username, rowID)
}

func loadBotConversationContextWithDB(
	ctx context.Context,
	gdb *gorm.DB,
	username string,
	rowID int64,
) (persistedConversationContext, error) {
	_, privateContext, _, _, err := loadPersistedBotProjectionRowWithDB(
		ctx,
		gdb,
		username,
		rowID,
	)
	if err != nil {
		return persistedConversationContext{}, err
	}
	if privateContext == nil {
		return persistedConversationContext{}, nil
	}
	return privateContext.clone(), nil
}

func loadBotRunProjectionRow(ctx context.Context, username string, rowID int64) (BotRunProjection, error) {
	projection, _, _, _, err := loadPersistedBotProjectionRow(ctx, username, rowID)
	return projection, err
}

func loadPersistedBotProjectionRow(ctx context.Context, username string, rowID int64) (BotRunProjection, *persistedConversationContext, string, int64, error) {
	return loadPersistedBotProjectionRowWithDB(ctx, model.DB(ctx), username, rowID)
}

func loadPersistedBotProjectionRowWithDB(
	ctx context.Context,
	gdb *gorm.DB,
	username string,
	rowID int64,
) (BotRunProjection, *persistedConversationContext, string, int64, error) {
	var row botProjectionRow
	result := gdb.WithContext(ctx).Model(&model.QuestionAgentLog{}).
		Select("bot_projection_json, bot_report_revision").
		Where("id = ? AND user_name = ?", rowID, username).
		Take(&row)
	if errors.Is(result.Error, gorm.ErrRecordNotFound) || result.RowsAffected == 0 {
		return BotRunProjection{}, nil, "", 0, ErrBotProjectionNotFound
	}
	if result.Error != nil {
		return BotRunProjection{}, nil, "", 0, result.Error
	}

	projection, privateContext, err := unmarshalPersistedProjectionWithContext(row.BotProjectionJSON)
	if err != nil {
		return BotRunProjection{}, nil, "", 0, err
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
	return projection, privateContext, row.BotProjectionJSON, row.BotReportRevision, nil
}

func mergeProjectionMetadata(dst *BotRunProjection, incoming BotRunProjection) {
	if strings.TrimSpace(incoming.Agent) != "" {
		dst.Agent = incoming.Agent
	}
	dst.Status = mergeProjectionStatus(dst.Status, incoming.Status)
	if incoming.WorkStage != "" {
		dst.WorkStage = incoming.WorkStage
	}
	if incoming.ChildTaskCount > dst.ChildTaskCount {
		dst.ChildTaskCount = incoming.ChildTaskCount
	}
	if len(incoming.Children) > 0 {
		dst.Children = cloneBotRunChildren(incoming.Children)
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
	if incoming.OutputDirectoryCount > dst.OutputDirectoryCount {
		dst.OutputDirectoryCount = incoming.OutputDirectoryCount
	}
}

func isProjectionTerminalStatus(status string) bool {
	switch status {
	case "SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT":
		return true
	default:
		return false
	}
}

func isProjectionFailureStatus(status string) bool {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "FAILED", "CANCELLED", "CANCELED", "TIMED_OUT", "TIMEOUT":
		return true
	default:
		return false
	}
}

func projectionHasPendingRequiredDelivery(projection BotRunProjection) bool {
	return projection.ResultArchiveV1 && projection.Delivery != nil && projection.Delivery.Required && projection.Delivery.Status == "pending"
}

// Scientific SUCCEEDED plus a still-packing archive is not compute RUNNING.
func businessStatusForPendingDelivery(scientificStatus string) string {
	if strings.EqualFold(strings.TrimSpace(scientificStatus), "SUCCEEDED") {
		return "FINALIZING"
	}
	return "RUNNING"
}

func mergeProjectionStatus(current, incoming string) string {
	if isProjectionTerminalStatus(current) || strings.TrimSpace(incoming) == "" {
		return current
	}
	return incoming
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
	out.Children = cloneBotRunChildren(in.Children)
	out.Artifacts.Directories = append([]string(nil), in.Artifacts.Directories...)
	out.Artifacts.OutputDirs = append([]string(nil), in.Artifacts.OutputDirs...)
	out.Artifacts.Paths = append([]string(nil), in.Artifacts.Paths...)
	out.Delivery = cloneProjectionDelivery(in.Delivery)
	out.RawPayload = append([]byte(nil), in.RawPayload...)
	if in.InterOp != nil {
		out.InterOp = interopProvenancePtr(*in.InterOp)
	}
	return out
}

func cloneProjectionDelivery(in *ProjectionDelivery) *ProjectionDelivery {
	if in == nil {
		return nil
	}
	out := *in
	return &out
}

func marshalPersistedProjection(projection BotRunProjection) (string, error) {
	return marshalPersistedProjectionWithContext(projection, nil)
}

func marshalPersistedProjectionWithContext(projection BotRunProjection, privateContext *persistedConversationContext) (string, error) {
	projection = normalizeCompletedReviewProjection(projection)
	workStage, err := normalizeProjectionWorkStage(projection.WorkStage)
	if err != nil {
		return "", err
	}
	interop, err := normalizeInteropProvenance(projection.InterOp)
	if err != nil {
		return "", err
	}
	encoded, err := json.Marshal(persistedProjection{
		RunID:              projection.RunID,
		Agent:              projection.Agent,
		Status:             projection.Status,
		WorkStage:          workStage,
		ChildTaskCount:     projection.ChildTaskCount,
		Children:           cloneBotRunChildren(projection.Children),
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
		OutputDirectoryCount: projection.OutputDirectoryCount,
		ResultArchiveV1:      projection.ResultArchiveV1,
		Delivery:             persistProjectionDelivery(projection.Delivery),
		TrackingDegraded:     projection.TrackingDegraded,
		DegradedInterop:      projection.DegradedInterop,
		InterOp:              interop,
		ConversationContext:  privateContext,
	})
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func unmarshalPersistedProjectionWithContext(raw string) (BotRunProjection, *persistedConversationContext, error) {
	if strings.TrimSpace(raw) == "" || strings.TrimSpace(raw) == "null" {
		return BotRunProjection{}, nil, nil
	}
	var stored persistedProjection
	if err := json.Unmarshal([]byte(raw), &stored); err != nil {
		return BotRunProjection{}, nil, fmt.Errorf("decode bot projection: %w", err)
	}
	interop, err := normalizeInteropProvenance(stored.InterOp)
	if err != nil {
		return BotRunProjection{}, nil, err
	}
	workStage, err := normalizeProjectionWorkStage(stored.WorkStage)
	if err != nil {
		return BotRunProjection{}, nil, err
	}
	projection := BotRunProjection{
		RunID:              stored.RunID,
		Agent:              stored.Agent,
		Status:             stored.Status,
		WorkStage:          workStage,
		ChildTaskCount:     stored.ChildTaskCount,
		Children:           cloneBotRunChildren(stored.Children),
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
		OutputDirectoryCount: stored.OutputDirectoryCount,
		ResultArchiveV1:      stored.ResultArchiveV1,
		Delivery:             restoreProjectionDelivery(stored.Delivery),
		TrackingDegraded:     stored.TrackingDegraded,
		DegradedInterop:      stored.DegradedInterop,
		InterOp:              interop,
	}
	return normalizeCompletedReviewProjection(projection), stored.ConversationContext, nil
}

func persistProjectionDelivery(in *ProjectionDelivery) *persistedProjectionDelivery {
	if in == nil {
		return nil
	}
	return &persistedProjectionDelivery{
		SchemaVersion:   in.SchemaVersion,
		Required:        in.Required,
		Status:          in.Status,
		Revision:        in.Revision,
		InventoryDigest: in.InventoryDigest,
		ArchiveName:     in.ArchiveName,
		ArchiveSize:     in.ArchiveSize,
		ArchiveRef:      in.ArchiveRef,
		ErrorCode:       in.ErrorCode,
		Retryable:       in.Retryable,
	}
}

func restoreProjectionDelivery(in *persistedProjectionDelivery) *ProjectionDelivery {
	if in == nil {
		return nil
	}
	return &ProjectionDelivery{
		SchemaVersion:   in.SchemaVersion,
		Required:        in.Required,
		Status:          in.Status,
		Revision:        in.Revision,
		InventoryDigest: in.InventoryDigest,
		ArchiveName:     in.ArchiveName,
		ArchiveSize:     in.ArchiveSize,
		ArchiveRef:      in.ArchiveRef,
		ErrorCode:       in.ErrorCode,
		Retryable:       in.Retryable,
	}
}

func cloneProjectionTime(in *time.Time) *time.Time {
	if in == nil {
		return nil
	}
	t := *in
	return &t
}
