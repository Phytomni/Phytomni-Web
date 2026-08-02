package api_service

import (
	"context"

	rxBot "phytomni-server/external/bot"
)

func NewService() *Service {
	return &Service{}
}

type agentRunReader interface {
	GetRunWithMeta(context.Context, string) (*rxBot.RunRecord, rxBot.ResponseMeta, error)
	GetRunLogs(context.Context, string) (*rxBot.RunLogsResponse, error)
}

type Service struct {
	runReader agentRunReader
}

func (ps *Service) agentRunReader() agentRunReader {
	if ps != nil && ps.runReader != nil {
		return ps.runReader
	}
	return rxBot.NewClient()
}
