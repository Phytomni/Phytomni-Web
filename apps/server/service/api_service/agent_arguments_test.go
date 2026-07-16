package api_service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	rxBot "phytomni-server/external/bot"
)

func TestQueryResearchUsesTypedArgumentsAndRunIdentity(t *testing.T) {
	gdb := setupExpertTestDB(t)
	var gotArgs map[string]interface{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/agents/research/runs" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		var body rxBot.AgentRunRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		gotArgs = body.Arguments
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"completion-research","run_id":"run-research","object":"agent.run","agent":"research","status":"running","task_ids":["child-research"],"result":{}}`))
	}))
	defer srv.Close()
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	out, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "paper", Tool: "InSilicoResearchAgent",
	})
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	want := map[string]interface{}{
		"user_query":      "paper",
		"data_list":       map[string]interface{}{},
		"obs_file_list":   []interface{}{},
		"interop_mode":    "off",
		"interop_targets": []interface{}{},
	}
	if !reflect.DeepEqual(gotArgs, want) {
		t.Fatalf("arguments=%#v want=%#v", gotArgs, want)
	}
	if out.Status != "RUNNING" {
		t.Fatalf("status=%q want RUNNING", out.Status)
	}
	var botRunID, taskID string
	gdb.Raw(`SELECT COALESCE(bot_run_id,''), COALESCE(task_id,'') FROM question_agent_logs WHERE id=?`, out.Id).Row().Scan(&botRunID, &taskID)
	if botRunID != "run-research" || taskID != "child-research" {
		t.Fatalf("identity bot_run_id=%q task_id=%q", botRunID, taskID)
	}
}

func TestQueryRemoteArgumentsPreserveResolverContracts(t *testing.T) {
	for _, tt := range []struct {
		name string
		tool string
		path string
		want map[string]interface{}
	}{
		{
			name: "design", tool: "DigitalDesignAgent", path: "/v1/agents/design/runs",
			want: map[string]interface{}{
				"user_query": "design", "obs_file_list": []interface{}{},
				"interop_mode": "off", "interop_targets": []interface{}{},
				"resolve_gene_id": true,
			},
		},
		{
			name: "network", tool: "GeneNetworkAgent", path: "/v1/agents/network/runs",
			want: map[string]interface{}{
				"user_query": "network", "obs_file_list": []interface{}{},
				"resolve_to_id": true,
			},
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			setupExpertTestDB(t)
			var gotArgs map[string]interface{}
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != tt.path {
					w.WriteHeader(http.StatusNotFound)
					return
				}
				var body rxBot.AgentRunRequest
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Errorf("decode request: %v", err)
				}
				gotArgs = body.Arguments
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"id":"completion-remote","run_id":"run-remote","object":"agent.run","agent":"` + tt.name + `","status":"running","task_ids":["child-remote"],"result":{}}`))
			}))
			defer srv.Close()
			rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
			t.Cleanup(func() { rxBot.BotConfig = nil })

			if _, err := NewService().Query(context.Background(), "alice", QueryInput{Query: tt.name, Tool: tt.tool}); err != nil {
				t.Fatalf("Query: %v", err)
			}
			if !reflect.DeepEqual(gotArgs, tt.want) {
				t.Fatalf("arguments=%#v want=%#v", gotArgs, tt.want)
			}
		})
	}
}
