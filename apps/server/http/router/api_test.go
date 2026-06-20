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
