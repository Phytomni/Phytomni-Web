package cache

import (
	"context"
	"net"
	"testing"
	"time"

	"github.com/go-redis/redis/v8"
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

// TestCheckRevocation_States asserts that the pipelined CheckRevocation returns
// the same (blocked, epoch) as the sequential IsBlocked + GetUserEpoch for four
// Redis states, and that the explicit expected values match. This is the
// equivalence + value gate: it also kills mutation 2 (blocked always false) and
// mutation 3 (epoch parsing removed) via the explicit want* assertions.
func TestCheckRevocation_States(t *testing.T) {
	epochVal := time.Unix(1_700_000_000, 0)
	h := HashToken("tok-equivalence")
	email := "alice@x.com"

	cases := []struct {
		name        string
		setup       func(ctx context.Context)
		wantBlocked bool
		wantEpoch   int64
	}{
		{
			name:        "both miss",
			setup:       func(context.Context) {},
			wantBlocked: false,
			wantEpoch:   0,
		},
		{
			name: "blocked hit only",
			setup: func(ctx context.Context) {
				if err := Block(ctx, h, time.Minute); err != nil {
					t.Fatalf("Block: %v", err)
				}
			},
			wantBlocked: true,
			wantEpoch:   0,
		},
		{
			name: "epoch hit only",
			setup: func(ctx context.Context) {
				if err := SetUserEpoch(ctx, email, epochVal, time.Hour); err != nil {
					t.Fatalf("SetUserEpoch: %v", err)
				}
			},
			wantBlocked: false,
			wantEpoch:   epochVal.Unix(),
		},
		{
			name: "both hit",
			setup: func(ctx context.Context) {
				if err := Block(ctx, h, time.Minute); err != nil {
					t.Fatalf("Block: %v", err)
				}
				if err := SetUserEpoch(ctx, email, epochVal, time.Hour); err != nil {
					t.Fatalf("SetUserEpoch: %v", err)
				}
			},
			wantBlocked: true,
			wantEpoch:   epochVal.Unix(),
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			startMiniredisRaw(t)
			if err := InitFromViper(); err != nil {
				t.Fatalf("init: %v", err)
			}
			ctx := context.Background()
			tc.setup(ctx)

			// Old sequential path.
			oldBlocked := IsBlocked(ctx, h)
			oldEpoch := GetUserEpoch(ctx, email)

			// New pipelined path.
			newBlocked, newEpoch := CheckRevocation(ctx, h, email)

			// Explicit value assertions (kill mutations 2 and 3).
			if newBlocked != tc.wantBlocked {
				t.Errorf("blocked = %v, want %v", newBlocked, tc.wantBlocked)
			}
			if newEpoch != tc.wantEpoch {
				t.Errorf("epoch = %d, want %d", newEpoch, tc.wantEpoch)
			}
			// Equivalence with the sequential path.
			if newBlocked != oldBlocked {
				t.Errorf("blocked: pipelined=%v sequential=%v", newBlocked, oldBlocked)
			}
			if newEpoch != oldEpoch {
				t.Errorf("epoch: pipelined=%d sequential=%d", newEpoch, oldEpoch)
			}
		})
	}
}

// TestCheckRevocation_EpochMissNotFailOpen asserts that an epoch miss (redis.Nil
// on the Get) is a normal miss, NOT a fail-open event. This is the mutation 1
// killer: if the `err != redis.Nil` guard is removed, ObserveFailOpen is wrongly
// called and FailOpenCount increments.
func TestCheckRevocation_EpochMissNotFailOpen(t *testing.T) {
	resetFailOpenForTest()
	startMiniredisRaw(t)
	if err := InitFromViper(); err != nil {
		t.Fatalf("init: %v", err)
	}
	ctx := context.Background()
	// No blocklist key, no epoch key: both miss. Exec returns redis.Nil (from the
	// Get), which is a normal miss, not a fail-open event.
	before := FailOpenCount()
	blocked, epoch := CheckRevocation(ctx, HashToken("x"), "a@x.com")
	if blocked {
		t.Error("blocked must be false on a clean miss")
	}
	if epoch != 0 {
		t.Errorf("epoch must be 0 on a clean miss, got %d", epoch)
	}
	if got := FailOpenCount(); got != before {
		t.Errorf("epoch miss must NOT increment FailOpenCount: before=%d after=%d", before, got)
	}
}

