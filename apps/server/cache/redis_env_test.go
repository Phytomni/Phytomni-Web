package cache

import (
	"os"
	"testing"
)

// unsetEnvForTest ensures key is not set for the duration of the test, restoring
// the original value (if any) in cleanup.
func unsetEnvForTest(t *testing.T, key string) {
	t.Helper()
	old, hadOld := os.LookupEnv(key)
	os.Unsetenv(key)
	t.Cleanup(func() {
		if hadOld {
			_ = os.Setenv(key, old)
		}
	})
}

// TestApplyEnvRedisPassword_EnvSet asserts that when
// PHYTOMNI_REDIS_PASSWORD is set, the env value overrides the file-loaded
// password.
func TestApplyEnvRedisPassword_EnvSet(t *testing.T) {
	t.Setenv("PHYTOMNI_REDIS_PASSWORD", "env-pw-value")
	cfg := Config{Password: "file-pw-value"}
	got := applyEnvRedisPassword(cfg)
	if got.Password != "env-pw-value" {
		t.Fatalf("Password = %q, want %q (env must win over file)", got.Password, "env-pw-value")
	}
}

// TestApplyEnvRedisPassword_FileValueWhenEnvUnset is the equivalence test:
// when PHYTOMNI_REDIS_PASSWORD is unset, the file-loaded password is retained
// — byte-identical to today's behavior.
func TestApplyEnvRedisPassword_FileValueWhenEnvUnset(t *testing.T) {
	unsetEnvForTest(t, "PHYTOMNI_REDIS_PASSWORD")
	cfg := Config{Password: "file-pw-value"}
	got := applyEnvRedisPassword(cfg)
	if got.Password != "file-pw-value" {
		t.Fatalf("Password = %q, want %q (file value must win when env unset)", got.Password, "file-pw-value")
	}
}
