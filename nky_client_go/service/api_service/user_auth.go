package api_service

import (
	"context"
	"log"
	"phytomni-server/common"
	"phytomni-server/model"
	"phytomni-server/utils"
	"phytomni-server/utils/errs"
	"time"

	"github.com/go-errors/errors"
	"github.com/spf13/viper"
)

func (ps *Service) RegisterAddUser(ctx context.Context, email string, password string, code string, id int, phone, organization, position string) (bool, error) {
	var userInfo model.SUser
	var description string
	userInfo.Email = email
	hashed, herr := utils.HashPassword(password)
	if herr != nil {
		return false, errors.New("管理员新增用户注册失败")
	}
	userInfo.Password = hashed
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

func (ps *Service) ModifyPassword(ctx context.Context, name, Password, newPassword string) (string, error) {
	// 先按邮箱取行(身份来自 JWT),再在 Go 内验旧密码 —— bcrypt 加盐非确定性,不能
	// 再用 SQL `WHERE password = ?` 等值匹配。原 SQL 写法隐式兜了"用户不存在",这里
	// 必须显式补 not-found 守卫(已删但 token 仍有效的用户须 fail-closed)。用值类型
	// 而非指针,避免 not-found 时对 nil 取 .Id。
	var userInfo model.SUser
	db := model.DB(ctx).Model(&model.SUser{}).Debug()
	if err := db.Where("email = ?", name).First(&userInfo).Error; err != nil || userInfo.Id == 0 {
		return "", errors.New("原密码输入错误,请重试")
	}

	ok, _, _ := utils.VerifyPassword(userInfo.Password, Password)
	if !ok {
		return "", errors.New("原密码输入错误,请重试")
	}

	newHash, herr := utils.HashPassword(newPassword)
	if herr != nil {
		return "", errors.New("密码修改失败")
	}

	if err := db.Where("id = ?", userInfo.Id).Updates(map[string]interface{}{
		"password":           newHash,
		"password_change_at": time.Now(),
	}).Error; err != nil {
		return "", errors.New("密码修改失败")
	}
	return name, nil
}

func (ps *Service) UpdateUserPassWord(ctx context.Context, password string, id int) bool {

	pwdHash, herr := utils.HashPassword(password)
	if herr != nil {
		log.Printf("更新用户密码失败(哈希出错): %v", herr)
		return false
	}
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

func (ps *Service) GetUserInfo(ctx context.Context, email string, password string) (userInfo common.UserResponse, count int64, apiErr common.Error) {
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
		apiErr = errs.NewLockedError("auth.account_locked")
		return
	}

	// 3. 验证密码（bcrypt 或遗留 MD5,按存储值形状判别）
	verified, needsUpgrade, _ := utils.VerifyPassword(user.Password, password)
	if !verified {
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
			apiErr = errs.NewLockedError("auth.account_locked_threshold")
		} else {
			apiErr = errs.NewError("auth.invalid_credentials")
		}
		return
	}

	// 4. 登录成功，重置失败次数和锁定时间，更新最后登录时间
	model.DB(ctx).Model(&model.SUser{}).Where("id = ?", user.Id).Updates(map[string]interface{}{
		"login_failed_count": 0,
		"locked_until":       nil,
		"last_login_at":      time.Now(),
	})

	// 登录成功后,若仍是遗留 MD5,用本次明文升级为 bcrypt。守卫 CAS（WHERE
	// password=原值）保证不覆盖并发改密;尽力而为：哈希/写入失败仅记日志,绝不
	// 影响登录,也不动 password_change_at（凭证本身没变）。
	if needsUpgrade {
		if newHash, herr := utils.HashPassword(password); herr == nil {
			res := model.DB(ctx).Model(&model.SUser{}).
				Where("id = ? AND password = ?", user.Id, user.Password).
				Update("password", newHash)
			if res.Error != nil {
				log.Printf("懒升级 bcrypt 失败(忽略,不影响登录) id=%d: %v", user.Id, res.Error)
			}
		} else {
			log.Printf("懒升级 bcrypt 跳过(哈希出错) id=%d: %v", user.Id, herr)
		}
	}

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

func (ps *Service) UserRegister(ctx context.Context, email, password string) error {
	mdPassword, herr := utils.HashPassword(password)
	if herr != nil {
		return errors.New("用户注册失败")
	}
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
