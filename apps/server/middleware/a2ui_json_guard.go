package middleware

import (
	"bytes"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"strings"

	"phytomni-server/common"
	"phytomni-server/common/i18n"

	"github.com/gin-gonic/gin"
)

// A2uiActionMaxRequestBytes bounds the request body before any downstream
// middleware (including audit logging) is allowed to read it.
const A2uiActionMaxRequestBytes int64 = 64 << 10

const (
	a2uiInvalidJSONCode      = "a2ui_invalid_json"
	a2uiRequestTooLargeCode  = "a2ui_request_too_large"
	a2uiUnsupportedMediaCode = "a2ui_unsupported_media_type"
)

// A2uiJSONGuard validates and bounds the A2UI action body before downstream
// handlers can consume it. Only JSON media types are accepted, and a valid
// body is restored for the next handler after validation.
func A2uiJSONGuard() gin.HandlerFunc {
	return func(c *gin.Context) {
		mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
		if err != nil || !isA2uiJSONMediaType(mediaType) {
			abortA2uiJSONGuard(c, http.StatusUnsupportedMediaType, a2uiUnsupportedMediaCode, "a2ui.unsupported_media_type")
			return
		}

		if c.Request == nil {
			abortA2uiJSONGuard(c, http.StatusBadRequest, a2uiInvalidJSONCode, "a2ui.invalid_json")
			return
		}

		body := c.Request.Body
		if body == nil {
			body = http.NoBody
		}
		originalBody := body
		defer originalBody.Close()

		bounded := io.LimitReader(body, A2uiActionMaxRequestBytes+1)
		rawBody, readErr := io.ReadAll(bounded)
		if int64(len(rawBody)) > A2uiActionMaxRequestBytes {
			abortA2uiJSONGuard(c, http.StatusRequestEntityTooLarge, a2uiRequestTooLargeCode, "a2ui.request_too_large")
			return
		}
		if readErr != nil || !json.Valid(rawBody) {
			abortA2uiJSONGuard(c, http.StatusBadRequest, a2uiInvalidJSONCode, "a2ui.invalid_json")
			return
		}

		c.Request.Body = io.NopCloser(bytes.NewReader(rawBody))
		c.Request.ContentLength = int64(len(rawBody))
		c.Next()
	}
}

func isA2uiJSONMediaType(mediaType string) bool {
	mediaType = strings.ToLower(mediaType)
	return strings.EqualFold(mediaType, "application/json") || strings.HasSuffix(mediaType, "+json")
}

func abortA2uiJSONGuard(c *gin.Context, status int, code, messageKey string) {
	common.WriteA2uiHTTPError(c, status, code, i18n.T(c, messageKey), false, false)
	c.Abort()
}
