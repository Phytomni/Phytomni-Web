package utils

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/spf13/viper"
)

// unsetEnvForTest ensures key is not set for the duration of the test, restoring
// the original value (if any) in cleanup. Unlike t.Setenv("", ...), this truly
// unsets the var — needed because viper.BindEnv uses os.LookupEnv which
// distinguishes set-to-empty from unset.
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

// writeTestConfig writes a minimal YAML config file with the given jwt secret
// and returns its path.
func writeTestConfig(t *testing.T, jwtSecret string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "app.yml")
	content := "jwt:\n  secret_key: " + jwtSecret + "\n"
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return path
}

// TestLoadConfigInFile_JWTSecret_EnvOverride asserts that when
// PHYTOMNI_JWT_SECRET is set, viper.GetString returns the env value, not the
// file value.
func TestLoadConfigInFile_JWTSecret_EnvOverride(t *testing.T) {
	cfgPath := writeTestConfig(t, "file-secret-value")
	t.Setenv("PHYTOMNI_JWT_SECRET", "env-secret-value")
	viper.Reset()
	t.Cleanup(viper.Reset)

	if err := LoadConfigInFile(cfgPath); err != nil {
		t.Fatalf("LoadConfigInFile: %v", err)
	}
	got := viper.GetString("jwt.secret_key")
	if got != "env-secret-value" {
		t.Fatalf("jwt.secret_key = %q, want %q (env must win over file)", got, "env-secret-value")
	}
}

// TestLoadConfigInFile_JWTSecret_FileValueWhenEnvUnset is the equivalence
// test: when PHYTOMNI_JWT_SECRET is unset, the file value wins — byte-identical
// to today's behavior.
func TestLoadConfigInFile_JWTSecret_FileValueWhenEnvUnset(t *testing.T) {
	cfgPath := writeTestConfig(t, "file-secret-value")
	unsetEnvForTest(t, "PHYTOMNI_JWT_SECRET")
	viper.Reset()
	t.Cleanup(viper.Reset)

	if err := LoadConfigInFile(cfgPath); err != nil {
		t.Fatalf("LoadConfigInFile: %v", err)
	}
	got := viper.GetString("jwt.secret_key")
	if got != "file-secret-value" {
		t.Fatalf("jwt.secret_key = %q, want %q (file value must win when env unset)", got, "file-secret-value")
	}
}

// TestLoadConfigInFile_JWTSecret_EmptyEnvKeepsFileValue asserts that a set-but
// empty PHYTOMNI_JWT_SECRET must NOT clobber the file secret (parity with
// PHYTOMNI_DB_DSN / PHYTOMNI_REDIS_PASSWORD non-empty guards).
func TestLoadConfigInFile_JWTSecret_EmptyEnvKeepsFileValue(t *testing.T) {
	cfgPath := writeTestConfig(t, "file-secret-value")
	t.Setenv("PHYTOMNI_JWT_SECRET", "")
	viper.Reset()
	t.Cleanup(viper.Reset)

	if err := LoadConfigInFile(cfgPath); err != nil {
		t.Fatalf("LoadConfigInFile: %v", err)
	}
	got := viper.GetString("jwt.secret_key")
	if got != "file-secret-value" {
		t.Fatalf("jwt.secret_key = %q, want %q (empty env must not clobber file)", got, "file-secret-value")
	}
}
