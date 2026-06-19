package api_service

import (
	"context"
	"phytomni-server/common"
	"phytomni-server/model"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-errors/errors"
	"gorm.io/gorm"
)

func (ps *Service) GetUserProfile(ctx context.Context, email string) (*common.UserProfileResponse, error) {
	var user model.SUser
	// 1. 查询用户基本信息
	if err := model.DB(ctx).Model(&model.SUser{}).Where("email = ?", email).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("auth.user_not_found")
		}
		return nil, err
	}

	// 2. 查询对话总数 (f_id = 0 代表对话)
	var dialogueCount int64
	if err := model.DB(ctx).Model(&model.SQuestionAgentLog{}).Where("user_name = ? AND f_id = ? AND delete_at IS NULL", email, 0).Count(&dialogueCount).Error; err != nil {
		return nil, err
	}

	return &common.UserProfileResponse{
		UserLostData: common.UserLostData{
			Id:           user.Id,
			Email:        user.Email,
			Code:         user.Code,
			Description:  user.Description,
			LockedUntil:  user.LockedUntil,
			LastLoginAt:  user.LastLoginAt,
			Phone:        user.Phone,
			Organization: user.Organization,
			Position:     user.Position,
			ChatLimit:    user.ChatLimit,
		},
		DialogueCount: dialogueCount,
	}, nil
}

func (ps *Service) CheckEmailExists(ctx context.Context, email string) bool {
	var count int64
	db := model.DB(ctx).Model(&model.SUser{}).Debug().Where("email = ?", email)
	db.Count(&count)
	if count > 0 {
		return true
	}
	return false
}

func (ps *Service) GetUserIdByEmail(ctx context.Context, email string) (userId int64) {
	var userInfo model.SUser
	db := model.DB(ctx).Model(&model.SUser{}).Debug().Where("email =?", email)
	db.First(&userInfo)
	userId = userInfo.Id
	return
}

func (ps *Service) GetUserRegisterPermission(ctx context.Context, email string) (bool, string) {
	var user *model.SUser
	db := model.DB(ctx).Model(&model.SUser{}).Debug().Where("email = ?", email)
	db.First(&user)
	if user.Code == "admin" {
		return true, user.Code
	}
	return false, ""
}

func (ps *Service) GetUpdateUserRegisterPermission(ctx context.Context, email string) (bool, string) {
	var user *model.SUser
	db := model.DB(ctx).Model(&model.SUser{}).Debug().Where("email = ?", email)
	db.First(&user)
	if user.Code == "admin" || user.Code == "super_admin" {
		return true, user.Code
	}
	return false, ""
}

func (ps *Service) GetUserToolPermission(ctx context.Context, email string) ([]string, []string, string) {
	var user *model.SUser
	model.DB(ctx).Model(&model.SUser{}).Debug().Where("email =?", email).First(&user)

	var UserToolName []*model.SUserToolName
	model.DB(ctx).Model(&model.SUserToolName{}).Debug().Where("code =?", user.Code).Find(&UserToolName)

	var ToolList []string
	var permissionList []string
	for _, v := range UserToolName {
		var ToolName *model.SToolName
		db := model.DB(ctx).Model(&model.SToolName{}).Debug().Where("id =?", v.ToolId)
		db.First(&ToolName)
		if ToolName.Id <= 9 {
			ToolList = append(ToolList, ToolName.ToolName)
		} else {
			permissionList = append(permissionList, ToolName.ToolName)
		}
	}

	return ToolList, permissionList, user.Code
}

func (ps *Service) GetUserList(ctx *gin.Context, current, size int, code string) ([]*common.UserLostData, int64, int, error) {
	var users []*common.UserLostData
	var total int64

	switch code {
	case "admin":
		// 计算总记录数
		db := model.DB(ctx).Model(&model.SUser{}).Where("code != ? and code !=?", "super_admin", "admin")
		if err := db.Count(&total).Error; err != nil {
			return nil, 0, 0, err
		}

		// 计算总页数
		totalPages := int((total + int64(size) - 1) / int64(size))

		// 执行分页查询
		offset := (current - 1) * size
		if err := db.Offset(offset).Limit(size).Find(&users).Error; err != nil {
			return nil, 0, 0, err
		}

		return users, total, totalPages, nil

	case "super_admin":
		// 计算总记录数
		db := model.DB(ctx).Model(&model.SUser{}).Where("code != ?", "super_admin")
		if err := db.Count(&total).Error; err != nil {
			return nil, 0, 0, err
		}

		// 计算总页数
		totalPages := int((total + int64(size) - 1) / int64(size))

		// 执行分页查询
		offset := (current - 1) * size
		if err := db.Offset(offset).Limit(size).Find(&users).Error; err != nil {
			return nil, 0, 0, err
		}

		return users, total, totalPages, nil
	}

	return nil, 0, 0, nil
}

func (ps *Service) ModifyPermission(ctx context.Context, name string, userId int, code, phone, organization, position string, chatLimit int) (int, error) {

	if code != "user" && code != "vip_user" && code != "admin" && code != "guest" {
		return 0, errors.New("权限格式错误,没有这样的权限")
	}

	db := model.DB(ctx).Model(&model.SUser{}).Debug()

	//判断权限是否为管理员或超级管理员
	var adminUser *model.SUser
	if db.Where("email = ?", name).First(&adminUser); adminUser.Code != "admin" && adminUser.Code != "super_admin" {
		return 0, errors.New("您没有修改用户权限的权利，请通知管理员")
	}

	if adminUser.Code == "admin" {
		if code != "user" && code != "vip_user" && code != "guest" {
			return 0, errors.New("您没有赋予此权限的权利")
		}
	}

	descriptionMap := map[string]string{
		"admin":    "管理员",
		"vip_user": "vip用户",
		"user":     "普通用户",
		"guest":    "游客",
	}
	description := descriptionMap[code]

	//修改用户权限
	updateData := map[string]interface{}{
		"code":         code,
		"description":  description,
		"updated_at":   time.Now(),
		"phone":        phone,
		"organization": organization,
		"position":     position,
	}

	// 如果是游客，允许修改对话限制
	if code == "guest" {
		updateData["chat_limit"] = chatLimit
	}

	result := db.Model(&model.SUser{}).Where("id = ?", userId).Updates(updateData)
	if result.Error != nil {
		return 0, result.Error
	}
	if result.RowsAffected == 0 {
		return 0, errors.New("用户信息修改失败，未变更")
	}

	return userId, nil
}

func (ps *Service) UnlockUser(ctx context.Context, operatorName string, targetUserId int) error {
	db := model.DB(ctx).Model(&model.SUser{}).Debug()

	// 1. 检查操作者权限
	var operator *model.SUser
	if err := db.Where("email = ?", operatorName).First(&operator).Error; err != nil {
		return errors.New("操作员不存在")
	}
	if operator.Code != "admin" && operator.Code != "super_admin" {
		return errors.New("无权执行此操作")
	}

	// 2. 解锁目标用户
	// 将 locked_until 设置为 NULL，login_failed_count 重置为 0
	result := db.Where("id = ?", targetUserId).Updates(map[string]interface{}{
		"locked_until":       nil,
		"login_failed_count": 0,
		"updated_at":         time.Now(),
	})

	if result.Error != nil {
		return errors.New("解锁失败: " + result.Error.Error())
	}
	if result.RowsAffected == 0 {
		return errors.New("用户不存在")
	}

	return nil
}
