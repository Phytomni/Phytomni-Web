package api_service

import (
	"context"
	"errors"
	"strings"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"

	"github.com/spf13/viper"
)

// ErrChatQuotaExhausted indicates insufficient/inactive account quota (handler maps to 403).
var ErrChatQuotaExhausted = errors.New("account has no chat quota; contact an administrator")

// ErrRemoteProductDisabled means the requested remote product is deliberately
// dark in Web configuration. It is mapped to a safe 503 by the HTTP layer and
// must be returned before any request is sent to Bot.
var ErrRemoteProductDisabled = errors.New("remote product is disabled")

// ErrRemoteProductForbidden means the authenticated account does not hold the
// product's Web-side tool permission. It is deliberately distinct from the
// dark flag so the HTTP layer can use a safe 404 for unauthorized routes.
var ErrRemoteProductForbidden = errors.New("remote product permission denied")

// Backward-compatible names for callers that describe the same closed gate in
// terms of authorization or capability. Keep one sentinel so errors.Is works
// consistently across handlers and tests.
var (
	ErrRemoteProductUnauthorized = ErrRemoteProductForbidden
	ErrRemoteProductUnavailable  = ErrRemoteProductDisabled
)

type remoteProductRequirement struct {
	tool    string
	enabled func(*rxBot.Config) bool
}

var remoteProductRequirements = map[string]remoteProductRequirement{
	"InSilicoResearchAgent": {
		tool:    "InSilicoResearchAgent",
		enabled: func(cfg *rxBot.Config) bool { return cfg != nil && cfg.ResearchEnabled },
	},
	"research": {
		tool:    "InSilicoResearchAgent",
		enabled: func(cfg *rxBot.Config) bool { return cfg != nil && cfg.ResearchEnabled },
	},
	"DigitalDesignAgent": {
		tool:    "DigitalDesignAgent",
		enabled: func(cfg *rxBot.Config) bool { return cfg != nil && cfg.DesignEnabled },
	},
	"design": {
		tool:    "DigitalDesignAgent",
		enabled: func(cfg *rxBot.Config) bool { return cfg != nil && cfg.DesignEnabled },
	},
	"GeneNetworkAgent": {
		tool:    "GeneNetworkAgent",
		enabled: func(cfg *rxBot.Config) bool { return cfg != nil && cfg.NetworkEnabled },
	},
	"network": {
		tool:    "GeneNetworkAgent",
		enabled: func(cfg *rxBot.Config) bool { return cfg != nil && cfg.NetworkEnabled },
	},
}

func isRemoteProductTool(tool string) bool {
	_, ok := remoteProductRequirements[strings.TrimSpace(tool)]
	return ok
}

// IsRemoteProductTool reports whether a canonical or Bot-slug tool belongs to
// one of the separately gated remote products. It lets the HTTP handler apply
// the same pre-dispatch boundary after parsing multipart fields.
func IsRemoteProductTool(tool string) bool {
	return isRemoteProductTool(tool)
}

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

// CheckRemoteProductAllowed is the server-side authorization boundary for
// remote Research, Design, and Network runs. A product must be explicitly
// enabled in BotConfig and the authenticated user's role must grant the
// canonical tool in user_tool_names/tool_names. Missing users or permission
// tables fail closed: a capability must never be inferred from browser input.
// This check is intentionally independent of the quota gate above so turning
// quota enforcement off cannot activate a remote product.
func (ps *Service) CheckRemoteProductAllowed(ctx context.Context, email, tool string) error {
	requirement, ok := remoteProductRequirements[strings.TrimSpace(tool)]
	if !ok {
		return ErrRemoteProductForbidden
	}
	if !requirement.enabled(rxBot.BotConfig) {
		return ErrRemoteProductDisabled
	}
	if ctx == nil {
		ctx = context.Background()
	}

	db := model.DB(ctx)
	var user model.User
	if err := db.Model(&model.User{}).Where("email = ?", strings.TrimSpace(email)).First(&user).Error; err != nil {
		return ErrRemoteProductForbidden
	}

	// Administrators retain their existing server-side ability to operate all
	// products once the explicit product flag is enabled. Regular accounts must
	// carry a canonical tool grant; role names from the browser are ignored.
	if user.Code == "admin" || user.Code == "super_admin" || user.Code == requirement.tool {
		return nil
	}

	var grants int64
	if err := db.Model(&model.UserToolName{}).
		Joins("JOIN tool_names ON tool_names.id = user_tool_names.tool_id").
		Where("user_tool_names.code = ? AND tool_names.tool_name = ?", user.Code, requirement.tool).
		Count(&grants).Error; err != nil {
		return ErrRemoteProductForbidden
	}
	if grants == 0 {
		return ErrRemoteProductForbidden
	}
	return nil
}
