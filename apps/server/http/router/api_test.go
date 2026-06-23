package router

import (
	"testing"

	"github.com/gin-gonic/gin"
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
// download surfaces, including the three distinct download middleware chains: the
// JWT analyst-agent/rendering downloads under the authed group, the no-JWT email
// obs-file (still logged), and the no-JWT/no-log token relay-file. operation-logs
// flips POST→GET (admin gate stays in the service) and gene details key on the
// file name as the resource id.
func TestApiV1AuditGeneDownloadRoutes(t *testing.T) {
	routes := routeSet(t)
	assertRoutes(t, routes,
		[]string{
			"GET /api/v1/operation-logs",
			"GET /api/v1/genes",
			"GET /api/v1/genes/:id",
			"POST /api/v1/gene-examples",
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
func TestApiV1ChatSendRoute(t *testing.T) {
	routes := routeSet(t)
	assertRoutes(t, routes,
		[]string{"POST /api/v1/conversations/:id/messages"},
		[]string{"POST /query"},
	)
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

// TestApiV1CrossBoundaryAliases pins the cross-boundary endpoints (Bot writeback,
// external server tasks): the new RESTful routes are live, AND the old paths stay
// registered as aliases until the off-repo consumers (Bot, external clients)
// backport — so unlike the other groups these old routes must NOT disappear yet.
func TestApiV1CrossBoundaryAliases(t *testing.T) {
	routes := routeSet(t)
	assertRoutes(t, routes,
		[]string{
			"PATCH /api/v1/async-tasks/analyst-log",
			"POST /api/v1/server/tasks",
			"PATCH /api/v1/server/tasks/:id",
		},
		nil,
	)
	for _, alias := range []string{
		"POST /query/analyst/update_log",
		"POST /v1/nky/server/create_task",
		"POST /v1/nky/server/update_task",
	} {
		if !routes[alias] {
			t.Errorf("cross-boundary alias %q should still be registered", alias)
		}
	}
}
