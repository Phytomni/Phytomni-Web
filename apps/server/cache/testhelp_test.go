package cache

import (
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/spf13/viper"
)

// startMiniredis spins up an in-process Redis double, points the viper redis.*
// keys at it (single-node client named "web"), and returns its address. All
// cache Redis tests use this instead of a real server.
func startMiniredis(t *testing.T) string {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	viper.Set("redis.default", "web")
	viper.Set("redis.clients", map[string]interface{}{
		"web": map[string]interface{}{
			"type":  "single-node",
			"addrs": []string{mr.Addr()},
			"db":    0,
		},
	})
	t.Cleanup(func() {
		viper.Set("redis.clients", nil)
		viper.Set("redis.default", "")
	})
	return mr.Addr()
}

// startMiniredisRaw is like startMiniredis but returns the *miniredis.Miniredis
// handle so tests can FastForward (TTL) or Close (simulate an outage).
func startMiniredisRaw(t *testing.T) *miniredis.Miniredis {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	viper.Set("redis.default", "web")
	viper.Set("redis.clients", map[string]interface{}{
		"web": map[string]interface{}{
			"type":  "single-node",
			"addrs": []string{mr.Addr()},
			"db":    0,
		},
	})
	t.Cleanup(func() {
		viper.Set("redis.clients", nil)
		viper.Set("redis.default", "")
	})
	return mr
}
