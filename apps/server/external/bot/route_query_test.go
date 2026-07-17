package bot

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestRouteQuery_PostsToRouteEndpoint pins the Expert transport: RouteQuery
// POSTs to /v1/query/route and decodes the agent.run-shaped response (resolved
// slug + formatted), so the gateway can reshape by the slug Bot chose.
func TestRouteQuery_PostsToRouteEndpoint(t *testing.T) {
	var gotPath, gotMethod string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotMethod = r.URL.Path, r.Method
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"run-1","run_id":"run-1","object":"agent.run","agent":"knowledge","status":"succeeded","task_ids":[],"result":{"formatted":{"answer":"hi","references":[]}}}`))
	}))
	defer srv.Close()
	BotConfig = &Config{BaseURL: srv.URL, TimeoutSeconds: 5}
	defer func() { BotConfig = nil }()

	resp, err := NewClient().RouteQuery(context.Background(), RouteQueryRequest{UserQuery: "hi"})
	if err != nil {
		t.Fatalf("RouteQuery: %v", err)
	}
	if gotMethod != http.MethodPost || gotPath != "/v1/query/route" {
		t.Errorf("expected POST /v1/query/route, got %s %s", gotMethod, gotPath)
	}
	if resp.Agent != "knowledge" || resp.Status != "succeeded" {
		t.Errorf("decoded resp wrong: %+v", resp)
	}
}

func TestRouteQuery_RejectsDuplicateObjectKeys(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{
			name: "duplicate top-level agent",
			body: `{"id":"run-1","agent":"knowledge","agent":"research","status":"running","result":{}}`,
		},
		{
			name: "duplicate nested formatted answer",
			body: `{"id":"run-1","agent":"knowledge","status":"succeeded","result":{"formatted":{"answer":"first","answer":"last"}}}`,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(tc.body))
			}))
			defer srv.Close()
			client := newTestClient(srv.URL)

			resp, err := client.RouteQuery(context.Background(), RouteQueryRequest{UserQuery: "hi"})
			if err == nil {
				t.Fatalf("RouteQuery accepted duplicate object keys with response=%+v", resp)
			}
			if !contains(err.Error(), "duplicate JSON object key") {
				t.Fatalf("RouteQuery error=%v, want duplicate-key rejection", err)
			}
		})
	}
}

func TestDoJSON_RetainsLastValueBehaviorOutsideRouteQuery(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"agent":"knowledge","agent":"research"}`))
	}))
	defer srv.Close()

	var out struct {
		Agent string `json:"agent"`
	}
	if err := newTestClient(srv.URL).doJSON(context.Background(), http.MethodGet, "/v1/agents", nil, &out); err != nil {
		t.Fatalf("doJSON should retain ordinary decoding behavior: %v", err)
	}
	if out.Agent != "research" {
		t.Fatalf("ordinary doJSON decoded agent=%q, want last value research", out.Agent)
	}
}
