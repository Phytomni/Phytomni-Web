package api_service

import (
	"context"
	"errors"
	"strings"

	"github.com/spf13/viper"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
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

// expertRemoteProductTools is the complete product capability set that must
// be accepted before Expert can dispatch to Bot's semantic router. Expert
// does not know which product the router will select until after that request,
// so the pre-dispatch policy deliberately requires every canonical remote
// product flag and grant up front.
var expertRemoteProductTools = [...]string{
	"InSilicoResearchAgent",
	"DigitalDesignAgent",
	"GeneNetworkAgent",
}

func isRemoteProductTool(tool string) bool {
	_, ok := remoteProductRequirements[strings.TrimSpace(tool)]
	return ok
}

func isRemoteProductEnabled(tool string) bool {
	requirement, ok := remoteProductRequirements[tool]
	return !ok || requirement.enabled(rxBot.BotConfig)
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
	resolution, err := ps.ResolveAgentPermissions(ctx, email)
	if err != nil {
		return ErrRemoteProductForbidden
	}
	if !containsAgentTool(resolution.GrantedTools, requirement.tool) {
		return ErrRemoteProductForbidden
	}
	if !containsAgentTool(resolution.AllowedTools, requirement.tool) {
		return ErrRemoteProductDisabled
	}
	return nil
}

func containsAgentTool(tools []string, target string) bool {
	for _, tool := range tools {
		if tool == target {
			return true
		}
	}
	return false
}

// CheckExpertRemoteProductsAllowed is the fail-closed Expert pre-dispatch
// policy. The router may select any canonical remote product, and its choice
// is not known until after RouteQueryWithMeta has already reached Bot. Require
// all three product flags and all three authenticated grants before that
// request; administrators satisfy each grant through the same server-side
// role check used by explicit product routes.
func (ps *Service) CheckExpertRemoteProductsAllowed(ctx context.Context, email string) error {
	var resolution AgentPermissionResolution
	resolved := false
	for _, tool := range expertRemoteProductTools {
		if !isRemoteProductEnabled(tool) {
			return ErrRemoteProductDisabled
		}
		if !resolved {
			var err error
			resolution, err = ps.ResolveAgentPermissions(ctx, email)
			if err != nil {
				return ErrRemoteProductForbidden
			}
			resolved = true
		}
		if !containsAgentTool(resolution.GrantedTools, tool) {
			return ErrRemoteProductForbidden
		}
		if !containsAgentTool(resolution.AllowedTools, tool) {
			return ErrRemoteProductDisabled
		}
	}
	return nil
}
