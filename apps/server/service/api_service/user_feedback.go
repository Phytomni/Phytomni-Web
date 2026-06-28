package api_service

import (
	"context"
	"errors"
	"phytomni-server/model"
	"time"
)

func (ps *Service) UserFeedback(ctx context.Context, email, feedbackType, feedbackContent string) (id int, err error) {
	var user *model.User
	err = model.DB(ctx).Model(&model.User{}).Debug().Where("email =?", email).First(&user).Error
	if err != nil {
		return 0, errors.New("user not found")
	}

	userFeedbackData := &model.UserFeedback{
		UserId:          int(user.Id),
		FeedbackType:    feedbackType,
		FeedbackContent: feedbackContent,
		CreatedAt:       time.Time{},
		UpdatedAt:       time.Time{},
		DeleteAt:        nil,
	}
	err = model.DB(ctx).Model(&model.UserFeedback{}).Debug().Create(userFeedbackData).Error
	if err != nil {
		return 0, errors.New("failed to store feedback")
	}

	return userFeedbackData.Id, nil
}
