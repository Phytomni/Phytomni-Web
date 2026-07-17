package bot

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGetInteropCapabilitiesDecodesOnlySafeTargetFields(t *testing.T) {
	var gotAuth string
	var gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v1/interop/capabilities" {
			t.Fatalf("request = %s %s, want GET /v1/interop/capabilities", r.Method, r.URL.Path)
		}
		gotAuth = r.Header.Get("Authorization")
		gotQuery = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"object":"list","data":[{"target_id":"mcp-peer","kind":"mcp","command":"/private/bin","card_base_url":"https://private.invalid","credential_ref":"operator-token","input_schema":{"secret":true}}],"errors":[{"target_id":"a2a-peer","kind":"a2a","code":"discovery_failed","exception":"private traceback"}]}`))
	}))
	t.Cleanup(srv.Close)

	response, err := newTestClient(srv.URL).GetInteropCapabilities(context.Background())
	if err != nil {
		t.Fatalf("GetInteropCapabilities error: %v", err)
	}
	if gotAuth != "Bearer ptm_test" {
		t.Fatalf("Authorization = %q, want Bearer ptm_test", gotAuth)
	}
	if gotQuery != "" {
		t.Fatalf("query override = %q, want empty", gotQuery)
	}
	if len(response.Data) != 1 || response.Data[0].TargetID != "mcp-peer" || response.Data[0].Kind != "mcp" {
		t.Fatalf("safe data = %#v", response.Data)
	}
	if len(response.Errors) != 1 || response.Errors[0].Code != "discovery_failed" {
		t.Fatalf("safe errors = %#v", response.Errors)
	}
	encoded := string(mustJSON(t, response))
	for _, forbidden := range []string{"private/bin", "private.invalid", "operator-token", "input_schema", "exception", "traceback"} {
		if strings.Contains(encoded, forbidden) {
			t.Fatalf("private field %q leaked through client DTO: %s", forbidden, encoded)
		}
	}
}

func TestGetInteropCapabilitiesRejectsUnboundedOrMalformedEnvelope(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{name: "bad target", body: `{"data":[{"target_id":"../secret","kind":"mcp"}]}`},
		{name: "bad kind", body: `{"data":[{"target_id":"mcp-peer","kind":"stdio"}]}`},
		{name: "bad code", body: `{"errors":[{"target_id":"mcp-peer","kind":"mcp","code":"private exception"}]}`},
		{name: "too many", body: `{"data":[` + strings.TrimSuffix(strings.Repeat(`{"target_id":"mcp-peer","kind":"mcp"},`, maxInteropCapabilities+1), ",") + `]}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(tt.body))
			}))
			t.Cleanup(srv.Close)
			if _, err := newTestClient(srv.URL).GetInteropCapabilities(context.Background()); err == nil {
				t.Fatal("malformed/unbounded envelope unexpectedly accepted")
			}
		})
	}
}

func TestGetInteropCapabilitiesMapsBotUnavailable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":{"message":"credential_ref=operator-token"}}`))
	}))
	t.Cleanup(srv.Close)

	_, err := newTestClient(srv.URL).GetInteropCapabilities(context.Background())
	if err == nil {
		t.Fatal("expected unavailable Bot error")
	}
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Status != http.StatusServiceUnavailable {
		t.Fatalf("error = %T %v, want APIError 503", err, err)
	}
}

func mustJSON(t *testing.T, value interface{}) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return data
}
