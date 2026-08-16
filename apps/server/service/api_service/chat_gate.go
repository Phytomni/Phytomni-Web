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

var ErrInvalidChatRouting = errors.New("invalid chat routing")

var ErrAgentToolForbidden = errors.New("agent tool forbidden")

var ErrNoExecutableAgentTools = errors.New("no executable agent tools")

var ErrAgentToolsUnavailable = errors.New(
	"granted agent tools are unavailable",
)

var ErrExpertRouteContract = errors.New("expert route contract failed")

// ChatRoutingDecision is the normalized Chat routing contract. Task 13 owns
// server-derived allowed-tools wiring; this decision only captures the exact
// client-supplied mode and optional canonical forced tool.
type ChatRoutingDecision struct {
	Mode       string
	ForcedTool string
}

// ValidateChatRouting enforces the Chat mode/tool contract without inspecting
// configuration or permissions. Non-empty inputs are intentionally not
// normalized: whitespace and joined values are invalid client routing.
func ValidateChatRouting(mode string, tool string) (ChatRoutingDecision, error) {
	if mode == "" {
		mode = "instant"
	}
	switch mode {
	case "instant":
		if tool != "" {
			return ChatRoutingDecision{}, ErrInvalidChatRouting
		}
		return ChatRoutingDecision{Mode: mode}, nil
	case "expert":
		if tool == "" {
			return ChatRoutingDecision{Mode: mode}, nil
		}
		if _, ok := rxBot.SlugFor(tool); !ok {
			return ChatRoutingDecision{}, ErrInvalidChatRouting
		}
		return ChatRoutingDecision{Mode: mode, ForcedTool: tool}, nil
	default:
		return ChatRoutingDecision{}, ErrInvalidChatRouting
	}
}

// ErrRemoteProductDisabled means the requested remote product is deliberately
// dark in Web configuration. It is mapped to a safe 503 by the HTTP layer and
// must be returned before any request is sent to Bot.
var ErrRemoteProductDisabled = errors.New("remote product is disabled")

// ErrRemoteProductForbidden means the authenticated account does not hold the
// product's Web-side tool permission. It is deliberately distinct from the
// dark flag so the HTTP layer can use a safe 404 for unauthorized routes.
var ErrRemoteProductForbidden = errors.New("remote product permission denied")

// ErrResearchInputIncompatible means Bot did not advertise the exact bounded
// Research input contract required for server-side admission.
var ErrResearchInputIncompatible = errors.New("research input contract is incompatible")

// Backward-compatible names for callers that describe the same closed gate in
// terms of authorization or capability. Keep one sentinel so errors.Is works
// consistently across handlers and tests.
var (
	ErrRemoteProductUnauthorized = ErrRemoteProductForbidden
	ErrRemoteProductUnavailable  = ErrRemoteProductDisabled
)

type remoteProductRequirement struct {
	tool                    string
	enabled                 func(*rxBot.Config) bool
	filterGenericPermission bool
}

type remoteProductAdmissionContextKey struct{}

type remoteProductAdmission struct {
	email         string
	tool          string
	researchInput rxBot.ResearchInputContract
}

var remoteProductRequirements = map[string]remoteProductRequirement{
	"AnalystAgent": {
		tool:                    "AnalystAgent",
		enabled:                 func(*rxBot.Config) bool { return true },
		filterGenericPermission: true,
	},
	"analyst": {
		tool:                    "AnalystAgent",
		enabled:                 func(*rxBot.Config) bool { return true },
		filterGenericPermission: true,
	},
	"InSilicoResearchAgent": {
		tool:                    "InSilicoResearchAgent",
		enabled:                 func(*rxBot.Config) bool { return true },
		filterGenericPermission: true,
	},
	"research": {
		tool:                    "InSilicoResearchAgent",
		enabled:                 func(*rxBot.Config) bool { return true },
		filterGenericPermission: true,
	},
	"DigitalDesignAgent": {
		tool:                    "DigitalDesignAgent",
		enabled:                 func(*rxBot.Config) bool { return true },
		filterGenericPermission: true,
	},
	"design": {
		tool:                    "DigitalDesignAgent",
		enabled:                 func(*rxBot.Config) bool { return true },
		filterGenericPermission: true,
	},
	"GeneNetworkAgent": {
		tool:                    "GeneNetworkAgent",
		enabled:                 func(*rxBot.Config) bool { return true },
		filterGenericPermission: true,
	},
	"network": {
		tool:                    "GeneNetworkAgent",
		enabled:                 func(*rxBot.Config) bool { return true },
		filterGenericPermission: true,
	},
}

