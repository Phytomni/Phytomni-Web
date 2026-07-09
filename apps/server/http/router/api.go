package router

import (
	"phytomni-server/common/i18n"
	"phytomni-server/http/handler/api_handler"
	"phytomni-server/middleware"

	"github.com/gin-gonic/gin"
)

func Api(r *gin.RouterGroup) {
	authHandler := api_handler.NewHandler()
	apiHandler := api_handler.NewHandler()

	// /api/v1/auth: public endpoints (no JWT). OPTIONS preflight handled globally by CORS middleware.
	apiAuthRouter := r.Group("api/v1/auth").Use(i18n.Localize(), middleware.GlobalMiddleware(), middleware.CORS(), middleware.OperationLog())
	{
		apiAuthRouter.POST("/sessions", middleware.PerIPRateLimit("login"), authHandler.Login)                // login (create session, per-IP rate limited)
		apiAuthRouter.POST("/registrations", middleware.PerIPRateLimit("register"), authHandler.UserRegister) // self-registration (per-IP rate limited)
	}

	// /api/v1/downloads keeps the disabled legacy email-link route visible. It
	// returns 410 without reading username/obs_path; email revival needs a separate plan.
	apiDownloadEmailRouter := r.Group("api/v1/downloads").Use(i18n.Localize(), middleware.GlobalMiddleware(), middleware.CORS(), middleware.OperationLog())
	{
		apiDownloadEmailRouter.GET("/obs-file", authHandler.GetDownloadObsFile) // legacy email route → 410 Gone
	}

	// /api/v1 authenticated group (JWT + forced-password-change gate): user and admin endpoints.
	// Middleware chain is identical to the old v1 group.
	apiV1Router := r.Group("api/v1").Use(i18n.Localize(), middleware.GlobalMiddleware(), middleware.AuthMiddleware(), middleware.LoginStatusMiddleware(), middleware.CORS(), middleware.OperationLog())
	{
		apiV1Router.POST("/users", apiHandler.Register)                              // admin registers a user or vip user
		apiV1Router.GET("/users", apiHandler.PermissionUserList)                     // admin user list
		apiV1Router.GET("/users/me", apiHandler.GetUserProfile)                      // get own profile (email from JWT, IDOR closed)
		apiV1Router.PUT("/users/me/password", apiHandler.ModifyPassword)             // change own password (locked-step with first_login_gate)
		apiV1Router.PUT("/users/:id/permissions", apiHandler.ModifyPermission)       // admin: modify user permission/password
		apiV1Router.POST("/users/:id/unlock", apiHandler.UnlockUser)                 // admin: manually unlock a user
		apiV1Router.GET("/users/me/tool-permissions", apiHandler.PermissionUserTool) // user tool-permission listing
		apiV1Router.POST("/user-feedback", apiHandler.UserFeedback)                  // submit user feedback

		apiV1Router.GET("/conversations", apiHandler.Conversations)                                             // conversation list (?favorite=true for favourites)
		apiV1Router.GET("/conversations/:id/messages", apiHandler.AnswerCheck)                                  // all child messages for a conversation
		apiV1Router.POST("/conversations/:id/messages", middleware.PerUserRateLimit("query"), apiHandler.Query) // send message (id=0 for new conversation, relayed to Bot, per-user rate limited)
		apiV1Router.POST("/conversations/:id/a2ui-actions", apiHandler.A2uiAction)                              // interactive agent-surface action uplink
		apiV1Router.DELETE("/conversations/:id", apiHandler.QueryListDelete)                                    // soft-delete conversation
		apiV1Router.PATCH("/conversations/:id", apiHandler.QueryListRename)                                     // rename conversation
		apiV1Router.PUT("/conversations/:id/reaction", apiHandler.QueryReactionType)                            // like/dislike
		apiV1Router.PUT("/conversations/:id/favorite", apiHandler.QueryCollect)                                 // favourite/unfavourite

		apiV1Router.GET("/async-tasks", apiHandler.AsyncTaskList)                       // task list (owner-scoped)
		apiV1Router.GET("/async-tasks/:id", apiHandler.AsyncTaskInfo)                   // task status (owner-scoped)
		apiV1Router.GET("/async-tasks/:id/analyst-log", apiHandler.AnalystAgentGetLog)  // analyst log
		apiV1Router.PATCH("/async-tasks/analyst-log", apiHandler.QueryAnalystUpdateLog) // async result write-back (Bot via legacy alias /query/analyst/update_log)

		apiV1Router.GET("/operation-logs", apiHandler.GetOperationLogs)   // operation log query (admin-only)
		apiV1Router.GET("/admin/cron-entries", apiHandler.GetCronEntries) // cron schedule inspection (admin-only)
		apiV1Router.GET("/genes", apiHandler.GeneList)                    // gene test data list
		apiV1Router.GET("/genes/:id", apiHandler.GeneDetails)             // gene detail (resource id = file_name)

		apiV1Router.GET("/downloads/analyst-agent/obs-file", apiHandler.DownloadAnalystAgentObsFile)     // AnalystAgent OBS file download link
		apiV1Router.GET("/downloads/analyst-agent/obs-images", apiHandler.DownloadAnalystAgentObsImages) // AnalystAgent OBS image download links
		apiV1Router.POST("/downloads/rendering-file", apiHandler.DownloadObsRenderingFile)               // file-format-conversion download
	}

	// /api/v1/auth lifecycle group: logout / logout-all. Carries AuthMiddleware (handler needs
	// ctx username/token) but NOT LoginStatusMiddleware — first-login users must still be able
	// to log out. This is a dedicated group distinct from both the public apiAuthRouter (no
	// AuthMiddleware) and apiV1Router (has the first-login gate).
	authLifecycleRouter := r.Group("api/v1/auth").Use(i18n.Localize(), middleware.GlobalMiddleware(), middleware.AuthMiddleware(), middleware.CORS(), middleware.OperationLog())
	{
		authLifecycleRouter.POST("/logout", apiHandler.Logout)        // revoke current token (single device)
		authLifecycleRouter.POST("/logout-all", apiHandler.LogoutAll) // logout all devices (per-user epoch bump)
	}

	// Bot write-back alias: Bot still POSTs /query/analyst/update_log; frontend has switched to
	// PATCH /api/v1/async-tasks/analyst-log. Remove this alias after Bot cross-repo backport.
	// Middleware chain matches /api/v1; gateway only serves real traffic when bot.proxy_enabled=true.
	queryRouter := r.Group("").Use(i18n.Localize(), middleware.GlobalMiddleware(), middleware.AuthMiddleware(), middleware.LoginStatusMiddleware(), middleware.CORS(), middleware.OperationLog())
	{
		queryRouter.POST("/query/analyst/update_log", apiHandler.QueryAnalystUpdateLog) // Bot write-back alias (pending Bot backport)
	}

	// Browser-direct download surface: window.open / <img src> cannot carry an Authorization
	// header, so authentication is handled by the short-lived query token in the handler
	// (ParseDownloadToken). No AuthMiddleware; also no OperationLog to avoid recording the token.
	relayDownloadRouter := r.Group("api/v1/downloads").Use(i18n.Localize(), middleware.GlobalMiddleware(), middleware.CORS())
	{
		relayDownloadRouter.GET("/relay-file", apiHandler.RelayFileDownload) // token-authenticated OBS relay streaming download
	}

	// /api/v1/gene-images: public gene-example image surface (obsfs-backed).
	// Browser-direct <img src> cannot carry an Authorization header, so this
	// group carries no AuthMiddleware. The handler's traversal gate is the
	// authorization boundary (gene data is public).
	apiGeneImageRouter := r.Group("api/v1").Use(i18n.Localize(), middleware.GlobalMiddleware(), middleware.CORS())
	{
		apiGeneImageRouter.GET("/gene-images/:gene/:file", apiHandler.GeneImage) // public gene-example image (obsfs-backed)
	}
}
