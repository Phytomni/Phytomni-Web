package api_service

import (
	"context"
	"errors"

	"phytomni-server/model"

	"github.com/spf13/viper"
)

// ErrChatQuotaExhausted 账户额度不足/待激活(handler 映射 403)。
var ErrChatQuotaExhausted = errors.New("账户额度不足，请联系管理员开通")

// chatGateBypassCodes 不受 ChatLimit 闸约束的角色。vip_user 暂不限额;
// 未来对 vip_user 限额时从此集合移除并纳入计量。单一集合便于调整。
var chatGateBypassCodes = map[string]bool{"admin": true, "super_admin": true, "vip_user": true}

// CheckChatAllowed 判定该用户能否发起 /query。总开关 chatlimit.enforce 默认 OFF
// (暗发布:OFF 时一律放行,与今日行为一致、零回归)。ON 时:旁路角色放行;否则
// 要求 chat_limit > 0。fail-open:载入 user 出错放行(不因 DB 抖动误拒真人;
// 与 Phase 2"认证永不降级"一致)。自助注册者 chat_limit=0 → 失活直到 admin 授额度。
func (ps *Service) CheckChatAllowed(ctx context.Context, email string) error {
	if !viper.GetBool("chatlimit.enforce") {
		return nil
	}
	var user model.User
	if err := model.DB(ctx).Model(&model.User{}).
		Where("email = ?", email).First(&user).Error; err != nil {
		return nil // fail-open
	}
	if chatGateBypassCodes[user.Code] {
		return nil
	}
	if user.ChatLimit > 0 {
		return nil
	}
	return ErrChatQuotaExhausted
}
