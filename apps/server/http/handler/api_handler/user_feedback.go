package api_handler

import (
	"net/http"
	"phytomni-server/common/i18n"
	"phytomni-server/utils/errs"

	"github.com/gin-gonic/gin"
)

func (ph *Handler) UserFeedback(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	feedbackType := ctx.PostForm("feedback_type")
	feedbackContent := ctx.PostForm("feedback_content")
	if feedbackType == "" || feedbackContent == "" {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": i18n.T(ctx, "feedback.empty_body")})
		return
	}

	userId, err := ph.service.UserFeedback(ctx, name.(string), feedbackType, feedbackContent)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": i18n.TMaybe(ctx, err.Error())})
		return
	}
	userList := struct {
		UserId int `json:"user_id"`
	}{
		UserId: userId,
	}

	ctx.JSON(errs.SucResp(userList))
}
