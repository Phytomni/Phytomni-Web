package api_service

import (
	"errors"
	"github.com/gin-gonic/gin"
	"nky_client_go/common"
	"nky_client_go/model"
	"nky_client_go/server/api"
	"time"
)

func (ps *ApiService) ApiQuestionStart(ctx *gin.Context, question string) (response *common.QuestionHWResponse, err error) {
	var REPO_ID = map[string]string{
		"中文": "ec3be998-43a8-483e-a2d8-029c9161431b",
		"英文": "a34b2477-a4b1-4a30-8726-77bbf66ca048",
	}
	rag, err := RunRAG(REPO_ID["英文"], question, 1, 10)
	if err != nil {
		return nil, errors.New("回答创建失败")
	}
	err = model.Default().Model(&model.SQuestionLog{}).Debug().Create(&model.SQuestionLog{
		UserId:   ps.GetUserIdByEmail(ctx.GetString("username")),
		Question: question,
		Answer:   rag,
	}).Error
	if err != nil {
		return nil, errors.New("存储回答失败")
	}
	response = new(common.QuestionHWResponse)
	response.Question = question
	response.Answer = rag
	response.UserName = ctx.GetString("username")
	return
}

func (ps *ApiService) ApiQuestionList(ctx *gin.Context, page int, size int) (response common.QuestionListResponse, apiErr api.Error) {
	if size < 0 {
		size = common.DEFAULT_PAGE_SIZE
	}
	offset := size * (page - 1)

	name, _ := ctx.Get("username")
	userId := ps.GetUserIdByEmail(name.(string))

	var questionItemList []model.SQuestionLog
	db := model.Default().Model(&model.SQuestionLog{}).Debug().Where("user_id = ?", userId)
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

func (ps *ApiService) ApiQuestionInfo(id int) (response common.QuestionInfoResponse, apiErr api.Error) {
	var questionInfo model.SQuestionLog
	db := model.Default().Model(&model.SQuestionLog{}).Debug().Where("id = ?", id)
	db.First(&questionInfo)

	response.Info = common.QuestionItem{
		Id:       questionInfo.Id,
		Question: questionInfo.Question,
		Answer:   questionInfo.Answer,
	}
	return
}

func (ps *ApiService) ApiKooSearchQuestion(ctx *gin.Context, request common.KooSearchQuestionRequest) (response *common.KooSearchQuestionResponse, err error) {

	question, err := RunKooSearchQuestion(request)
	if err != nil {
		return nil, err
	}

	content := request.KooSearchMessages[len(request.KooSearchMessages)-1]
	err = model.Default().Model(&model.SKooSearchQuestionLog{}).Debug().Create(&model.SKooSearchQuestionLog{
		UserId:     ps.GetUserIdByEmail(ctx.GetString("username")),
		Question:   content.Content,
		ChatId:     request.ChatID,
		Answer:     question.ChatResult.Message,
		QuestionId: question.ChatResult.QuestionID,
		Status:     1,
		CreatedAt:  time.Time{},
		UpdatedAt:  time.Time{},
	}).Error
	if err != nil {
		return nil, errors.New("存储回答失败")
	}
	return question, nil
}

func (ps *ApiService) ApiKooSearchSearch(ctx *gin.Context, request common.KooSearchSearchRequest) (response *common.KooSearchSearchResponse, err error) {

	question, err := RunKooSearchSearch(request)
	if err != nil {
		return nil, err
	}

	return question, nil
}
