package api_service

import (
	"context"
	"errors"
	"time"

	"phytomni-server/model"

	"github.com/spf13/viper"
)

// ErrRegisterRateLimited 注册 per-IP 持久底线超阈(handler 映射为 429)。
var ErrRegisterRateLimited = errors.New("注册过于频繁，请稍后再试")

const registerFloorPath = "/api/v1/auth/registrations"

// registerFloorConfig 读注册底线阈值/窗口。比 Phase 2 Redis 层(10/h)更宽——只兜
// 断网/持续滥用,非正常态二道闸。viper 缺省回落(改动需重启)。
func registerFloorConfig() (int64, time.Duration) {
	limit := viper.GetInt64("register.durable_floor.limit")
	if limit <= 0 {
		limit = 30
	}
	window := viper.GetDuration("register.durable_floor.window")
	if window <= 0 {
		window = time.Hour
	}
	return limit, window
}

// CheckRegisterFloor 注册前的持久 per-IP 底线:窗口内同 IP 对注册 path 的 op-log 行数
// >= 阈值 → ErrRegisterRateLimited。空 IP → 放行(无法识别身份)。
// **fail-closed**:COUNT 出错返回该错误(handler 拒注册;洪泛时 DB 出错正是该拒之时,
// 且 MySQL 退化时后续 Create 本就失败)。
//
// IP 按**精确等值**匹配 OperationLog 中间件写入的原始 c.ClientIP() 值(走 client_ip
// 上的存值;IPv4 常态命中)。IPv6 /48 聚合是未来增强(需中间件侧也存掩码值或 SQL 范围
// 查,见 design §6-5 / Non-Goals),本期按全地址等值——故不做掩码,保持读写两侧一致 +
// 索引友好。读现有 user_operation_logs(path、created_at 已索引),无新表/列/索引。
func (ps *Service) CheckRegisterFloor(ctx context.Context, clientIP string) error {
	if clientIP == "" {
		return nil
	}
	limit, window := registerFloorConfig()
	since := time.Now().Add(-window)

	var count int64
	err := model.DB(ctx).Model(&model.UserOperationLog{}).
		Where("client_ip = ? AND path = ? AND created_at > ?", clientIP, registerFloorPath, since).
		Count(&count).Error
	if err != nil {
		return err // fail-closed
	}
	if count >= limit {
		return ErrRegisterRateLimited
	}
	return nil
}
