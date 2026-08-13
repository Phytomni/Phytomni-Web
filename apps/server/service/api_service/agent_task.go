package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"phytomni-server/common"
	rxBot "phytomni-server/external/bot"
	rxLog "phytomni-server/log"
	"phytomni-server/model"
)

func (ps *Service) AsyncTaskList(ctx context.Context, username string, current, size int) ([]*common.ApiAsyncTaskListResponse, int64, int, error) {

	// Normalize pagination params: the handler reads `current`/`size` query
	// params via strconv.Atoi, defaulting to 0 when absent. size=0 makes the
	// totalPages (total+size-1)/size expression integer-divide-by-zero panic
	// (gin Recovery turns it into 500). Fall back to sane defaults instead of
	// rejecting — the browser always sends current=1&size=10; this only guards
	// bare curl/monitoring probes.
	if size <= 0 {
		size = 10
	}
	if current <= 0 {
		current = 1
	}

	var QuestionAgentLogList []*common.ApiAsyncTaskListResponse

	// Reusable owner-scoped query: Session freezes user_name + status + resource
	// conditions so Count and paged Find each clone from the same scoped base —
	// no cross-contamination and no accidental full-table scan (cross-user
	// isolation is explicit, not reliant on implicit chain-instance state).
	scoped := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where("user_name = ?", username).
		Where("status = ? or status = ? or status = ?", "RUNNING", "SUCCEEDED", "FAILED").
		Where("NULLIF(TRIM(server_id), '') IS NOT NULL OR NULLIF(TRIM(task_id), '') IS NOT NULL OR NULLIF(TRIM(bot_run_id), '') IS NOT NULL").
		Session(&gorm.Session{})

	var total int64
	if err := scoped.Count(&total).Error; err != nil {
		return nil, 0, 0, err
	}

	totalPages := int((total + int64(size) - 1) / int64(size))
	offset := (current - 1) * size
	if err := scoped.Order("created_at DESC").Offset(offset).Limit(size).Find(&QuestionAgentLogList).Error; err != nil {
		return nil, 0, 0, err
	}

	for _, v := range QuestionAgentLogList {
		if v.FId != 0 {
			var result *model.QuestionAgentLog
			if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).
				Where("id = ? and user_name = ?", v.FId, username).
				First(&result).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					// A corrupt/mismatched parent must not leak another user's
					// dialogue id or make the owner's list unusable.
					continue
				}
				return nil, 0, 0, err
			}
			v.FDialogueId = result.DialogueId
		}
	}

	return QuestionAgentLogList, total, totalPages, nil
}

func (ps *Service) AsyncTaskInfo(ctx context.Context, id int, username string) (QuestionAgentLogList *model.QuestionAgentLog, err error) {

	// Scope by id AND owner: the auto-increment id is enumerable, so without the
	// user_name filter any authenticated user could read another user's task row.
	if err = model.DB(ctx).Model(&model.QuestionAgentLog{}).Debug().
		Where("id = ? and user_name = ?", id, username).First(&QuestionAgentLogList).Error; err != nil {
		return nil, errors.New("task not found")
	}
	if strings.TrimSpace(QuestionAgentLogList.TaskId) == "" &&
		strings.TrimSpace(QuestionAgentLogList.BotRunId) == "" &&
		strings.TrimSpace(QuestionAgentLogList.ServerId) == "" {
		return nil, errors.New("task not found")
	}

	return
}

func (ps *Service) QueryList(ctx context.Context, username string) ([]*common.QueryListRequest, error) {
	var QuestionAgentLogList []*common.QueryListRequest
	if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).Where("user_name = ? AND f_id = ? AND delete_at IS NULL", username, 0).
		Order("created_at DESC").
		Find(&QuestionAgentLogList).
		Error; err != nil {
		return nil, err
	}

	QADataList := make([]*common.QueryListRequest, 0, len(QuestionAgentLogList))
	for _, v := range QuestionAgentLogList {
		var DataList common.QueryListRequest // non-pointer: zero value is safe when GORM finds no record
		createdAt := v.CreatedAt

		// latest child record for this parent
		err := model.DB(ctx).Model(&model.QuestionAgentLog{}).Where("f_id = ? AND delete_at IS NULL", v.Id).
			Order("created_at DESC").
			Limit(1).
			First(&DataList).Error

		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				log.Printf("No record found for f_id=%d", v.Id)
			} else {
				return nil, err
			}
		}

		if DataList.Id != 0 {
			createdAt = DataList.CreatedAt
		}

		QAData := &common.QueryListRequest{
			Id:         v.Id,
			DialogueId: v.DialogueId,
			TitleQuery: v.TitleQuery,
			CreatedAt:  createdAt,
		}
		QADataList = append(QADataList, QAData)
	}
	sort.Slice(QADataList, func(i, j int) bool {
		return QADataList[i].CreatedAt.After(QADataList[j].CreatedAt)
	})

	return QADataList, nil
}

