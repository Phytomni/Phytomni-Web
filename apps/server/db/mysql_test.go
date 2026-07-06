package db

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

// TestApplyEnvDSN_EnvSet asserts that when PHYTOMNI_DB_DSN is set, the env
// value overrides the file-loaded DSN.
func TestApplyEnvDSN_EnvSet(t *testing.T) {
	t.Setenv("PHYTOMNI_DB_DSN", "env-dsn-value")
	cfg := Config{Dsn: "file-dsn-value"}
	got := applyEnvDSN(cfg)
	if got.Dsn != "env-dsn-value" {
		t.Fatalf("Dsn = %q, want %q (env must win over file)", got.Dsn, "env-dsn-value")
	}
}

// TestApplyEnvDSN_FileValueWhenEnvUnset is the equivalence test: when
// PHYTOMNI_DB_DSN is unset, the file-loaded DSN is retained — byte-identical
// to today's behavior.
func TestApplyEnvDSN_FileValueWhenEnvUnset(t *testing.T) {
	unsetEnvForTest(t, "PHYTOMNI_DB_DSN")
	cfg := Config{Dsn: "file-dsn-value"}
	got := applyEnvDSN(cfg)
	if got.Dsn != "file-dsn-value" {
		t.Fatalf("Dsn = %q, want %q (file value must win when env unset)", got.Dsn, "file-dsn-value")
	}
}
