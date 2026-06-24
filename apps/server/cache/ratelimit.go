package cache

import (
	"context"
	"time"
)

// rateLimitOpTimeout 限定单次限流 Redis 操作的最长耗时:登录是同步热路径,"慢但活"
// 的 Redis 不应拖垮它——超时即 fail-open 放行(G 加固)。切勿设到 sub-RTT(会让
// 健康 Redis 也静默 no-op,把限流器变摆设);80ms 远大于本地/同机房 RTT,只在
// Redis 真卡时触发。
const rateLimitOpTimeout = 80 * time.Millisecond

// Allow 对 key 在 window 窗口内做固定窗口计数,返回本次请求是否在 limit 之内。
// fail-open(镜像 revocation.go):nil client / Redis error / 超时 → 记一次
// ObserveFailOpen(path) 并返回 true(放行)。只有 Redis 活且 count>limit 才返回 false。
//
// 原子建桶:SetNX(key,0,window) 仅在 key 不存在时连同 TTL 一起写,故计数 key 永远
// 带 TTL——绝不会出现"无 TTL 的 key 永久封死某身份"(那会把 fail-open 限流器变成
// 意外 fail-closed)。窗口随该身份在窗口内的首个请求开始。
func Allow(ctx context.Context, path, key string, limit int64, window time.Duration) bool {
	c := Client(defaultName)
	if c == nil {
		ObserveFailOpen(path)
		return true
	}
	pctx, cancel := context.WithTimeout(ctx, rateLimitOpTimeout)
	defer cancel()

	if err := c.SetNX(pctx, key, 0, window).Err(); err != nil {
		ObserveFailOpen(path)
		return true
	}
	n, err := c.Incr(pctx, key).Result()
	if err != nil {
		ObserveFailOpen(path)
		return true
	}
	return n <= limit
}
