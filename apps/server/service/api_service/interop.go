package api_service

import (
	"context"
	"errors"
	"sort"
	"strings"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

var (
	// ErrInteropDisabled is returned before authorization or any Bot request
	// while the Web-owned interop dark-launch switch is off.
	ErrInteropDisabled = errors.New("interop capability discovery is disabled")
	// ErrInteropForbidden is deliberately indistinguishable for unknown users
	// and missing grants so the endpoint does not become a user/role oracle.
	ErrInteropForbidden = errors.New("interop capability discovery is not permitted")
	// ErrInteropUnavailable is the only service error for Bot transport,
	// registry, or decode failures; upstream details stay out of HTTP responses.
	ErrInteropUnavailable = errors.New("interop capability discovery unavailable")
)

// InteropTarget is the allowlisted Web DTO. It is target-level metadata only:
// endpoint, command, credential, schema, peer payload, and exception fields
// are not represented in this type and therefore cannot reach the browser.
type InteropTarget struct {
	TargetID string `json:"target_id"`
	Kind     string `json:"kind"`
	Status   string `json:"status,omitempty"`
	Code     string `json:"code,omitempty"`
}

// InteropCapabilities is the stable response shape consumed by the future
// Web interop surfaces. A target that returned at least one safe capability is
// represented as available; a target-level discovery failure is represented
// with a bounded status/code pair. Successful targets are never discarded
// because a different target failed.
type InteropCapabilities struct {
	Targets []InteropTarget `json:"targets"`
}

// interopAgentCapabilityTools are the server-side grants that establish the
// existing "agents" capability. The synthetic "agents" permission is
// accepted for deployments that model capabilities as menu permissions; the
// canonical agent grants cover the current tool-permission schema.
var interopAgentCapabilityTools = []string{
	"agents",
	"ChatAgent",
	"KnowledgeAgent",
	"DataAgent",
	"ReviewAgent",
	"BriefGeneAgent",
	"AnalystAgent",
	"DeepGenomeAgent",
	"InSilicoResearchAgent",
	"DigitalDesignAgent",
	"GeneNetworkAgent",
}

// CheckInteropAllowed enforces the interop capability boundary from the
// authenticated Web identity. Browser-supplied roles or target ids are never
// consulted. Administrators retain access; regular users need an existing
// server-side agent/tool grant.
func (ps *Service) CheckInteropAllowed(ctx context.Context, email string) error {
	if ctx == nil {
		ctx = context.Background()
	}
	email = strings.TrimSpace(email)
	if email == "" {
		return ErrInteropForbidden
	}

	db := model.DB(ctx)
	var user model.User
	if err := db.Model(&model.User{}).Where("email = ?", email).First(&user).Error; err != nil {
		return ErrInteropForbidden
	}
	if user.Code == "admin" || user.Code == "super_admin" {
		return nil
	}

	var grants int64
	if err := db.Model(&model.UserToolName{}).
		Joins("JOIN tool_names ON tool_names.id = user_tool_names.tool_id").
		Where("user_tool_names.code = ?", user.Code).
		Where("tool_names.tool_name IN ?", interopAgentCapabilityTools).
		Count(&grants).Error; err != nil {
		return ErrInteropForbidden
	}
	if grants == 0 {
		return ErrInteropForbidden
	}
	return nil
}

// InteropCapabilities returns a sanitized, target-level snapshot from Bot.
// The feature gate and authorization checks precede client construction and
// the Bot call, preserving a zero-call boundary for dormant or unauthorized
// requests.
func (ps *Service) InteropCapabilities(ctx context.Context, email string) (InteropCapabilities, error) {
	if rxBot.BotConfig == nil || !rxBot.BotConfig.InteropEnabled {
		return InteropCapabilities{Targets: []InteropTarget{}}, ErrInteropDisabled
	}
	if err := ps.CheckInteropAllowed(ctx, email); err != nil {
		return InteropCapabilities{Targets: []InteropTarget{}}, err
	}
	if ctx == nil {
		ctx = context.Background()
	}
	response, err := rxBot.NewClient().GetInteropCapabilities(ctx)
	if err != nil {
		return InteropCapabilities{Targets: []InteropTarget{}}, ErrInteropUnavailable
	}
	return sanitizeInteropCapabilities(response), nil
}

func sanitizeInteropCapabilities(response *rxBot.InteropCapabilitiesResponse) InteropCapabilities {
	byTarget := make(map[string]InteropTarget)
	if response == nil {
		return InteropCapabilities{Targets: []InteropTarget{}}
	}
	for _, item := range response.Data {
		key := item.TargetID + "\x00" + item.Kind
		byTarget[key] = InteropTarget{
			TargetID: item.TargetID,
			Kind:     item.Kind,
			Status:   "available",
		}
	}
	for _, item := range response.Errors {
		key := item.TargetID + "\x00" + item.Kind
		if current, ok := byTarget[key]; ok && current.Status == "available" {
			continue
		}
		code := ""
		if item.Code == "discovery_failed" {
			code = item.Code
		}
		byTarget[key] = InteropTarget{
			TargetID: item.TargetID,
			Kind:     item.Kind,
			Status:   "failed",
			Code:     code,
		}
	}

	result := make([]InteropTarget, 0, len(byTarget))
	for _, target := range byTarget {
		result = append(result, target)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].TargetID != result[j].TargetID {
			return result[i].TargetID < result[j].TargetID
		}
		return result[i].Kind < result[j].Kind
	})
	return InteropCapabilities{Targets: result}
}
