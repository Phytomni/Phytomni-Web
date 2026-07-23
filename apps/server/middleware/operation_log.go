package middleware

import (
	"bytes"
	"encoding/json"
	"io"
	"net/url"
	rxLog "phytomni-server/log"
	"phytomni-server/model"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// sensitiveFieldSubstrings matches the lowercased JSON / query-parameter
// key against any of these substrings — a hit replaces the value with
// "******" before the audit log row hits MySQL. The intent is to catch
// the long tail of credential-bearing field names (api_key, access_token,
// refresh_token, authorization, etc.) without enumerating every variant.
var sensitiveFieldSubstrings = []string{
	"password",
	"passwd",
	"token",
	"secret",
	"api_key",
	"apikey",
	"access_key",
	"accesskey",
	"private_key",
	"privatekey",
	"authorization",
}

// redactedMask is the constant placeholder that replaces masked values
// in the audit log. Twelve characters mirrors the prior /login redact
// width so existing log readers stay visually aligned.
const redactedMask = "******"

// looksSensitive reports whether a (lowercase) key name matches one of
// the registered substring fragments. Substring matching catches the
// "old_password", "new_password", "x-api-key" and "client_secret"
// variants that an exact-match list would miss.
func looksSensitive(key string) bool {
	lowered := strings.ToLower(key)
	for _, frag := range sensitiveFieldSubstrings {
		if strings.Contains(lowered, frag) {
			return true
		}
	}
	return false
}

// redactValue recursively walks an arbitrary JSON value. Map keys matching
// looksSensitive are masked wholesale (no descent into their value); other
// map values and array elements are recursed. Scalars are returned as-is.
func redactValue(v interface{}) interface{} {
	switch node := v.(type) {
	case map[string]interface{}:
		for key, child := range node {
			if looksSensitive(key) {
				node[key] = redactedMask
				continue
			}
			node[key] = redactValue(child)
		}
		return node
	case []interface{}:
		for i, child := range node {
			node[i] = redactValue(child)
		}
		return node
	default:
		return v
	}
}

// redactJSONBody parses a JSON body and recursively masks every key matching
// looksSensitive (including nested objects/arrays). On parse failure it returns
// a redacted placeholder and never falls back to the raw bytes.
func redactJSONBody(body []byte) string {
	if len(body) == 0 {
		return ""
	}
	var root interface{}
	if err := json.Unmarshal(body, &root); err != nil {
		return "[redacted: unparseable body]"
	}
	masked, err := json.Marshal(redactValue(root))
	if err != nil {
		return "[redacted: unparseable body]"
	}
	return string(masked)
}

// maskParsedQuery masks sensitive keys in already-parsed url.Values and
// re-encodes. When nothing matched it returns fallback verbatim, so a clean
// input keeps its original spacing/ordering for the log reader.
func maskParsedQuery(values url.Values, fallback string) string {
	masked := false
	for key := range values {
		if looksSensitive(key) {
			values.Set(key, redactedMask)
			masked = true
		}
	}
	if !masked {
		return fallback
	}
	return values.Encode()
}

// redactQueryParams parses the raw query string and masks any sensitive
// keys before re-encoding. A parse failure returns a fixed placeholder rather
// than raw text, because query strings can carry credentials just like request
// bodies and malformed percent-encoding must not bypass the audit-log boundary.
func redactQueryParams(raw string) string {
	if raw == "" {
		return ""
	}
	values, err := url.ParseQuery(raw)
	if err != nil {
		return "[redacted: unparseable query]"
	}
	return maskParsedQuery(values, raw)
}

// redactURLEncodedBody masks sensitive keys in an x-www-form-urlencoded
// request body. Unlike redactQueryParams it NEVER falls back to the raw
// bytes: a malformed body (invalid percent-encoding) returns a placeholder.
// Request bodies carry credentials — /login, /auth/user/register and
// /modify/password submit the password via PostForm — so the body-redaction
// invariant is "never store plaintext", even when the body fails to parse.
func redactURLEncodedBody(body []byte) string {
	if len(body) == 0 {
		return ""
	}
	values, err := url.ParseQuery(string(body))
	if err != nil {
		return "[redacted: unparseable body]"
	}
	return maskParsedQuery(values, string(body))
}

// redactBodyByContentType routes request-body redaction by content-type and never stores raw plaintext:
//   - multipart/form-data        → dropped wholesale placeholder (usually a file)
//   - x-www-form-urlencoded      → redactURLEncodedBody (never falls back to raw even on ParseQuery failure)
//   - JSON                       → redactJSONBody recursive masking
//   - other / unrecognized       → redacted placeholder, never the raw body
func redactBodyByContentType(contentType string, body []byte) string {
	switch {
	case strings.Contains(contentType, "multipart/form-data"):
		return "[Multipart Content - Body Ignored]"
	case strings.Contains(contentType, "application/x-www-form-urlencoded"):
		return redactURLEncodedBody(body)
	case strings.Contains(contentType, "application/json"):
		return redactJSONBody(body)
	case len(body) == 0:
		return ""
	default:
		return "[redacted: unsupported content-type]"
	}
}

const (
	a2uiActionAuditInvalidBody = "[redacted: invalid a2ui action]"
	a2uiActionAuditMask        = "[REDACTED]"
)

// a2uiActionAuditBody is deliberately separate from the service envelope. It
// contains only the identifiers needed to correlate an action in an audit row;
// the untrusted payload is replaced with a fixed mask before marshaling.
type a2uiActionAuditBody struct {
	SurfaceID string `json:"surface_id"`
	Widget    string `json:"widget"`
	ActionID  string `json:"action_id"`
	RunID     string `json:"run_id"`
	Payload   string `json:"payload"`
}

func validA2uiAuditString(raw json.RawMessage) (string, bool) {
	var value string
	if err := json.Unmarshal(raw, &value); err != nil || strings.TrimSpace(value) == "" {
		return "", false
	}
	if utf8.RuneCountInString(value) > 256 {
		return "", false
	}
	return value, true
}

// redactA2uiActionBody keeps only bounded action identifiers and masks the
// complete payload. Unknown fields are intentionally ignored. Any malformed
// or incorrectly shaped envelope collapses to a fixed placeholder so the
// operation log never receives untrusted raw text.
func redactA2uiActionBody(body []byte) string {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil || fields == nil {
		return a2uiActionAuditInvalidBody
	}

	surfaceID, ok := validA2uiAuditString(fields["surface_id"])
	if !ok {
		return a2uiActionAuditInvalidBody
	}
	widget, ok := validA2uiAuditString(fields["widget"])
	if !ok {
		return a2uiActionAuditInvalidBody
	}
	actionID, ok := validA2uiAuditString(fields["action_id"])
	if !ok {
		return a2uiActionAuditInvalidBody
	}
	runID, ok := validA2uiAuditString(fields["run_id"])
	if !ok {
		return a2uiActionAuditInvalidBody
	}
	if payload, exists := fields["payload"]; !exists || len(payload) == 0 || !json.Valid(payload) {
		return a2uiActionAuditInvalidBody
	}

	masked, err := json.Marshal(a2uiActionAuditBody{
		SurfaceID: surfaceID,
		Widget:    widget,
		ActionID:  actionID,
		RunID:     runID,
		Payload:   a2uiActionAuditMask,
	})
	if err != nil {
		return a2uiActionAuditInvalidBody
	}
	return string(masked)
}

func OperationLog() gin.HandlerFunc {
	return func(c *gin.Context) {
		startTime := time.Now()

		var bodyBytes []byte
		contentType := c.ContentType()
		if !strings.Contains(contentType, "multipart/form-data") {
			if c.Request.Body != nil {
				bodyBytes, _ = io.ReadAll(c.Request.Body)
			}
			// Restore the body so downstream BindJSON/etc. can still read it.
			c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
		}

		// Resolve user_id before c.Next() so the DB logger can attribute SQL rows.
		// AuthMiddleware runs before OperationLog (configured in router), so username is already set here.
		var userId int64
		var userEmail string

		if v, exists := c.Get("user_id"); exists {
			switch val := v.(type) {
			case int:
				userId = int64(val)
			case int64:
				userId = val
			case float64:
				userId = int64(val)
			}
		}

		if v, exists := c.Get("username"); exists {
			if username, ok := v.(string); ok {
				userEmail = username
			}
		}

		if userId == 0 && userEmail != "" {
			var user model.User
			// Query with logger.Discard: this lookup exists only to obtain the user_id, which we do not
			// have yet, so logging it would flood sql_operation_logs with rows whose user_id is empty.
			if err := model.Default().Session(&gorm.Session{Logger: logger.Discard}).Select("id").Where("email = ?", userEmail).First(&user).Error; err == nil {
				userId = user.Id
				// Propagate user_id back into the context so later service-layer model.DB(c) calls hand it to the logger.
				c.Set("user_id", userId)
			}
		}

		c.Next()

		latency := time.Since(startTime).Milliseconds()
		statusCode := c.Writer.Status()
		clientIP := c.ClientIP()
		userAgent := c.Request.UserAgent()
		method := c.Request.Method
		path := c.Request.URL.Path
		queryParams := c.Request.URL.RawQuery

		var errorMessage string
		if len(c.Errors) > 0 {
			errorMessage = c.Errors.String()
		}

		// Body redaction — the A2UI action route masks its complete payload while
		// all other endpoints retain the generic content-type rules.
		var bodyStr string
		if c.FullPath() == "/api/v1/conversations/:id/a2ui-actions" {
			bodyStr = redactA2uiActionBody(bodyBytes)
		} else {
			// urlencoded uses the same masking as redactQueryParams (covers /login,
			// /register, /modify/password PostForm credentials), JSON is recursively
			// masked, everything else is a placeholder.
			bodyStr = redactBodyByContentType(contentType, bodyBytes)
		}

		// The same redaction rules cover the query string so ?token=xxx / ?api_key=xxx
		// URL forms cannot leak credentials into the audit log.
		queryParams = redactQueryParams(queryParams)

		go func(
			uid int64,
			uEmail string,
			mtd, pth, qParams, bParams, ip, ua, errMsg string,
			status int,
			lat int64,
		) {
			logEntry := model.UserOperationLog{
				UserId:       uid,
				UserEmail:    uEmail,
				Method:       mtd,
				Path:         pth,
				QueryParams:  qParams,
				BodyParams:   bParams,
				ClientIp:     ip,
				UserAgent:    ua,
				StatusCode:   status,
				Latency:      lat,
				ErrorMessage: errMsg,
				CreatedAt:    time.Now(),
			}

			// model.Default() must return a concurrency-safe *gorm.DB instance.
			if err := model.Default().Create(&logEntry).Error; err != nil {
				// Log only the error metadata, never the body — the body may still hold sensitive fragments pre-redaction.
				rxLog.Sugar().Errorw("operation log insert failed", "err", err)
			}
		}(userId, userEmail, method, path, queryParams, bodyStr, clientIP, userAgent, errorMessage, statusCode, latency)
	}
}
