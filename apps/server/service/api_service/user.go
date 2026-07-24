package api_service

import (
	"context"
	stdErrors "errors"
	"fmt"
	"phytomni-server/common"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-errors/errors"
	"gorm.io/gorm"
)

var ErrAgentPermissionUserNotFound = stdErrors.New("agent permission user not found")

// AgentPermissionResolution separates the user's stored canonical grants from
// tools presently executable under independently configured product flags.
// PermissionKeys carries non-agent UI permissions for callers that need them.
type AgentPermissionResolution struct {
	Role           string
	GrantedTools   []string
	AllowedTools   []string
	PermissionKeys []string
}

// ResolveAgentPermissions provides the server-owned canonical permission view
// for an authenticated user. Agent identity comes from the canonical registry,
// never from historical numeric tool IDs.
func (ps *Service) ResolveAgentPermissions(ctx context.Context, email string) (AgentPermissionResolution, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	resolution := AgentPermissionResolution{
		GrantedTools:   []string{},
		AllowedTools:   []string{},
		PermissionKeys: []string{},
	}
	db := model.DB(ctx)
	var user model.User
	if err := db.Where("email = ?", strings.TrimSpace(email)).First(&user).Error; err != nil {
		if stdErrors.Is(err, gorm.ErrRecordNotFound) {
			return resolution, fmt.Errorf("%w: %s", ErrAgentPermissionUserNotFound, strings.TrimSpace(email))
		}
		return resolution, err
	}
	resolution.Role = user.Code

	canonical := make(map[string]struct{}, len(rxBot.CanonicalAgentDisplayOrder))
	for _, tool := range rxBot.CanonicalAgentDisplayOrder {
		canonical[tool] = struct{}{}
	}
	if user.Code == "admin" || user.Code == "super_admin" {
		for _, tool := range rxBot.CanonicalAgentDisplayOrder {
			resolution.GrantedTools = append(resolution.GrantedTools, tool)
			if isRemoteProductEnabled(tool) {
				resolution.AllowedTools = append(resolution.AllowedTools, tool)
			}
		}
		return resolution, nil
	}

	var toolNames []string
	if err := db.Table("user_tool_names").
		Select("tool_names.tool_name").
		Joins("JOIN tool_names ON tool_names.id = user_tool_names.tool_id").
		Where("user_tool_names.code = ?", user.Code).
		Pluck("tool_names.tool_name", &toolNames).Error; err != nil {
		return resolution, err
	}

	granted := make(map[string]struct{}, len(canonical))
	permissionKeys := make(map[string]struct{})
	for _, tool := range toolNames {
		if _, ok := canonical[tool]; ok {
			granted[tool] = struct{}{}
			continue
		}
		permissionKeys[tool] = struct{}{}
	}
	if _, ok := canonical[user.Code]; ok {
		granted[user.Code] = struct{}{}
	}

	for _, tool := range rxBot.CanonicalAgentDisplayOrder {
		if _, ok := granted[tool]; ok {
			resolution.GrantedTools = append(resolution.GrantedTools, tool)
			if isRemoteProductEnabled(tool) {
				resolution.AllowedTools = append(resolution.AllowedTools, tool)
			}
		}
	}
	for _, tool := range toolNames {
		if _, ok := permissionKeys[tool]; ok {
			resolution.PermissionKeys = append(resolution.PermissionKeys, tool)
			delete(permissionKeys, tool)
		}
	}

	return resolution, nil
}

func (ps *Service) GetUserProfile(ctx context.Context, email string) (*common.UserProfileResponse, error) {
	var user model.User
	if err := model.DB(ctx).Model(&model.User{}).Where("email = ?", email).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("auth.user_not_found")
		}
		return nil, err
	}

	var dialogueCount int64
	if err := model.DB(ctx).Model(&model.QuestionAgentLog{}).Where("user_name = ? AND f_id = ? AND delete_at IS NULL", email, 0).Count(&dialogueCount).Error; err != nil {
		return nil, err
	}

	return &common.UserProfileResponse{
		UserLostData: common.UserLostData{
			Id:           user.Id,
			Email:        user.Email,
			Code:         user.Code,
			Description:  user.Description,
			LockedUntil:  user.LockedUntil,
			LastLoginAt:  user.LastLoginAt,
			Phone:        user.Phone,
			Organization: user.Organization,
			Position:     user.Position,
			ChatLimit:    user.ChatLimit,
		},
		DialogueCount: dialogueCount,
	}, nil
}

func (ps *Service) CheckEmailExists(ctx context.Context, email string) bool {
	var count int64
	db := model.DB(ctx).Model(&model.User{}).Debug().Where("email = ?", email)
	db.Count(&count)
	return count > 0
}

func (ps *Service) GetUserIdByEmail(ctx context.Context, email string) (userId int64) {
	var userInfo model.User
	db := model.DB(ctx).Model(&model.User{}).Debug().Where("email =?", email)
	db.First(&userInfo)
	userId = userInfo.Id
	return
}

func (ps *Service) GetUserRegisterPermission(ctx context.Context, email string) (bool, string) {
	var user *model.User
	db := model.DB(ctx).Model(&model.User{}).Debug().Where("email = ?", email)
	db.First(&user)
	if user.Code == "admin" {
		return true, user.Code
	}
	return false, ""
}

