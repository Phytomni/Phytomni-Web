package api_service

import (
	"context"
	"io"

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

type agentCatalogReader interface {
	GetAgents(context.Context) (*rxBot.AgentsListResponse, error)
}

type executionEventClient interface {
	GetRunEvents(context.Context, string, int64, int) (*rxBot.ExecutionEventPageV1, error)
	GetRunEventProjection(context.Context, string) (*rxBot.RunEventProjectionV1, error)
	GetRunEvent(context.Context, string, string) (*rxBot.ExecutionEventV1, error)
	OpenRunEventStream(context.Context, string, int64) (io.ReadCloser, rxBot.ResponseMeta, error)
	GetExecutionEvents(context.Context, string, int64, int) (*rxBot.ExecutionEventPageV1, error)
	GetExecutionEventProjection(context.Context, string) (*rxBot.RunEventProjectionV1, error)
	GetExecutionEvent(context.Context, string, string) (*rxBot.ExecutionEventV1, error)
	OpenExecutionEventStream(context.Context, string, int64) (io.ReadCloser, rxBot.ResponseMeta, error)
}

type executionRuntimeClient interface {
	AdmitExecutionV2(context.Context, rxBot.ExecutionAdmissionRequestV2) (*rxBot.ExecutionAdmissionResponseV2, rxBot.ResponseMeta, error)
	GetExecutionSnapshotV2(context.Context, string, string) (*rxBot.ExecutionProjectionV2, rxBot.ResponseMeta, error)
	GetExecutionEventsV2(context.Context, string, string, int64, int) (*rxBot.ExecutionEventPageV2, rxBot.ResponseMeta, error)
	GetExecutionEventV2(context.Context, string, string, string) (*rxBot.ExecutionEventV2, rxBot.ResponseMeta, error)
	GetExecutionOperationV2(context.Context, string, string, string) (*rxBot.ExecutionOperationRecordV2, rxBot.ResponseMeta, error)
	ResolveExecutionTargetV2(context.Context, string, string, string, string) (*rxBot.ExecutionTargetResolutionV2, rxBot.ResponseMeta, error)
	ResolveExecutionTraceV1(context.Context, string, string, string, int64, int) (*rxBot.ExecutionTraceResolutionV1, rxBot.ResponseMeta, error)
	OpenExecutionTargetContentV2(context.Context, string, string, string, string) (io.ReadCloser, rxBot.ExecutionTargetContentMetadataV2, rxBot.ResponseMeta, error)
	PostExecutionActionV2(context.Context, string, string, rxBot.ExecutionActionRequestV2) (*rxBot.ExecutionOperationResponseV2, rxBot.ResponseMeta, error)
	CancelExecutionV2(context.Context, string, string, rxBot.ExecutionCancelRequestV2) (*rxBot.ExecutionOperationResponseV2, rxBot.ResponseMeta, error)
	OpenExecutionStreamV2(context.Context, string, string, int64, int64, int64) (io.ReadCloser, rxBot.ResponseMeta, error)
	SettleConversationContext(context.Context, rxBot.ContextSettlementRequest) (*rxBot.ContextMutationResponse, error)
}

type Service struct {
	runReader      agentRunReader
	deliveryClient resultDeliveryClient
	catalogReader  agentCatalogReader
	eventClient    executionEventClient
	runtimeClient  executionRuntimeClient
}

func (ps *Service) executionRuntimeClient() executionRuntimeClient {
	if ps != nil && ps.runtimeClient != nil {
		return ps.runtimeClient
	}
	return rxBot.NewClient()
}

func (ps *Service) executionEventClient() executionEventClient {
	if ps != nil && ps.eventClient != nil {
		return ps.eventClient
	}
	return rxBot.NewClient()
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

func (ps *Service) archiveDeliveryClient() resultDeliveryClient {
	if ps != nil && ps.deliveryClient != nil {
		return ps.deliveryClient
	}
	return rxBot.NewClient()
}
