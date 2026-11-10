package utils

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/spf13/viper"
)

type registrationRoleCase struct {
	name        string
	value       any
	set         bool
	want        string
	wantInvalid bool
}

func checkRegistrationRole(t *testing.T, tc registrationRoleCase) {
	t.Helper()
	got, err := RegistrationDefaultRole()
	if tc.wantInvalid {
		if got != "" || !errors.Is(err, ErrInvalidRegistrationRole) {
			t.Fatalf("invalid policy was accepted: role=%q err=%v", got, err)
		}
	} else if err != nil || got != tc.want {
		t.Fatalf("role = %q, want %q, err = %v", got, tc.want, err)
	}
}

func resetRegistrationConfig(t *testing.T) {
	t.Helper()
	previous := *viper.GetViper()
	viper.Reset()
	t.Cleanup(func() { *viper.GetViper() = previous })
}

func TestRegistrationDefaultRole_MissingDefaultsToGuest(t *testing.T) {
	resetRegistrationConfig(t)
	checkRegistrationRole(t, registrationRoleCase{set: false, want: "guest"})
	if !RegistrationEnabled() {
		t.Fatal("missing registration settings must leave registration open")
	}
}

func TestRegistrationDefaultRole_ExactAllowedValues(t *testing.T) {
	for _, tc := range []registrationRoleCase{
		{name: "guest", value: "guest", set: true, want: "guest"},
		{name: "user", value: "user", set: true, want: "user"},
		{name: "vip_user", value: "vip_user", set: true, want: "vip_user"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resetRegistrationConfig(t)
			if tc.set {
				viper.Set(RegistrationDefaultRoleKey, tc.value)
			}
			checkRegistrationRole(t, tc)
		})
	}
}

func TestRegistrationDefaultRole_RejectsExplicitInvalidValues(t *testing.T) {
	for _, tc := range []registrationRoleCase{
		{name: "empty", value: "", set: true, wantInvalid: true},
		{name: "space", value: " ", set: true, wantInvalid: true},
		{name: "alias", value: "vip", set: true, wantInvalid: true},
		{name: "uppercase", value: "VIP_USER", set: true, wantInvalid: true},
		{name: "padded", value: " guest ", set: true, wantInvalid: true},
		{name: "admin", value: "admin", set: true, wantInvalid: true},
		{name: "super_admin", value: "super_admin", set: true, wantInvalid: true},
		{name: "agent", value: "ChatAgent", set: true, wantInvalid: true},
		{name: "bool", value: false, set: true, wantInvalid: true},
		{name: "number", value: 42, set: true, wantInvalid: true},
		{name: "slice", value: []string{"guest"}, set: true, wantInvalid: true},
		{name: "empty_slice", value: []string{}, set: true, wantInvalid: true},
		{name: "empty_map", value: map[string]any{}, set: true, wantInvalid: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resetRegistrationConfig(t)
			viper.SetDefault(RegistrationDefaultRoleKey, "guest")
			if tc.set {
				viper.Set(RegistrationDefaultRoleKey, tc.value)
			}
			checkRegistrationRole(t, tc)
		})
	}
}

func TestLoadConfigInFile_RegistrationRolePolicy(t *testing.T) {
	for _, tc := range []struct {
		name, role string
		want       string
		invalid    bool
	}{
		{name: "absent", want: "guest"},
		{name: "guest", role: "guest", want: "guest"},
		{name: "user", role: "user", want: "user"},
		{name: "vip_user", role: "vip_user", want: "vip_user"},
		{name: "empty", role: `""`, invalid: true},
		{name: "null", role: "null", invalid: true},
		{name: "implicit_null", role: " ", invalid: true},
		{name: "bool", role: "false", invalid: true},
		{name: "number", role: "42", invalid: true},
		{name: "slice", role: "[guest]", invalid: true},
		{name: "empty_slice", role: "[]", invalid: true},
		{name: "empty_map", role: "{}", invalid: true},
		{name: "map", role: "{nested: guest}", invalid: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resetRegistrationConfig(t)
			viper.SetDefault(RegistrationDefaultRoleKey, "guest")
			path := filepath.Join(t.TempDir(), "app.yml")
			content := "auth:\n  registration_enabled: false\n"
			if tc.role != "" {
				content += "  registration_default_role: " + tc.role + "\n"
			}
			if err := os.WriteFile(path, []byte(content), 0600); err != nil {
				t.Fatal(err)
			}
			if err := LoadConfigInFile(path); err != nil {
				t.Fatalf("readable policy must not block startup: %v", err)
			}
			checkRegistrationRole(t, registrationRoleCase{want: tc.want, wantInvalid: tc.invalid})
			if RegistrationEnabled() {
				t.Fatal("explicit registration OFF was lost")
			}
		})
	}
}

