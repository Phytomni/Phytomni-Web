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
	warnMu.Lock()
	lastWarn = map[string]time.Time{}
	warnMu.Unlock()
}
