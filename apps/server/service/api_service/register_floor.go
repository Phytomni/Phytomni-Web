package api_service

import (
	"context"
	"errors"
	"time"

	"phytomni-server/model"

	"github.com/spf13/viper"
)

// ErrRegisterRateLimited is returned when the per-IP durable registration floor
// is exceeded (handler maps this to 429).
var ErrRegisterRateLimited = errors.New("too many registrations, please try again later")

const registerFloorPath = "/api/v1/auth/registrations"

// registerFloorConfig reads the registration floor threshold and window. The
// floor is intentionally wider than the Redis rate-limit layer (10/h) — it
// only catches sustained abuse / Redis-down scenarios, not normal traffic.
// Viper fallback applies; changes require a restart.
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

// CheckRegisterFloor enforces a durable per-IP registration floor: if the number
// of op-log rows for the registration path from the same IP within the window is
// >= threshold, it returns ErrRegisterRateLimited. Empty IP passes through
// (unidentifiable caller).
//
// fail-closed: a COUNT error is returned as-is (handler rejects registration;
// a DB error during flooding is exactly when rejection is appropriate, and MySQL
// degradation would cause the subsequent Create to fail anyway).
//
// IP matching is exact equality against the raw c.ClientIP() value written by
// the OperationLog middleware (IPv4 is the common case). IPv6 /48 aggregation
// is a future enhancement (would require the middleware to also store the masked
// value, or a SQL range query); for now, full-address equality keeps read and
// write sides consistent and index-friendly. Reads the existing
// user_operation_logs table (path and created_at are already indexed); no new
// tables, columns, or indexes required.
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
