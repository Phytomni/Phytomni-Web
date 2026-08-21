package api_service

import (
	"context"
	"io"
	"sync"

	rxBot "phytomni-server/external/bot"
)

func NewService() *Service {
	return &Service{}
}

type agentRunReader interface {
	GetRunWithMeta(context.Context, string) (*rxBot.RunRecord, rxBot.ResponseMeta, error)
	GetRunLogs(context.Context, string) (*rxBot.RunLogsResponse, error)
}

type agentRunCanceller interface {
	CancelRunWithMeta(context.Context, string) (*rxBot.RunRecord, rxBot.ResponseMeta, error)
}

type resultDeliveryClient interface {
	RetryRunDelivery(context.Context, string) (*rxBot.RunDelivery, error)
}

type agentCatalogReader interface {
	GetAgents(context.Context) (*rxBot.AgentsListResponse, error)
}

type runStreamReader interface {
	RunStreamWithMeta(context.Context, string, int64) (io.ReadCloser, rxBot.ResponseMeta, error)
}

type Service struct {
	runReader      agentRunReader
	runCanceller   agentRunCanceller
	deliveryClient resultDeliveryClient
	catalogReader  agentCatalogReader
	runStream      runStreamReader
	streamHub      *StreamHub
	streamHubOnce  sync.Once
	resupplyMu     sync.Mutex
	resupplies     map[int64]*streamResupply
}

func (ps *Service) agentCatalogReader() agentCatalogReader {
	if ps != nil && ps.catalogReader != nil {
		return ps.catalogReader
	}
	return rxBot.NewClient()
}

func (ps *Service) agentRunReader() agentRunReader {
	if ps != nil && ps.runReader != nil {
		return ps.runReader
	}
	return rxBot.NewClient()
}

func (ps *Service) agentRunCanceller() agentRunCanceller {
	if ps != nil && ps.runCanceller != nil {
		return ps.runCanceller
	}
	return rxBot.NewClient()
}

func (ps *Service) archiveDeliveryClient() resultDeliveryClient {
	if ps != nil && ps.deliveryClient != nil {
		return ps.deliveryClient
	}
	return rxBot.NewClient()
}

func (ps *Service) runStreamReader() runStreamReader {
	if ps != nil && ps.runStream != nil {
		return ps.runStream
	}
	return rxBot.NewStreamingClient()
}