type ConversationHistoryRow struct {
	*model.QuestionAgentLog
	Artifacts       []ConversationArtifactLink `json:"artifacts,omitempty"`
	Attachments     []rxBot.AssetAttachmentRef `json:"attachments,omitempty"`
	Delivery        *AgentTaskDeliveryDTO      `json:"delivery,omitempty"`
	ContextRebuilt  bool                       `json:"context_rebuilt,omitempty"`
	ContextDegraded bool                       `json:"context_degraded,omitempty"`
}

func (ps *Service) AnswerCheck(ctx context.Context, username string, dialogueId string) ([]*ConversationHistoryRow, error) {
	result, err := ps.AnswerCheckWithMode(ctx, username, dialogueId, HistoryReadModeFromConfig())
	if err != nil {
		return nil, err
	}
	rows := make([]*ConversationHistoryRow, 0, len(result.Rows))
	for _, row := range result.Rows {
		if row == nil {
			continue
		}
		historyRow := &ConversationHistoryRow{QuestionAgentLog: row}
		private, contextErr := LoadBotConversationContext(ctx, username, row.Id)
		if contextErr != nil {
			return nil, contextErr
		}
		historyRow.Attachments = append([]rxBot.AssetAttachmentRef(nil), private.InputAttachments...)
		projection, _, projectionErr := unmarshalPersistedProjectionWithContext(row.BotProjectionJSON)
		if projectionErr != nil {
			return nil, projectionErr
		}
		historyRow.Delivery = agentTaskDeliveryDTO(projection)
		if row.Status == statusSucceeded {
			if projection.ResultArchiveV1 || len(projection.Artifacts.Paths) > 0 {
				links, linkErr := ps.conversationArtifactLinks(ctx, username, dialogueId, row.Id)
				if linkErr != nil {
					return nil, linkErr
				}
				historyRow.Artifacts = links
			}
			if private.Stage != nil {
				historyRow.ContextRebuilt = private.Stage.ContextRebuilt
				historyRow.ContextDegraded = private.Stage.ContextDegraded
			}
			if private.SettlementState == conversationSettlementRebuildRequired {
				historyRow.ContextDegraded = true
			}
		}
		rows = append(rows, historyRow)
	}
	return rows, nil
}

// AnswerCheckWithMode exposes the reversible history source boundary to Web
// callers that need an observation outcome. The existing AnswerCheck wrapper
// above deliberately returns only rows, preserving the public HTTP payload.
func (ps *Service) AnswerCheckWithMode(ctx context.Context, username string, dialogueId string, mode HistoryReadMode) (HistoryReadResult, error) {
	switch mode {
	case HistoryReadModeDual:
		return ps.answerCheckProjectionFirst(ctx, username, dialogueId, true)
	case HistoryReadModeProjection:
		return ps.answerCheckProjectionFirst(ctx, username, dialogueId, false)
	default:
		rows, err := ps.answerCheckLegacy(ctx, username, dialogueId)
		result := HistoryReadResult{Rows: rows, Source: historySourceLegacy}
		if len(rows) > 0 {
			result.Sources = make([]string, len(rows))
			for index := range result.Sources {
				result.Sources[index] = historySourceLegacy
			}
		}
		return result, err
	}
}

