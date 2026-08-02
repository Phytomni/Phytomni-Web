package api_handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"phytomni-server/common/i18n"
	"phytomni-server/service/api_service"
	"phytomni-server/utils/errs"

	"github.com/gin-gonic/gin"
)

const maxUploadControlBodyBytes int64 = 16 << 10

var errUploadControlBodyTooLarge = errors.New("upload control body too large")

type uploadCreateBody struct {
	Filename     string `json:"filename"`
	SizeBytes    int64  `json:"size_bytes"`
	ContentType  string `json:"content_type_hint,omitempty"`
	LastModified int64  `json:"last_modified_ms,omitempty"`
	Purpose      string `json:"purpose"`
}

// CreateUpload accepts metadata only. The authenticated Web identity supplies
// the owner; the browser chooses only its finite attachment purpose.
func (ph *Handler) CreateUpload(ctx *gin.Context) {
	username, ok := uploadUsername(ctx)
	if !ok {
		writeUploadError(ctx, http.StatusUnauthorized, "common.not_logged_in")
		return
	}
	if ctx.ContentType() != "application/json" {
		writeUploadError(ctx, http.StatusUnsupportedMediaType, "upload.unsupported_media_type")
		return
	}
	body, err := readUploadControlBody(ctx)
	if err != nil {
		if errors.Is(err, errUploadControlBodyTooLarge) {
			writeUploadError(ctx, http.StatusRequestEntityTooLarge, "upload.request_too_large")
		} else {
			writeUploadError(ctx, http.StatusBadRequest, "upload.invalid_request")
		}
		return
	}
	var request uploadCreateBody
	if err := decodeUploadCreateBody(body, &request); err != nil {
		writeUploadError(ctx, http.StatusBadRequest, "upload.invalid_request")
		return
	}
	keys := ctx.Request.Header.Values("Idempotency-Key")
	if len(keys) != 1 || strings.TrimSpace(keys[0]) == "" {
		writeUploadError(ctx, http.StatusBadRequest, "upload.invalid_request")
		return
	}

	result, err := ph.service.CreateUpload(ctx.Request.Context(), username, api_service.UploadCreateInput{
		Filename:     request.Filename,
		SizeBytes:    request.SizeBytes,
		ContentType:  request.ContentType,
		LastModified: request.LastModified,
		Purpose:      request.Purpose,
	}, keys[0])
	if err != nil {
		writeUploadServiceError(ctx, err)
		return
	}
	ctx.Header("Cache-Control", "no-store")
	ctx.JSON(errs.SucResp(result))
}

// RenewUploadCapability accepts no browser body. Web derives the owner from
// the authenticated identity and forwards only the path asset ID to Bot.
func (ph *Handler) RenewUploadCapability(ctx *gin.Context) {
	username, ok := uploadUsername(ctx)
	if !ok {
		writeUploadError(ctx, http.StatusUnauthorized, "common.not_logged_in")
		return
	}
	if !uploadRequestBodyEmpty(ctx) {
		writeUploadError(ctx, http.StatusBadRequest, "upload.invalid_request")
		return
	}
	result, err := ph.service.RenewUploadCapability(ctx.Request.Context(), username, ctx.Param("asset_id"))
	if err != nil {
		writeUploadServiceError(ctx, err)
		return
	}
	ctx.Header("Cache-Control", "no-store")
	ctx.JSON(errs.SucResp(result))
}

func uploadUsername(ctx *gin.Context) (string, bool) {
	value, exists := ctx.Get("username")
	username, ok := value.(string)
	return username, exists && ok && strings.TrimSpace(username) != ""
}

func readUploadControlBody(ctx *gin.Context) ([]byte, error) {
	if ctx.Request.Body == nil {
		return nil, nil
	}
	body, err := io.ReadAll(io.LimitReader(ctx.Request.Body, maxUploadControlBodyBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > maxUploadControlBodyBytes {
		return nil, errUploadControlBodyTooLarge
	}
	return body, nil
}

func decodeUploadCreateBody(body []byte, out *uploadCreateBody) error {
	if len(body) == 0 {
		return errors.New("empty upload control body")
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return err
	}
	var trailing interface{}
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return errors.New("multiple upload control values")
		}
		return err
	}
	return nil
}

func uploadRequestBodyEmpty(ctx *gin.Context) bool {
	if ctx.Request.Body == nil {
		return true
	}
	var one [1]byte
	n, err := ctx.Request.Body.Read(one[:])
	return n == 0 && (errors.Is(err, io.EOF) || err == nil)
}

func writeUploadServiceError(ctx *gin.Context, err error) {
	if errors.Is(err, api_service.ErrAttachmentPurposeInvalid) {
		writeUploadErrorCode(
			ctx,
			http.StatusUnprocessableEntity,
			"attachment_purpose_invalid",
			"upload.invalid_purpose",
		)
		return
	}
	if errors.Is(err, api_service.ErrUploadMetadataInvalid) {
		writeUploadError(ctx, http.StatusBadRequest, "upload.invalid_request")
		return
	}
	writeUploadError(ctx, http.StatusServiceUnavailable, "upload.unavailable")
}

func writeUploadErrorCode(ctx *gin.Context, status int, errorCode, messageKey string) {
	ctx.JSON(status, gin.H{
		"code":       status,
		"error_code": errorCode,
		"message":    i18n.T(ctx, messageKey),
	})
}

func writeUploadError(ctx *gin.Context, status int, messageKey string) {
	ctx.JSON(status, gin.H{
		"code":    status,
		"message": i18n.T(ctx, messageKey),
	})
}
