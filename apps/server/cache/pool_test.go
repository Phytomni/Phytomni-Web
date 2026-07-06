package cache

import (
	"testing"

	"github.com/go-redis/redis/v8"
)

// TestOptionsFromConfig_PoolFieldsPopulated asserts that when the Config
// carries PoolSize / MinIdleConns, the constructed redis.Options mirror them
// (alongside the existing Addr/Password/DB fields).
func TestOptionsFromConfig_PoolFieldsPopulated(t *testing.T) {
	cfg := Config{
		Addrs:        []string{"host:6379"},
		Password:     "pw",
		DB:           1,
		PoolSize:     32,
		MinIdleConns: 4,
	}
	opts := optionsFromConfig(cfg)
	if opts == nil {
		t.Fatal("optionsFromConfig returned nil")
	}
	if got, want := opts.Addr, "host:6379"; got != want {
		t.Errorf("Addr = %q, want %q", got, want)
	}
	if got, want := opts.Password, "pw"; got != want {
		t.Errorf("Password = %q, want %q", got, want)
	}
	if got, want := opts.DB, 1; got != want {
		t.Errorf("DB = %d, want %d", got, want)
	}
	if got, want := opts.PoolSize, 32; got != want {
		t.Errorf("PoolSize = %d, want %d", got, want)
	}
	if got, want := opts.MinIdleConns, 4; got != want {
		t.Errorf("MinIdleConns = %d, want %d", got, want)
	}
}

// TestOptionsFromConfig_ZeroPoolFieldsIsGoRedisDefault is the equivalence
// invariant: when PoolSize / MinIdleConns are unset (zero values), the
// resulting redis.Options carry zero values too — which go-redis interprets
// as its internal defaults (PoolSize 10*CPU, MinIdleConns 0). Existing
// configs that omit these fields are therefore byte-identical to today.
func TestOptionsFromConfig_ZeroPoolFieldsIsGoRedisDefault(t *testing.T) {
	cfg := Config{
		Addrs:    []string{"host:6379"},
		Password: "pw",
		DB:       0,
		// PoolSize / MinIdleConns intentionally unset.
	}
	opts := optionsFromConfig(cfg)
	if got := opts.PoolSize; got != 0 {
		t.Errorf("PoolSize = %d, want 0 (go-redis default when unset)", got)
	}
	if got := opts.MinIdleConns; got != 0 {
		t.Errorf("MinIdleConns = %d, want 0 (go-redis default when unset)", got)
	}
	// Sanity: the zero-value Options matches what a bare redis.Options would
	// carry for the pool fields, proving no implicit defaults are injected.
	bare := &redis.Options{}
	if opts.PoolSize != bare.PoolSize || opts.MinIdleConns != bare.MinIdleConns {
		t.Errorf("pool fields diverge from bare redis.Options zero values: opts={%d,%d} bare={%d,%d}",
			opts.PoolSize, opts.MinIdleConns, bare.PoolSize, bare.MinIdleConns)
	}
}
