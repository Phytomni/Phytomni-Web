package router

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
	"gorm.io/gorm"

	"github.com/glebarez/sqlite"

	rxCache "phytomni-server/cache"
	"phytomni-server/db"
	"phytomni-server/middleware"
)

// buildChatGateEnv 搭建真实 Api() 路由 + miniredis + SQLite,users 表包含
// CheckChatAllowed 所需的 code / chat_limit 列。每个测试独立调用以避免状态串联。
func buildChatGateEnv(t *testing.T) (*gin.Engine, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	viper.Set("jwt.secret_key", "chat-gate-test-secret")
	t.Cleanup(func() { viper.Set("jwt.secret_key", "") })

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	viper.Set("redis.default", "web")
	viper.Set("redis.clients", map[string]interface{}{
		"web": map[string]interface{}{
			"type":  "single-node",
			"addrs": []string{mr.Addr()},
			"db":    0,
		},
	})
	t.Cleanup(func() {
		viper.Set("redis.clients", nil)
		viper.Set("redis.default", "")
	})
	if err := rxCache.InitFromViper(); err != nil {
		t.Fatalf("cache init: %v", err)
	}

	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if sqlDB, e := gdb.DB(); e == nil {
		sqlDB.SetMaxOpenConns(1)
	}

	// users: 含 CheckChatAllowed 读取的 code / chat_limit 以及 AuthMiddleware /
	// LoginStatusMiddleware 所需的 first_login_status / password_change_at。
	if err := gdb.Exec(`CREATE TABLE users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT,
		code TEXT DEFAULT 'user',
		chat_limit INTEGER DEFAULT 0,
		first_login_status TEXT DEFAULT '1',
		password_change_at DATETIME
	)`).Error; err != nil {
		t.Fatalf("create users: %v", err)
	}

	// user_operation_logs: OperationLog 中间件在成功响应后写审计行。
	if err := gdb.Exec(`CREATE TABLE user_operation_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER,
		user_email TEXT,
		method TEXT,
		path TEXT,
		query_params TEXT,
		body_params TEXT,
		client_ip TEXT,
		user_agent TEXT,
		status_code INTEGER,
		latency INTEGER,
		error_message TEXT,
		created_at DATETIME
	)`).Error; err != nil {
		t.Fatalf("create user_operation_logs: %v", err)
	}

	db.Set("phytomni-server", gdb)

	engine := gin.New()
	Api(engine.Group("/"))
	return engine, gdb
}

// queryRequest 向 /api/v1/conversations/0/messages 发送带 token 的 multipart POST,
// 携带最小合法 body(query 字段非空),返回 HTTP 状态码。
func queryRequest(engine *gin.Engine, token string) int {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("query", "test query")
	mw.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/conversations/0/messages", &buf)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	return w.Code
}

// TestE2E_ChatGate_EnforceOn_ZeroLimit 验证闸接线:enforce=ON,code='user',
// chat_limit=0 → /query 返回 403(额度耗尽)。
// 变异守卫:如果删除 Query 中的 CheckChatAllowed 调用,该测试无 403 → 变红。
func TestE2E_ChatGate_EnforceOn_ZeroLimit(t *testing.T) {
	engine, gdb := buildChatGateEnv(t)

	viper.Set("chatlimit.enforce", true)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", nil) })

	// 插入 chat_limit=0 的普通用户(first_login_status='1' 通过 LoginStatusMiddleware)
	gdb.Exec(`INSERT INTO users (email, code, chat_limit, first_login_status) VALUES ('inert@x.com', 'user', 0, '1')`)

	tok, err := middleware.GenerateToken("inert@x.com")
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	code := queryRequest(engine, tok)
	if code != http.StatusForbidden {
		t.Fatalf("enforce=ON user/chat_limit=0: want 403, got %d", code)
	}
}

// TestE2E_ChatGate_EnforceOn_FundedUser 验证 chat_limit=5 用户不被闸拒:
// 响应不是 403——允许请求继续(可能因 Bot 未启动而得其他错误码,但非闸拒绝)。
// 变异守卫:如果闸误拒 chat_limit>0 的用户,该测试变红。
func TestE2E_ChatGate_EnforceOn_FundedUser(t *testing.T) {
	engine, gdb := buildChatGateEnv(t)

	viper.Set("chatlimit.enforce", true)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", nil) })

	gdb.Exec(`INSERT INTO users (email, code, chat_limit, first_login_status) VALUES ('funded@x.com', 'user', 5, '1')`)

	tok, err := middleware.GenerateToken("funded@x.com")
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	code := queryRequest(engine, tok)
	if code == http.StatusForbidden {
		t.Fatalf("enforce=ON user/chat_limit=5: gate must not reject, got 403")
	}
}

// TestE2E_ChatGate_EnforceOff_ZeroLimit 验证暗发布默认状态:enforce=OFF 时,
// chat_limit=0 用户不因闸得 403(零回归)。
// 变异守卫:如果 enforce 短路被删除,该测试变红。
func TestE2E_ChatGate_EnforceOff_ZeroLimit(t *testing.T) {
	engine, gdb := buildChatGateEnv(t)

	viper.Set("chatlimit.enforce", false)
	t.Cleanup(func() { viper.Set("chatlimit.enforce", nil) })

	gdb.Exec(`INSERT INTO users (email, code, chat_limit, first_login_status) VALUES ('zero@x.com', 'user', 0, '1')`)

	tok, err := middleware.GenerateToken("zero@x.com")
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	code := queryRequest(engine, tok)
	if code == http.StatusForbidden {
		t.Fatalf("enforce=OFF user/chat_limit=0: gate must not fire (zero regression), got 403")
	}
}