// answerCheckLegacy is the compatibility path used when the dual-read flag is
// disabled. Keep its projection and Bot overlay order unchanged so disabling
// the new mode is an immediate rollback for existing callers.
func (ps *Service) answerCheckLegacy(ctx context.Context, username string, dialogueId string) (QuestionAgentLogList []*model.QuestionAgentLog, err error) {
	QuestionAgentLogList, err = ps.loadHistoryRows(ctx, username, dialogueId)
	if err != nil {
		return nil, err
	}

	// A persisted bounded projection is the first history source during the
	// reversible cutover. It remains available even when Bot is dark or
	// temporarily unreachable; Web-owned fields stay on the row.
	ps.overlayPersistedBotProjections(ctx, QuestionAgentLogList)

	// Bot is the content source of truth when the gateway is active: overlay MySQL
	// transition fields with Bot content, leaving Web-only fields (id,
	// reaction_type, upload_path) intact. proxy_enabled=false or Bot unreachable
	// falls back to MySQL legacy fields (degrade, not error).
	if rxBot.BotConfig != nil && rxBot.BotConfig.ProxyEnabled {
		ps.overlayBotContent(ctx, dialogueId, QuestionAgentLogList)
	}
	return QuestionAgentLogList, nil
}

// loadHistoryRows reads only the authenticated owner's parent and children.
// Projection reads reuse the same owner predicate in LoadBotRunProjection.
func (ps *Service) loadHistoryRows(ctx context.Context, username string, dialogueId string) (QuestionAgentLogList []*model.QuestionAgentLog, err error) {
	var QuestionAgentLog *model.QuestionAgentLog
	// First() returns ErrRecordNotFound when there is no match but still fills the
	// struct with &{Id:0}; if that Id were used to query children, f_id=0 (the
	// parent-row sentinel) would match every root row across all dialogues.
	// Defensive guard: treat RecordNotFound as a new/empty dialogue and return nil;
	// propagate all other errors.
	if err = model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where("user_name = ? AND dialogue_id = ? AND f_id = ? AND delete_at IS NULL", username, dialogueId, 0).
		First(&QuestionAgentLog).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	// Scope children to the same owner as the parent. Defense-in-depth: child
	// rows are written under the dialogue owner, so a row with a different
	// user_name attached to an owned parent (via a write bug or DB corruption)
	// must never surface through history.
	if err = model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where("user_name = ? AND f_id = ? AND delete_at IS NULL", username, QuestionAgentLog.Id).
		Find(&QuestionAgentLogList).Error; err != nil {
		return nil, err
	}
	newList := make([]*model.QuestionAgentLog, 0, len(QuestionAgentLogList)+1)
	newList = append(newList, QuestionAgentLog)
	newList = append(newList, QuestionAgentLogList...)
	QuestionAgentLogList = newList
	return QuestionAgentLogList, nil
}

const (
	historyFallbackMissingRunID   = "blank_run_id"
	historyFallbackProjectionRead = "projection_unavailable"
	historyFallbackProjectionBad  = "projection_malformed"
	historyFallbackRunIDMismatch  = "run_id_mismatch"
	historyFallbackBotUnavailable = "bot_read_unavailable"
)

func projectionFallbackReason(row *model.QuestionAgentLog, projection BotRunProjection, err error) string {
	if row == nil || strings.TrimSpace(row.BotRunId) == "" {
		return historyFallbackMissingRunID
	}
	if err != nil {
		var decodeErr *ProjectionDecodeError
		if errors.As(err, &decodeErr) {
			return historyFallbackProjectionBad
		}
		return historyFallbackProjectionRead
	}
	if strings.TrimSpace(projection.RunID) == "" || strings.TrimSpace(projection.RunID) != strings.TrimSpace(row.BotRunId) {
		return historyFallbackRunIDMismatch
	}
	return historyFallbackProjectionRead
}

func cloneHistoryRows(rows []*model.QuestionAgentLog) []*model.QuestionAgentLog {
	cloned := make([]*model.QuestionAgentLog, len(rows))
	for index, row := range rows {
		if row == nil {
			continue
		}
		copy := *row
		cloned[index] = &copy
	}
	return cloned
}

func normalizedHistoryStatus(status string) string {
	return strings.ToUpper(strings.TrimSpace(status))
}

func aggregateHistorySource(sources []string) string {
	if len(sources) == 0 {
		return historySourceLegacy
	}
	for _, source := range sources {
		if source != historySourceProjection {
			return historySourceLegacy
		}
	}
	return historySourceProjection
}

