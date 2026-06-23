package cache

import (
	"context"
	"time"
)

// Available reports whether the default Redis client exists and responds to a
// PING within a short timeout. Callers use it for /readyz and may use it to
// short-circuit before a Redis op, but the authoritative fail-open behavior is
// "attempt the op; on error, degrade" — Available is a cheap pre-check, not a
// guarantee.
func Available(ctx context.Context) bool {
	c := Client(defaultName)
	if c == nil {
		return false
	}
	pctx, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
	defer cancel()
	return c.Ping(pctx).Err() == nil
}
