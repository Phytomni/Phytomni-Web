package api_service

import (
	"context"
	"errors"
	"phytomni-server/model"
	"time"
)

// ErrOperationLogForbidden indicates the caller is not authorised to read the
// operation-log audit table. That table contains cross-user PII (email / IP /
// UA / request metadata) and is restricted to admin queries only.
// The handler maps this error to 403.
var ErrOperationLogForbidden = errors.New("not authorized to access operation logs")

func (ps *Service) GetOperationLogs(ctx context.Context, operatorName string, userIds []int64, startTime, endTime string) ([]model.UserOperationLog, error) {
	// Authorisation gate: audit logs are admin-only; normal users must not enumerate other users' records.
	var operator *model.User
	if err := model.DB(ctx).Model(&model.User{}).Where("email = ?", operatorName).First(&operator).Error; err != nil {
		return nil, ErrOperationLogForbidden
	}
	if operator.Code != "admin" && operator.Code != "super_admin" {
		return nil, ErrOperationLogForbidden
	}

	db := model.DB(ctx).Model(&model.UserOperationLog{}).Debug()

	if len(userIds) > 0 {
		db = db.Where("user_id IN ?", userIds)
	}

	if startTime != "" {
		var st time.Time
		var err error
		if st, err = time.Parse(time.RFC3339, startTime); err != nil {
			if st, err = time.ParseInLocation("2006-01-02 15:04:05", startTime, time.Local); err != nil {
				if st, err = time.ParseInLocation("2006-01-02", startTime, time.Local); err != nil {
					// all formats failed; ignore
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
					// all formats failed
				}
			}
		}
		if !et.IsZero() {
			db = db.Where("created_at <= ?", et)
		}
	}

	var logs []model.UserOperationLog
	if err := db.Order("created_at DESC").Find(&logs).Error; err != nil {
		return nil, err
	}

	return logs, nil
}