// answerCheckProjectionFirst renders validated persisted projections before
// legacy row fields. Dual mode additionally performs a bounded Bot list read
// solely for safe count/status/revision comparison; it never exposes that
// response or lets it overwrite Web-owned history rows.
func (ps *Service) answerCheckProjectionFirst(ctx context.Context, username string, dialogueId string, dual bool) (HistoryReadResult, error) {
	rows, err := ps.loadHistoryRows(ctx, username, dialogueId)
	if err != nil {
		return HistoryReadResult{}, err
	}
	legacyRows := cloneHistoryRows(rows)
	sources := make([]string, len(rows))
	for index := range sources {
		sources[index] = historySourceLegacy
	}
	fallbackReason := ""
	hasRun := false
	projectionByRun := make(map[string]BotRunProjection)
	for index, row := range rows {
		if row == nil {
			continue
		}
		runID := strings.TrimSpace(row.BotRunId)
		if runID != "" {
			hasRun = true
		}
		projection, projectionErr := BotRunProjection{}, error(nil)
		if runID != "" && strings.TrimSpace(row.UserName) != "" {
			projection, projectionErr = LoadBotRunProjection(ctx, username, row.Id)
		} else {
			projectionErr = ErrBotProjectionNotFound
		}
		if projectionErr == nil && strings.TrimSpace(projection.RunID) == runID && runID != "" && applyBotProjectionToHistoryRow(row, projection) {
			sources[index] = historySourceProjection
			projectionByRun[runID] = projection
			if dual {
				observeHistoryRead(historyObservationProjectionHit)
				if normalizedHistoryStatus(projection.Status) != normalizedHistoryStatus(legacyRows[index].Status) && normalizedHistoryStatus(legacyRows[index].Status) != "" {
					observeHistoryRead(historyObservationStatusMismatch)
				}
			}
			continue
		}
		if dual {
			observeHistoryRead(historyObservationLegacyFallback)
		}
		if fallbackReason == "" {
			fallbackReason = projectionFallbackReason(row, projection, projectionErr)
		}
	}

	if dual && hasRun && rxBot.BotConfig != nil && rxBot.BotConfig.ProxyEnabled {
		resp, listErr := rxBot.NewClient().ListRuns(ctx, dialogueId)
		if listErr != nil {
			observeHistoryRead(historyObservationBotUnavailable)
			rows = legacyRows
			for index := range sources {
				if sources[index] == historySourceProjection {
					observeHistoryRead(historyObservationLegacyFallback)
				}
				sources[index] = historySourceLegacy
			}
			fallbackReason = historyFallbackBotUnavailable
		} else {
			expectedRuns := make(map[string]struct{})
			for _, row := range rows {
				if row != nil {
					if runID := strings.TrimSpace(row.BotRunId); runID != "" {
						expectedRuns[runID] = struct{}{}
					}
				}
			}
			if len(resp.Data) != len(expectedRuns) {
				observeHistoryRead(historyObservationCountMismatch)
			}
			for _, record := range resp.Data {
				runID := strings.TrimSpace(record.RunID)
				if runID == "" {
					continue
				}
				projection, decodeErr := DecodeRunProjection(&record)
				if decodeErr != nil {
					continue
				}
				stored, ok := projectionByRun[runID]
				if !ok {
					continue
				}
				if normalizedHistoryStatus(stored.Status) != normalizedHistoryStatus(projection.Status) {
					observeHistoryRead(historyObservationStatusMismatch)
				}
				if stored.ReportRevision >= 0 && projection.ReportRevision >= 0 && stored.ReportRevision != projection.ReportRevision {
					observeHistoryRead(historyObservationRevisionMismatch)
				}
			}
		}
	}

	return HistoryReadResult{
		Rows:           rows,
		Source:         aggregateHistorySource(sources),
		FallbackReason: fallbackReason,
		Sources:        sources,
	}, nil
}

