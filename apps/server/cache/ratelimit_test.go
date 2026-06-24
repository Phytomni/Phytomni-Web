package cache

import (
	"context"
	"testing"
	"time"
)

func TestAllow_UnderAndOverLimit(t *testing.T) {
	startMiniredisRaw(t)
	if err := InitFromViper(); err != nil {
		t.Fatalf("init: %v", err)
	}
	ctx := context.Background()
	for i := 1; i <= 3; i++ {
		if !Allow(ctx, "ratelimit_test", "k", 3, time.Minute) {
			t.Fatalf("request %d within limit must be allowed", i)
		}
	}
	if Allow(ctx, "ratelimit_test", "k", 3, time.Minute) {
		t.Fatal("4th request over limit must be denied")
	}
}

func TestAllow_WindowResets(t *testing.T) {
	mr := startMiniredisRaw(t)
	if err := InitFromViper(); err != nil {
		t.Fatalf("init: %v", err)
	}
	ctx := context.Background()
	if !Allow(ctx, "ratelimit_test", "k", 1, time.Minute) {
		t.Fatal("first request must be allowed")
	}
	if Allow(ctx, "ratelimit_test", "k", 1, time.Minute) {
		t.Fatal("second request in same window must be denied")
	}
	// Mutation guard: if SetNX dropped the TTL the key would never expire and
	// this would stay denied → RED.
	mr.FastForward(2 * time.Minute)
	if !Allow(ctx, "ratelimit_test", "k", 1, time.Minute) {
		t.Fatal("after window expiry the request must be allowed again")
	}
}

func TestAllow_PerKeyIsolation(t *testing.T) {
	startMiniredisRaw(t)
	if err := InitFromViper(); err != nil {
		t.Fatalf("init: %v", err)
	}
	ctx := context.Background()
	if !Allow(ctx, "ratelimit_test", "k1", 1, time.Minute) {
		t.Fatal("k1 first must be allowed")
	}
	if Allow(ctx, "ratelimit_test", "k1", 1, time.Minute) {
		t.Fatal("k1 second must be denied")
	}
	if !Allow(ctx, "ratelimit_test", "k2", 1, time.Minute) {
		t.Fatal("k2 must have its own independent bucket")
	}
}

func TestAllow_FailOpenWhenRedisDown(t *testing.T) {
	resetFailOpenForTest()
	mr := startMiniredisRaw(t)
	if err := InitFromViper(); err != nil {
		t.Fatalf("init: %v", err)
	}
	ctx := context.Background()
	mr.Close() // outage
	before := FailOpenCount()
	if !Allow(ctx, "ratelimit_test", "k", 1, time.Minute) {
		t.Error("Allow must fail-open to true when Redis is down")
	}
	if FailOpenCount() <= before {
		t.Error("Allow redis-down must increment FailOpenCount")
	}
}

func TestAllow_FailOpenWhenNilClient(t *testing.T) {
	resetFailOpenForTest()
	clients = nil
	t.Cleanup(func() { clients = nil })
	ctx := context.Background()
	before := FailOpenCount()
	if !Allow(ctx, "ratelimit_test", "k", 1, time.Minute) {
		t.Error("Allow must fail-open to true when client is nil")
	}
	if FailOpenCount() <= before {
		t.Error("Allow nil-client must increment FailOpenCount")
	}
}

// Pins the G footgun: on a HEALTHY Redis the per-op timeout must NOT trip, so a
// genuine over-limit is still denied. A sub-RTT timeout would degrade every call
// to fail-open and flip this over-limit assertion to allowed → RED.
func TestAllow_TimeoutDoesNotSilentlyNoOp(t *testing.T) {
	startMiniredisRaw(t)
	if err := InitFromViper(); err != nil {
		t.Fatalf("init: %v", err)
	}
	ctx := context.Background()
	if !Allow(ctx, "ratelimit_test", "k", 1, time.Minute) {
		t.Fatal("first must be allowed")
	}
	if Allow(ctx, "ratelimit_test", "k", 1, time.Minute) {
		t.Fatal("over-limit must be DENIED on healthy Redis (timeout must not no-op the limiter)")
	}
}

func TestRateLimitBlockedCounter(t *testing.T) {
	resetFailOpenForTest()
	before := RateLimitBlockedCount()
	ObserveRateLimitBlocked()
	if RateLimitBlockedCount() != before+1 {
		t.Fatalf("RateLimitBlockedCount = %d, want %d", RateLimitBlockedCount(), before+1)
	}
}
