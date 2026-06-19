package api_handler

import (
	"net/http"
	customI18n "nky_client_go/common/i18n"
	rxLog "nky_client_go/log"
	"nky_client_go/middleware"
	"nky_client_go/model"
	"nky_client_go/utils"
	"nky_client_go/utils/errs"
	"strconv"

	"github.com/asaskevich/govalidator"

	"github.com/gin-gonic/gin"
)

func (ph *ApiHandler) ApiGetUserProfile(ctx *gin.Context) {
	// profile 接口为"查自己"语义:邮箱只从 AuthMiddleware 注入的 JWT 身份
	// (ctx.Get("username"))取,绝不信任前端传来的 ?email=,以关闭 IDOR。
	// 前端仍发 ?email=,后端忽略,合法自查行为不变。
	name, ok := ctx.Get("username")
	email, _ := name.(string)
	if !ok || email == "" {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": "未登录"})
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
		// 前端响应拦截器只读 res.data.message,错误信封必须用 "message" 承载
		// 已本地化的文案,而非旧的 "error" 键(否则本地化文案被通用回落吞掉)。
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": customI18n.T(ctx, "register.credentials_required"),
		})
		return
	}

	// 检查密码长度（示例）
	if len(password) < 8 || len(password) > 16 {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": customI18n.T(ctx, "register.password_too_short"),
		})
		return
	}

	// 密码复杂度校验
	if !utils.ValidatePasswordComplexity(password) {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": customI18n.T(ctx, "register.password_complexity"),
		})
		return
	}

	// 检查用户是否已存在
	if exists := ph.service.CheckEmailExists(ctx, email); exists {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": customI18n.T(ctx, "register.username_exists"), "token": ""})
		return
	}

	if !govalidator.IsEmail(email) {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": customI18n.T(ctx, "register.email_invalid_format"),
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
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusInternalServerError, "message": customI18n.T(ctx, "modify_password.password_format_invalid")})
		return
	}

	// 密码复杂度校验
	if !utils.ValidatePasswordComplexity(newPassword) {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": customI18n.T(ctx, "modify_password.new_password_complexity"),
		})
		return
	}

	if password == newPassword {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": customI18n.T(ctx, "modify_password.new_password_same_as_old"),
		})
		return
	}

	email, err := ph.service.ApiModifyPassword(ctx, name.(string), password, newPassword)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	// Mark this user as no longer first-login. The flip happens here (after a
	// successful password change) instead of in the login handler so the field
	// reflects "initial password has been changed" rather than "user has ever
	// logged in". Fail the response on flip error — without the flip the user
	// stays gated, so a stale success would confuse them.
	if err := model.DB(ctx).Model(&model.SUser{}).Where("email = ?", name.(string)).
		Update("first_login_status", "1").Error; err != nil {
		rxLog.Sugar().Errorw("first_login_status flip failed after password change",
			"username", name, "err", err)
		ctx.JSON(http.StatusInternalServerError, gin.H{
			"code":    http.StatusInternalServerError,
			"message": customI18n.T(ctx, "modify_password.flag_update_failed"),
		})
		return
	}

	ctx.JSON(errs.SucResp(email))
}

func (ph *ApiHandler) ApiLogin(ctx *gin.Context) {
	email := ctx.PostForm("email")
	password := ctx.PostForm("password")

	// 检查用户是否已存在
	if exists := ph.service.CheckEmailExists(ctx, email); !exists {
		ctx.JSON(http.StatusConflict, gin.H{"code": http.StatusInternalServerError, "message": customI18n.T(ctx, "auth.user_not_found")})
		return
	}

	userRes, count, err := ph.service.GetUserInfo(ctx, email, password)
	if count == 0 {
		// Service returns translation keys as error messages (e.g. "auth.account_locked").
		// Translate via customI18n.T before writing JSON; missing-key fallback returns
		// the key text + warning log so a typo degrades visibly but doesn't 500.
		if lockedErr, ok := err.(*errs.LockedError); ok {
			ctx.JSON(http.StatusConflict, gin.H{
				"code":    http.StatusInternalServerError,
				"message": customI18n.T(ctx, lockedErr.Error()),
				"locked":  true,
			})
			return
		}
		msg := customI18n.T(ctx, "auth.invalid_credentials")
		if err != nil {
			msg = customI18n.T(ctx, err.Error())
		}
		ctx.JSON(http.StatusConflict, gin.H{"code": http.StatusInternalServerError, "message": msg})
		return
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
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": customI18n.T(ctx, "auth.token_generation_failed"), "token": ""})
		return
	}

	// 校验当前密码复杂度，如果过低则添加提示
	if userRes.PasswordWarning == "" && !utils.ValidatePasswordComplexity(password) {
		userRes.PasswordWarning = customI18n.T(ctx, "password_warning.weak_complexity")
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
