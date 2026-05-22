package api_service

import (
	"context"
	"log"
	"nky_client_go/common"
	"nky_client_go/model"
	"nky_client_go/server/api"
	"nky_client_go/utils"
	"nky_client_go/utils/errs"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-errors/errors"
	"github.com/spf13/viper"
	"gorm.io/gorm"
)

func (ps *ApiService) ApiGetUserProfile(ctx context.Context, email string) (*common.UserProfileResponse, error) {
	var user model.SUser
	// 1. 查询用户基本信息
	if err := model.DB(ctx).Model(&model.SUser{}).Where("email = ?", email).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("用户不存在")
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

func (ps *ApiService) CheckEmailExists(ctx context.Context, email string) bool {
	var count int64
	db := model.DB(ctx).Model(&model.SUser{}).Debug().Where("email = ?", email)
	db.Count(&count)
	if count > 0 {
		return true
	}
	return false
}

func (ps *ApiService) RegisterAddUser(ctx context.Context, email string, password string, code string, id int, phone, organization, position string) (bool, error) {
	var userInfo model.SUser
	var description string
	userInfo.Email = email
	userInfo.Password = utils.MD5String(password)
	userInfo.Code = code
	userInfo.FirstLoginStatus = "0"
	userInfo.CreatedAt = time.Time{}
	userInfo.UpdatedAt = time.Time{}
	userInfo.Phone = phone
	userInfo.Organization = organization
	userInfo.Position = position
	now := time.Now()
	userInfo.PasswordChangeAt = &now
	switch userInfo.Code {
	case "admin":
		description = "管理员"
	case "vip_user":
		description = "vip用户"
	case "user":
		description = "普通用户"
	case "guest":
		description = "游客"
		// 游客默认限制
		userInfo.ChatLimit = viper.GetInt("guest_default_chat_limit")
	}
	userInfo.Description = description

	// 判断赋值权限
	if code != "user" && code != "vip_user" && code != "guest" {
		return false, errors.New("错误的权限赋值，您没有这样的权限")
	}

	affected := model.DB(ctx).Model(&model.SUser{}).Debug().Create(&userInfo).RowsAffected
	if affected > 0 {
		return true, nil
	}
	return false, errors.New("管理员新增用户注册失败")
}

func (ps *ApiService) ApiModifyPassword(ctx context.Context, name, Password, newPassword string) (string, error) {
	oldHash := utils.MD5String(Password)
	newHash := utils.MD5String(newPassword)

	var userInfo *model.SUser
	db := model.DB(ctx).Model(&model.SUser{}).Debug()
	err := db.Where("email = ? and password = ?", name, oldHash).First(&userInfo).Error
	if userInfo.Id == 0 || err != nil {
		return "", errors.New("原密码输入错误,请重试")
	}

	err = db.Where("id = ? and password = ?", userInfo.Id, oldHash).Updates(map[string]interface{}{
		"password":           newHash,
		"password_change_at": time.Now(),
	}).Error
	if err != nil {
		return "", errors.New("密码修改失败")
	}
	return name, err

}

func (ps *ApiService) UpdateUserPassWord(ctx context.Context, password string, id int) bool {

	pwdHash := utils.MD5String(password)
	result := model.DB(ctx).Model(&model.SUser{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"password":           pwdHash,
			"password_change_at": time.Now(),
		})
	if result.Error != nil {
		// 处理错误
		log.Printf("更新用户密码失败: %v", result.Error)
		return false
	}
	if result.RowsAffected == 0 {
		// 处理未找到用户的情况
		log.Printf("未找到ID为 %d 的用户", id)
		return false
	}
	return true

}

func (ps *ApiService) GetUserInfo(ctx context.Context, email string, password string) (userInfo common.UserResponse, count int64, apiErr api.Error) {
	var user model.SUser
	db := model.DB(ctx).Model(&model.SUser{}).Debug().Where("email =?", email)

	// 1. 检查用户是否存在
	if err := db.First(&user).Error; err != nil {
		count = 0
		return
	}

	// 2. 检查账号是否被锁定
	if user.LockedUntil != nil && user.LockedUntil.After(time.Now()) {
		// 账户已锁定
		count = 0
		apiErr = errs.NewError("账户已锁定，请稍后再试")
		return
	}

	// 3. 验证密码
	if user.Password != utils.MD5String(password) {
		// 密码错误，增加失败次数
		newFailedCount := user.LoginFailedCount + 1
		updates := map[string]interface{}{
			"login_failed_count": newFailedCount,
		}

		// 失败5次锁定15分钟
		if newFailedCount >= 5 {
			lockedUntil := time.Now().Add(15 * time.Minute)
			updates["locked_until"] = lockedUntil
		}

		model.DB(ctx).Model(&model.SUser{}).Where("id = ?", user.Id).Updates(updates)

		count = 0
		if newFailedCount >= 5 {
			apiErr = errs.NewError("登录失败次数过多，账户已锁定15分钟")
		} else {
			apiErr = errs.NewError("用户名或密码错误")
		}
		return
	}

	// 4. 登录成功，重置失败次数和锁定时间，更新最后登录时间
	model.DB(ctx).Model(&model.SUser{}).Where("id = ?", user.Id).Updates(map[string]interface{}{
		"login_failed_count": 0,
		"locked_until":       nil,
		"last_login_at":      time.Now(),
	})

	// 5. 检查密码是否过期 (90天)
	if user.PasswordChangeAt != nil {
		// 90天 = 24 * 90 小时
		if time.Since(*user.PasswordChangeAt) > 90*24*time.Hour {
			userInfo.PasswordWarning = "您的密码已使用超过90天，建议您尽快更换密码。"
		}
	} else {
		// 如果是新用户或者没有记录修改时间，可以考虑初始化为创建时间或当前时间
		// 这里假设如果没有 PasswordChangeAt，则不提示，或者可以视策略而定
		// 也可以提示 "建议您定期更换密码"
	}

	// 构造返回数据
	userInfo.Id = user.Id
	userInfo.Email = user.Email
	userInfo.Password = user.Password
	userInfo.FirstLoginStatus = user.FirstLoginStatus
	count = 1
	return
}

func (ps *ApiService) GetUserIdByEmail(ctx context.Context, email string) (userId int64) {
	var userInfo model.SUser
	db := model.DB(ctx).Model(&model.SUser{}).Debug().Where("email =?", email)
	db.First(&userInfo)
	userId = userInfo.Id
	return
}

func (ps *ApiService) GetUserRegisterPermission(ctx context.Context, email string) (bool, string) {
	var user *model.SUser
	db := model.DB(ctx).Model(&model.SUser{}).Debug().Where("email = ?", email)
	db.First(&user)
	if user.Code == "admin" {
		return true, user.Code
	}
	return false, ""
}

func (ps *ApiService) GetUpdateUserRegisterPermission(ctx context.Context, email string) (bool, string) {
	var user *model.SUser
	db := model.DB(ctx).Model(&model.SUser{}).Debug().Where("email = ?", email)
	db.First(&user)
	if user.Code == "admin" || user.Code == "super_admin" {
		return true, user.Code
	}
	return false, ""
}

func (ps *ApiService) GetUserToolPermission(ctx context.Context, email string) ([]string, []string, string) {
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

func (ps *ApiService) GetUserList(ctx *gin.Context, current, size int, code string) ([]*common.UserLostData, int64, int, error) {
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

func (ps *ApiService) ApiModifyPermission(ctx context.Context, name string, userId int, code, phone, organization, position string, chatLimit int) (int, error) {

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

func (ps *ApiService) ApiUserRegister(ctx context.Context, email, password string) error {
	mdPassword := utils.MD5String(password)
	now := time.Now()
	db := model.DB(ctx).Model(&model.SUser{}).Debug()
	err := db.Create(&model.SUser{
		Email:            email,
		Password:         mdPassword,
		Code:             "user",
		Description:      "普通用户",
		PasswordChangeAt: &now,
	}).Error
	if err != nil {
		return errors.New("用户注册失败")
	}
	return nil
}

func (ps *ApiService) ApiUnlockUser(ctx context.Context, operatorName string, targetUserId int) error {
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
