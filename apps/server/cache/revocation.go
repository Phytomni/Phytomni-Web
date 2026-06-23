package cache

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strconv"
	"time"

	"github.com/go-redis/redis/v8"

	rxLog "phytomni-server/log"
)

const (
	revokeTokenPrefix = "revoke:tok:"  // + hex(sha256(token))  -> single-token blocklist
	revokeUserPrefix  = "revoke:user:" // + email               -> per-user revocation epoch
)

var errNoRedisClient = errors.New("redis client not configured")

// HashToken returns hex(sha256(raw)). The blocklist keys on the FULL token string
// (signature included), SHA-256, never truncated — so the logout writer and the
// AuthMiddleware checker derive byte-identical keys and there is no truncation
// collision that could revoke the wrong token.
func HashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// Block adds a token hash to the blocklist with ttl = the token's remaining life
// (so the key self-expires at the token's natural exp). Fail-open: a nil client or
// a Redis error is observed and returned for the caller to log; logout still
// succeeds (best-effort under a Redis outage).
func Block(ctx context.Context, tokenHash string, ttl time.Duration) error {
	c := Client(defaultName)
	if c == nil {
		ObserveFailOpen("revocation_block")
		return errNoRedisClient
	}
	if err := c.Set(ctx, revokeTokenPrefix+tokenHash, "1", ttl).Err(); err != nil {
		ObserveFailOpen("revocation_block")
		return err
	}
	return nil
}

// IsBlocked reports whether a token hash is blocklisted. Fail-open: nil client or
// Redis error → false (a Redis outage degrades to "allow", never locks everyone
// out). The authoritative durable revocation is the password-change floor, not
// this online check.
func IsBlocked(ctx context.Context, tokenHash string) bool {
	c := Client(defaultName)
	if c == nil {
		ObserveFailOpen("revocation_check")
		return false
	}
	n, err := c.Exists(ctx, revokeTokenPrefix+tokenHash).Result()
	if err != nil {
		ObserveFailOpen("revocation_check")
		return false
	}
	return n > 0
}

// SetUserEpoch records a per-user revocation epoch: every token with iat < epoch is
// revoked (logout-all, and every password change). ttl should be >= TokenLifetime
// so the key outlives the longest-lived token, then self-expires. Fail-open.
func SetUserEpoch(ctx context.Context, email string, epoch time.Time, ttl time.Duration) error {
	c := Client(defaultName)
	if c == nil {
		ObserveFailOpen("revocation_epoch_set")
		return errNoRedisClient
	}
	if err := c.Set(ctx, revokeUserPrefix+email, strconv.FormatInt(epoch.Unix(), 10), ttl).Err(); err != nil {
		ObserveFailOpen("revocation_epoch_set")
		return err
	}
	return nil
}

// GetUserEpoch returns the per-user revocation epoch (unix seconds), or 0 if none
// or unreachable. Fail-open: nil client / real error → 0 (+ observed). A missing
// key (redis.Nil) is the normal "no epoch" case and is NOT a fail-open event.
func GetUserEpoch(ctx context.Context, email string) int64 {
	c := Client(defaultName)
	if c == nil {
		ObserveFailOpen("revocation_epoch_get")
		return 0
	}
	v, err := c.Get(ctx, revokeUserPrefix+email).Result()
	if err != nil {
		if err != redis.Nil {
			ObserveFailOpen("revocation_epoch_get")
		}
		return 0
	}
	epoch, perr := strconv.ParseInt(v, 10, 64)
	if perr != nil {
		rxLog.Sugar().Warnf("revocation epoch parse failed for %s: %v", email, perr)
		return 0
	}
	return epoch
}
