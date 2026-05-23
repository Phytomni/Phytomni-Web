package api_handler

import (
	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
	"net/http"
	"nky_client_go/common"
	"nky_client_go/utils/errs"
)

func (ph *ApiHandler) ApiKooSearchQuestion(ctx *gin.Context) {
	var question common.KooSearchQuestionRequest

	question.ExtraRepoIDs = []string{}
	question.RefreshFlag = 0
	question.TopP = 0.1
	question.MaxTokens = 2048
	question.ChatTemperature = 0.8
	question.SearchTemperature = 0.3
	question.PresencePenalty = 0

	if err := ctx.ShouldBindJSON(&question); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": err.Error()})
		return
	}

	searchQuestion, err := ph.service.ApiKooSearchQuestion(ctx, question)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(searchQuestion))
}

func (ph *ApiHandler) ApiKooSearchSearch(ctx *gin.Context) {
	var question common.KooSearchSearchRequest
	question.ExtraRepoIds = []string{}
	if err := ctx.ShouldBindJSON(&question); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"code": http.StatusBadRequest, "message": err.Error()})
		return
	}

	searchQuestion, err := ph.service.ApiKooSearchSearch(ctx, question)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"code": http.StatusInternalServerError, "message": err.Error()})
		return
	}

	ctx.JSON(errs.SucResp(searchQuestion))
}

func (ph *ApiHandler) ApiKooSearchDownloadFiles(ctx *gin.Context) {

	file := ctx.Query("file")

	url := viper.GetString("koosearch.url.files_url") + file
	ctx.JSON(http.StatusOK, gin.H{"code": http.StatusOK, "data": url})
}
