package api_handler

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strconv"
	"time"

	"phytomni-server/common/i18n"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/service/api_service"
	"phytomni-server/utils/errs"

	"github.com/gin-gonic/gin"
)

func executionEventIdentity(ctx *gin.Context) (string, string, string, bool) {
	value, _ := ctx.Get("username")
	username, ok := value.(string)
	return username, ctx.Param("id"), ctx.Param("run_id"), ok && username != ""
}

func publicExecutionIdentity(ctx *gin.Context) (string, string, bool) {
	value, _ := ctx.Get("username")
	username, ok := value.(string)
	return username, ctx.Param("execution_id"), ok && username != ""
}

func executionCursor(ctx *gin.Context) (int64, error) {
	value := ctx.Query("after_seq")
	if value == "" {
		value = ctx.GetHeader("Last-Event-ID")
	}
	if value == "" {
		value = "0"
	}
	cursor, err := strconv.ParseInt(value, 10, 64)
	if err != nil || cursor < 0 {
		return 0, errors.New(i18n.T(ctx, "execution.invalid_cursor"))
	}
	return cursor, nil
}

func executionEventError(ctx *gin.Context, err error) {
	if errors.Is(err, api_service.ErrExecutionRunOwnership) {
		ctx.JSON(http.StatusNotFound, gin.H{"code": http.StatusNotFound, "message": i18n.T(ctx, "execution.resource_not_found")})
		return
	}
	ctx.JSON(http.StatusBadGateway, gin.H{"code": http.StatusBadGateway, "message": i18n.T(ctx, "execution.history_unavailable")})
}

func (ph *Handler) ConversationRunEvents(ctx *gin.Context) {
	username, dialogueID, runID, ok := executionEventIdentity(ctx)
	if !ok {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": i18n.T(ctx, "execution.unauthorized")})
		return
	}
	afterSeq, err := strconv.ParseInt(ctx.DefaultQuery("after_seq", "0"), 10, 64)
	if err != nil || afterSeq < 0 {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "execution.invalid_cursor")})
		return
	}
	limit, err := strconv.Atoi(ctx.DefaultQuery("limit", "50"))
	if err != nil || limit < 1 || limit > 200 {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "execution.invalid_limit")})
		return
	}
	page, err := ph.service.ConversationRunEvents(ctx, username, dialogueID, runID, afterSeq, limit)
	if err != nil {
		executionEventError(ctx, err)
		return
	}
	ctx.JSON(errs.SucResp(page))
}

func (ph *Handler) ConversationRunEventProjection(ctx *gin.Context) {
	username, dialogueID, runID, ok := executionEventIdentity(ctx)
	if !ok {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": i18n.T(ctx, "execution.unauthorized")})
		return
	}
	projection, err := ph.service.ConversationRunEventProjection(ctx, username, dialogueID, runID)
	if err != nil {
		executionEventError(ctx, err)
		return
	}
	ctx.JSON(errs.SucResp(projection))
}

func (ph *Handler) ConversationRunEvent(ctx *gin.Context) {
	username, dialogueID, runID, ok := executionEventIdentity(ctx)
	if !ok {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": i18n.T(ctx, "execution.unauthorized")})
		return
	}
	event, err := ph.service.ConversationRunEvent(ctx, username, dialogueID, runID, ctx.Param("event_id"))
	if err != nil {
		executionEventError(ctx, err)
		return
	}
	ctx.JSON(errs.SucResp(event))
}

func (ph *Handler) ConversationRunExecutionTarget(ctx *gin.Context) {
	username, dialogueID, runID, ok := executionEventIdentity(ctx)
	if !ok {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": i18n.T(ctx, "execution.unauthorized")})
		return
	}
	target, err := ph.service.ConversationRunExecutionTarget(
		ctx, username, dialogueID, runID, ctx.Param("kind"), ctx.Param("target_id"),
	)
	if err != nil {
		executionEventError(ctx, err)
		return
	}
	ctx.JSON(errs.SucResp(target))
}

