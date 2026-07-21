package log

import (
	"context"
	"testing"

	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
	"phytomni-server/utils"
)

func TestSugarContextAttachesTypedRequestID(t *testing.T) {
	core, observed := observer.New(zap.InfoLevel)
	previous := logger
	logger = zap.New(core)
	t.Cleanup(func() { logger = previous })

	SugarContext(utils.WithRequestID(context.Background(), "web-request-42")).Info("request correlation")
	entries := observed.All()
	if len(entries) != 1 {
		t.Fatalf("observed entries = %d, want one", len(entries))
	}
	if got := entries[0].ContextMap()["request_id"]; got != "web-request-42" {
		t.Fatalf("request_id field = %#v, want web-request-42", got)
	}
}
