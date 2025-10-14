package api_service

import (
	"errors"
	"nky_client_go/model"
	"time"
)

func (ps *ApiService) ApiUserFeedback(email, feedbackType, feedbackContent string) (id int, err error) {
	var user *model.SUser
	err = model.Default().Model(&model.SUser{}).Debug().Where("email =?", email).First(&user).Error
	if err != nil {
		return 0, errors.New("用户不存在")
	}

	userFeedbackData := &model.SUserFeedback{
		UserId:          int(user.Id),
		FeedbackType:    feedbackType,
		FeedbackContent: feedbackContent,
		CreatedAt:       time.Time{},
		UpdatedAt:       time.Time{},
		DeleteAt:        nil,
	}
	err = model.Default().Model(&model.SUserFeedback{}).Debug().Create(userFeedbackData).Error
	if err != nil {
		return 0, errors.New("反馈存储失败")
	}

	return userFeedbackData.Id, nil
}
