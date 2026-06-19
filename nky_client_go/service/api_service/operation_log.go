package api_service

import (
	"context"
	"errors"
	"phytomni-server/model"
	"time"
)

// ErrOperationLogForbidden 表示调用者无权读取操作日志审计表。
// 该表含跨用户 PII(邮箱/IP/UA/请求元数据),只能由管理员查询。
// handler 将其映射为 403。
var ErrOperationLogForbidden = errors.New("无权访问操作日志")

func (ps *Service) GetOperationLogs(ctx context.Context, operatorName string, userIds []int64, startTime, endTime string) ([]model.UserOperationLog, error) {
	// 鉴权:审计日志只对管理员开放,普通登录用户不得枚举他人记录。
	var operator *model.User
	if err := model.DB(ctx).Model(&model.User{}).Where("email = ?", operatorName).First(&operator).Error; err != nil {
		return nil, ErrOperationLogForbidden
	}
	if operator.Code != "admin" && operator.Code != "super_admin" {
		return nil, ErrOperationLogForbidden
	}

	db := model.DB(ctx).Model(&model.UserOperationLog{}).Debug()

	// 添加用户ID过滤条件
	if len(userIds) > 0 {
		db = db.Where("user_id IN ?", userIds)
	}

	// 添加时间过滤条件
	if startTime != "" {
		// 尝试解析多种时间格式
		var st time.Time
		var err error
		// 尝试 RFC3339 格式
		if st, err = time.Parse(time.RFC3339, startTime); err != nil {
			// 尝试 "2006-01-02 15:04:05" 格式
			if st, err = time.ParseInLocation("2006-01-02 15:04:05", startTime, time.Local); err != nil {
				// 尝试 "2006-01-02" 格式
				if st, err = time.ParseInLocation("2006-01-02", startTime, time.Local); err != nil {
					// 如果都解析失败，记录错误或忽略
				}
			}
		}
		if !st.IsZero() {
			db = db.Where("created_at >= ?", st)
		}
	}
	if endTime != "" {
		var et time.Time
		var err error
		if et, err = time.Parse(time.RFC3339, endTime); err != nil {
			if et, err = time.ParseInLocation("2006-01-02 15:04:05", endTime, time.Local); err != nil {
				if et, err = time.ParseInLocation("2006-01-02", endTime, time.Local); err != nil {
					// 解析失败
				}
			}
		}
		if !et.IsZero() {
			db = db.Where("created_at <= ?", et)
		}
	}

	var logs []model.UserOperationLog
	// 按时间倒序排列
	if err := db.Order("created_at DESC").Find(&logs).Error; err != nil {
		return nil, err
	}

	return logs, nil
}
