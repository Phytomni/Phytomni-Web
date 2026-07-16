package api_handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"phytomni-server/common"
	"phytomni-server/common/i18n"
	rxBot "phytomni-server/external/bot"
	rxLog "phytomni-server/log"
	"phytomni-server/service/api_service"
	"phytomni-server/utils/errs"

	"github.com/gin-gonic/gin"
)

// queryErrorStatus maps a /query service error to the HTTP status and message
// the Web app and ops should see, so a disabled gateway (503) and an unknown tool
// (400) are distinguishable from a client-correctable Bot 4xx (its surfaced
// message) and from an opaque server failure (500, generic message).
func queryErrorStatus(err error) (int, string) {
	switch {
	case errors.Is(err, api_service.ErrGatewayDisabled):
		return http.StatusServiceUnavailable, "service temporarily unavailable"
	case errors.Is(err, api_service.ErrUnknownTool):
		return http.StatusBadRequest, "unknown tool type"
	case errors.Is(err, api_service.ErrExpertDisabled):
		return http.StatusServiceUnavailable, "expert mode not available"
	case errors.Is(err, api_service.ErrMissingBotRunID):
		return http.StatusConflict, "task is not syncable through bot run state"
	case errors.Is(err, api_service.ErrInvalidA2uiSurface):
		return http.StatusBadRequest, "invalid input-required surface"
	case errors.Is(err, rxBot.ErrBotTimeout):
		return http.StatusGatewayTimeout, "request timed out, please narrow your query or try again later"
	case errors.Is(err, api_service.ErrStreamUnsupported):
		return http.StatusBadRequest, "streaming not supported for this request"
	}
	if msg, ok := rxBot.SurfaceableMessage(err); ok {
		return http.StatusBadRequest, msg
	}
	return http.StatusInternalServerError, "request failed"
}

func writeQueryError(ctx *gin.Context, status int, message string) {
	body := gin.H{"code": status, "message": message}
	if requestID := common.A2uiRequestID(ctx); requestID != "" {
		body["request_id"] = requestID
	}
	ctx.JSON(status, body)
}

// wantsStream reports whether the caller opted into SSE via the Accept header.
func wantsStream(ctx *gin.Context) bool {
	return strings.Contains(ctx.GetHeader("Accept"), "text/event-stream")
}

// streamEnabled reports whether the AG-UI streaming dark-launch flag is on.
func streamEnabled() bool {
	return rxBot.BotConfig != nil && rxBot.BotConfig.StreamEnabled
}

