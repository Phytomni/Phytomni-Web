package utils

import "context"

// BuildRequestIdCtx builds a context carrying an x-request-id.
func BuildRequestIdCtx() context.Context {
	return context.WithValue(context.Background(), "x-request-id", GenUUID())
}