// overlayBotContent fetches Bot runs for a dialogue in a single call and
// overrides the content columns (query/answer/tool_name/status) on rows that
// carry a bot_run_id, leaving Web-only fields (id, reaction_type, upload_path)
// intact. Any Bot failure leaves the MySQL legacy fields in place — a degrade,
// not an error — so history replay never 500s on Bot trouble.
func (ps *Service) overlayBotContent(ctx context.Context, dialogueId string, list []*model.QuestionAgentLog) {
	hasRun := false
	for _, r := range list {
		if r.BotRunId != "" {
			hasRun = true
			break
		}
	}
	if !hasRun {
		return
	}
	resp, err := rxBot.NewClient().ListRuns(ctx, dialogueId)
	if err != nil {
		rxLog.Sugar().Warnw("answer-check bot list runs failed, using legacy fields", "dialogue_id", dialogueId, "err", err)
		return
	}
	byRun := make(map[string]rxBot.RunRecord, len(resp.Data))
	for _, rec := range resp.Data {
		byRun[rec.RunID] = rec
	}
	for _, row := range list {
		if row.BotRunId == "" {
			continue
		}
		// A valid persisted projection has already crossed the modern boundary
		// above. Do not let a legacy flat/list response replace it with an older
		// or less complete shape during history replay. If the JSON is malformed,
		// retain the Bot response as the safe fallback.
		if projection, projectionErr := LoadBotRunProjection(ctx, row.UserName, row.Id); projectionErr == nil && projection.RunID == strings.TrimSpace(row.BotRunId) {
			continue
		}
		rec, ok := byRun[row.BotRunId]
		if !ok {
			continue
		}
		if projection, projectionErr := DecodeRunProjection(&rec); projectionErr == nil && projection.RunID == strings.TrimSpace(row.BotRunId) {
			formatted, _, _ := rxBot.ParseRunFormatted(rec.Result)
			applyBotProjectionToHistoryRowWithFormatted(row, projection, formatted)
			continue
		}
		if rec.Query != "" {
			row.Query = rec.Query
		}
		// Reshape from the run's formatted envelope (/v1/runs keeps
		// result.formatted in default mode) so cited/data history replays carry
		// the JSON the Web app parses. deep_genome's assembled report arrives as
		// result.final_report (no formatted block); fall back to it, then to the
		// flat answer for runs with no rendered content yet (still running, or
		// analyst awaiting Bot's formatted answer).
		if f, answerText, ok := rxBot.ParseRunFormatted(rec.Result); ok {
			row.Answer = rxBot.ShapeAnswer(rec.Agent, answerText, f)
		} else if fr, ok := rxBot.ParseRunFinalReport(rec.Result); ok {
			// final_report is deep_genome-exclusive; reshape with the known slug.
			row.Answer = rxBot.ShapeAnswer("deep_genome", fr, nil)
		} else if rec.Answer != "" {
			row.Answer = rec.Answer
		}
		if rec.ToolName != "" {
			row.ToolName = rec.ToolName
		}
		if rec.Status != "" {
			// The Web app gates the download button on the exact-case "SUCCEEDED";
			// Bot returns lowercase. Normalize like the update-log write path.
			row.Status = strings.ToUpper(rec.Status)
		}
	}
}

func (ps *Service) overlayPersistedBotProjections(ctx context.Context, list []*model.QuestionAgentLog) {
	for _, row := range list {
		if row == nil || strings.TrimSpace(row.BotRunId) == "" || strings.TrimSpace(row.UserName) == "" {
			continue
		}
		projection, err := LoadBotRunProjection(ctx, row.UserName, row.Id)
		if err != nil || strings.TrimSpace(projection.RunID) == "" || projection.RunID != strings.TrimSpace(row.BotRunId) {
			continue
		}
		applyBotProjectionToHistoryRow(row, projection)
	}
}

func applyBotProjectionToHistoryRow(row *model.QuestionAgentLog, projection BotRunProjection) bool {
	return applyBotProjectionToHistoryRowWithFormatted(row, projection, nil)
}

func persistedReviewAnswerMatchesReport(answer string, report string) bool {
	var shaped struct {
		Content string            `json:"content"`
		DocList []json.RawMessage `json:"doc_list"`
	}
	if err := json.Unmarshal([]byte(answer), &shaped); err != nil {
		return false
	}
	return shaped.Content == report && len(shaped.DocList) > 0
}