func (ph *Handler) ConversationRunEventStream(ctx *gin.Context) {
	username, dialogueID, runID, ok := executionEventIdentity(ctx)
	if !ok {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": i18n.T(ctx, "execution.unauthorized")})
		return
	}
	cursorValue := ctx.Query("after_seq")
	if cursorValue == "" {
		cursorValue = ctx.GetHeader("Last-Event-ID")
	}
	if cursorValue == "" {
		cursorValue = "0"
	}
	afterSeq, err := strconv.ParseInt(cursorValue, 10, 64)
	if err != nil || afterSeq < 0 {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "execution.invalid_cursor")})
		return
	}
	body, _, err := ph.service.ConversationRunEventStream(ctx, username, dialogueID, runID, afterSeq)
	if err != nil {
		executionEventError(ctx, err)
		return
	}
	defer body.Close()
	ctx.Header("Content-Type", "text/event-stream")
	ctx.Header("Cache-Control", "no-cache")
	ctx.Header("X-Accel-Buffering", "no")
	ctx.Status(http.StatusOK)
	_, _ = io.Copy(ctx.Writer, body)
}

func (ph *Handler) ExecutionEvents(ctx *gin.Context) {
	username, executionID, ok := publicExecutionIdentity(ctx)
	if !ok {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": i18n.T(ctx, "execution.unauthorized")})
		return
	}
	afterSeq, err := executionCursor(ctx)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "execution.invalid_cursor")})
		return
	}
	limit, err := strconv.Atoi(ctx.DefaultQuery("limit", "50"))
	if err != nil || limit < 1 || limit > 200 {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "execution.invalid_limit")})
		return
	}
	page, err := ph.service.ExecutionEventsPageV2(ctx, username, executionID, afterSeq, limit)
	if err != nil {
		executionEventError(ctx, err)
		return
	}
	ctx.JSON(errs.SucResp(page))
}

func (ph *Handler) ExecutionEventProjection(ctx *gin.Context) {
	username, executionID, ok := publicExecutionIdentity(ctx)
	if !ok {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": i18n.T(ctx, "execution.unauthorized")})
		return
	}
	projection, err := ph.service.ExecutionSnapshotV2(ctx, username, executionID)
	if err != nil {
		executionEventError(ctx, err)
		return
	}
	ctx.JSON(errs.SucResp(projection))
}

func (ph *Handler) ExecutionEvent(ctx *gin.Context) {
	username, executionID, ok := publicExecutionIdentity(ctx)
	if !ok {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": i18n.T(ctx, "execution.unauthorized")})
		return
	}
	event, err := ph.service.ExecutionEventDetailV2(ctx, username, executionID, ctx.Param("event_id"))
	if err != nil {
		executionEventError(ctx, err)
		return
	}
	ctx.JSON(errs.SucResp(event))
}

func (ph *Handler) ExecutionOperation(ctx *gin.Context) {
	username, executionID, ok := publicExecutionIdentity(ctx)
	if !ok {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": i18n.T(ctx, "execution.unauthorized")})
		return
	}
	operation, err := ph.service.ExecutionOperationDetailV2(
		ctx, username, executionID, ctx.Param("operation_id"),
	)
	if err != nil {
		executionEventError(ctx, err)
		return
	}
	ctx.JSON(errs.SucResp(operation))
}

func (ph *Handler) ExecutionTarget(ctx *gin.Context) {
	username, executionID, ok := publicExecutionIdentity(ctx)
	if !ok {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": i18n.T(ctx, "execution.unauthorized")})
		return
	}
	if ctx.Param("kind") == "trace" {
		afterSeq, cursorErr := executionCursor(ctx)
		limit, limitErr := strconv.Atoi(ctx.DefaultQuery("limit", "50"))
		if cursorErr != nil || limitErr != nil || limit < 1 || limit > 100 {
			ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "execution.invalid_trace_cursor")})
			return
		}
		trace, traceErr := ph.service.ExecutionTraceResolutionV1(
			ctx, username, executionID, ctx.Param("target_id"), afterSeq, limit,
		)
		if traceErr != nil {
			executionEventError(ctx, traceErr)
			return
		}
		ctx.JSON(errs.SucResp(trace))
		return
	}
	target, err := ph.service.ExecutionTargetResolutionV2(
		ctx, username, executionID, ctx.Param("kind"), ctx.Param("target_id"),
	)
	if err != nil {
		executionEventError(ctx, err)
		return
	}
	ctx.JSON(errs.SucResp(target))
}

