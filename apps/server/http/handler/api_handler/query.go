package api_handler

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

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
		return http.StatusServiceUnavailable, "服务暂不可用"
	case errors.Is(err, api_service.ErrUnknownTool):
		return http.StatusBadRequest, "未知的工具类型"
	}
	if msg, ok := rxBot.SurfaceableMessage(err); ok {
		return http.StatusBadRequest, msg
	}
	return http.StatusInternalServerError, "请求处理失败"
}

// Query is the gateway entry for chat sends. It parses the multipart form
// the Web app posts, hands it to the service, and returns the row the Web app renders.
// The Web app consumes this as JSON via axios; an SSE pass-through path (the Bot
// client exposes ChatCompletionStream) is wired once the Web app adopts streaming
// — today it never sends stream=true.
func (ph *Handler) Query(ctx *gin.Context) {
	name, _ := ctx.Get("username")

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
			ctx.JSON(http.StatusRequestEntityTooLarge, gin.H{"code": http.StatusRequestEntityTooLarge, "message": "上传内容过大"})
			return
		}
	}

	in := api_service.QueryInput{
		Query:   ctx.PostForm("query"),
		Tool:    ctx.PostForm("tool"),
		History: ctx.DefaultPostForm("history", "[]"),
	}
	if strings.TrimSpace(in.Query) == "" {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "查询内容不能为空"})
		return
	}
	// RESTful:会话 id 从路径 /conversations/:id/messages 取(id=0 表示新会话,
	// 沿用旧 DefaultPostForm("id","0") 的语义)。refresh_id 仍随 multipart body。
	in.Id, _ = strconv.ParseInt(ctx.Param("id"), 10, 64)
	in.RefreshId, _ = strconv.ParseInt(ctx.DefaultPostForm("refresh_id", "0"), 10, 64)

	if form != nil {
		files := form.File["files"]
		sizes := make([]int64, len(files))
		for i, fh := range files {
			sizes[i] = fh.Size
		}
		if verr := rxBot.CheckFiles(sizes); verr != nil {
			ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": verr.Error()})
			return
		}
		for _, fh := range files {
			f, err := fh.Open()
			if err != nil {
				ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "无法读取上传文件"})
				return
			}
			data, err := io.ReadAll(f)
			_ = f.Close()
			if err != nil {
				ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "无法读取上传文件"})
				return
			}
			in.Files = append(in.Files, api_service.QueryFile{Filename: fh.Filename, Data: data})
		}
	}

	data, err := ph.service.Query(ctx, name.(string), in)
	if err != nil {
		status, msg := queryErrorStatus(err)
		if status >= http.StatusInternalServerError {
			rxLog.Sugar().Errorw("ApiQuery failed", "user", name, "err", err)
		} else {
			rxLog.Sugar().Warnw("ApiQuery client error", "user", name, "status", status, "err", err)
		}
		ctx.JSON(status, gin.H{"code": status, "message": msg})
		return
	}
	ctx.JSON(errs.SucResp(data))
}

// QueryAnalystUpdateLog syncs a finished remote task result back into the
// Web row. The Web app posts task_id plus compute_resource.
func (ph *Handler) QueryAnalystUpdateLog(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	taskID := ctx.PostForm("task_id")
	computeResource := ctx.PostForm("compute_resource")

	result, err := ph.service.QueryAnalystUpdateLog(ctx, name.(string), taskID, computeResource)
	if err != nil {
		status, msg := queryErrorStatus(err)
		if status >= http.StatusInternalServerError {
			rxLog.Sugar().Errorw("ApiQueryAnalystUpdateLog failed", "user", name, "err", err)
		} else {
			rxLog.Sugar().Warnw("ApiQueryAnalystUpdateLog client error", "user", name, "status", status, "err", err)
		}
		ctx.JSON(status, gin.H{"code": status, "message": msg})
		return
	}
	ctx.JSON(errs.SucResp(result))
}
