package api_handler

import (
	"net/http"
	"phytomni-server/common"
	"phytomni-server/utils/errs"
	"strconv"

	"github.com/gin-gonic/gin"
)

func (ph *Handler) UnlockUser(ctx *gin.Context) {
	operatorName, exists := ctx.Get("username")
	if !exists {
		ctx.JSON(http.StatusUnauthorized, gin.H{"code": http.StatusUnauthorized, "message": "not logged in"})
		return
	}

	// RESTful: target user id from path param /users/:id/unlock
	userIdStr := ctx.Param("id")
	if userIdStr == "" {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "user ID cannot be empty"})
		return
	}
	userId, err := strconv.Atoi(userIdStr)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "invalid user ID"})
		return
	}

	err = ph.service.UnlockUser(ctx, operatorName.(string), userId)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp("unlocked successfully"))
}

func (ph *Handler) PermissionUserTool(ctx *gin.Context) {
	name, _ := ctx.Get("username")

	ToolList, permissionList, permission := ph.service.GetUserToolPermission(ctx, name.(string))
	if len(ToolList) == 0 && len(permissionList) == 0 {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": "failed to get tool list", "token": ""})
		return
	}

	if ToolList == nil {
		ToolList = []string{} // ensure non-nil for JSON encoding
	}

	LoginRes := &common.LoginResponse{
		ToolList:       ToolList,
		PermissionList: permissionList,
		Permission:     permission,
		ExpertEnabled:  ph.service.ExpertModeEnabled(),
	}

	ctx.JSON(errs.SucResp(LoginRes))
}

func (ph *Handler) PermissionUserList(ctx *gin.Context) {
	name, _ := ctx.Get("username")

	current, _ := strconv.Atoi(ctx.Query("current"))
	size, _ := strconv.Atoi(ctx.Query("size"))

	permission, code := ph.service.GetUpdateUserRegisterPermission(ctx, name.(string))
	if !permission {
		ctx.JSON(200, gin.H{"code": 403, "message": "no administrator or super administrator permission", "token": ""})
		return
	}

	userList, total, totalPages, err := ph.service.GetUserList(ctx, current, size, code)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": "failed to query user list", "token": ""})
		return
	}

	response := &common.UserListResponse{
		Total:      total,
		TotalPages: totalPages,
		UserList:   userList,
	}

	ctx.JSON(errs.SucResp(response))
}

func (ph *Handler) ModifyPermission(ctx *gin.Context) {

	name, _ := ctx.Get("username")
	userId, _ := strconv.Atoi(ctx.Param("id")) // RESTful: user id from path /users/:id/permissions
	code := ctx.PostForm("code")
	password := ctx.PostForm("password")
	phone := ctx.PostForm("phone")
	organization := ctx.PostForm("organization")
	position := ctx.PostForm("position")
	chatLimit, _ := strconv.Atoi(ctx.PostForm("chat_limit"))

	// A non-empty password means the admin is resetting this user's password.
	if password != "" {
		if len(password) < 8 || len(password) > 16 {
			ctx.JSON(http.StatusConflict, gin.H{"code": http.StatusInternalServerError, "message": "invalid password format", "token": ""})
			return
		}
		if updatePass := ph.service.UpdateUserPassWord(ctx, password, userId); !updatePass {
			ctx.JSON(http.StatusConflict, gin.H{"code": http.StatusInternalServerError, "message": "failed to change password", "token": ""})
			return
		}
		ctx.JSON(errs.SucResp(userId))
		return
	}

	uId, err := ph.service.ModifyPermission(ctx, name.(string), userId, code, phone, organization, position, chatLimit)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(gin.H{
		"up_id": uId,
	}))
}