func applyBotProjectionToHistoryRowWithFormatted(row *model.QuestionAgentLog, projection BotRunProjection, formatted *rxBot.Formatted) bool {
	if row == nil || strings.TrimSpace(projection.RunID) == "" {
		return false
	}
	if report := projection.VisibleReport(); strings.TrimSpace(report) != "" {
		preserveDurableReview := formatted == nil && projection.Agent == "review" &&
			persistedReviewAnswerMatchesReport(row.Answer, report)
		if !preserveDurableReview {
			row.Answer = rxBot.ShapeAnswer(projection.Agent, report, formatted)
		}
	}
	if strings.TrimSpace(projection.Status) != "" {
		row.Status = projection.Status
		if projectionHasPendingRequiredDelivery(projection) && !isProjectionFailureStatus(projection.Status) {
			row.Status = "RUNNING"
		}
	}
	if toolName := slugToToolName[projection.Agent]; toolName != "" {
		row.ToolName = toolName
	}
	return true
}

func (ps *Service) QueryListDelete(ctx context.Context, name string, id int) (int, error) {
	var root model.QuestionAgentLog
	needsTombstone := false
	err := model.DB(ctx).Transaction(func(tx *gorm.DB) error {
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("user_name = ? AND id = ? AND f_id = ?", name, id, 0).
			First(&root).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrConversationDeleteNotFound
		}
		if err != nil {
			return err
		}
		if root.DeleteAt != nil && root.LogStatus == conversationDeleteAcked {
			return nil
		}
		if root.DeleteAt != nil && root.LogStatus == conversationDeletePending {
			needsTombstone = true
			return nil
		}

		now := time.Now()
		updates := map[string]any{"log_status": conversationDeletePending}
		if root.DeleteAt == nil {
			updates["delete_at"] = now
		}
		result := tx.Model(&model.QuestionAgentLog{}).
			Where("user_name = ? AND id = ? AND f_id = ?", name, id, 0).
			Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrConversationDeleteNotFound
		}
		needsTombstone = true
		return nil
	})
	if errors.Is(err, ErrConversationDeleteNotFound) {
		return 0, ErrConversationDeleteNotFound
	}
	if err != nil {
		return 0, errors.New("failed to delete conversation")
	}
	if !needsTombstone {
		return id, nil
	}
	if err := ps.tombstoneDeletedConversation(context.WithoutCancel(ctx), root); err != nil {
		rxLog.SugarContext(ctx).Warnw(
			"conversation context tombstone deferred",
			"conversation_row_id", id,
			"reason", "bot_tombstone_failed",
		)
	}
	return id, nil
}

func (ps *Service) QueryListRename(ctx context.Context, name string, id int, rename string) (string, error) {
	db := model.DB(ctx).Model(&model.QuestionAgentLog{}).Debug()

	result := db.Where("user_name = ? and id = ? and f_id = 0 and delete_at IS NULL", name, id).Update("title_query", rename)
	if result.Error != nil {
		return "", errors.New("failed to update title query list")
	}
	if result.RowsAffected == 0 {
		return "", errors.New("no matching title query record found")
	}

	return rename, nil
}

func (ps *Service) QueryReactionType(ctx context.Context, id int, reactionType, name string) (int, error) {
	db := model.DB(ctx).Model(&model.QuestionAgentLog{}).Debug()

	result := db.Where("user_name = ? and id = ? and delete_at IS NULL", name, id).Update("reaction_type", reactionType)
	if result.Error != nil {
		return 0, errors.New("failed to update reaction record")
	}
	if result.RowsAffected == 0 {
		return 0, errors.New("no matching like/dislike record found")
	}

	return id, nil
}

func (ps *Service) QueryCollect(ctx context.Context, id int, collectType, name string) (int, error) {
	db := model.DB(ctx).Model(&model.QuestionAgentLog{}).Debug()

	result := db.Where("user_name = ? and id = ? and delete_at IS NULL", name, id).Update("collect_type", collectType)
	if result.Error != nil {
		return 0, errors.New("failed to update favorite record")
	}
	if result.RowsAffected == 0 {
		return 0, errors.New("no matching favorite record found")
	}

	return id, nil
}

func (ps *Service) QueryCollectList(ctx context.Context, name string) ([]*common.ApiQueryCollectListResponse, error) {

	CollectList := make([]*common.ApiQueryCollectListResponse, 0)
	err := model.DB(ctx).Model(&model.QuestionAgentLog{}).Debug().
		Where("user_name = ? and collect_type =? and delete_at IS NULL", name, "1").
		Order("created_at DESC").
		Find(&CollectList).Error
	if err != nil {
		return nil, errors.New("collect_list query failed")
	}

	return CollectList, nil
}
