package api_service

import (
	"context"
	"nky_client_go/common"
	"nky_client_go/model"
	"nky_client_go/server/api"

	"github.com/gin-gonic/gin"
)

func (ps *ApiService) ApiQuestionList(ctx *gin.Context, page int, size int) (response common.QuestionListResponse, apiErr api.Error) {
	if size < 0 {
		size = common.DEFAULT_PAGE_SIZE
	}
	offset := size * (page - 1)

	name, _ := ctx.Get("username")
	userId := ps.GetUserIdByEmail(ctx, name.(string))

	var questionItemList []model.SQuestionLog
	db := model.DB(ctx).Model(&model.SQuestionLog{}).Debug().Where("user_id = ?", userId)
	db = db.Count(&response.Total)
	db = db.Order("id desc").Limit(size).Offset(offset)
	db.Find(&questionItemList)

	questionList := make([]common.QuestionInfo, 0)
	for _, item := range questionItemList {
		questionList = append(questionList, common.QuestionInfo{
			Id:       item.Id,
			Question: item.Question,
		})
	}
	response.Page = page
	response.List = questionList
	return
}

func (ps *ApiService) ApiQuestionInfo(ctx context.Context, id int) (response common.QuestionInfoResponse, apiErr api.Error) {
	var questionInfo model.SQuestionLog
	db := model.DB(ctx).Model(&model.SQuestionLog{}).Debug().Where("id = ?", id)
	db.First(&questionInfo)

	response.Info = common.QuestionItem{
		Id:       questionInfo.Id,
		Question: questionInfo.Question,
		Answer:   questionInfo.Answer,
	}
	return
}
