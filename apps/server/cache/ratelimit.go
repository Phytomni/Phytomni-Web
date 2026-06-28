package cache

import (
	"context"
	"time"
)

// rateLimitOpTimeout caps the maximum duration of a single rate-limit Redis
// operation. Login is a synchronous hot path — a slow-but-alive Redis must not
// stall it; timeout triggers fail-open (pass-through). Do not set this below
// the RTT: a sub-RTT value would silently no-op on a healthy Redis and turn
// the rate limiter into a no-op. 80ms is well above local / same-datacenter RTT
// and only fires when Redis is truly stuck.
const rateLimitOpTimeout = 80 * time.Millisecond

// Allow performs a fixed-window count for key within window and returns whether
// this request is within limit.
//
// fail-open (mirrors revocation.go): nil client / Redis error / timeout records
// one ObserveFailOpen(path) and returns true (pass-through). false is only
// returned when Redis is live and count > limit.
//
// Atomic bucket creation: SetNX(key, 0, window) writes the key with a TTL only
// when it does not already exist, so a count key always has a TTL — there is no
// way to get a key without a TTL that permanently locks out an identity (which
// would turn a fail-open rate limiter into an accidental fail-closed one). The
// window starts on the first request from that identity within the window.
func Allow(ctx context.Context, path, key string, limit int64, window time.Duration) bool {
	c := Client(defaultName)
	if c == nil {
		ObserveFailOpen(path)
		return true
	}
	pctx, cancel := context.WithTimeout(ctx, rateLimitOpTimeout)
	defer cancel()

	if err := c.SetNX(pctx, key, 0, window).Err(); err != nil {
		ObserveFailOpen(path)
		return true
	}
	n, err := c.Incr(pctx, key).Result()
	if err != nil {
		ObserveFailOpen(path)
		return true
	}
	return n <= limit
}
