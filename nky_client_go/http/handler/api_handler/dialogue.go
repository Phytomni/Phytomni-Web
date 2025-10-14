package api_handler

import (
	"errors"
	"github.com/gin-gonic/gin"
	"net/http"
	"nky_client_go/common"
	"nky_client_go/utils/errs"
)

func (ph *ApiHandler) ApiDialogueFlowStart(ctx *gin.Context) {
	var DialogueRequest common.DialogueRequestData
	DialogueRequest.User = "abc-123"
	if err := ctx.ShouldBindJSON(&DialogueRequest); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": errors.New("格式错误")})
		return
	}
	response, err := ph.service.ApiDialogueFlowStart(ctx, DialogueRequest)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ctx.JSON(errs.SucResp(response))
}
