package api_handler

import (
	"net/http"
	"nky_client_go/utils/errs"

	"github.com/gin-gonic/gin"
)

func (ph *ApiHandler) ApiUserFeedback(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	feedbackType := ctx.PostForm("feedback_type")
	feedbackContent := ctx.PostForm("feedback_content")
	if feedbackType == "" || feedbackContent == "" {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": "反馈类型或反馈内容不能为空"})
		return
	}

	// 登录生成有权限的工具
	userId, err := ph.service.ApiUserFeedback(ctx, name.(string), feedbackType, feedbackContent)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}
	userList := struct {
		UserId int `json:"user_id"`
	}{
		UserId: userId,
	}

	ctx.JSON(errs.SucResp(userList))
}