func (ps *Service) GetUpdateUserRegisterPermission(ctx context.Context, email string) (bool, string) {
	var user *model.User
	db := model.DB(ctx).Model(&model.User{}).Debug().Where("email = ?", email)
	db.First(&user)
	if user.Code == "admin" || user.Code == "super_admin" {
		return true, user.Code
	}
	return false, ""
}

func (ps *Service) GetUserToolPermission(ctx context.Context, email string) ([]string, []string, string) {
	var user *model.User
	model.DB(ctx).Model(&model.User{}).Debug().Where("email =?", email).First(&user)

	var UserToolName []*model.UserToolName
	// Order by tool_id so tool_list / permission_list follow tool_names.id
	// (the canonical agent order), not the grant-row insertion order.
	model.DB(ctx).Model(&model.UserToolName{}).Debug().Where("code =?", user.Code).Order("tool_id").Find(&UserToolName)

	var ToolList []string
	var permissionList []string
	for _, v := range UserToolName {
		var ToolName *model.ToolName
		db := model.DB(ctx).Model(&model.ToolName{}).Debug().Where("id =?", v.ToolId)
		db.First(&ToolName)
		// ids 1-10 are the chat agents (see tool_names seed); 11+ are UI/menu
		// permission keys.
		if ToolName.Id <= 10 {
			ToolList = append(ToolList, ToolName.ToolName)
		} else {
			permissionList = append(permissionList, ToolName.ToolName)
		}
	}

	return ToolList, permissionList, user.Code
}

func (ps *Service) GetUserList(ctx *gin.Context, current, size int, code string) ([]*common.UserLostData, int64, int, error) {
	var users []*common.UserLostData
	var total int64

	switch code {
	case "admin":
		db := model.DB(ctx).Model(&model.User{}).Where("code != ? and code !=?", "super_admin", "admin")
		if err := db.Count(&total).Error; err != nil {
			return nil, 0, 0, err
		}
		totalPages := int((total + int64(size) - 1) / int64(size))
		offset := (current - 1) * size
		if err := db.Offset(offset).Limit(size).Find(&users).Error; err != nil {
			return nil, 0, 0, err
		}
		return users, total, totalPages, nil

	case "super_admin":
		db := model.DB(ctx).Model(&model.User{}).Where("code != ?", "super_admin")
		if err := db.Count(&total).Error; err != nil {
			return nil, 0, 0, err
		}
		totalPages := int((total + int64(size) - 1) / int64(size))
		offset := (current - 1) * size
		if err := db.Offset(offset).Limit(size).Find(&users).Error; err != nil {
			return nil, 0, 0, err
		}
		return users, total, totalPages, nil
	}

	return nil, 0, 0, nil
}

func (ps *Service) ModifyPermission(ctx context.Context, name string, userId int, code, phone, organization, position string, chatLimit int) (int, error) {

	if code != "user" && code != "vip_user" && code != "admin" && code != "guest" {
		return 0, errors.New("invalid permission format, no such permission")
	}

	db := model.DB(ctx).Model(&model.User{}).Debug()

	var adminUser *model.User
	if db.Where("email = ?", name).First(&adminUser); adminUser.Code != "admin" && adminUser.Code != "super_admin" {
		return 0, errors.New("you are not allowed to modify user permissions, please notify an administrator")
	}

	if adminUser.Code == "admin" {
		if code != "user" && code != "vip_user" && code != "guest" {
			return 0, errors.New("you are not allowed to grant this permission")
		}
	}

	descriptionMap := map[string]string{
		"admin":    "Administrator",
		"vip_user": "VIP User",
		"user":     "Regular User",
		"guest":    "Guest",
	}
	description := descriptionMap[code]

	updateData := map[string]interface{}{
		"code":         code,
		"description":  description,
		"updated_at":   time.Now(),
		"phone":        phone,
		"organization": organization,
		"position":     position,
	}

	if code == "guest" {
		updateData["chat_limit"] = chatLimit
	}

	result := db.Model(&model.User{}).Where("id = ?", userId).Updates(updateData)
	if result.Error != nil {
		return 0, result.Error
	}
	if result.RowsAffected == 0 {
		return 0, errors.New("failed to update user info, no change")
	}

	return userId, nil
}

func (ps *Service) UnlockUser(ctx context.Context, operatorName string, targetUserId int) error {
	db := model.DB(ctx).Model(&model.User{}).Debug()

	var operator *model.User
	if err := db.Where("email = ?", operatorName).First(&operator).Error; err != nil {
		return errors.New("operator not found")
	}
	if operator.Code != "admin" && operator.Code != "super_admin" {
		return errors.New("not authorized to perform this operation")
	}

	result := db.Where("id = ?", targetUserId).Updates(map[string]interface{}{
		"locked_until":       nil,
		"login_failed_count": 0,
		"updated_at":         time.Now(),
	})

	if result.Error != nil {
		return errors.New("unlock failed: " + result.Error.Error())
	}
	if result.RowsAffected == 0 {
		return errors.New("user not found")
	}

	return nil
}
