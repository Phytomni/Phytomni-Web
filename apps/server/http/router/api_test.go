package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"phytomni-server/db"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/middleware"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/spf13/viper"
	"gorm.io/gorm"
)

// routeSet builds the engine through the real Api() registration and returns a
// set of "METHOD PATH" strings. Building the router also exercises gin's tree
// for registration conflicts (e.g. static /users/me vs param /users/:id), so a
// panic here is itself a contract failure, not just a missing assertion.
func routeSet(t *testing.T) map[string]bool {
	t.Helper()
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	Api(engine.Group("/"))
	set := make(map[string]bool)
	for _, r := range engine.Routes() {
		set[r.Method+" "+r.Path] = true
	}
	return set
}

// assertRoutes fails for any route in present that is missing and any route in
// absent that is still registered.
func assertRoutes(t *testing.T, routes map[string]bool, present, absent []string) {
	t.Helper()
	for _, want := range present {
		if !routes[want] {
			t.Errorf("missing migrated route %q", want)
		}
	}
	for _, bad := range absent {
		if routes[bad] {
			t.Errorf("old route %q should be gone after migration", bad)
		}
	}
}

// TestApiV1AuthUserRoutes pins the §5.6 RESTful migration of the auth & users
// group: the new /api/v1 routes must be registered (with id as a path param
// where the spec moves it off the body) and the old action-style routes must be
// gone — so a regression that drops a route, reverts a verb, or reverts a path
// fails here.
func TestApiV1AuthUserRoutes(t *testing.T) {
	routes := routeSet(t)
	assertRoutes(t, routes,
		[]string{
			"GET /api/v1/bot/capabilities",
			"POST /api/v1/auth/sessions",
			"POST /api/v1/auth/registrations",
			"POST /api/v1/users",
			"GET /api/v1/users",
			"GET /api/v1/users/me",
			"PUT /api/v1/users/me/password",
			"PUT /api/v1/users/:id/permissions",
			"POST /api/v1/users/:id/unlock",
			"GET /api/v1/users/me/tool-permissions",
			"POST /api/v1/user-feedback",
		},
		[]string{
			"POST /auth/login",
			"POST /auth/user/register",
			"GET /v1/permission/user/list",
			"GET /v1/user/profile",
			"POST /v1/modify/password",
			"POST /v1/modify/permission",
			"POST /v1/user/unlock",
			"GET /v1/permission/user/tool",
			"POST /v1/user/feedback",
			"POST /v1/register",
		},
	)
}

// TestBotCapabilitiesRouteRejectsUnauthenticatedBeforeBotCall pins the
// middleware ordering: a request without a JWT must be rejected by
// AuthMiddleware before the manifest handler can ask Bot for /v1/agents.
func TestBotCapabilitiesRouteRejectsUnauthenticatedBeforeBotCall(t *testing.T) {
	var botCalls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		botCalls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"object":"list","data":[]}`))
	}))
	t.Cleanup(srv.Close)

	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 1}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	Api(engine.Group("/"))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/bot/capabilities", nil)
	res := httptest.NewRecorder()
	engine.ServeHTTP(res, req)

	if res.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d (body=%s)", res.Code, http.StatusUnauthorized, res.Body.String())
	}
	if botCalls != 0 {
		t.Fatalf("Bot listing was called %d times before authentication", botCalls)
	}
}

// TestBotCapabilitiesAuthenticatedRouteReturnsManifest drives the real
// authenticated route through AuthMiddleware and LoginStatusMiddleware. The
// response is the standard Web envelope and contains only the public DTO.
func TestBotCapabilitiesAuthenticatedRouteReturnsManifest(t *testing.T) {
	previousSecret := viper.GetString("jwt.secret_key")
	viper.Set("jwt.secret_key", "bot-capability-router-test-secret")
	t.Cleanup(func() { viper.Set("jwt.secret_key", previousSecret) })

	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	for _, stmt := range []string{
		`CREATE TABLE users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT,
			first_login_status TEXT,
			password_change_at DATETIME
		)`,
		`CREATE TABLE user_operation_logs (
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
		)`,
	} {
		if err := gdb.Exec(stmt).Error; err != nil {
			t.Fatalf("create router test table: %v", err)
		}
	}
	if err := gdb.Exec(`INSERT INTO users (email, first_login_status) VALUES ('alice@example.com', '1')`).Error; err != nil {
		t.Fatalf("seed router test user: %v", err)
	}
	db.Set("phytomni-server", gdb)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"object":"list","data":[{"slug":"chat","tool":"ChatAgent"}]}`))
	}))
	t.Cleanup(srv.Close)
	previousBotConfig := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 1}
	t.Cleanup(func() { rxBot.BotConfig = previousBotConfig })

	token, err := middleware.GenerateToken("alice@example.com")
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	Api(engine.Group("/"))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/bot/capabilities", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	res := httptest.NewRecorder()
	engine.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body=%s)", res.Code, http.StatusOK, res.Body.String())
	}
	var envelope struct {
		Code int                      `json:"code"`
		Data []map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if envelope.Code != http.StatusOK || len(envelope.Data) != 10 {
		t.Fatalf("envelope = %#v, want success with ten rows", envelope)
	}
	if _, ok := envelope.Data[0]["api_key"]; ok {
		t.Fatal("private field leaked through authenticated route")
	}
	if enabled, _ := envelope.Data[0]["enabled"].(bool); !enabled {
		t.Fatal("present ChatAgent should be enabled")
	}
}