func isRemoteProductTool(tool string) bool {
	_, ok := remoteProductRequirements[strings.TrimSpace(tool)]
	return ok
}

func isResearchProductTool(tool string) bool {
	requirement, ok := remoteProductRequirements[strings.TrimSpace(tool)]
	return ok && requirement.tool == "InSilicoResearchAgent"
}

// IsResearchAgentProductTool reports whether a route-owned identifier maps to
// the canonical Research product.
func IsResearchAgentProductTool(tool string) bool {
	return isResearchProductTool(tool)
}

func isRemoteProductEnabled(tool string) bool {
	requirement, ok := remoteProductRequirements[tool]
	return !ok || !requirement.filterGenericPermission || requirement.enabled(rxBot.BotConfig)
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

// checkRemoteProductAccess enforces only the local feature and owner permission
// boundary. Research's live Bot contract is deliberately resolved later, after
// an accepted owner-scoped retry has had a chance to reuse its durable row.
func (ps *Service) checkRemoteProductAccess(ctx context.Context, email, tool string) (remoteProductAdmission, error) {
	requirement, ok := remoteProductRequirements[strings.TrimSpace(tool)]
	if !ok {
		return remoteProductAdmission{}, ErrRemoteProductForbidden
	}
	if !requirement.enabled(rxBot.BotConfig) {
		return remoteProductAdmission{}, ErrRemoteProductDisabled
	}
	resolution, err := ps.ResolveAgentPermissions(ctx, email)
	if err != nil {
		return remoteProductAdmission{}, ErrRemoteProductForbidden
	}
	if !containsAgentTool(resolution.GrantedTools, requirement.tool) {
		return remoteProductAdmission{}, ErrRemoteProductForbidden
	}
	if !containsAgentTool(resolution.AllowedTools, requirement.tool) {
		return remoteProductAdmission{}, ErrRemoteProductDisabled
	}
	return remoteProductAdmission{email: email, tool: requirement.tool}, nil
}

func (ps *Service) completeRemoteProductAdmission(
	ctx context.Context,
	admission remoteProductAdmission,
) (remoteProductAdmission, error) {
	if admission.tool == "InSilicoResearchAgent" &&
		(admission.researchInput.MaxUserQueryChars < 1 ||
			admission.researchInput.MaxAttachments < 1) {
		contract, err := ps.validatedResearchInputContract(ctx, nil)
		if err != nil {
			return remoteProductAdmission{}, ErrResearchInputIncompatible
		}
		admission.researchInput = contract
	}
	return admission, nil
}

// checkRemoteProductAllowed enforces the complete server-owned product gate
// for callers that need a live capability decision immediately.
func (ps *Service) checkRemoteProductAllowed(ctx context.Context, email, tool string) (remoteProductAdmission, error) {
	admission, err := ps.checkRemoteProductAccess(ctx, email, tool)
	if err != nil {
		return remoteProductAdmission{}, err
	}
	return ps.completeRemoteProductAdmission(ctx, admission)
}

// CheckRemoteProductAllowed is the server-side authorization boundary for
// remote Research, Design, Network, and Analyst runs. Those products are
// locally always enabled. Research still requires the Bot research-input
// contract. Every product still requires the authenticated user's role
// grant in user_tool_names/tool_names. Missing users or permission tables
// fail closed: a capability must never be inferred from browser input.
// This check is intentionally independent of the quota gate above so turning
// quota enforcement off cannot activate a remote product.
func (ps *Service) CheckRemoteProductAllowed(ctx context.Context, email, tool string) error {
	_, err := ps.checkRemoteProductAllowed(ctx, email, tool)
	return err
}

// AdmitRemoteProduct performs the local server-owned feature and permission
// gate before the handler parses a body. Query completes Research's live Bot
// contract only for a new key; an accepted retry therefore cannot be revoked by
// later catalog drift. The private context key cannot be supplied by a browser.
func (ps *Service) AdmitRemoteProduct(ctx context.Context, email, tool string) (context.Context, error) {
	admission, err := ps.checkRemoteProductAccess(ctx, email, tool)
	if err != nil {
		return ctx, err
	}
	return context.WithValue(ctx, remoteProductAdmissionContextKey{}, admission), nil
}

// RemoteProductInputLimits is the live product contract a handler may enforce
// before parsing its bounded request body. Products without a negotiated input
// contract leave both fields zero.
type RemoteProductInputLimits struct {
	MaxQueryChars  int
	MaxAttachments int
}

// CompleteRemoteProductAdmission resolves the live product contract after the
// local feature and owner permission gate. The completed admission is retained
// in the returned context so Query does not repeat the catalog request.
func (ps *Service) CompleteRemoteProductAdmission(
	ctx context.Context,
	email string,
	tool string,
) (context.Context, RemoteProductInputLimits, error) {
	admission, ok := remoteProductAdmissionFromContext(ctx, email, tool)
	if !ok {
		var err error
		admission, err = ps.checkRemoteProductAccess(ctx, email, tool)
		if err != nil {
			return ctx, RemoteProductInputLimits{}, err
		}
	}
	completed, err := ps.completeRemoteProductAdmission(ctx, admission)
	if err != nil {
		return ctx, RemoteProductInputLimits{}, err
	}
	limits := RemoteProductInputLimits{}
	if completed.tool == "InSilicoResearchAgent" {
		maxQueryChars, maxAttachments, ok := researchInputLimits(completed)
		if !ok {
			return ctx, RemoteProductInputLimits{}, ErrResearchInputIncompatible
		}
		limits.MaxQueryChars = maxQueryChars
		limits.MaxAttachments = maxAttachments
	}
	return context.WithValue(ctx, remoteProductAdmissionContextKey{}, completed), limits, nil
}

func remoteProductAdmissionFromContext(ctx context.Context, email, tool string) (remoteProductAdmission, bool) {
	requirement, ok := remoteProductRequirements[strings.TrimSpace(tool)]
	if !ok {
		return remoteProductAdmission{}, false
	}
	admission, ok := ctx.Value(remoteProductAdmissionContextKey{}).(remoteProductAdmission)
	if !ok || admission.email != email || admission.tool != requirement.tool {
		return remoteProductAdmission{}, false
	}
	return admission, true
}

func researchInputLimits(admission remoteProductAdmission) (maxQueryChars, maxAttachments int, ok bool) {
	if admission.tool != "InSilicoResearchAgent" ||
		admission.researchInput.MaxUserQueryChars < 1 ||
		admission.researchInput.MaxAttachments < 1 {
		return 0, 0, false
	}
	maxQueryChars = effectiveResearchQueryLimit(admission.researchInput.MaxUserQueryChars)
	return maxQueryChars, admission.researchInput.MaxAttachments, true
}

func (ps *Service) ensureRemoteProductAccess(ctx context.Context, email, tool string) (remoteProductAdmission, error) {
	if admission, ok := remoteProductAdmissionFromContext(ctx, email, tool); ok {
		return admission, nil
	}
	return ps.checkRemoteProductAccess(ctx, email, tool)
}

func containsAgentTool(tools []string, target string) bool {
	for _, tool := range tools {
		if tool == target {
			return true
		}
	}
	return false
}

func permissionFailure(permissions AgentPermissionResolution, requested string) error {
	if requested != "" && !containsAgentTool(permissions.GrantedTools, requested) {
		return ErrAgentToolForbidden
	}
	if len(permissions.GrantedTools) == 0 {
		return ErrNoExecutableAgentTools
	}
	return ErrAgentToolsUnavailable
}
