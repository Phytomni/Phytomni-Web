package utils

import "context"

// BuildRequestIdCtx 构建x-request-id
func BuildRequestIdCtx() context.Context {
	return context.WithValue(context.Background(), "x-request-id", GenUUID())
}
