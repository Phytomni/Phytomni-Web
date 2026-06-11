package api_handler

import (
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
