package router

import (
	"nky_client_go/http/handler/api_handler"
	"nky_client_go/middleware"

	"github.com/gin-gonic/gin"
)

func Api(r *gin.RouterGroup) {
	prefixRouter := r.Group("auth").Use(middleware.GlobalMiddleware(), middleware.CORS())
	homeHandler := api_handler.NewApiHandler()
	{
		prefixRouter.POST("/user/register", homeHandler.ApiUserRegister)                //自主注册
		prefixRouter.OPTIONS("/login", func(c *gin.Context) { c.AbortWithStatus(204) }) //本机的前端会有跨域问题，显示解决
		prefixRouter.POST("/login", homeHandler.ApiLogin)
		prefixRouter.GET("/download/obs_file", homeHandler.ApiGetDownloadObsFile) //给与邮件中获取文件下载的链接（需要修改为获取zip）

	}

	prefixTokenRouter := r.Group("v1").Use(middleware.GlobalMiddleware(), middleware.AuthMiddleware(), middleware.CORS())
	homeTokenHandler := api_handler.NewApiHandler()
	{
		//todo 以下为新需求的使用接口
		prefixTokenRouter.GET("/query/list", homeTokenHandler.ApiQueryList)                   //查看存储的所有问答列表,返回用户所有问题
		prefixTokenRouter.GET("/answer/check", homeTokenHandler.ApiAnswerCheck)               //根据父id查找全部子级对话
		prefixTokenRouter.POST("/query/list/delete", homeTokenHandler.ApiQueryListDelete)     //问题列表软删除
		prefixTokenRouter.POST("/query/list/rename", homeTokenHandler.ApiQueryListRename)     //问题列表重命名
		prefixTokenRouter.POST("/query/reaction_type", homeTokenHandler.ApiQueryReactionType) //对话点赞，点踩
		prefixTokenRouter.POST("/query/collect", homeTokenHandler.ApiQueryCollect)            //对话收藏
		prefixTokenRouter.GET("/query/collect/list", homeTokenHandler.ApiQueryCollectList)    //对话收藏列表

		//todo
		prefixTokenRouter.POST("/register", homeTokenHandler.ApiRegister)                      //管理员注册用户、vip用户
		prefixTokenRouter.POST("/modify/password", homeTokenHandler.ApiModifyPassword)         //用户个人修改密码
		prefixTokenRouter.GET("/permission/user/list", homeTokenHandler.ApiPermissionUserList) //管理员用户列表
		prefixTokenRouter.POST("/modify/permission", homeTokenHandler.ApiModifyPermission)     //管理员,超级管理员修改权限。密码                                                      //管理员修改用户权限
		prefixTokenRouter.GET("/permission/user/tool", homeTokenHandler.ApiPermissionUserTool) //用户工具权限展示
		prefixTokenRouter.POST("/user/feedback", homeTokenHandler.ApiUserFeedback)             //用户反馈记录

		prefixTokenRouter.GET("/async_task/list", homeTokenHandler.ApiAsyncTaskList) //查询任务列表
		prefixTokenRouter.GET("/async_task/info", homeTokenHandler.ApiAsyncTaskInfo) //查询任务状态
		//prefixTokenRouter.GET("/get_analyst_agent_log", homeTokenHandler.ApiGetAnalystAgentLog) //查询分析日志
		prefixTokenRouter.GET("/analyst/get_log", homeTokenHandler.ApiAnalystAgentGetLog) //查询分析日志
		//prefixTokenRouter.POST("/analyst/update_log", homeTokenHandler.ApiAnalystAgentUpdateLog) //查询并更新日志内容

		//实时创建下载链接能力

		prefixTokenRouter.GET("/gene/list", homeTokenHandler.ApiGeneList)                       //基因测试数据列表
		prefixTokenRouter.GET("/gene/details", homeTokenHandler.ApiGeneDetails)                 //模拟数据详情
		prefixTokenRouter.POST("/gene/details/storage", homeTokenHandler.ApiGeneDetailsStorage) //基因示例迭代数据

		prefixTokenRouter.GET("/download/analyst_agent/obs_file", homeTokenHandler.ApiDownloadAnalystAgentObsFile) //获取AnalystAgent的obs文件下载链接

		prefixTokenRouter.POST("/download/rendering_file", homeTokenHandler.ApiDownloadObsRenderingFile) //文件格式转换下载

	}
	serverRouter := r.Group("v1/nky/server").Use(middleware.CORS(), middleware.GlobalMiddleware())
	homeServerHandler := api_handler.NewApiHandler()
	{
		//todo server内部开放路由
		serverRouter.POST("/create_task", homeServerHandler.ApiServerCreateTask) //客户使用server创建
		serverRouter.POST("/update_task", homeServerHandler.ApiServerUpdateTask) //客户使用server修改

		//serverRouter.GET("/get_analyst_agent_log", homeServerHandler.ApiGetAnalystAgentLog) //获取日志下载链接
	}
}

//prefixTokenRouter := r.Group("v1").Use(middleware.GlobalMiddleware(), middleware.AuthMiddleware(), middleware.CORS())
//homeTokenHandler := api_handler.NewApiHandler()
//{
////todo 以下接口都暂停使用
//prefixTokenRouter.GET("/index", homeTokenHandler.ApiIndexList)
//prefixTokenRouter.GET("/user_info", homeTokenHandler.ApiUserInfo)
//
//prefixTokenRouter.GET("/question/list", homeTokenHandler.ApiQuestionList)
//prefixTokenRouter.GET("/question/info", homeTokenHandler.ApiQuestionInfo)
////Dify对话流
//prefixTokenRouter.POST("/dialogue/start", homeTokenHandler.ApiDialogueFlowStart)
////RAG
//prefixTokenRouter.POST("/question/start", homeTokenHandler.ApiQuestionStart)                   //目前只有RAG实现
//prefixTokenRouter.POST("/koosearch/question", homeTokenHandler.ApiKooSearchQuestion)           //问答
//prefixTokenRouter.POST("/koosearch/search", homeTokenHandler.ApiKooSearchSearch)               //搜索
//prefixTokenRouter.GET("/koosearch/download/files", homeTokenHandler.ApiKooSearchDownloadFiles) //下载文件
////BI
//prefixTokenRouter.POST("/bi/question", homeTokenHandler.ApiBiQuestion)
//}