// TestCheckRevocation_FailOpenNilClient asserts that a nil Redis client (Redis
// not configured) fails open to (false, 0) with ObserveFailOpen called. This is
// the mutation 4 killer: if the nil-client branch is deleted, c.Pipeline() on a
// nil interface panics.
func TestCheckRevocation_FailOpenNilClient(t *testing.T) {
	resetFailOpenForTest()
	// No InitFromViper / no miniredis: simulate "Redis not configured".
	clients = nil
	t.Cleanup(func() { clients = nil })
	ctx := context.Background()

	before := FailOpenCount()
	blocked, epoch := CheckRevocation(ctx, HashToken("x"), "a@x.com")
	if blocked {
		t.Error("blocked must fail-open to false when client is nil")
	}
	if epoch != 0 {
		t.Errorf("epoch must fail-open to 0 when client is nil, got %d", epoch)
	}
	if FailOpenCount() <= before {
		t.Error("nil-client must increment FailOpenCount")
	}
}

// TestCheckRevocation_FailOpenRedisDown asserts that a real Redis outage (client
// non-nil but connection broken) fails open via the pipeline-error path. This
// complements the nil-client test: here the pipeline Exec returns a connection
// error (not redis.Nil), so the fail-open branch fires.
func TestCheckRevocation_FailOpenRedisDown(t *testing.T) {
	resetFailOpenForTest()
	mr := startMiniredisRaw(t)
	if err := InitFromViper(); err != nil {
		t.Fatalf("init: %v", err)
	}
	ctx := context.Background()
	// Seed a blocklist entry so the happy path would return blocked=true if Redis
	// were up — proving the fail-open path overrides the cached state.
	h := HashToken("tok-down")
	if err := Block(ctx, h, time.Minute); err != nil {
		t.Fatalf("Block: %v", err)
	}
	mr.Close() // simulate outage

	before := FailOpenCount()
	blocked, epoch := CheckRevocation(ctx, h, "alice@x.com")
	if blocked {
		t.Error("blocked must fail-open to false when Redis is down")
	}
	if epoch != 0 {
		t.Errorf("epoch must fail-open to 0 when Redis is down, got %d", epoch)
	}
	if FailOpenCount() <= before {
		t.Error("Redis-down must increment FailOpenCount")
	}
}

// A down-but-not-refused Redis (a tarpit: accepts the connection but never
// replies) would block every op on the read. With the 80ms per-op timeout the
// call fails open quickly; remove the timeout wrapper and it blocks until the
// client ReadTimeout (2s here), making this latency-bound assertion RED. This is
// the mutation killer for "remove the timeout wrapper".
func TestRevocation_OpTimeoutBoundsLatency(t *testing.T) {
	resetFailOpenForTest()
	startMiniredisRaw(t)
	if err := InitFromViper(); err != nil {
		t.Fatalf("init: %v", err)
	}
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { lis.Close() })
	go func() {
		for {
			conn, err := lis.Accept()
			if err != nil {
				return
			}
			_ = conn // hold the connection, never read/write
		}
	}()
	tarpit := redis.NewClient(&redis.Options{
		Addr:        lis.Addr().String(),
		ReadTimeout: 2 * time.Second,
		DialTimeout: time.Second,
		MaxRetries:  -1, // disable retries so the mutated version stays time-bounded (~2s)
	})
	clients[defaultName] = tarpit
	t.Cleanup(func() { tarpit.Close(); clients = nil })

	ctx := context.Background()
	start := time.Now()
	if IsBlocked(ctx, HashToken("x")) {
		t.Error("tarpit Redis must fail-open to not-blocked")
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Errorf("IsBlocked took %v; per-op 80ms timeout not applied", elapsed)
	}
}
