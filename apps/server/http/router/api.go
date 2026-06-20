package router

import (
	"phytomni-server/common/i18n"
	"phytomni-server/http/handler/api_handler"
	"phytomni-server/middleware"

	"github.com/gin-gonic/gin"
)

func Api(r *gin.RouterGroup) {
	prefixRouter := r.Group("auth").Use(i18n.Localize(), middleware.GlobalMiddleware(), middleware.CORS(), middleware.OperationLog())
	authHandler := api_handler.NewHandler()
	{
		prefixRouter.POST("/user/register", authHandler.UserRegister)                   //自主注册
		prefixRouter.OPTIONS("/login", func(c *gin.Context) { c.AbortWithStatus(204) }) //本机的前端会有跨域问题，显示解决
		prefixRouter.POST("/login", authHandler.Login)
		prefixRouter.GET("/download/obs_file", authHandler.GetDownloadObsFile) //给与邮件中获取文件下载的链接（需要修改为获取zip）

	}

	prefixTokenRouter := r.Group("v1").Use(i18n.Localize(), middleware.GlobalMiddleware(), middleware.AuthMiddleware(), middleware.LoginStatusMiddleware(), middleware.CORS(), middleware.OperationLog())
	apiHandler := api_handler.NewHandler()
	{
		//todo 以下为新需求的使用接口
		prefixTokenRouter.GET("/query/list", apiHandler.QueryList)                   //查看存储的所有问答列表,返回用户所有问题
		prefixTokenRouter.GET("/answer/check", apiHandler.AnswerCheck)               //根据父id查找全部子级对话
		prefixTokenRouter.POST("/query/list/delete", apiHandler.QueryListDelete)     //问题列表软删除
		prefixTokenRouter.POST("/query/list/rename", apiHandler.QueryListRename)     //问题列表重命名
		prefixTokenRouter.POST("/query/reaction_type", apiHandler.QueryReactionType) //对话点赞，点踩
		prefixTokenRouter.POST("/query/collect", apiHandler.QueryCollect)            //对话收藏
		prefixTokenRouter.GET("/query/collect/list", apiHandler.QueryCollectList)    //对话收藏列表

		//todo
		prefixTokenRouter.POST("/register", apiHandler.Register)                      //管理员注册用户、vip用户
		prefixTokenRouter.POST("/modify/password", apiHandler.ModifyPassword)         //用户个人修改密码
		prefixTokenRouter.GET("/permission/user/list", apiHandler.PermissionUserList) //管理员用户列表
		prefixTokenRouter.POST("/modify/permission", apiHandler.ModifyPermission)     //管理员,超级管理员修改权限。密码                                                      //管理员修改用户权限
		prefixTokenRouter.POST("/user/unlock", apiHandler.UnlockUser)                 //管理员手动解锁用户
		prefixTokenRouter.GET("/permission/user/tool", apiHandler.PermissionUserTool) //用户工具权限展示
		prefixTokenRouter.POST("/user/feedback", apiHandler.UserFeedback)             //用户反馈记录
		prefixTokenRouter.GET("/user/profile", apiHandler.GetUserProfile)             //查询个人资料

		prefixTokenRouter.GET("/async_task/list", apiHandler.AsyncTaskList)      //查询任务列表
		prefixTokenRouter.GET("/async_task/info", apiHandler.AsyncTaskInfo)      //查询任务状态
		prefixTokenRouter.GET("/analyst/get_log", apiHandler.AnalystAgentGetLog) //查询分析日志

		// 增加日志查询接口
		prefixTokenRouter.POST("/operation/logs", apiHandler.GetOperationLogs) //查询用户操作日志

		//实时创建下载链接能力

		prefixTokenRouter.GET("/gene/list", apiHandler.GeneList)                       //基因测试数据列表
		prefixTokenRouter.GET("/gene/details", apiHandler.GeneDetails)                 //模拟数据详情
		prefixTokenRouter.POST("/gene/details/storage", apiHandler.GeneDetailsStorage) //基因示例迭代数据

		prefixTokenRouter.GET("/download/analyst_agent/obs_file", apiHandler.DownloadAnalystAgentObsFile)     //获取AnalystAgent的obs文件下载链接
		prefixTokenRouter.GET("/download/analyst_agent/obs_images", apiHandler.DownloadAnalystAgentObsImages) //获取AnalystAgent的obs图片下载链接

		prefixTokenRouter.POST("/download/rendering_file", apiHandler.DownloadObsRenderingFile) //文件格式转换下载

	}

	// The Web app posts /query and /query/analyst/update_log at the root path (not
	// under /v1). Mount them on a root group that replicates the /v1 auth chain.
	// The gateway only serves real traffic when bot.proxy_enabled is true.
	queryRouter := r.Group("").Use(i18n.Localize(), middleware.GlobalMiddleware(), middleware.AuthMiddleware(), middleware.LoginStatusMiddleware(), middleware.CORS(), middleware.OperationLog())
	{
		queryRouter.POST("/query", apiHandler.Query)                                    //对话编排,转发到 Bot
		queryRouter.POST("/query/analyst/update_log", apiHandler.QueryAnalystUpdateLog) //异步任务结果同步回库
	}

	// 浏览器直连下载面:window.open / <img src> 无法携带 Authorization 头,
	// 鉴权由 handler 内的 query 短时 token(ParseDownloadToken)完成,因此
	// 不挂 AuthMiddleware;也不挂 OperationLog,避免把 token 记进操作日志。
	relayDownloadRouter := r.Group("v1").Use(i18n.Localize(), middleware.GlobalMiddleware(), middleware.CORS())
	{
		relayDownloadRouter.GET("/download/relay_file", apiHandler.RelayFileDownload) //token 鉴权的 OBS 中转流式下载
	}

	serverRouter := r.Group("v1/nky/server").Use(i18n.Localize(), middleware.CORS(), middleware.GlobalMiddleware())
	serverTaskHandler := api_handler.NewHandler()
	{
		//todo server内部开放路由
		serverRouter.POST("/create_task", serverTaskHandler.ServerCreateTask) //客户使用server创建
		serverRouter.POST("/update_task", serverTaskHandler.ServerUpdateTask) //客户使用server修改
	}
}

//prefixTokenRouter := r.Group("v1").Use(middleware.GlobalMiddleware(), middleware.AuthMiddleware(), middleware.CORS())
//apiHandler := api_handler.NewHandler()
//{
////todo 以下接口都暂停使用
//prefixTokenRouter.GET("/index", apiHandler.ApiIndexList)
//prefixTokenRouter.GET("/user_info", apiHandler.ApiUserInfo)
//
//}
