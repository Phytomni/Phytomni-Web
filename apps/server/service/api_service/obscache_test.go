package api_service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	rxCache "phytomni-server/cache"
	rxBot "phytomni-server/external/bot"

	"github.com/alicebob/miniredis/v2"
	"github.com/spf13/viper"
)

// setupObsCacheRedis starts an in-process Redis double, points viper at it,
// initializes the cache client, and enables the obscache feature for the test.
// All viper keys are cleaned up; the leaked client is neutralized by the
// miniredis Close cleanup (a closed server -> fail-open miss).
func setupObsCacheRedis(t *testing.T) *miniredis.Miniredis {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	viper.Set("redis.default", "web")
	viper.Set("redis.clients", map[string]interface{}{
		"web": map[string]interface{}{"type": "single-node", "addrs": []string{mr.Addr()}, "db": 0},
	})
	viper.Set("obscache.enabled", true)
	if err := rxCache.InitFromViper(); err != nil {
		t.Fatalf("cache init: %v", err)
	}
	t.Cleanup(func() {
		viper.Set("redis.clients", nil)
		viper.Set("redis.default", "")
		viper.Set("obscache.enabled", nil)
	})
	return mr
}

// listCountingRelay stands up a fake Bot OBS relay returning the given JSON
// body for /v1/relay/obs/list and counts how many times list was called.
func listCountingRelay(t *testing.T, listBody string) *int64 {
	t.Helper()
	var n int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/relay/obs/list" {
			atomic.AddInt64(&n, 1)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(listBody))
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })
	return &n
}

// TestObsCache_HitAvoidsSecondRelayCall: a SUCCEEDED task lists once; the second
// download of the same obsPath is served from Redis (relay hit exactly once).
func TestObsCache_HitAvoidsSecondRelayCall(t *testing.T) {
	setupObsCacheRedis(t)
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, download_path, status, created_at) VALUES
		(80, 'alice', '/obs/p/r1', 'SUCCEEDED', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	n := listCountingRelay(t, `{"keys":["/obs/p/r1/out.zip"]}`)
	ps := NewService()

	for i := 0; i < 2; i++ {
		url, err := ps.DownloadAnalystAgentObsFile(context.Background(), "alice", "/obs/p/r1")
		if err != nil {
			t.Fatalf("call %d: %v", i, err)
		}
		if url == "" {
			t.Fatalf("call %d: empty url", i)
		}
	}
	if got := atomic.LoadInt64(n); got != 1 {
		t.Fatalf("SUCCEEDED listing must be cached: relay list calls = %d, want 1", got)
	}
}

// TestObsCache_NonSucceededNotCached: a non-terminal status must NOT cache —
// every call re-lists. (Synthetic row: download_path is normally success-only.)
func TestObsCache_NonSucceededNotCached(t *testing.T) {
	setupObsCacheRedis(t)
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, download_path, status, created_at) VALUES
		(81, 'alice', '/obs/p/r2', 'RUNNING', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	n := listCountingRelay(t, `{"keys":["/obs/p/r2/out.zip"]}`)
	ps := NewService()
	for i := 0; i < 2; i++ {
		if _, err := ps.DownloadAnalystAgentObsFile(context.Background(), "alice", "/obs/p/r2"); err != nil {
			t.Fatalf("call %d: %v", i, err)
		}
	}
	if got := atomic.LoadInt64(n); got != 2 {
		t.Fatalf("non-SUCCEEDED must not cache: relay list calls = %d, want 2", got)
	}
}

// TestObsCache_EmptyListingNotCached: an empty listing (even for SUCCEEDED) must
// not be cached — the second call re-lists (relay hit twice). Both calls error
// (no zip), which is fine; the property under test is the relay-hit count.
func TestObsCache_EmptyListingNotCached(t *testing.T) {
	setupObsCacheRedis(t)
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, download_path, status, created_at) VALUES
		(82, 'alice', '/obs/p/r3', 'SUCCEEDED', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	n := listCountingRelay(t, `{"keys":[]}`)
	ps := NewService()
	for i := 0; i < 2; i++ {
		if _, err := ps.DownloadAnalystAgentObsFile(context.Background(), "alice", "/obs/p/r3"); err == nil {
			t.Fatalf("call %d: expected no-zip error on empty listing", i)
		}
	}
	if got := atomic.LoadInt64(n); got != 2 {
		t.Fatalf("empty listing must not cache: relay list calls = %d, want 2", got)
	}
}

// TestObsCache_OwnershipStillEnforcedOnCacheHit: even with the cache warm for
// alice's path, bob is rejected by the ownership lookup BEFORE the cache is
// consulted — the cache key is obsPath only, never the user.
func TestObsCache_OwnershipStillEnforcedOnCacheHit(t *testing.T) {
	setupObsCacheRedis(t)
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, download_path, status, created_at) VALUES
		(83, 'alice', '/obs/p/r4', 'SUCCEEDED', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	listCountingRelay(t, `{"keys":["/obs/p/r4/out.zip"]}`)
	ps := NewService()
	// Warm the cache as the owner.
	if _, err := ps.DownloadAnalystAgentObsFile(context.Background(), "alice", "/obs/p/r4"); err != nil {
		t.Fatalf("owner warm: %v", err)
	}
	// Non-owner must be rejected (no row), regardless of a warm cache.
	if _, err := ps.DownloadAnalystAgentObsFile(context.Background(), "bob", "/obs/p/r4"); err == nil {
		t.Fatal("non-owner must be rejected before the cache is consulted")
	}
}

// TestObsCache_DisabledAlwaysRelays: obscache.enabled=false bypasses the cache
// entirely even when Redis is up (every call re-lists).
func TestObsCache_DisabledAlwaysRelays(t *testing.T) {
	setupObsCacheRedis(t)
	viper.Set("obscache.enabled", false) // override the helper's enable
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, download_path, status, created_at) VALUES
		(84, 'alice', '/obs/p/r5', 'SUCCEEDED', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	n := listCountingRelay(t, `{"keys":["/obs/p/r5/out.zip"]}`)
	ps := NewService()
	for i := 0; i < 2; i++ {
		if _, err := ps.DownloadAnalystAgentObsFile(context.Background(), "alice", "/obs/p/r5"); err != nil {
			t.Fatalf("call %d: %v", i, err)
		}
	}
	if got := atomic.LoadInt64(n); got != 2 {
		t.Fatalf("disabled cache must always relay: list calls = %d, want 2", got)
	}
}
