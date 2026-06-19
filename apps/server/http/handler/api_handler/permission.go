package api_handler

import (
	"net/http"
	"phytomni-server/common"
	"phytomni-server/utils/errs"
	"strconv"

	"github.com/gin-gonic/gin"
)

func (ph *Handler) UnlockUser(ctx *gin.Context) {
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
	err = ph.service.UnlockUser(ctx, operatorName.(string), userId)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp("解锁成功"))
}

func (ph *Handler) PermissionUserTool(ctx *gin.Context) {
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

func (ph *Handler) PermissionUserList(ctx *gin.Context) {
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

func (ph *Handler) ModifyPermission(ctx *gin.Context) {

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

	uId, err := ph.service.ModifyPermission(ctx, name.(string), userId, code, phone, organization, position, chatLimit)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(gin.H{
		"up_id": uId,
	}))
}
