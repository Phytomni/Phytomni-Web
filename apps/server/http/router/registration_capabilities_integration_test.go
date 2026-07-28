package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"phytomni-server/utils"

	"github.com/spf13/viper"
)

func TestAuthCapabilities_IsPublicAndReflectsFlag(t *testing.T) {
	for _, tc := range []struct {
		name    string
		enabled bool
	}{
		{name: "registration enabled", enabled: true},
		{name: "registration disabled", enabled: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			viper.Set(utils.RegistrationEnabledKey, tc.enabled)
			t.Cleanup(func() { viper.Set(utils.RegistrationEnabledKey, nil) })

			engine, _ := buildFloorApiEnv(t)
			req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/capabilities", nil)
			res := httptest.NewRecorder()
			engine.ServeHTTP(res, req)

			if res.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d (body=%s)", res.Code, http.StatusOK, res.Body.String())
			}

			var envelope struct {
				Code int `json:"code"`
				Data struct {
					RegistrationEnabled bool `json:"registration_enabled"`
				} `json:"data"`
			}
			if err := json.Unmarshal(res.Body.Bytes(), &envelope); err != nil {
				t.Fatalf("decode envelope: %v", err)
			}
			if envelope.Code != http.StatusOK {
				t.Fatalf("envelope code = %d, want %d", envelope.Code, http.StatusOK)
			}
			if envelope.Data.RegistrationEnabled != tc.enabled {
				t.Fatalf("registration_enabled = %v, want %v", envelope.Data.RegistrationEnabled, tc.enabled)
			}

			var raw struct {
				Data map[string]json.RawMessage `json:"data"`
			}
			if err := json.Unmarshal(res.Body.Bytes(), &raw); err != nil {
				t.Fatalf("decode payload keys: %v", err)
			}
			if len(raw.Data) != 1 {
				t.Fatalf("capability payload = %s, want only registration_enabled", res.Body.String())
			}
		})
	}
}
