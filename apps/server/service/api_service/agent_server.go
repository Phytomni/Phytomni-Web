package api_service

import (
	"context"
	"errors"
	"phytomni-server/model"
	"time"
)

func (ps *Service) ServerCreateTask(ctx context.Context, serverId, serverStatus, toolName string) (int, error) {
	db := model.DB(ctx).Model(&model.ServerToolLogs{}).Debug()
	if result := db.Where("server_id=?", serverId).First(&model.ServerToolLogs{}).RowsAffected; result != 0 {
		return 0, errors.New("server_id已存在，请重新提交")
	}

	serverResult := &model.ServerToolLogs{
		ServerId:     serverId,
		ToolName:     toolName,
		ServerStatus: serverStatus,
		SyncStatus:   0,
		CreatedAt:    time.Time{},
		UpdatedAt:    time.Time{},
		DeleteAt:     nil,
	}

	err := db.Create(serverResult).Error
	return serverResult.Id, err
}

func (ps *Service) ServerUpdateTask(ctx context.Context, serverId, toolResult, serverFilePath, serverStatus string) (int, error) {
	serverResult := &model.ServerToolLogs{
		ToolResult:     toolResult,
		ServerFilePath: serverFilePath,
		ServerStatus:   serverStatus,
		UpdatedAt:      time.Time{},
	}

	db := model.DB(ctx).Model(&model.ServerToolLogs{}).Debug()
	var serverToolLogs *model.ServerToolLogs
	db.Where("server_id = ?", serverId).First(&serverToolLogs)
	if serverToolLogs.Id == 0 {
		return 0, errors.New("没有查到server任务")
	}

	err := db.Where("server_id = ?", serverId).Updates(serverResult).Error
	if err != nil {
		return 0, errors.New("修改server操作数据库失败")
	}

	return serverToolLogs.Id, err
}
