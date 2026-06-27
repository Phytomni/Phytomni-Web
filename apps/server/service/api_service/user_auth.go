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

		userInfo.ChatLimit = viper.GetInt("guest_default_chat_limit")
	}
	userInfo.Description = description

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
	// Fetch the row by email (identity comes from JWT), then verify the old password in Go —
	// bcrypt is salted and non-deterministic, so SQL `WHERE password = ?` equality cannot match.
	// The old SQL form implicitly swallowed "user not found"; here we add an explicit not-found
	// guard (a deleted-but-token-still-valid user must fail-closed). Value type, not pointer,
	// avoids dereferencing .Id on a not-found zero row.
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
	// Set per-user epoch = now (the real event time). AuthMiddleware compares iat < epoch-IatSkew
	// and GenerateToken sets iat = now-IatSkew; the skew cancels on both sides, so the net effect
	// is "revoke only tokens genuinely issued before this moment". Do NOT write now+IatSkew here,
	// or the skew is double-counted and the effective threshold becomes now+IatSkew, wrongly
	// revoking recovery tokens issued within 60s after the password change (the C1 lockout
	// epoch-path variant). fail-open: a Redis outage only logs — the persistent
	// password_change_at floor is the offline backstop.
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

		log.Printf("更新用户密码失败: %v", result.Error)
		return false
	}
	if result.RowsAffected == 0 {

		log.Printf("未找到ID为 %d 的用户", id)
		return false
	}
	// Resolve id→email and set the per-user epoch = now (the real event time). AuthMiddleware's
	// iat < epoch-IatSkew comparison and GenerateToken's iat=now-IatSkew cancel so the net effect
	// is "revoke only tokens issued before this moment". Do NOT add IatSkew here, or recovery
	// tokens issued after the password change would be wrongly revoked. fail-open: a missing
	// email or a Redis outage only logs; the password change itself already succeeded
	// (the persistent floor still backstops).
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

	if err := db.First(&user).Error; err != nil {
		count = 0
		return
	}

	if user.LockedUntil != nil && user.LockedUntil.After(time.Now()) {

		count = 0
		apiErr = errs.NewLockedError("auth.account_locked")
		return
	}

	verified, needsUpgrade, _ := utils.VerifyPassword(user.Password, password)
	if !verified {

		newFailedCount := user.LoginFailedCount + 1
		updates := map[string]interface{}{
			"login_failed_count": newFailedCount,
		}

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

	model.DB(ctx).Model(&model.User{}).Where("id = ?", user.Id).Updates(map[string]interface{}{
		"login_failed_count": 0,
		"locked_until":       nil,
		"last_login_at":      time.Now(),
	})

	// On successful login, lazily upgrade a legacy MD5 hash to bcrypt using this plaintext.
	// Guard with CAS (WHERE password = old value) so a concurrent password change is not
	// overwritten; best-effort: hash/write failure only logs, never blocks login, and does
	// not touch password_change_at (the credential itself did not change).
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

	if user.PasswordChangeAt != nil {

		if time.Since(*user.PasswordChangeAt) > 90*24*time.Hour {
			userInfo.PasswordWarning = "您的密码已使用超过90天，建议您尽快更换密码。"
		}
	} else {
		// No PasswordChangeAt: treat as not-expired (no warning). A future policy could
		// initialize this to created-at or now.
	}

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
