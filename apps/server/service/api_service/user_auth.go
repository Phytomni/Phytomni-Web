package api_service

import (
	"context"
	stdErrors "errors"
	"log"
	rxCache "phytomni-server/cache"
	"phytomni-server/common"
	"phytomni-server/middleware"
	"phytomni-server/model"
	"phytomni-server/utils"
	"phytomni-server/utils/errs"
	"time"

	"github.com/go-errors/errors"
	"github.com/spf13/viper"
	"gorm.io/gorm"
)

func (ps *Service) RegisterAddUser(ctx context.Context, email string, password string, code string, id int, phone, organization, position string) (bool, error) {
	var userInfo model.User
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

	if err := model.DB(ctx).Model(&model.User{}).Debug().Create(&userInfo).Error; err != nil {
		if stdErrors.Is(err, gorm.ErrDuplicatedKey) {
			return false, errors.New("该邮箱已被注册")
		}
		return false, errors.New("管理员新增用户注册失败")
	}
	return true, nil
}

func (ps *Service) ModifyPassword(ctx context.Context, name, Password, newPassword string) (string, error) {
	// 先按邮箱取行(身份来自 JWT),再在 Go 内验旧密码 —— bcrypt 加盐非确定性,不能
	// 再用 SQL `WHERE password = ?` 等值匹配。原 SQL 写法隐式兜了"用户不存在",这里
	// 必须显式补 not-found 守卫(已删但 token 仍有效的用户须 fail-closed)。用值类型
	// 而非指针,避免 not-found 时对 nil 取 .Id。
	var userInfo model.User
	db := model.DB(ctx).Model(&model.User{}).Debug()
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
	// 设 per-user epoch = now(真实事件时间)。AuthMiddleware 比较 iat < epoch-IatSkew,
	// GenerateToken 设 iat = now-IatSkew,skew 两边抵消,净效果="仅当 token 真正在此
	// 刻之前签发时才撤销"。切勿在此写 now+IatSkew,否则双重计算 skew 会使有效阈值变为
	// now+IatSkew,令改密后 60s 内的恢复 token 被误撤销(即 C1 锁出的 epoch 路径变体)。
	// fail-open:Redis 挂只记日志——持久 password_change_at floor 已是离线兜底。
	if err := rxCache.SetUserEpoch(ctx, name, time.Now(), middleware.TokenLifetime); err != nil {
		log.Printf("改密设撤销 epoch 失败(fail-open,不影响改密) email=%s: %v", name, err)
	}
	return name, nil
}

func (ps *Service) UpdateUserPassWord(ctx context.Context, password string, id int) bool {

	pwdHash, herr := utils.HashPassword(password)
	if herr != nil {
		log.Printf("更新用户密码失败(哈希出错): %v", herr)
		return false
	}
	result := model.DB(ctx).Model(&model.User{}).
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
	// 解析 id→email 设 per-user epoch = now(真实事件时间)。AuthMiddleware 的
	// iat < epoch-IatSkew 比较与 GenerateToken 的 iat=now-IatSkew 相减后净效果为
	// "仅撤销此刻之前签发的 token"。此处切勿加 IatSkew,否则会令改密后的恢复
	// token 被误撤销。fail-open:查不到 email 或 Redis 挂只记日志,改密本身已成功
	// (持久 floor 仍兜底)。
	var target model.User
	if err := model.DB(ctx).Select("email").Where("id = ?", id).First(&target).Error; err == nil && target.Email != "" {
		if err := rxCache.SetUserEpoch(ctx, target.Email, time.Now(), middleware.TokenLifetime); err != nil {
			log.Printf("管理员改密设撤销 epoch 失败(fail-open) id=%d: %v", id, err)
		}
	} else if err != nil {
		log.Printf("管理员改密解析目标 email 失败(fail-open) id=%d: %v", id, err)
	}
	return true

}

func (ps *Service) GetUserInfo(ctx context.Context, email string, password string) (userInfo common.UserResponse, count int64, apiErr common.Error) {
	var user model.User
	db := model.DB(ctx).Model(&model.User{}).Debug().Where("email =?", email)

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

		model.DB(ctx).Model(&model.User{}).Where("id = ?", user.Id).Updates(updates)

		count = 0
		if newFailedCount >= 5 {
			apiErr = errs.NewLockedError("auth.account_locked_threshold")
		} else {
			apiErr = errs.NewError("auth.invalid_credentials")
		}
		return
	}

	// 4. 登录成功，重置失败次数和锁定时间，更新最后登录时间
	model.DB(ctx).Model(&model.User{}).Where("id = ?", user.Id).Updates(map[string]interface{}{
		"login_failed_count": 0,
		"locked_until":       nil,
		"last_login_at":      time.Now(),
	})

	// 登录成功后,若仍是遗留 MD5,用本次明文升级为 bcrypt。守卫 CAS（WHERE
	// password=原值）保证不覆盖并发改密;尽力而为：哈希/写入失败仅记日志,绝不
	// 影响登录,也不动 password_change_at（凭证本身没变）。
	if needsUpgrade {
		if newHash, herr := utils.HashPassword(password); herr == nil {
			res := model.DB(ctx).Model(&model.User{}).
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
	db := model.DB(ctx).Model(&model.User{}).Debug()
	err := db.Create(&model.User{
		Email:            email,
		Password:         mdPassword,
		Code:             "user",
		Description:      "普通用户",
		PasswordChangeAt: &now,
	}).Error
	if err != nil {
		if stdErrors.Is(err, gorm.ErrDuplicatedKey) {
			return errors.New("该邮箱已被注册")
		}
		return errors.New("用户注册失败")
	}
	return nil
}
