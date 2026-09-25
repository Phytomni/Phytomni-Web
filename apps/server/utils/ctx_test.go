package utils

import (
	"context"
	"testing"
)

type legacyContextKey string

func TestRequestIDRoundTripUsesTypedContextKey(t *testing.T) {
	ctx := WithRequestID(context.Background(), "web-request-7")
	got, ok := RequestID(ctx)
	if !ok || got != "web-request-7" {
		t.Fatalf("RequestID() = %q, %v; want web-request-7, true", got, ok)
	}
}

func TestRequestIDRejectsMissingAndLegacyStringKey(t *testing.T) {
	for name, ctx := range map[string]context.Context{
		"missing":         context.Background(),
		"wrong typed key": context.WithValue(context.Background(), legacyContextKey("x-request-id"), "legacy"),
	} {
		t.Run(name, func(t *testing.T) {
			if got, ok := RequestID(ctx); ok || got != "" {
				t.Fatalf("RequestID() = %q, %v; want empty, false", got, ok)
			}
		})
	}
}

func TestBuildRequestIdCtxGeneratesNonEmptyID(t *testing.T) {
	got, ok := RequestID(BuildRequestIdCtx())
	if !ok || got == "" {
		t.Fatalf("BuildRequestIdCtx() RequestID = %q, %v; want non-empty, true", got, ok)
	}
}
