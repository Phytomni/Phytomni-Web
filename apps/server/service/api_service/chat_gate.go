package api_service

import (
	"context"
	"errors"

	"phytomni-server/model"

	"github.com/spf13/viper"
)

// ErrChatQuotaExhausted indicates insufficient/inactive account quota (handler maps to 403).
var ErrChatQuotaExhausted = errors.New("account has no chat quota; contact an administrator")

// chatGateBypassCodes are roles exempt from the ChatLimit gate. vip_user is not
// metered for now; to enforce a vip_user limit in the future, remove it from this
// set and add metering. A single set keeps it easy to adjust.
var chatGateBypassCodes = map[string]bool{"admin": true, "super_admin": true, "vip_user": true}

// CheckChatAllowed decides whether the user may issue a /query. The master switch
// chatlimit.enforce defaults to OFF (dark launch: OFF passes everything through,
// matching today's behavior with zero regression). When ON: bypass roles pass;
// otherwise chat_limit > 0 is required. fail-open: a user-load error passes
// through (do not falsely reject real users on DB flakiness; consistent with the
// rate-limit layer — authentication never degrades). Self-registered users have
// chat_limit=0 → inactive until an admin grants quota.
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
