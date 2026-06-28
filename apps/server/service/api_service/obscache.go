package api_service

import (
	"context"
	"time"

	rxCache "phytomni-server/cache"
	rxBot "phytomni-server/external/bot"

	"github.com/spf13/viper"
)

// statusSucceeded is the exact casing used on the Web side for the terminal
// success state (Bot uses lowercase; the Web download gate compares SUCCEEDED
// — see query.go:317 / agent_task.go:227).
const statusSucceeded = "SUCCEEDED"

// defaultObsCacheTTL is the TTL for OBS listing cache entries. Terminal-state
// task output directories are frozen, so a long TTL avoids repeated
// Web → Bot → OBS round-trips.
const defaultObsCacheTTL = time.Hour

// obsCacheConfig reads the OBS listing cache toggle and TTL. The master switch
// obscache.enabled defaults to ON (initConfig sets viper.SetDefault to true).
// It is a benign fail-open optimisation that only takes effect when Redis is
// available; setting it to false bypasses the cache without affecting token
// revocation or rate limiting. ttl falls back to defaultObsCacheTTL when unset.
// Changes require a restart (same pattern as rateLimitConfig).
func obsCacheConfig() (bool, time.Duration) {
	ttl := viper.GetDuration("obscache.ttl")
	if ttl <= 0 {
		ttl = defaultObsCacheTTL
	}
	return viper.GetBool("obscache.enabled"), ttl
}

// listObsKeysCached lists the OBS object keys under obsPath. When the task is
// in a terminal state (SUCCEEDED) and a non-empty listing was previously cached,
// the result is returned directly from Redis. Otherwise, keys are fetched via
// the Bot relay, and the result is written to the cache (terminal + non-empty only).
//
// Entirely fail-open: Redis down / not configured → fall back to source listing;
// never blocks a download.
//
// Invariant (must not regress — see spec §4.3 red-team guardrails): ownership
// validation (user_name + download_path checked against MySQL) MUST be done by
// the caller BEFORE and OUTSIDE this function. This function caches only the
// obsPath → keys data mapping; it never folds "user X may access obsPath" into
// the cache key — doing so would allow a cache hit to bypass authorisation (IDOR).
// Signed download URLs (carrying short-lived tokens) are also never cached; this
// function returns only raw keys and signing is re-done downstream by relayDownloadURL.
func listObsKeysCached(ctx context.Context, client *rxBot.Client, obsPath string, cacheable bool) ([]string, error) {
	enabled, ttl := obsCacheConfig()
	useCache := enabled && cacheable
	if useCache {
		if keys, ok := rxCache.GetObsKeys(ctx, obsPath); ok {
			return keys, nil
		}
	}
	keys, err := client.ListObsKeys(ctx, obsPath)
	if err != nil {
		return nil, err
	}
	if useCache && len(keys) > 0 {
		rxCache.PutObsKeys(ctx, obsPath, keys, ttl)
	}
	return keys, nil
}