func (ph *Handler) ExecutionTargetContent(ctx *gin.Context) {
	username, executionID, ok := publicExecutionIdentity(ctx)
	if !ok {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": i18n.T(ctx, "execution.unauthorized")})
		return
	}
	body, metadata, err := ph.service.OpenExecutionTargetContentV2(
		ctx, username, executionID, ctx.Param("kind"), ctx.Param("target_id"),
	)
	if err != nil {
		executionEventError(ctx, err)
		return
	}
	defer body.Close()
	ctx.Header("Content-Type", metadata.MediaType)
	ctx.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": metadata.FileName}))
	ctx.Header("Cache-Control", "private, no-store")
	ctx.Header("X-Content-Type-Options", "nosniff")
	ctx.Status(http.StatusOK)
	_, _ = io.Copy(ctx.Writer, body)
}

func (ph *Handler) ExecutionEventStream(ctx *gin.Context) {
	username, executionID, ok := publicExecutionIdentity(ctx)
	if !ok {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": i18n.T(ctx, "execution.unauthorized")})
		return
	}
	afterSeq, err := executionCursor(ctx)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "execution.invalid_cursor")})
		return
	}
	afterRevision, err := strconv.ParseInt(ctx.DefaultQuery("after_revision", "0"), 10, 64)
	if err != nil || afterRevision < 0 {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "execution.invalid_content_revision")})
		return
	}
	afterOffset, err := strconv.ParseInt(ctx.DefaultQuery("after_offset", "0"), 10, 64)
	if err != nil || afterOffset < 0 {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "execution.invalid_content_offset")})
		return
	}
	snapshot, err := ph.service.ExecutionStreamSnapshotV2(ctx, username, executionID)
	if err != nil {
		executionEventError(ctx, err)
		return
	}
	ctx.Header("Content-Type", "text/event-stream")
	ctx.Header("Cache-Control", "no-cache")
	ctx.Header("X-Accel-Buffering", "no")
	ctx.Status(http.StatusOK)
	encoded, _ := json.Marshal(snapshot)
	_, _ = fmt.Fprintf(ctx.Writer, "event: execution_snapshot\ndata: %s\n\n", encoded)
	flusher, _ := ctx.Writer.(http.Flusher)
	if flusher != nil {
		flusher.Flush()
	}

	// A valid early admission remains attached while the outbox worker obtains
	// Bot acknowledgement. The browser sees an immediate snapshot and periodic
	// heartbeat instead of a silent pending request or 404/502 race.
	poll := time.NewTicker(250 * time.Millisecond)
	heartbeat := time.NewTicker(15 * time.Second)
	defer poll.Stop()
	defer heartbeat.Stop()
	for {
		binding, bindErr := ph.service.ExecutionAdmissionBinding(ctx, username, executionID)
		if bindErr != nil {
			return
		}
		if binding.RunID != nil {
			break
		}
		if binding.TerminalStatus != nil {
			return
		}
		select {
		case <-ctx.Request.Context().Done():
			return
		case <-heartbeat.C:
			_, _ = io.WriteString(ctx.Writer, ": heartbeat\n\n")
			if flusher != nil {
				flusher.Flush()
			}
		case <-poll.C:
		}
	}
	var body io.ReadCloser
	trackingNoticeSent := false
	retry := time.NewTicker(2 * time.Second)
	degradedHeartbeat := time.NewTicker(15 * time.Second)
	defer retry.Stop()
	defer degradedHeartbeat.Stop()
	for body == nil {
		body, err = ph.service.OpenExecutionStreamV2(ctx, username, executionID, afterSeq, afterRevision, afterOffset)
		if err == nil {
			break
		}
		if !trackingNoticeSent {
			control := gin.H{"schema_version": 2, "execution_id": executionID, "tracking_health": "degraded", "reason": "bot_unavailable"}
			encoded, _ := json.Marshal(control)
			_, _ = fmt.Fprintf(ctx.Writer, "event: execution_tracking\ndata: %s\n\n", encoded)
			if flusher != nil {
				flusher.Flush()
			}
			trackingNoticeSent = true
		}
		binding, bindErr := ph.service.ExecutionAdmissionBinding(ctx, username, executionID)
		if bindErr != nil {
			return
		}
		if binding.TerminalStatus != nil {
			latest, snapshotErr := ph.service.ExecutionSnapshotV2(ctx, username, executionID)
			if snapshotErr == nil {
				encoded, _ := json.Marshal(latest)
				_, _ = fmt.Fprintf(ctx.Writer, "event: execution_snapshot\ndata: %s\n\n", encoded)
				if flusher != nil {
					flusher.Flush()
				}
			}
			return
		}
		select {
		case <-ctx.Request.Context().Done():
			return
		case <-degradedHeartbeat.C:
			_, _ = io.WriteString(ctx.Writer, ": heartbeat\n\n")
			if flusher != nil {
				flusher.Flush()
			}
		case <-retry.C:
		}
	}
	defer body.Close()
	_, _ = copyExecutionStream(ctx.Writer, flusher, body, executionID)
}

