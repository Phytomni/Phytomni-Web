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
	var gotAttachments []rxBot.AssetAttachmentRef
	var gotOwner string
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
		gotAttachments = body.Attachments
		gotOwner = body.OwnerSubject
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"run-research","object":"agent.run","agent":"research","status":"running","task_ids":["child-research"],"result":{}}`))
	}))
	defer srv.Close()
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5,
		ResearchEnabled: true, DesignEnabled: true, NetworkEnabled: true,
	}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	out, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "paper", Tool: "InSilicoResearchAgent", Mode: "instant", Surface: QuerySurfaceAgentProduct,
		Attachments: []rxBot.AssetAttachmentRef{{AssetID: "file_research"}},
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
	if len(gotAttachments) != 1 || gotAttachments[0].AssetID != "file_research" || gotOwner != "alice" {
		t.Fatalf("attachments=%#v owner=%q, want file_research/alice", gotAttachments, gotOwner)
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
		name  string
		tool  string
		path  string
		input QueryInput
		want  map[string]interface{}
	}{
		{
			name: "design", tool: "DigitalDesignAgent", path: "/v1/agents/design/runs",
			input: QueryInput{GeneID: "AT1G01010", SpeciesCode: "ath"},
			want: map[string]interface{}{
				"user_query":    "design",
				"obs_file_list": []interface{}{},
				"interop_mode":  "off", "interop_targets": []interface{}{},
				"resolve_gene_id": true,
				"gene_id":         "AT1G01010", "species_code": "ath",
			},
		},
		{
			name: "network", tool: "GeneNetworkAgent", path: "/v1/agents/network/runs",
			input: QueryInput{ToID: "TO:0000207", SpeciesCode: "osa"},
			want: map[string]interface{}{
				"user_query":       "network",
				"obs_file_list":    []interface{}{},
				"resolve_trait_id": true,
				"to_id":            "TO:0000207",
				"species_code":     "osa",
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
				_, _ = w.Write([]byte(`{"id":"run-remote","object":"agent.run","agent":"` + tt.name + `","status":"running","task_ids":["child-remote"],"result":{}}`))
			}))
			defer srv.Close()
			rxBot.BotConfig = &rxBot.Config{
				BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5,
				ResearchEnabled: true, DesignEnabled: true, NetworkEnabled: true,
			}
			t.Cleanup(func() { rxBot.BotConfig = nil })

			in := tt.input
			in.Query, in.Tool, in.Mode, in.Surface = tt.name, tt.tool, "instant", QuerySurfaceAgentProduct
			if _, err := NewService().Query(context.Background(), "alice", in); err != nil {
				t.Fatalf("Query: %v", err)
			}
			if !reflect.DeepEqual(gotArgs, tt.want) {
				t.Fatalf("arguments=%#v want=%#v", gotArgs, tt.want)
			}
		})
	}
}
