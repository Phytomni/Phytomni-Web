package cache

import (
	"context"
	"testing"
	"time"
)

func TestObsCache_PutGetRoundTrip(t *testing.T) {
	startMiniredisRaw(t)
	if err := InitFromViper(); err != nil {
		t.Fatalf("init: %v", err)
	}
	ctx := context.Background()
	PutObsKeys(ctx, "/obs/p/r1", []string{"a.zip", "b.png"}, time.Minute)
	keys, ok := GetObsKeys(ctx, "/obs/p/r1")
	if !ok {
		t.Fatal("expected cache hit after Put")
	}
	if len(keys) != 2 || keys[0] != "a.zip" || keys[1] != "b.png" {
		t.Fatalf("roundtrip keys = %v", keys)
	}
}

func TestObsCache_MissDoesNotCountFailOpen(t *testing.T) {
	resetFailOpenForTest()
	startMiniredisRaw(t)
	if err := InitFromViper(); err != nil {
		t.Fatalf("init: %v", err)
	}
	// A cold miss on a healthy Redis is redis.Nil — NOT a degradation.
	before := FailOpenCount()
	if _, ok := GetObsKeys(context.Background(), "/obs/p/absent"); ok {
		t.Fatal("absent key must miss")
	}
	if FailOpenCount() != before {
		t.Fatalf("a normal cold miss must NOT increment FailOpenCount (got delta %d)", FailOpenCount()-before)
	}
}

func TestObsCache_EmptyNotCached(t *testing.T) {
	startMiniredisRaw(t)
	if err := InitFromViper(); err != nil {
		t.Fatalf("init: %v", err)
	}
	ctx := context.Background()
	PutObsKeys(ctx, "/obs/p/empty", nil, time.Minute)
	if _, ok := GetObsKeys(ctx, "/obs/p/empty"); ok {
		t.Fatal("empty listing must never be cached")
	}
	PutObsKeys(ctx, "/obs/p/empty2", []string{}, time.Minute)
	if _, ok := GetObsKeys(ctx, "/obs/p/empty2"); ok {
		t.Fatal("zero-length listing must never be cached")
	}
}

func TestObsCache_FailOpenWhenRedisDown(t *testing.T) {
	resetFailOpenForTest()
	mr := startMiniredisRaw(t)
	if err := InitFromViper(); err != nil {
		t.Fatalf("init: %v", err)
	}
	ctx := context.Background()
	PutObsKeys(ctx, "/obs/p/r1", []string{"a.zip"}, time.Minute)
	mr.Close() // simulate outage

	before := FailOpenCount()
	if _, ok := GetObsKeys(ctx, "/obs/p/r1"); ok {
		t.Error("Get must fail-open to miss when Redis is down")
	}
	if FailOpenCount() <= before {
		t.Error("Redis-down Get must increment FailOpenCount")
	}

	before = FailOpenCount()
	PutObsKeys(ctx, "/obs/p/r2", []string{"x.zip"}, time.Minute)
	if FailOpenCount() <= before {
		t.Error("Redis-down Put must increment FailOpenCount")
	}
}

func TestObsCache_FailOpenWhenNilClient(t *testing.T) {
	resetFailOpenForTest()
	clients = nil
	t.Cleanup(func() { clients = nil })
	ctx := context.Background()

	before := FailOpenCount()
	if _, ok := GetObsKeys(ctx, "/x"); ok {
		t.Error("Get must fail-open to miss when client is nil")
	}
	if FailOpenCount() <= before {
		t.Error("nil-client Get must increment FailOpenCount")
	}

	before = FailOpenCount()
	PutObsKeys(ctx, "/x", []string{"a.zip"}, time.Minute)
	if FailOpenCount() <= before {
		t.Error("nil-client Put must increment FailOpenCount")
	}
}

func TestObsCache_TTLExpiry(t *testing.T) {
	mr := startMiniredisRaw(t)
	if err := InitFromViper(); err != nil {
		t.Fatalf("init: %v", err)
	}
	ctx := context.Background()
	PutObsKeys(ctx, "/obs/p/r1", []string{"a.zip"}, time.Minute)
	if _, ok := GetObsKeys(ctx, "/obs/p/r1"); !ok {
		t.Fatal("must hit before TTL expiry")
	}
	mr.FastForward(2 * time.Minute)
	if _, ok := GetObsKeys(ctx, "/obs/p/r1"); ok {
		t.Fatal("must miss after TTL expiry")
	}
}

func TestObsCache_HitCounter(t *testing.T) {
	resetFailOpenForTest()
	startMiniredisRaw(t)
	if err := InitFromViper(); err != nil {
		t.Fatalf("init: %v", err)
	}
	ctx := context.Background()
	PutObsKeys(ctx, "/obs/p/r1", []string{"a.zip"}, time.Minute)
	before := ObsCacheHitCount()
	if _, ok := GetObsKeys(ctx, "/obs/p/r1"); !ok {
		t.Fatal("expected hit")
	}
	if ObsCacheHitCount() != before+1 {
		t.Fatalf("hit must increment ObsCacheHitCount by 1, delta=%d", ObsCacheHitCount()-before)
	}
	// A miss must NOT increment the hit counter.
	before = ObsCacheHitCount()
	GetObsKeys(ctx, "/obs/p/absent")
	if ObsCacheHitCount() != before {
		t.Fatal("a miss must not increment ObsCacheHitCount")
	}
}
