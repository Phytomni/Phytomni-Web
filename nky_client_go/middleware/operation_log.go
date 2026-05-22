package middleware

import (
	"bytes"
	"encoding/json"
	"io"
	"nky_client_go/model"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

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
			var user model.SUser
			// 使用 model.Default() 查询，并禁用日志记录，防止产生“无主”的 SQL 日志
			// 这条查询本身就是为了获取 UserID，此时还没有 UserID，如果记录日志会导致 s_sql_operation_logs 中出现大量 user_id 为空的记录
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

		// Body 脱敏处理
		var bodyStr string
		if !strings.Contains(contentType, "multipart/form-data") {
			bodyStr = string(bodyBytes)
			if strings.Contains(path, "/login") || strings.Contains(path, "/register") || strings.Contains(path, "/modify/password") {
				// 简单的脱敏逻辑：尝试解析 JSON 并掩盖 password
				var bodyMap map[string]interface{}
				if err := json.Unmarshal(bodyBytes, &bodyMap); err == nil {
					if _, ok := bodyMap["password"]; ok {
						bodyMap["password"] = "******"
					}
					if _, ok := bodyMap["new_password"]; ok {
						bodyMap["new_password"] = "******"
					}
					if _, ok := bodyMap["old_password"]; ok {
						bodyMap["old_password"] = "******"
					}
					maskedBody, _ := json.Marshal(bodyMap)
					bodyStr = string(maskedBody)
				}
			}
		} else {
			bodyStr = "[Multipart Content - Body Ignored]"
		}

		// 异步写入数据库
		go func(
			uid int64,
			uEmail string,
			mtd, pth, qParams, bParams, ip, ua, errMsg string,
			status int,
			lat int64,
		) {
			logEntry := model.SUserOperationLog{
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
				// 记录日志失败，通常只能输出到控制台或文件日志
				// fmt.Printf("Failed to create operation log: %v\n", err)
			}
		}(userId, userEmail, method, path, queryParams, bodyStr, clientIP, userAgent, errorMessage, statusCode, latency)
	}
}