type executionFlushWriter struct {
	writer  io.Writer
	flusher http.Flusher
}

func (writer executionFlushWriter) Write(payload []byte) (int, error) {
	written, err := writer.writer.Write(payload)
	if written > 0 && writer.flusher != nil {
		writer.flusher.Flush()
	}
	return written, err
}

// copyExecutionStream forwards every upstream SSE write and flushes it at the
// Web boundary. A plain io.Copy may leave Bot heartbeats and low-volume Agent
// activity buffered until the connection closes, which makes a healthy long
// execution look stalled and triggers browser reconnects.
func copyExecutionStream(
	destination io.Writer,
	flusher http.Flusher,
	source io.Reader,
	expectedExecutionID string,
) (int64, error) {
	reader := bufio.NewReader(source)
	writer := executionFlushWriter{writer: destination, flusher: flusher}
	var frame bytes.Buffer
	var written int64
	flushFrame := func() error {
		if frame.Len() == 0 {
			return nil
		}
		normalized, err := rxBot.NormalizeExecutionEventFrameV2(frame.Bytes(), expectedExecutionID)
		if err != nil {
			return err
		}
		count, err := writer.Write(normalized)
		written += int64(count)
		frame.Reset()
		return err
	}
	for {
		line, readErr := reader.ReadBytes('\n')
		frame.Write(line)
		if bytes.Equal(line, []byte("\n")) || bytes.Equal(line, []byte("\r\n")) {
			if err := flushFrame(); err != nil {
				return written, err
			}
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				if err := flushFrame(); err != nil {
					return written, err
				}
				return written, nil
			}
			return written, readErr
		}
	}
}

func (ph *Handler) ExecutionSnapshot(ctx *gin.Context) {
	username, executionID, ok := publicExecutionIdentity(ctx)
	if !ok {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": i18n.T(ctx, "execution.unauthorized")})
		return
	}
	snapshot, err := ph.service.ExecutionSnapshotV2(ctx, username, executionID)
	if err != nil {
		executionEventError(ctx, err)
		return
	}
	ctx.JSON(errs.SucResp(snapshot))
}

func executionControlError(ctx *gin.Context, err error) {
	if errors.Is(err, api_service.ErrExecutionRunOwnership) {
		ctx.JSON(http.StatusNotFound, gin.H{"code": http.StatusNotFound, "message": i18n.T(ctx, "execution.resource_not_found")})
		return
	}
	var apiErr *rxBot.APIError
	if errors.As(err, &apiErr) && apiErr.Status >= 400 && apiErr.Status < 500 {
		ctx.JSON(apiErr.Status, gin.H{"code": apiErr.Status, "message": i18n.T(ctx, "execution.control_rejected")})
		return
	}
	ctx.JSON(http.StatusBadGateway, gin.H{"code": http.StatusBadGateway, "message": i18n.T(ctx, "execution.control_unavailable")})
}

func (ph *Handler) ExecutionAction(ctx *gin.Context) {
	username, executionID, ok := publicExecutionIdentity(ctx)
	if !ok {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": i18n.T(ctx, "execution.unauthorized")})
		return
	}
	var request rxBot.ExecutionActionRequestV2
	decoder := json.NewDecoder(ctx.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil || request.ActionID == "" || request.ExpectedRevision < 0 {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "execution.invalid_action")})
		return
	}
	response, err := ph.service.ExecutionActionV2(ctx, username, executionID, request)
	if err != nil {
		executionControlError(ctx, err)
		return
	}
	ctx.JSON(http.StatusAccepted, response)
}

func (ph *Handler) ExecutionCancel(ctx *gin.Context) {
	username, executionID, ok := publicExecutionIdentity(ctx)
	if !ok {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": i18n.T(ctx, "execution.unauthorized")})
		return
	}
	var request rxBot.ExecutionCancelRequestV2
	decoder := json.NewDecoder(ctx.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil || request.RequestID == "" || request.ExpectedRevision < 0 {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "execution.invalid_cancellation")})
		return
	}
	response, err := ph.service.ExecutionCancelV2(ctx, username, executionID, request)
	if err != nil {
		executionControlError(ctx, err)
		return
	}
	ctx.JSON(http.StatusAccepted, response)
}
