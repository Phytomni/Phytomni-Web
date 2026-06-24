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
	warnMu.Lock()
	lastWarn = map[string]time.Time{}
	warnMu.Unlock()
}

// rateLimitBlocked 记录被限流中间件以 429 拦下的请求数(仅"确认超限",不含
// Redis-down 的 fail-open 放行——后者计入 failOpenCount)。与 failOpenCount 同构
// (atomic + getter + /readyz 字段),便于运维区分"限流真触发"与"Redis 挂降级"。
var rateLimitBlocked int64

// ObserveRateLimitBlocked 在限流中间件确认超限、返回 429 时调用。
func ObserveRateLimitBlocked() { atomic.AddInt64(&rateLimitBlocked, 1) }

// RateLimitBlockedCount 返回进程启动以来被限流拦下的请求总数(/readyz 暴露)。
func RateLimitBlockedCount() int64 { return atomic.LoadInt64(&rateLimitBlocked) }