// TestApiV1ConversationRoutes pins the §5.6 RESTful migration of the conversation
// group: list/collect-list collapse onto GET /api/v1/conversations (the dispatcher
// branches on ?favorite=true), and the per-conversation actions move the id into
// the path with resource verbs.
func TestApiV1ConversationRoutes(t *testing.T) {
	routes := routeSet(t)
	assertRoutes(t, routes,
		[]string{
			"GET /api/v1/conversations",
			"GET /api/v1/conversations/:id/messages",
			"POST /api/v1/conversations/:id/a2ui-actions",
			"DELETE /api/v1/conversations/:id",
			"PATCH /api/v1/conversations/:id",
			"PUT /api/v1/conversations/:id/reaction",
			"PUT /api/v1/conversations/:id/favorite",
		},
		[]string{
			"GET /v1/query/list",
			"GET /v1/answer/check",
			"POST /v1/query/list/delete",
			"POST /v1/query/list/rename",
			"POST /v1/query/reaction_type",
			"POST /v1/query/collect",
			"GET /v1/query/collect/list",
		},
	)
}

// TestApiV1AsyncTaskRoutes pins the §5.6 async-task migration: the id moves from
// the query string into the path; owner-scoping stays in the service layer and is
// covered by the service tests, so this only asserts the route shape.
func TestApiV1AsyncTaskRoutes(t *testing.T) {
	routes := routeSet(t)
	assertRoutes(t, routes,
		[]string{
			"GET /api/v1/async-tasks",
			"GET /api/v1/async-tasks/:id",
			"GET /api/v1/async-tasks/:id/analyst-log",
		},
		[]string{
			"GET /v1/async_task/list",
			"GET /v1/async_task/info",
			"GET /v1/analyst/get_log",
		},
	)
}

// TestApiV1AuditGeneDownloadRoutes pins the §5.6 migration of the audit, gene and
// download surfaces, including three distinct download surfaces: the disabled
// legacy email obs-file route, the JWT analyst-agent/rendering downloads under
// the authed group, and the no-JWT/no-log token relay-file. operation-logs flips
// POST→GET (admin gate stays in the service) and gene details key on the file
// name as the resource id.
func TestApiV1AuditGeneDownloadRoutes(t *testing.T) {
	routes := routeSet(t)
	assertRoutes(t, routes,
		[]string{
			"GET /api/v1/operation-logs",
			"GET /api/v1/admin/cron-entries",
			"GET /api/v1/genes",
			"GET /api/v1/genes/:id",
			"GET /api/v1/gene-images/:gene/:file",
			"GET /api/v1/downloads/obs-file",
			"GET /api/v1/downloads/analyst-agent/obs-file",
			"GET /api/v1/downloads/analyst-agent/obs-images",
			"POST /api/v1/downloads/rendering-file",
			"GET /api/v1/downloads/relay-file",
		},
		[]string{
			"POST /v1/operation/logs",
			"GET /v1/gene/list",
			"GET /v1/gene/details",
			"POST /v1/gene/details/storage",
			"GET /auth/download/obs_file",
			"GET /v1/download/analyst_agent/obs_file",
			"GET /v1/download/analyst_agent/obs_images",
			"POST /v1/download/rendering_file",
			"GET /v1/download/relay_file",
		},
	)
}

// TestApiV1ChatSendRoute pins the D4 chat-send migration: POST /query becomes
// POST /api/v1/conversations/:id/messages (id=0 means a new conversation), co-
// existing with the GET on the same path. The old root /query route must be gone.
func TestAgentProductRunRoute(t *testing.T) {
	routes := routeSet(t)
	assertRoutes(t, routes,
		[]string{
			"POST /api/v1/conversations/:id/messages",
			"POST /api/v1/agent-products/:tool/runs",
		},
		[]string{"POST /query"},
	)
}

func TestAgentProductRunRouteRequiresAuthentication(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	Api(engine.Group("/"))

	for _, tool := range []string{"InSilicoResearchAgent", "DigitalDesignAgent", "GeneNetworkAgent"} {
		t.Run(tool, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/v1/agent-products/"+tool+"/runs", nil)
			res := httptest.NewRecorder()
			engine.ServeHTTP(res, req)

			if res.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401 (body=%s)", res.Code, res.Body.String())
			}
		})
	}
}

// TestApiV1AuthLifecycleRoutes pins the Phase 1 logout endpoints. They live on a
// dedicated group (AuthMiddleware, no LoginStatusMiddleware) so a first-login user
// can still log out — a regression that drops them or moves them onto the public
// auth group / the first-login-gated v1 group fails here.
func TestApiV1AuthLifecycleRoutes(t *testing.T) {
	routes := routeSet(t)
	assertRoutes(t, routes,
		[]string{
			"POST /api/v1/auth/logout",
			"POST /api/v1/auth/logout-all",
		},
		nil,
	)
}

// TestApiV1CrossBoundaryAliases pins the surviving Bot-writeback cross-boundary
// endpoints (new RESTful path + retained old alias, kept until the Bot backport).
// The external server-task surface (POST /api/v1/server/tasks + the /v1/nky/server
// aliases) was removed once it was confirmed to have no real external caller —
// the four routes below MUST stay gone (negative assertion guards against a
// regression re-registering them).
func TestApiV1CrossBoundaryAliases(t *testing.T) {
	routes := routeSet(t)
	assertRoutes(t, routes,
		[]string{
			"PATCH /api/v1/async-tasks/analyst-log",
		},
		[]string{
			"POST /api/v1/server/tasks",
			"PATCH /api/v1/server/tasks/:id",
			"POST /v1/nky/server/create_task",
			"POST /v1/nky/server/update_task",
		},
	)
	if !routes["POST /query/analyst/update_log"] {
		t.Errorf("Bot-writeback alias %q should still be registered", "POST /query/analyst/update_log")
	}
}