// Query is the gateway entry for chat sends. It parses the multipart form
// the Web app posts, hands it to the service, and returns the row the Web app renders.
// The Web app consumes this as JSON via axios by default. A caller can opt into
// AG-UI SSE pass-through by sending Accept: text/event-stream; when the
// bot.stream_enabled dark-launch flag is also on and the turn is Instant (not
// mode=expert), the response streams as text/event-stream frames instead of the
// blocking JSON envelope.
func (ph *Handler) Query(ctx *gin.Context) {
	name, _ := ctx.Get("username")

	// Reject inert accounts before any body parsing or Bot relay.
	if email, _ := name.(string); email != "" {
		if err := ph.service.CheckChatAllowed(ctx, email); err != nil {
			ctx.JSON(http.StatusForbidden, gin.H{
				"code":    http.StatusForbidden,
				"message": i18n.T(ctx, "chat.quota_exhausted"),
			})
			return
		}
	}

	_, totalBytes, _ := rxBot.UploadLimits()
	ctx.Request.Body = http.MaxBytesReader(ctx.Writer, ctx.Request.Body, totalBytes)

	// Parse the bounded multipart body once: a MaxBytesReader trip surfaces
	// here, so an over-limit upload is reported as too large rather than
	// mislabeled as an empty query. (/query is multipart-only from the Web app; a
	// non-multipart body yields ErrNotMultipart and simply carries no files.)
	form, formErr := ctx.MultipartForm()
	if formErr != nil {
		var maxErr *http.MaxBytesError
		if errors.As(formErr, &maxErr) || strings.Contains(formErr.Error(), "request body too large") {
			ctx.JSON(http.StatusRequestEntityTooLarge, gin.H{"code": http.StatusRequestEntityTooLarge, "message": i18n.T(ctx, "query.upload_too_large")})
			return
		}
	}

	in := api_service.QueryInput{
		Query:   ctx.PostForm("query"),
		Tool:    ctx.PostForm("tool"),
		History: ctx.DefaultPostForm("history", "[]"),
		Mode:    ctx.DefaultPostForm("mode", "instant"),
	}
	if strings.TrimSpace(in.Query) == "" {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "query.query_empty")})
		return
	}
	// RESTful: conversation id from path /conversations/:id/messages (id=0 means a
	// new conversation, preserving the old DefaultPostForm("id","0") semantics).
	// refresh_id still travels in the multipart body.
	in.Id, _ = strconv.ParseInt(ctx.Param("id"), 10, 64)
	in.RefreshId, _ = strconv.ParseInt(ctx.DefaultPostForm("refresh_id", "0"), 10, 64)

	if form != nil {
		files := form.File["files"]
		sizes := make([]int64, len(files))
		for i, fh := range files {
			sizes[i] = fh.Size
		}
		if verr := rxBot.CheckFiles(sizes); verr != nil {
			ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.TMaybe(ctx, verr.Error())})
			return
		}
		for _, fh := range files {
			f, err := fh.Open()
			if err != nil {
				ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "query.file_unreadable")})
				return
			}
			data, err := io.ReadAll(f)
			_ = f.Close()
			if err != nil {
				ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "query.file_unreadable")})
				return
			}
			in.Files = append(in.Files, api_service.QueryFile{Filename: fh.Filename, Data: data})
		}
	}

	// SSE branch (dark-launch). Taken when the caller accepts
	// text/event-stream, the flag is on, and the turn is Instant. The
	// chat-family restriction is enforced downstream in QueryStream (via
	// ChatModelFor); a non-chat slug reaching here is refused with
	// ErrStreamUnsupported before any frame. Expert must fall through to the
	// blocking path, which owns RouteQuery dispatch and the expert_enabled dark
	// gate — the frontend forces tool="" in Expert, so slug alone cannot tell
	// the two apart. The route middleware (auth, per-user rate limit) and the
	// multipart parse above have already run, so the gate order holds.
	if streamEnabled() && wantsStream(ctx) && in.Mode != "expert" {
		flusher, canFlush := ctx.Writer.(http.Flusher)
		if canFlush {
			// Write the SSE headers lazily — only when the first frame is
			// actually forwarded. If QueryStream fails BEFORE any frame (a
			// pre-first-byte error: ErrGatewayDisabled, the expert/non-chat
			// ErrStreamUnsupported guards, ErrUnknownTool, or an upload /
			// dialogue-resolve / stream-open failure), the headers are still
			// unset, so the error can ship as a normal JSON response with the
			// correct Content-Type. Staging the SSE headers up front would pin
			// Content-Type: text/event-stream onto a JSON error body (Gin's
			// writeContentType only sets it when the header map is empty), and
			// an SSE-aware client would silently fail to
			// parse the error.
			headerSent := false
			onReady := func(identity api_service.StreamIdentity) {
				ctx.Header("X-Phyto-Dialogue-Id", identity.DialogueID)
				ctx.Header("X-Phyto-Message-Id", strconv.FormatInt(identity.MessageID, 10))
			}
			forward := func(frame []byte) error {
				if !headerSent {
					ctx.Header("Content-Type", "text/event-stream")
					ctx.Header("Cache-Control", "no-cache")
					ctx.Header("Connection", "keep-alive")
					ctx.Header("X-Accel-Buffering", "no")
					ctx.Status(http.StatusOK)
					headerSent = true
				}
				if _, werr := ctx.Writer.Write(frame); werr != nil {
					return werr
				}
				flusher.Flush()
				return nil
			}
			_, serr := ph.service.QueryStream(ctx, name.(string), in, onReady, forward)
			if serr != nil {
				status, msg := queryErrorStatus(serr)
				if headerSent {
					// Frames already flushed: HTTP status is locked, so surface
					// the failure as an in-band SSE error frame. Encode the
					// message with json.Marshal so any character is escaped to
					// valid JSON (fmt's %q is Go-quoting, not JSON-quoting).
					msgJSON, _ := json.Marshal(msg)
					_, _ = fmt.Fprintf(ctx.Writer, "event: RunError\ndata: {\"type\":\"RunError\",\"message\":%s}\n\n", msgJSON)
					flusher.Flush()
				} else {
					// Pre-first-byte failure: no SSE headers were written, so a
					// normal JSON error with the right Content-Type still ships.
					writeQueryError(ctx, status, msg)
				}
			}
			return
		}
		// Writer cannot flush (test double / unusual proxy): fall through to
		// the blocking path rather than panicking.
	}

	data, err := ph.service.Query(ctx, name.(string), in)
	if err != nil {
		status, msg := queryErrorStatus(err)
		if status >= http.StatusInternalServerError {
			rxLog.Sugar().Errorw("ApiQuery failed", "user", name, "err", err)
		} else {
			rxLog.Sugar().Warnw("ApiQuery client error", "user", name, "status", status, "err", err)
		}
		writeQueryError(ctx, status, msg)
		return
	}
	// QueryData carries the Web request id for client correlation. The service
	// normally derives it from Gin's context; keep the handler as the final
	// boundary so custom service contexts cannot drop the id from the envelope.
	if data.RequestID == "" {
		if requestID, ok := ctx.Get("x-request-id"); ok {
			if id, ok := requestID.(string); ok {
				data.RequestID = strings.TrimSpace(id)
			}
		}
	}
	ctx.JSON(errs.SucResp(data))
}

// QueryAnalystUpdateLog syncs a finished remote task result back into the
// Web row. The Web app posts task_id plus compute_resource.
func (ph *Handler) QueryAnalystUpdateLog(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	taskID := strings.TrimSpace(ctx.PostForm("task_id"))
	if taskID == "" {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "query.task_id_required")})
		return
	}
	computeResource := ctx.PostForm("compute_resource")

	result, err := ph.service.QueryAnalystUpdateLog(ctx, name.(string), taskID, computeResource)
	if err != nil {
		status, msg := queryErrorStatus(err)
		if status >= http.StatusInternalServerError {
			rxLog.Sugar().Errorw("ApiQueryAnalystUpdateLog failed", "user", name, "err", err)
		} else {
			rxLog.Sugar().Warnw("ApiQueryAnalystUpdateLog client error", "user", name, "status", status, "err", err)
		}
		writeQueryError(ctx, status, msg)
		return
	}
	ctx.JSON(errs.SucResp(result))
}
