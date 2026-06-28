package cache

import (
	"sync"
	"sync/atomic"
	"time"

	rxLog "phytomni-server/log"
)

var (
	failOpenCount int64
	warnMu        sync.Mutex
	lastWarn      = map[string]time.Time{}
)

// ObserveFailOpen records that a Redis-backed feature degraded to its fail-open
// default. It always bumps the process counter (surfaced by /readyz) and emits a
// rate-limited WARN (at most once per path per 60s) so a sustained Redis outage
// is visible the whole time it persists, not just as a single boot line.
func ObserveFailOpen(path string) {
	atomic.AddInt64(&failOpenCount, 1)
	now := time.Now()
	warnMu.Lock()
	last, ok := lastWarn[path]
	if !ok || now.Sub(last) >= 60*time.Second {
		lastWarn[path] = now
		warnMu.Unlock()
		rxLog.Sugar().Warnf("redis_unavailable_failopen path=%s (feature degraded to safe default)", path)
		return
	}
	warnMu.Unlock()
}

// FailOpenCount returns the total fail-open events since process start.
func FailOpenCount() int64 { return atomic.LoadInt64(&failOpenCount) }

// resetFailOpenForTest zeroes the counter + warn-throttle map (tests only).
func resetFailOpenForTest() {
	atomic.StoreInt64(&failOpenCount, 0)
	atomic.StoreInt64(&rateLimitBlocked, 0)
	atomic.StoreInt64(&obsCacheHit, 0)
	warnMu.Lock()
	lastWarn = map[string]time.Time{}
	warnMu.Unlock()
}

// rateLimitBlocked counts requests blocked with 429 by the rate-limit middleware
// (confirmed over-limit only; Redis-down fail-open pass-throughs count in
// failOpenCount instead). Same structure as failOpenCount (atomic + getter +
// /readyz field) so ops can distinguish "rate limit truly fired" from "Redis down".
var rateLimitBlocked int64

// ObserveRateLimitBlocked is called by the rate-limit middleware when it
// confirms an over-limit request and returns 429.
func ObserveRateLimitBlocked() { atomic.AddInt64(&rateLimitBlocked, 1) }

// RateLimitBlockedCount returns the total number of requests rate-limited since
// process start (exposed via /readyz).
func RateLimitBlockedCount() int64 { return atomic.LoadInt64(&rateLimitBlocked) }

// obsCacheHit counts genuine OBS listing cache hits (hits only; misses and
// fail-opens are not counted here). Same structure as failOpenCount and
// rateLimitBlocked so ops can assess cache effectiveness and tune TTLs.
var obsCacheHit int64

// ObserveObsCacheHit is called by GetObsKeys on a cache hit.
func ObserveObsCacheHit() { atomic.AddInt64(&obsCacheHit, 1) }

// ObsCacheHitCount returns the total OBS listing cache hits since process start
// (exposed via /readyz).
func ObsCacheHitCount() int64 { return atomic.LoadInt64(&obsCacheHit) }
