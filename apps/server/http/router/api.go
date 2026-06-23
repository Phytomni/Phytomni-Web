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

	// /api/v1/auth:公开端点(无 JWT)。OPTIONS 预检由 CORS 中间件统一处理,无需专路由。
	apiAuthRouter := r.Group("api/v1/auth").Use(i18n.Localize(), middleware.GlobalMiddleware(), middleware.CORS(), middleware.OperationLog())
	{
		apiAuthRouter.POST("/sessions", authHandler.Login)             //登录(建会话)
		apiAuthRouter.POST("/registrations", authHandler.UserRegister) //自主注册(D5)
	}

	// /api/v1/downloads(邮件直链):obs-file 链接自带 obs_path+username、无 JWT,但记
	// 操作日志(与旧 auth 组中间件链一致)。
	apiDownloadEmailRouter := r.Group("api/v1/downloads").Use(i18n.Localize(), middleware.GlobalMiddleware(), middleware.CORS(), middleware.OperationLog())
	{
		apiDownloadEmailRouter.GET("/obs-file", authHandler.GetDownloadObsFile) //邮件中的结果下载链接
	}

	// /api/v1 认证组(JWT + 强制改密闸):用户与管理。中间件链与旧 v1 组逐字一致。
	apiV1Router := r.Group("api/v1").Use(i18n.Localize(), middleware.GlobalMiddleware(), middleware.AuthMiddleware(), middleware.LoginStatusMiddleware(), middleware.CORS(), middleware.OperationLog())
	{
		apiV1Router.POST("/users", apiHandler.Register)                              //管理员注册用户、vip用户(D5)
		apiV1Router.GET("/users", apiHandler.PermissionUserList)                     //管理员用户列表
		apiV1Router.GET("/users/me", apiHandler.GetUserProfile)                      //查询个人资料(邮箱取自 JWT,IDOR 关闭)
		apiV1Router.PUT("/users/me/password", apiHandler.ModifyPassword)             //用户个人修改密码(🔒 与 first_login_gate 锁步)
		apiV1Router.PUT("/users/:id/permissions", apiHandler.ModifyPermission)       //管理员修改用户权限/密码
		apiV1Router.POST("/users/:id/unlock", apiHandler.UnlockUser)                 //管理员手动解锁用户
		apiV1Router.GET("/users/me/tool-permissions", apiHandler.PermissionUserTool) //用户工具权限展示
		apiV1Router.POST("/user-feedback", apiHandler.UserFeedback)                  //用户反馈记录

		apiV1Router.GET("/conversations", apiHandler.Conversations)                  //会话列表(?favorite=true 为收藏列表)
		apiV1Router.GET("/conversations/:id/messages", apiHandler.AnswerCheck)       //某会话的全部子级对话
		apiV1Router.POST("/conversations/:id/messages", apiHandler.Query)            //发送消息(id=0 为新会话,转发到 Bot)
		apiV1Router.DELETE("/conversations/:id", apiHandler.QueryListDelete)         //软删除会话
		apiV1Router.PATCH("/conversations/:id", apiHandler.QueryListRename)          //重命名会话
		apiV1Router.PUT("/conversations/:id/reaction", apiHandler.QueryReactionType) //点赞/点踩
		apiV1Router.PUT("/conversations/:id/favorite", apiHandler.QueryCollect)      //收藏/取消收藏

		apiV1Router.GET("/async-tasks", apiHandler.AsyncTaskList)                       //任务列表(owner-scoped)
		apiV1Router.GET("/async-tasks/:id", apiHandler.AsyncTaskInfo)                   //任务状态(owner-scoped)
		apiV1Router.GET("/async-tasks/:id/analyst-log", apiHandler.AnalystAgentGetLog)  //分析日志
		apiV1Router.PATCH("/async-tasks/analyst-log", apiHandler.QueryAnalystUpdateLog) //异步结果回写(Bot 经旧别名 /query/analyst/update_log)

		apiV1Router.GET("/operation-logs", apiHandler.GetOperationLogs)   //操作日志查询(admin-only)
		apiV1Router.GET("/genes", apiHandler.GeneList)                    //基因测试数据列表
		apiV1Router.GET("/genes/:id", apiHandler.GeneDetails)             //基因详情(资源 id 即 file_name)
		apiV1Router.POST("/gene-examples", apiHandler.GeneDetailsStorage) //基因示例迭代数据

		apiV1Router.GET("/downloads/analyst-agent/obs-file", apiHandler.DownloadAnalystAgentObsFile)     //AnalystAgent obs 文件下载链接
		apiV1Router.GET("/downloads/analyst-agent/obs-images", apiHandler.DownloadAnalystAgentObsImages) //AnalystAgent obs 图片下载链接
		apiV1Router.POST("/downloads/rendering-file", apiHandler.DownloadObsRenderingFile)               //文件格式转换下载
	}

	// /api/v1/auth 生命周期组:登出/全设备登出。带 AuthMiddleware(handler 需 ctx 的
	// username/token)但**不带 LoginStatusMiddleware**——首登用户也必须能登出。这是
	// 与公开 apiAuthRouter(无 AuthMiddleware)和 apiV1Router(有首登闸)都不同的专用组。
	authLifecycleRouter := r.Group("api/v1/auth").Use(i18n.Localize(), middleware.GlobalMiddleware(), middleware.AuthMiddleware(), middleware.CORS(), middleware.OperationLog())
	{
		authLifecycleRouter.POST("/logout", apiHandler.Logout)        //当前 token 失效(单设备)
		authLifecycleRouter.POST("/logout-all", apiHandler.LogoutAll) //全设备登出(per-user epoch)
	}

	// Bot 回写别名:Bot 仍 POST /query/analyst/update_log;前端已改用
	// PATCH /api/v1/async-tasks/analyst-log。Bot 跨仓 backport 后由 operator 移除本别名。
	// 中间件链与 /api/v1 一致;网关仅在 bot.proxy_enabled 为 true 时服务真实流量。
	queryRouter := r.Group("").Use(i18n.Localize(), middleware.GlobalMiddleware(), middleware.AuthMiddleware(), middleware.LoginStatusMiddleware(), middleware.CORS(), middleware.OperationLog())
	{
		queryRouter.POST("/query/analyst/update_log", apiHandler.QueryAnalystUpdateLog) //Bot 回写别名(等 Bot backport)
	}

	// 浏览器直连下载面:window.open / <img src> 无法携带 Authorization 头,
	// 鉴权由 handler 内的 query 短时 token(ParseDownloadToken)完成,因此
	// 不挂 AuthMiddleware;也不挂 OperationLog,避免把 token 记进操作日志。
	relayDownloadRouter := r.Group("api/v1/downloads").Use(i18n.Localize(), middleware.GlobalMiddleware(), middleware.CORS())
	{
		relayDownloadRouter.GET("/relay-file", apiHandler.RelayFileDownload) //token 鉴权的 OBS 中转流式下载
	}

	// /api/v1/server:开放(无 JWT)的外部 server 接入口。
	serverRouter := r.Group("api/v1/server").Use(i18n.Localize(), middleware.CORS(), middleware.GlobalMiddleware())
	serverTaskHandler := api_handler.NewHandler()
	{
		serverRouter.POST("/tasks", serverTaskHandler.ServerCreateTask)      //客户使用 server 创建
		serverRouter.PATCH("/tasks/:id", serverTaskHandler.ServerUpdateTask) //客户使用 server 修改(server_id 进路径)
	}

	// 旧外部接入别名:外部客户端仍调 /v1/nky/server/*;它们跨边界 backport 到
	// /api/v1/server/tasks 后由 operator 移除本别名(design §2.1 无永久兼容层)。
	legacyServerRouter := r.Group("v1/nky/server").Use(i18n.Localize(), middleware.CORS(), middleware.GlobalMiddleware())
	{
		legacyServerRouter.POST("/create_task", serverTaskHandler.ServerCreateTask) //别名 → POST /api/v1/server/tasks
		legacyServerRouter.POST("/update_task", serverTaskHandler.ServerUpdateTask) //别名 → PATCH /api/v1/server/tasks/:id
	}
}