func TestLoadConfigInFile_LayeredRegistrationRolePolicy(t *testing.T) {
	for _, invalid := range []string{`""`, "null", "false", "42", "[guest]", "[]", "{}", "{nested: guest}"} {
		for _, tc := range []struct {
			name        string
			roles       [3]string
			want        string
			wantInvalid bool
		}{
			{name: "absent", want: "guest"},
			{name: "precedence", roles: [3]string{"guest", "user", "vip_user"}, want: "vip_user"},
			{name: "invalid_base", roles: [3]string{invalid, "", ""}, wantInvalid: true},
			{name: "invalid_environment", roles: [3]string{"user", invalid, ""}, wantInvalid: true},
			{name: "invalid_custom", roles: [3]string{"guest", "user", invalid}, wantInvalid: true},
			{name: "corrected_environment", roles: [3]string{invalid, "user", ""}, want: "user"},
			{name: "corrected_custom", roles: [3]string{"guest", invalid, "vip_user"}, want: "vip_user"},
		} {
			t.Run(invalid+"/"+tc.name, func(t *testing.T) {
				resetRegistrationConfig(t)
				viper.SetDefault(RegistrationDefaultRoleKey, "guest")
				t.Setenv("ENV", "test")
				dir := t.TempDir()
				cwd, err := os.Getwd()
				if err != nil {
					t.Fatal(err)
				}
				if err := os.Mkdir(filepath.Join(dir, "config"), 0700); err != nil {
					t.Fatal(err)
				}
				for i, name := range []string{"app.yml", "test.yml", "custom.yml"} {
					content := "auth:\n  registration_enabled: false\n"
					if tc.roles[i] != "" {
						content += "  registration_default_role: " + tc.roles[i] + "\n"
					}
					if err := os.WriteFile(filepath.Join(dir, "config", name), []byte(content), 0600); err != nil {
						t.Fatal(err)
					}
				}
				if err := os.Chdir(dir); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() {
					if err := os.Chdir(cwd); err != nil {
						t.Fatal(err)
					}
				})
				if err := LoadConfigInFile(""); err != nil {
					t.Fatalf("readable policy must not block startup: %v", err)
				}
				checkRegistrationRole(t, registrationRoleCase{want: tc.want, wantInvalid: tc.wantInvalid})
				if RegistrationEnabled() {
					t.Fatal("explicit registration OFF was lost")
				}
			})
		}
	}
}

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

func TestRegistrationEnabled_MissingKeyDefaultsToTrue(t *testing.T) {
	viper.Reset()
	t.Cleanup(viper.Reset)
	if !RegistrationEnabled() {
		t.Fatal("missing auth.registration_enabled must preserve public registration")
	}
}

func TestRegistrationEnabled_UsesExplicitValue(t *testing.T) {
	for _, tc := range []struct {
		name  string
		value bool
		want  bool
	}{
		{name: "on", value: true, want: true},
		{name: "off", value: false, want: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			viper.Reset()
			t.Cleanup(viper.Reset)
			viper.Set(RegistrationEnabledKey, tc.value)
			if got := RegistrationEnabled(); got != tc.want {
				t.Fatalf("RegistrationEnabled() = %v, want %v", got, tc.want)
			}
		})
	}
}
