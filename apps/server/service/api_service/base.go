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

type resultDeliveryClient interface {
	RetryRunDelivery(context.Context, string) (*rxBot.RunDelivery, error)
}

type Service struct {
	runReader      agentRunReader
	deliveryClient resultDeliveryClient
}

func (ps *Service) agentRunReader() agentRunReader {
	if ps != nil && ps.runReader != nil {
		return ps.runReader
	}
	return rxBot.NewClient()
}

func (ps *Service) archiveDeliveryClient() resultDeliveryClient {
	if ps != nil && ps.deliveryClient != nil {
		return ps.deliveryClient
	}
	return rxBot.NewClient()
}
