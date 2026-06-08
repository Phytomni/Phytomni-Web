package api_handler

import (
	"io"
	"net/http"
	"strconv"

	rxLog "nky_client_go/log"
	"nky_client_go/service/api_service"
	"nky_client_go/utils/errs"

	"github.com/gin-gonic/gin"
)

// ApiQuery is the gateway entry for chat sends. It parses the multipart form
// chat-ai posts, hands it to the service, and returns the row chat-ai renders.
// chat-ai consumes this as JSON via axios; an SSE pass-through path (the Bot
// client exposes ChatCompletionStream) is wired once chat-ai adopts streaming
// — today it never sends stream=true.
func (ph *ApiHandler) ApiQuery(ctx *gin.Context) {
	name, _ := ctx.Get("username")

	in := api_service.QueryInput{
		Query:   ctx.PostForm("query"),
		Tool:    ctx.PostForm("tool"),
		History: ctx.DefaultPostForm("history", "[]"),
	}
	in.Id, _ = strconv.ParseInt(ctx.DefaultPostForm("id", "0"), 10, 64)
	in.RefreshId, _ = strconv.ParseInt(ctx.DefaultPostForm("refresh_id", "0"), 10, 64)

	if form, err := ctx.MultipartForm(); err == nil && form != nil {
		for _, fh := range form.File["files"] {
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

	data, err := ph.service.ApiQuery(ctx, name.(string), in)
	if err != nil {
		rxLog.Sugar().Errorw("ApiQuery failed", "user", name, "err", err)
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": "请求处理失败"})
		return
	}
	ctx.JSON(errs.SucResp(data))
}

// ApiQueryAnalystUpdateLog syncs a finished remote task result back into the
// Web row. chat-ai posts task_id plus compute_resource.
func (ph *ApiHandler) ApiQueryAnalystUpdateLog(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	taskID := ctx.PostForm("task_id")
	computeResource := ctx.PostForm("compute_resource")

	result, err := ph.service.ApiQueryAnalystUpdateLog(ctx, name.(string), taskID, computeResource)
	if err != nil {
		rxLog.Sugar().Errorw("ApiQueryAnalystUpdateLog failed", "user", name, "err", err)
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": "请求处理失败"})
		return
	}
	ctx.JSON(errs.SucResp(result))
}
