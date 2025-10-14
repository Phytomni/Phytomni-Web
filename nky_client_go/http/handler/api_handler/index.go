package api_handler

import (
	"net/http"
	"nky_client_go/utils/errs"
	"strconv"

	"nky_client_go/common"

	rxLog "nky_client_go/log"

	"github.com/gin-gonic/gin"
)

func (ph *ApiHandler) ApiIndexList(ctx *gin.Context) {
	page, _ := strconv.Atoi(ctx.Query("page"))
	response, err := ph.service.ApiIndexList(page)
	if err != nil {
		ctx.JSON(errs.ErrResp(err))
		return
	}
	ctx.JSON(errs.SucResp(response))
}

func (ph *ApiHandler) ApiUserInfo(ctx *gin.Context) {
	name, _ := ctx.Get("username")
	rxLog.Sugar().Info("当前登录的用户： ", name)
	var userData common.UserInfo
	userData.UserName = name.(string)

	ctx.JSON(errs.SucResp(userData))
}

func (ph *ApiHandler) ApiQuestionList(ctx *gin.Context) {
	page, _ := strconv.Atoi(ctx.Query("page"))
	size, _ := strconv.Atoi(ctx.Query("size"))
	response, err := ph.service.ApiQuestionList(ctx, page, size)
	if err != nil {
		ctx.JSON(errs.ErrResp(err))
		return
	}
	ctx.JSON(errs.SucResp(response))
}

func (ph *ApiHandler) ApiQuestionInfo(ctx *gin.Context) {
	id, _ := strconv.Atoi(ctx.Query("id"))
	response, err := ph.service.ApiQuestionInfo(id)
	if err != nil {
		ctx.JSON(errs.ErrResp(err))
		return
	}
	ctx.JSON(errs.SucResp(response))
}

func (ph *ApiHandler) ApiQuestionStart(ctx *gin.Context) {
	var question common.QuestionResquest
	if err := ctx.ShouldBindJSON(&question); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": err.Error()})
		return
	}
	//switch给定的问题类型，走不同的处理逻辑
	//RAG
	response, err := ph.service.ApiQuestionStart(ctx, question.Content)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": err.Error()})
		return
	}
	ctx.JSON(errs.SucResp(response))
}
