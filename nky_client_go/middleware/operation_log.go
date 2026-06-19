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

// redactValue 递归遍历任意 JSON 值,对 map 中命中 looksSensitive 的 key
// 整体打码(不再深入其值),对其余 map 值与数组元素继续递归。标量原样返回。
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

// redactJSONBody 解析 JSON body 并递归遮蔽所有命中 looksSensitive 的 key
// (含嵌套 object / array)。解析失败 → 返回打码占位,绝不回落原文。
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
// keys before re-encoding. A parse failure returns the input verbatim
// so the audit log still captures *something*; the alternative (drop
// the whole query) would lose forensic value. This raw-on-error fallback
// is deliberate for query STRINGS only — request bodies go through
// redactURLEncodedBody, which never falls back to raw.
func redactQueryParams(raw string) string {
	if raw == "" {
		return ""
	}
	values, err := url.ParseQuery(raw)
	if err != nil {
		return raw
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

// redactBodyByContentType 按 Content-Type 分流脱敏 request body,绝不落原文:
//   - multipart/form-data        → 整体丢弃占位(里面通常是文件)
//   - x-www-form-urlencoded      → redactURLEncodedBody(ParseQuery 失败也不回落原文)
//   - JSON                       → redactJSONBody 递归遮蔽
//   - 其他 / 无法识别            → 打码占位,绝不存原文
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

// OperationLog 用户操作日志中间件
func OperationLog() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 1. 开始时间
		startTime := time.Now()

		// 2. 获取 Request Body
		var bodyBytes []byte
		// 检查 Content-Type，如果是文件上传则不读取 Body
		contentType := c.ContentType()
		if !strings.Contains(contentType, "multipart/form-data") {
			if c.Request.Body != nil {
				bodyBytes, _ = io.ReadAll(c.Request.Body)
			}
			// 读取完后，需要重新赋值回去，否则后续的 BindJson 等操作会读不到数据
			c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
		}

		// 3. 尝试获取并设置用户ID (在执行业务逻辑前，以便 DB Logger 可以获取)
		// 注意：AuthMiddleware 运行在 OperationLog 之前 (在 router 中配置)，所以 username 此时应该可用
		var userId int64
		var userEmail string

		// 3.1 尝试直接从 Context 获取 (如果前面的中间件已设置)
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

		// 3.2 如果没有 user_id，尝试从 username 获取
		if v, exists := c.Get("username"); exists {
			if username, ok := v.(string); ok {
				userEmail = username
			}
		}

		// 3.3 如果有 email 但没有 id，查询数据库
		if userId == 0 && userEmail != "" {
			var user model.User
			// 使用 model.Default() 查询，并禁用日志记录，防止产生“无主”的 SQL 日志
			// 这条查询本身就是为了获取 UserID，此时还没有 UserID，如果记录日志会导致 sql_operation_logs 中出现大量 user_id 为空的记录
			if err := model.Default().Session(&gorm.Session{Logger: logger.Discard}).Select("id").Where("email = ?", userEmail).First(&user).Error; err == nil {
				userId = user.Id
				// 关键：将 user_id 设置回 Context，以便后续的 Service 层调用 model.DB(c) 时能传递给 Logger
				c.Set("user_id", userId)
			}
		}

		// 4. 执行业务逻辑
		c.Next()

		// 5. 异步记录日志 (API日志)
		// ...

		latency := time.Since(startTime).Milliseconds()
		statusCode := c.Writer.Status()
		clientIP := c.ClientIP()
		userAgent := c.Request.UserAgent()
		method := c.Request.Method
		path := c.Request.URL.Path
		queryParams := c.Request.URL.RawQuery

		// 尝试获取错误信息
		var errorMessage string
		if len(c.Errors) > 0 {
			errorMessage = c.Errors.String()
		}

		// Body 脱敏处理 — 按 Content-Type 分流,绝不落原文:
		// urlencoded 走 redactQueryParams 同款打码(覆盖 /login / /register /
		// /modify/password 的 PostForm 凭据),JSON 递归遮蔽,其余打码占位。
		bodyStr := redactBodyByContentType(contentType, bodyBytes)

		// 同一套脱敏规则覆盖 query string,避免 ?token=xxx / ?api_key=xxx
		// 之类的 URL 形态把凭据写进 audit log。
		queryParams = redactQueryParams(queryParams)

		// 异步写入数据库
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

			// 写入数据库
			// 注意：这里需要确保 model.Default() 返回的 DB 实例是并发安全的
			if err := model.Default().Create(&logEntry).Error; err != nil {
				// 只记 err 元数据,绝不记 body —— body 可能含已脱敏前的敏感片段
				rxLog.Sugar().Errorw("operation log insert failed", "err", err)
			}
		}(userId, userEmail, method, path, queryParams, bodyStr, clientIP, userAgent, errorMessage, statusCode, latency)
	}
}
