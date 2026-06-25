package api_service

import (
	"context"
	"time"

	rxCache "phytomni-server/cache"
	rxBot "phytomni-server/external/bot"

	"github.com/spf13/viper"
)

// statusSucceeded 是 Web 端终态成功的精确大小写值(Bot 为小写,Web 下载闸按大写;
// 见 query.go:317 / agent_task.go:227)。
const statusSucceeded = "SUCCEEDED"

// defaultObsCacheTTL 终态任务输出目录冻结,长 TTL 省重复 Web→Bot→OBS 列举往返。
const defaultObsCacheTTL = time.Hour

// obsCacheConfig 读 OBS 列举缓存开关与 TTL。总开关 obscache.enabled 默认 ON
// (initConfig 内 viper.SetDefault 设 true;良性 fail-open 优化,仅 Redis 可用时生效;
// 置 false 可单独旁路缓存而不影响 token 撤销/限流)。ttl 缺省回落 defaultObsCacheTTL。
// 改动需重启生效(与 rateLimitConfig 同构)。
func obsCacheConfig() (bool, time.Duration) {
	ttl := viper.GetDuration("obscache.ttl")
	if ttl <= 0 {
		ttl = defaultObsCacheTTL
	}
	return viper.GetBool("obscache.enabled"), ttl
}

// listObsKeysCached 列出 obsPath 下的 OBS 对象 key:任务终态(SUCCEEDED)且此前缓存过
// 非空列举时由 Redis 直接返回,否则回源经 Bot 中转列举并(终态+非空时)写缓存。
// 全程 fail-open:Redis 挂/未配置 → 回源列举,绝不阻断下载。
//
// 不变量(绝不回退,见 spec §4.3 红队护栏):所有权校验(user_name+download_path 查
// MySQL)必须由调用方在本函数之前、之外完成。这里只缓存 obsPath→keys 这一纯数据映射,
// 绝不把"用户 X 可访问 obsPath"折进缓存键——否则缓存命中会绕过鉴权变成 IDOR。也绝不
// 缓存签名下载 URL(含短时 token):本函数只返回 raw key,签发由下游 relayDownloadURL
// 每次重做。
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
