package cache

import (
	"context"
	"testing"
	"time"
)

func TestBlockAndIsBlocked(t *testing.T) {
	mr := startMiniredisRaw(t)
	if err := InitFromViper(); err != nil {
		t.Fatalf("init: %v", err)
	}
	ctx := context.Background()
	h := HashToken("Bearer-stripped.raw.token")

	if IsBlocked(ctx, h) {
		t.Fatal("unknown token must not be blocked")
	}
	if err := Block(ctx, h, time.Minute); err != nil {
		t.Fatalf("Block: %v", err)
	}
	if !IsBlocked(ctx, h) {
		t.Fatal("token must be blocked after Block")
	}
	// TTL expiry: fast-forward past the TTL → no longer blocked.
	mr.FastForward(2 * time.Minute)
	if IsBlocked(ctx, h) {
		t.Fatal("token must un-block after TTL expiry")
	}
}

func TestUserEpoch_SetGet(t *testing.T) {
	startMiniredisRaw(t)
	if err := InitFromViper(); err != nil {
		t.Fatalf("init: %v", err)
	}
	ctx := context.Background()

	if got := GetUserEpoch(ctx, "alice@x.com"); got != 0 {
		t.Fatalf("no epoch → 0, got %d", got)
	}
	now := time.Unix(1_700_000_000, 0)
	if err := SetUserEpoch(ctx, "alice@x.com", now, time.Hour); err != nil {
		t.Fatalf("SetUserEpoch: %v", err)
	}
	if got := GetUserEpoch(ctx, "alice@x.com"); got != now.Unix() {
		t.Errorf("GetUserEpoch = %d, want %d", got, now.Unix())
	}
	// Per-user isolation: a different user has no epoch.
	if got := GetUserEpoch(ctx, "bob@x.com"); got != 0 {
		t.Errorf("bob epoch = %d, want 0", got)
	}
}

func TestRevocation_FailOpenWhenRedisDown(t *testing.T) {
	resetFailOpenForTest()
	mr := startMiniredisRaw(t)
	if err := InitFromViper(); err != nil {
		t.Fatalf("init: %v", err)
	}
	ctx := context.Background()
	h := HashToken("tok")
	if err := Block(ctx, h, time.Minute); err != nil {
		t.Fatalf("Block: %v", err)
	}
	mr.Close() // simulate outage

	// Fail-open: a down Redis must degrade to "not blocked" / "no epoch".
	// Each call is individually mutation-isolated: capture before, assert after.
	before := FailOpenCount()
	if IsBlocked(ctx, h) {
		t.Error("IsBlocked must fail-open to false when Redis is down")
	}
	if FailOpenCount() <= before {
		t.Error("IsBlocked redis-down must increment FailOpenCount")
	}

	before = FailOpenCount()
	if got := GetUserEpoch(ctx, "alice@x.com"); got != 0 {
		t.Errorf("GetUserEpoch must fail-open to 0 when Redis is down, got %d", got)
	}
	if FailOpenCount() <= before {
		t.Error("GetUserEpoch redis-down must increment FailOpenCount")
	}

	before = FailOpenCount()
	if err := Block(ctx, h, time.Minute); err == nil {
		t.Error("Block must return a non-nil error when Redis is down")
	}
	if FailOpenCount() <= before {
		t.Error("Block redis-down must increment FailOpenCount")
	}
}

func TestRevocation_FailOpenWhenNilClient(t *testing.T) {
	resetFailOpenForTest()
	// No InitFromViper / no miniredis: simulate "Redis not configured".
	clients = nil
	t.Cleanup(func() { clients = nil })
	ctx := context.Background()

	before := FailOpenCount()
	if IsBlocked(ctx, HashToken("x")) {
		t.Error("IsBlocked must fail-open to false when client is nil")
	}
	if FailOpenCount() <= before {
		t.Error("IsBlocked nil-client must increment FailOpenCount")
	}

	before = FailOpenCount()
	if got := GetUserEpoch(ctx, "a@x.com"); got != 0 {
		t.Errorf("GetUserEpoch must fail-open to 0 when client is nil, got %d", got)
	}
	if FailOpenCount() <= before {
		t.Error("GetUserEpoch nil-client must increment FailOpenCount")
	}

	before = FailOpenCount()
	if err := Block(ctx, HashToken("x"), time.Minute); err == nil {
		t.Error("Block must return a non-nil error when client is nil")
	}
	if FailOpenCount() <= before {
		t.Error("Block nil-client must increment FailOpenCount")
	}

	before = FailOpenCount()
	if err := SetUserEpoch(ctx, "a@x.com", time.Now(), time.Hour); err == nil {
		t.Error("SetUserEpoch must return a non-nil error when client is nil")
	}
	if FailOpenCount() <= before {
		t.Error("SetUserEpoch nil-client must increment FailOpenCount")
	}
}

func TestUserEpoch_TTLExpiry(t *testing.T) {
	mr := startMiniredisRaw(t)
	if err := InitFromViper(); err != nil {
		t.Fatalf("init: %v", err)
	}
	ctx := context.Background()

	epoch := time.Unix(1_700_000_000, 0)
	if err := SetUserEpoch(ctx, "carol@x.com", epoch, time.Minute); err != nil {
		t.Fatalf("SetUserEpoch: %v", err)
	}
	if got := GetUserEpoch(ctx, "carol@x.com"); got != epoch.Unix() {
		t.Fatalf("GetUserEpoch before expiry = %d, want %d", got, epoch.Unix())
	}
	// Fast-forward past TTL → epoch must expire and return 0.
	mr.FastForward(2 * time.Minute)
	if got := GetUserEpoch(ctx, "carol@x.com"); got != 0 {
		t.Errorf("GetUserEpoch after TTL expiry = %d, want 0", got)
	}
}
