package api_handler

import (
	"errors"
	"net/http"
	"phytomni-server/common/i18n"
	rxLog "phytomni-server/log"
	"phytomni-server/middleware"
	"phytomni-server/model"
	"phytomni-server/service/api_service"
	"phytomni-server/utils"
	"phytomni-server/utils/errs"
	"strconv"

	"github.com/asaskevich/govalidator"

	"github.com/gin-gonic/gin"
)

func (ph *Handler) GetUserProfile(ctx *gin.Context) {
	// "View self" semantics: email is taken exclusively from the JWT identity
	// injected by AuthMiddleware (ctx.Get("username")); the ?email= query param
	// sent by the frontend is intentionally ignored to close IDOR.
	name, ok := ctx.Get("username")
	email, _ := name.(string)
	if !ok || email == "" {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": "未登录"})
		return
	}

	profile, err := ph.service.GetUserProfile(ctx, email)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(profile))
}

func (ph *Handler) UserRegister(ctx *gin.Context) {
	email := ctx.PostForm("email")
	password := ctx.PostForm("password")

	if email == "" || password == "" {
		// The frontend response interceptor reads only res.data.message; the error
		// envelope must use "message" (not the legacy "error" key) so the i18n
		// string is preserved rather than swallowed by the generic fallback.
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": i18n.T(ctx, "register.credentials_required"),
		})
		return
	}

	if err := ph.service.CheckRegisterFloor(ctx, ctx.ClientIP()); err != nil {
		if errors.Is(err, api_service.ErrRegisterRateLimited) {
			ctx.Header("Retry-After", "3600")
			ctx.JSON(http.StatusTooManyRequests, gin.H{
				"code":    http.StatusTooManyRequests,
				"message": i18n.T(ctx, "register.rate_limited"),
			})
			return
		}
		// fail-closed: a COUNT error also rejects registration (low risk, retryable)
		ctx.JSON(http.StatusServiceUnavailable, gin.H{
			"code":    http.StatusServiceUnavailable,
			"message": i18n.T(ctx, "register.service_unavailable"),
		})
		return
	}

	if len(password) < 8 || len(password) > 16 {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": i18n.T(ctx, "register.password_too_short"),
		})
		return
	}

	if !utils.ValidatePasswordComplexity(password) {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": i18n.T(ctx, "register.password_complexity"),
		})
		return
	}

	if exists := ph.service.CheckEmailExists(ctx, email); exists {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "register.username_exists"), "token": ""})
		return
	}

	if !govalidator.IsEmail(email) {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": i18n.T(ctx, "register.email_invalid_format"),
		})
		return
	}

	err := ph.service.UserRegister(ctx, email, password)
	if err != nil {
		ctx.JSON(http.StatusConflict, gin.H{"code": http.StatusConflict, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(email))

}

func (ph *Handler) Register(ctx *gin.Context) {
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

	if len(password) < 8 || len(password) > 16 {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": "密码长度至少为8位",
		})
		return
	}

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
	name, _ := ctx.Get("username")
	permission, _ := ph.service.GetUserRegisterPermission(ctx, name.(string))
	if !permission {
		ctx.JSON(http.StatusConflict, gin.H{"code": http.StatusInternalServerError, "message": "你不是管理员，没有创建用户的权限", "token": ""})
		return
	}

	if exists := ph.service.CheckEmailExists(ctx, email); exists {
		ctx.JSON(http.StatusConflict, gin.H{"code": http.StatusInternalServerError, "message": "用户名已存在", "token": ""})
		return
	}

	_, err := ph.service.RegisterAddUser(ctx, email, password, code, id, phone, organization, position)
	if err != nil {
		ctx.JSON(http.StatusConflict, gin.H{"code": http.StatusInternalServerError, "message": err.Error(), "token": ""})
		return
	}

	token, err := middleware.GenerateToken(email)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": "生成token失败", "token": ""})
		return
	}
	ctx.JSON(errs.SucResp(token))

}

func (ph *Handler) ModifyPassword(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	password := ctx.PostForm("password")
	newPassword := ctx.PostForm("new_password")

	if len(newPassword) < 8 || len(newPassword) > 16 {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusInternalServerError, "message": i18n.T(ctx, "modify_password.password_format_invalid")})
		return
	}

	if !utils.ValidatePasswordComplexity(newPassword) {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": i18n.T(ctx, "modify_password.new_password_complexity"),
		})
		return
	}

	if password == newPassword {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"code":    http.StatusBadRequest,
			"message": i18n.T(ctx, "modify_password.new_password_same_as_old"),
		})
		return
	}

	email, err := ph.service.ModifyPassword(ctx, name.(string), password, newPassword)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	// Mark this user as no longer first-login. The flip happens here (after a
	// successful password change) instead of in the login handler so the field
	// reflects "initial password has been changed" rather than "user has ever
	// logged in". Fail the response on flip error — without the flip the user
	// stays gated, so a stale success would confuse them.
	if err := model.DB(ctx).Model(&model.User{}).Where("email = ?", name.(string)).
		Update("first_login_status", "1").Error; err != nil {
		rxLog.Sugar().Errorw("first_login_status flip failed after password change",
			"username", name, "err", err)
		ctx.JSON(http.StatusInternalServerError, gin.H{
			"code":    http.StatusInternalServerError,
			"message": i18n.T(ctx, "modify_password.flag_update_failed"),
		})
		return
	}

	ctx.JSON(errs.SucResp(email))
}

func (ph *Handler) Login(ctx *gin.Context) {
	email := ctx.PostForm("email")
	password := ctx.PostForm("password")

	if exists := ph.service.CheckEmailExists(ctx, email); !exists {
		ctx.JSON(http.StatusConflict, gin.H{"code": http.StatusInternalServerError, "message": i18n.T(ctx, "auth.user_not_found")})
		return
	}

	userRes, count, err := ph.service.GetUserInfo(ctx, email, password)
	if count == 0 {
		// Service returns translation keys as error messages (e.g. "auth.account_locked").
		// Translate via i18n.T before writing JSON; missing-key fallback returns
		// the key text + warning log so a typo degrades visibly but doesn't 500.
		if lockedErr, ok := err.(*errs.LockedError); ok {
			ctx.JSON(http.StatusConflict, gin.H{
				"code":    http.StatusInternalServerError,
				"message": i18n.T(ctx, lockedErr.Error()),
				"locked":  true,
			})
			return
		}
		msg := i18n.T(ctx, "auth.invalid_credentials")
		if err != nil {
			msg = i18n.T(ctx, err.Error())
		}
		ctx.JSON(http.StatusConflict, gin.H{"code": http.StatusInternalServerError, "message": msg})
		return
	}

	token, tokenErr := middleware.GenerateToken(email)
	if tokenErr != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": i18n.T(ctx, "auth.token_generation_failed"), "token": ""})
		return
	}

	if userRes.PasswordWarning == "" && !utils.ValidatePasswordComplexity(password) {
		userRes.PasswordWarning = i18n.T(ctx, "password_warning.weak_complexity")
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
