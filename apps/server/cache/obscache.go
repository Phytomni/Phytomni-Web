package cache

import (
	"context"
	"encoding/json"
	"time"

	"github.com/go-redis/redis/v8"
)

// obsCacheOpTimeout caps the Redis round-trip for a single OBS listing cache
// operation. Downloads are on the interactive path — a slow-but-alive Redis
// must not stall them; timeout triggers fail-open (miss → re-fetch from OBS).
// 80ms is well above same-datacenter RTT and only fires when Redis is truly
// stuck (same pattern as ratelimit.go).
const obsCacheOpTimeout = 80 * time.Millisecond

// obsKeyPrefix is the Redis key prefix. Final key = obsKeyPrefix + obsPath.
// obsPath is bounded by the question_agent_logs.download_path varchar(255)
// column; direct concatenation aids redis-cli debugging — it is not secret
// and does not need to be hashed.
const obsKeyPrefix = "obs:keys:"

// GetObsKeys returns the cached object-key list for obsPath.
//
// fail-open (mirrors ratelimit.go / revocation.go): nil client / Redis error /
// timeout / deserialisation failure → ObserveFailOpen("obscache") + (nil,false)
// (miss; caller re-fetches from OBS).
// Cache hit → ObserveObsCacheHit() + (keys,true).
//
// redis.Nil (key absent = normal cold miss) is NOT a degradation — silently
// returns (nil,false) without counting fail-open (otherwise every first listing
// inflates failopen_count and triggers spurious WARNs).
//
// Invariant: this function only looks up data by obsPath and never accepts or
// encodes any user identity — authorisation is the caller's responsibility.
func GetObsKeys(ctx context.Context, obsPath string) ([]string, bool) {
	c := Client(defaultName)
	if c == nil {
		ObserveFailOpen("obscache")
		return nil, false
	}
	pctx, cancel := context.WithTimeout(ctx, obsCacheOpTimeout)
	defer cancel()

	raw, err := c.Get(pctx, obsKeyPrefix+obsPath).Bytes()
	if err != nil {
		if err == redis.Nil {
			return nil, false // normal cold miss, not a degradation
		}
		ObserveFailOpen("obscache")
		return nil, false
	}
	var keys []string
	if err := json.Unmarshal(raw, &keys); err != nil {
		ObserveFailOpen("obscache")
		return nil, false
	}
	ObserveObsCacheHit()
	return keys, true
}

// PutObsKeys writes the object-key list for obsPath into Redis with the given
// TTL (JSON-encoded).
//
// fail-open: nil client / serialisation failure / Redis error / timeout →
// ObserveFailOpen + silent return (a cache-write failure must never affect the
// in-flight download).
// Empty lists are never cached: when a task has just completed, files may
// arrive later, so caching an empty result would produce long-lived false misses.
func PutObsKeys(ctx context.Context, obsPath string, keys []string, ttl time.Duration) {
	if len(keys) == 0 {
		return // defensive guard; callers also check, but double-safe
	}
	c := Client(defaultName)
	if c == nil {
		ObserveFailOpen("obscache")
		return
	}
	raw, err := json.Marshal(keys)
	if err != nil {
		ObserveFailOpen("obscache")
		return
	}
	pctx, cancel := context.WithTimeout(ctx, obsCacheOpTimeout)
	defer cancel()
	if err := c.Set(pctx, obsKeyPrefix+obsPath, raw, ttl).Err(); err != nil {
		ObserveFailOpen("obscache")
	}
}
