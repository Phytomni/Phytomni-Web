package api_handler

import (
	"net/http"
	"nky_client_go/common"
	"nky_client_go/middleware"
	"nky_client_go/model"
	"nky_client_go/utils"
	"nky_client_go/utils/errs"
	"strconv"

	"github.com/asaskevich/govalidator"

	"github.com/gin-gonic/gin"
)

func (ph *ApiHandler) ApiGetUserProfile(ctx *gin.Context) {
	email := ctx.Query("email")
	if email == "" {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "邮箱不能为空"})
		return
	}

	profile, err := ph.service.ApiGetUserProfile(ctx, email)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(profile))
}

func (ph *ApiHandler) ApiUserRegister(ctx *gin.Context) {
	email := ctx.PostForm("email")
	password := ctx.PostForm("password")

	if email == "" || password == "" {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":  http.StatusBadRequest,
			"error": "用户名或密码不能为空",
		})
		return
	}

	// 检查密码长度（示例）
	if len(password) < 8 || len(password) > 16 {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": "密码长度至少为8位",
		})
		return
	}

	// 密码复杂度校验
	if !utils.ValidatePasswordComplexity(password) {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": "密码必须包含大小写字母、数字及标点符号",
		})
		return
	}

	// 检查用户是否已存在
	if exists := ph.service.CheckEmailExists(ctx, email); exists {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "用户名已存在", "token": ""})
		return
	}

	if !govalidator.IsEmail(email) {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": "用户名必须是有效的邮箱格式",
		})
		return
	}

	err := ph.service.ApiUserRegister(ctx, email, password)
	if err != nil {
		ctx.JSON(http.StatusConflict, gin.H{"code": http.StatusConflict, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(email))

}

func (ph *ApiHandler) ApiUnlockUser(ctx *gin.Context) {
	// 获取当前登录用户名（操作员）
	operatorName, exists := ctx.Get("username")
	if !exists {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": "未登录"})
		return
	}

	// 获取要解锁的用户ID
	userIdStr := ctx.PostForm("user_id")
	if userIdStr == "" {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "用户ID不能为空"})
		return
	}
	userId, err := strconv.Atoi(userIdStr)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "无效的用户ID"})
		return
	}

	// 调用Service执行解锁
	err = ph.service.ApiUnlockUser(ctx, operatorName.(string), userId)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp("解锁成功"))
}

func (ph *ApiHandler) ApiRegister(ctx *gin.Context) {
	email := ctx.PostForm("email")
	password := ctx.PostForm("password")
	code := ctx.PostForm("code")
	id, _ := strconv.Atoi(ctx.PostForm("id"))
	phone := ctx.PostForm("phone")
	organization := ctx.PostForm("organization")
	position := ctx.PostForm("position")

	if email == "" || password == "" {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":  http.StatusBadRequest,
			"error": "用户名或密码不能为空",
		})
		return
	}

	// 检查密码长度（示例）
	if len(password) < 8 || len(password) > 16 {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": "密码长度至少为8位",
		})
		return
	}

	// 密码复杂度校验
	if !utils.ValidatePasswordComplexity(password) {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": "密码必须包含大小写字母、数字及标点符号",
		})
		return
	}

	if !govalidator.IsEmail(email) {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": "用户名必须是有效的邮箱格式",
		})
		return
	}
	// 检查是否有注册的权限
	name, _ := ctx.Get("username")
	permission, _ := ph.service.GetUserRegisterPermission(ctx, name.(string))
	if !permission {
		ctx.JSON(http.StatusConflict, gin.H{"code": http.StatusInternalServerError, "message": "你不是管理员，没有创建用户的权限", "token": ""})
		return
	}

	// 检查用户是否已存在
	if exists := ph.service.CheckEmailExists(ctx, email); exists {
		ctx.JSON(http.StatusConflict, gin.H{"code": http.StatusInternalServerError, "message": "用户名已存在", "token": ""})
		return
	}

	// 注册用户
	_, err := ph.service.RegisterAddUser(ctx, email, password, code, id, phone, organization, position)
	if err != nil {
		ctx.JSON(http.StatusConflict, gin.H{"code": http.StatusInternalServerError, "message": err.Error(), "token": ""})
		return
	}

	// 注册成功后直接生成token
	token, err := middleware.GenerateToken(email)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": "生成token失败", "token": ""})
		return
	}
	ctx.JSON(errs.SucResp(token))

}

func (ph *ApiHandler) ApiModifyPassword(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	password := ctx.PostForm("password")
	newPassword := ctx.PostForm("new_password")

	if len(newPassword) < 8 || len(newPassword) > 16 {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusInternalServerError, "message": "新的密码格式不正确"})
		return
	}

	// 密码复杂度校验
	if !utils.ValidatePasswordComplexity(newPassword) {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": "新密码必须包含大小写字母、数字及标点符号",
		})
		return
	}

	if password == newPassword {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": "新密码不能与旧密码相同",
		})
		return
	}

	email, err := ph.service.ApiModifyPassword(ctx, name.(string), password, newPassword)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}
	ctx.JSON(errs.SucResp(email))
}

