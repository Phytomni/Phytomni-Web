package cache

import (
	"context"
	"encoding/json"
	"time"

	"github.com/go-redis/redis/v8"
)

// obsCacheOpTimeout 限定单次 OBS 列举缓存的 Redis 操作耗时:下载是交互路径,"慢但活"
// 的 Redis 不应拖慢它——超时即 fail-open(miss→回源列举)。80ms 远大于同机房 RTT,
// 只在 Redis 真卡时触发(与 ratelimit.go 同构)。
const obsCacheOpTimeout = 80 * time.Millisecond

// obsKeyPrefix Redis key 前缀。终值 = obsKeyPrefix + obsPath。obsPath 由
// question_agent_logs.download_path 的 varchar(255) 上界约束,直接拼接便于 redis-cli
// 排障;非机密,无需 hash。
const obsKeyPrefix = "obs:keys:"

// GetObsKeys 取 obsPath 的已缓存对象 key 列表。
// fail-open(镜像 ratelimit.go / revocation.go):nil client / Redis error / 超时 /
// 反序列化失败 → ObserveFailOpen("obscache") + (nil,false)(miss,调用方回源列举)。
// 命中 → ObserveObsCacheHit() + (keys,true)。
// 注意:redis.Nil(键不存在=正常冷 miss)不是降级——静默返回 (nil,false),不计 fail-open
// (否则每次首列都会虚增 failopen_count 并刷 WARN)。
//
// 不变量:本函数只按 obsPath 取数据,绝不接收/编码任何用户身份——鉴权在调用方完成。
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
			return nil, false // 正常 miss,非降级
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

// PutObsKeys 把 obsPath 的对象 key 列表以 ttl 写入 Redis(JSON 编码)。
// fail-open:nil client / 序列化失败 / Redis error / 超时 → ObserveFailOpen + 静默返回
// (写缓存失败绝不影响本次下载)。空列表绝不缓存(终态后文件可能晚到,缓空=长期假空)。
func PutObsKeys(ctx context.Context, obsPath string, keys []string, ttl time.Duration) {
	if len(keys) == 0 {
		return // 空列举不缓(防御性;调用方亦先判,双保险)
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
