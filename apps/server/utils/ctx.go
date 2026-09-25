package utils

import "context"

type contextKey string

const requestIDContextKey contextKey = "x-request-id"

// WithRequestID returns a child context carrying the Web request ID.
func WithRequestID(ctx context.Context, requestID string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, requestIDContextKey, requestID)
}

// RequestID reads the Web request ID from a typed context key.
func RequestID(ctx context.Context) (string, bool) {
	if ctx == nil {
		return "", false
	}
	requestID, ok := ctx.Value(requestIDContextKey).(string)
	return requestID, ok
}

// BuildRequestIdCtx builds a context carrying an x-request-id.
func BuildRequestIdCtx() context.Context {
	return WithRequestID(context.Background(), GenUUID())
}
