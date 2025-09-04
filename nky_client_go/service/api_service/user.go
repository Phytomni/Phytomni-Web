package api_service

import (
	"github.com/gin-gonic/gin"
	"github.com/go-errors/errors"
	"log"
	"nky_client_go/common"
	"nky_client_go/model"
	"nky_client_go/server/api"
	"nky_client_go/utils"
	"time"
)

func (ps *ApiService) CheckEmailExists(email string) bool {
	var count int64
	db := model.Default().Model(&model.SUser{}).Debug().Where("email = ?", email)
	db.Count(&count)
	if count > 0 {
		return true
	}
	return false
}

func (ps *ApiService) RegisterAddUser(email string, password string, code string, id int) (bool, error) {
	var userInfo model.SUser
	var description string
	userInfo.Email = email
	userInfo.Password = utils.MD5String(password)
	userInfo.Code = code
	userInfo.FirstLoginStatus = "0"
	userInfo.CreatedAt = time.Time{}
	userInfo.UpdatedAt = time.Time{}
	switch userInfo.Code {
	case "admin":
		description = "管理员"
	case "vip_user":
		description = "vip用户"
	case "user":
		description = "普通用户"
	}
	userInfo.Description = description

	// 判断赋值权限
	if code != "user" && code != "vip_user" {
		return false, errors.New("错误的权限赋值，您没有这样的权限")
	}

	affected := model.Default().Model(&model.SUser{}).Debug().Create(&userInfo).RowsAffected
	if affected > 0 {
		return true, nil
	}
	return false, errors.New("管理员新增用户注册失败")
}

func (ps *ApiService) ApiModifyPassword(name, Password, newPassword string) (string, error) {
	oldHash := utils.MD5String(Password)
	newHash := utils.MD5String(newPassword)

	var userInfo *model.SUser
	db := model.Default().Model(&model.SUser{}).Debug()
	err := db.Where("email = ? and password = ?", name, oldHash).First(&userInfo).Error
	if userInfo.Id == 0 || err != nil {
		return "", errors.New("原密码输入错误,请重试")
	}

	err = db.Where("id = ? and password = ?", userInfo.Id, oldHash).Update("password", newHash).Error
	if err != nil {
		return "", errors.New("密码修改失败")
	}
	return name, err

}

func (ps *ApiService) UpdateUserPassWord(password string, id int) bool {

	pwdHash := utils.MD5String(password)
	result := model.Default().Model(&model.SUser{}).
		Where("id = ?", id).
		Update("password", pwdHash)
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

func (ps *ApiService) GetUserInfo(email string, password string) (userInfo common.UserResponse, count int64, apiErr api.Error) {
	db := model.Default().Model(&model.SUser{}).Debug().Where("email =? AND password = ?", email, utils.MD5String(password))
	db.Count(&count)
	db.First(&userInfo)
	return
}

func (ps *ApiService) GetUserIdByEmail(email string) (userId int64) {
	var userInfo model.SUser
	db := model.Default().Model(&model.SUser{}).Debug().Where("email =?", email)
	db.First(&userInfo)
	userId = userInfo.Id
	return
}

func (ps *ApiService) GetUserRegisterPermission(email string) (bool, string) {
	var user *model.SUser
	db := model.Default().Model(&model.SUser{}).Debug().Where("email = ?", email)
	db.First(&user)
	if user.Code == "admin" {
		return true, user.Code
	}
	return false, ""
}

func (ps *ApiService) GetUpdateUserRegisterPermission(email string) (bool, string) {
	var user *model.SUser
	db := model.Default().Model(&model.SUser{}).Debug().Where("email = ?", email)
	db.First(&user)
	if user.Code == "admin" || user.Code == "super_admin" {
		return true, user.Code
	}
	return false, ""
}

func (ps *ApiService) GetUserToolPermission(email string) ([]string, []string, string) {
	var user *model.SUser
	model.Default().Model(&model.SUser{}).Debug().Where("email =?", email).First(&user)

	var UserToolName []*model.SUserToolName
	model.Default().Model(&model.SUserToolName{}).Debug().Where("code =?", user.Code).Find(&UserToolName)

	var ToolList []string
	var permissionList []string
	for _, v := range UserToolName {
		var ToolName *model.SToolName
		model.Default().Model(&model.SToolName{}).Debug().Where("id =?", v.ToolId).First(&ToolName)
		if ToolName.Id <= 7 {
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
		db := model.Default().Model(&model.SUser{}).Where("code != ? and code !=?", "super_admin", "admin")
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
		db := model.Default().Model(&model.SUser{}).Where("code != ?", "super_admin")
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

func (ps *ApiService) ApiModifyPermission(name string, userId int, code string) (int, error) {

	if code != "user" && code != "vip_user" && code != "admin" {
		return 0, errors.New("权限格式错误,没有这样的权限")
	}

	db := model.Default().Model(&model.SUser{}).Debug()

	//判断权限是否为管理员或超级管理员
	var adminUser *model.SUser
	if db.Where("email = ?", name).First(&adminUser); adminUser.Code != "admin" && adminUser.Code != "super_admin" {
		return 0, errors.New("您没有修改用户权限的权利，请通知管理员")
	}

	if adminUser.Code == "admin" {
		if code != "user" && code != "vip_user" {
			return 0, errors.New("您没有赋予此权限的权利")
		}
	}

	descriptionMap := map[string]string{
		"admin":    "管理员",
		"vip_user": "vip用户",
		"user":     "普通用户",
	}
	description := descriptionMap[code]

	//修改用户权限
	result := db.Model(&model.SUser{}).Where("id = ?", userId).Updates(map[string]interface{}{
		"code":        code,
		"description": description,
		"updated_at":  time.Now(),
		// 可以添加更多需要更新的字段
	})
	if result.Error != nil {
		return 0, result.Error
	}
	if result.RowsAffected == 0 {
		return 0, errors.New("权限修改失败，权限未变更")
	}

	return userId, nil
}

func (ps *ApiService) ApiUserRegister(email, password string) error {
	mdPassword := utils.MD5String(password)
	db := model.Default().Model(&model.SUser{}).Debug()
	err := db.Create(&model.SUser{
		Email:       email,
		Password:    mdPassword,
		Code:        "user",
		Description: "普通用户",
	}).Error
	if err != nil {
		return errors.New("用户注册失败")
	}
	return nil
}