func (ph *ApiHandler) ApiLogin(ctx *gin.Context) {
	email := ctx.PostForm("email")
	password := ctx.PostForm("password")

	// 检查用户是否已存在
	if exists := ph.service.CheckEmailExists(ctx, email); !exists {
		ctx.JSON(http.StatusConflict, gin.H{"code": http.StatusInternalServerError, "message": "用户不存在"})
		return
	}

	userRes, count, err := ph.service.GetUserInfo(ctx, email, password)
	if count == 0 {
		msg := "用户名或密码错误"
		if err != nil {
			msg = err.Error()
		}
		ctx.JSON(http.StatusConflict, gin.H{"code": http.StatusInternalServerError, "message": msg})
		return
	}

	if userRes.FirstLoginStatus == "0" {
		err := model.DB(ctx).Model(&model.SUser{}).Debug().Where("id = ?", userRes.Id).Update("first_login_status", "1").Error
		if err != nil {
			ctx.JSON(http.StatusConflict, gin.H{"code": http.StatusInternalServerError, "message": "修改登陆状态失败"})
			return
		}
	}

	// 登录生成有权限的工具
	//ToolList, permission := ph.service.GetUserToolPermission(userResquest.Email)
	//if len(ToolList) == 0 {
	//	ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": "获取工具列表失败", "token": ""})
	//	return
	//}

	// 登录成功后直接生成token
	token, tokenErr := middleware.GenerateToken(email)
	if tokenErr != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": "生成token失败", "token": ""})
		return
	}

	// 校验当前密码复杂度，如果过低则添加提示
	if userRes.PasswordWarning == "" && !utils.ValidatePasswordComplexity(password) {
		userRes.PasswordWarning = "当前密码复杂度较低，为安全起见请及时修改密码。"
	}

	userData := struct {
		Token           string `json:"token"`
		UserName        string `json:"user_name"`
		LoginStatus     string `json:"login_status"`
		PasswordWarning string `json:"password_warning,omitempty"`
	}{
		Token:           token,
		UserName:        email,
		LoginStatus:     userRes.FirstLoginStatus,
		PasswordWarning: userRes.PasswordWarning,
	}

	ctx.JSON(errs.SucResp(userData))
}

func (ph *ApiHandler) ApiPermissionUserTool(ctx *gin.Context) {
	name, _ := ctx.Get("username")

	// 登录生成有权限的工具
	ToolList, permissionList, permission := ph.service.GetUserToolPermission(ctx, name.(string))
	if len(ToolList) == 0 && len(permissionList) == 0 {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": "获取工具列表失败", "token": ""})
		return
	}

	if ToolList == nil {
		ToolList = []string{} // 确保不是 nil
	}

	LoginRes := &common.LoginResponse{
		ToolList:       ToolList,
		PermissionList: permissionList,
		Permission:     permission,
	}

	ctx.JSON(errs.SucResp(LoginRes))
}

func (ph *ApiHandler) ApiPermissionUserList(ctx *gin.Context) {
	// 检查是否有查看用户列表的权限
	name, _ := ctx.Get("username")

	current, _ := strconv.Atoi(ctx.Query("current"))
	size, _ := strconv.Atoi(ctx.Query("size"))

	permission, code := ph.service.GetUpdateUserRegisterPermission(ctx, name.(string))
	if !permission {
		ctx.JSON(200, gin.H{"code": 403, "message": "没有管理员或超级管理员权限", "token": ""})
		return
	}

	// 生成所有用户的列表展示
	userList, total, totalPages, err := ph.service.GetUserList(ctx, current, size, code)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": "查询用户列表失败", "token": ""})
		return
	}

	response := &common.UserListResponse{
		Total:      total,
		TotalPages: totalPages,
		UserList:   userList,
	}

	ctx.JSON(errs.SucResp(response))
}

func (ph *ApiHandler) ApiModifyPermission(ctx *gin.Context) {

	name, _ := ctx.Get("username")
	userId, _ := strconv.Atoi(ctx.PostForm("id"))
	code := ctx.PostForm("code")
	password := ctx.PostForm("password")
	phone := ctx.PostForm("phone")
	organization := ctx.PostForm("organization")
	position := ctx.PostForm("position")
	chatLimit, _ := strconv.Atoi(ctx.PostForm("chat_limit"))

	// 展示在列表中有id的则为有权限修改密码的用户
	if password != "" {
		if len(password) < 8 || len(password) > 16 {
			ctx.JSON(http.StatusConflict, gin.H{"code": http.StatusInternalServerError, "message": "密码格式不正确", "token": ""})
			return
		}
		if updatePass := ph.service.UpdateUserPassWord(ctx, password, userId); !updatePass {
			ctx.JSON(http.StatusConflict, gin.H{"code": http.StatusInternalServerError, "message": "修改密码失败", "token": ""})
			return
		}
		ctx.JSON(errs.SucResp(userId))
		return
	}

	uId, err := ph.service.ApiModifyPermission(ctx, name.(string), userId, code, phone, organization, position, chatLimit)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(gin.H{
		"up_id": uId,
	}))
}
