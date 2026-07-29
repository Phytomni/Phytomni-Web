package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/utils"
)

// compatChatServer serves one synthetic ChatCompletion response so identity
// shaping can be tested independently of Bot's OpenAI-compatible completion id.
func compatChatServer(t *testing.T, chatBody string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/v1/chat/completions" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_, _ = w.Write([]byte(chatBody))
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, ExpertEnabled: true, TimeoutSeconds: 5,
		ResearchEnabled: true, DesignEnabled: true, NetworkEnabled: true,
	}
	t.Cleanup(func() { rxBot.BotConfig = nil })
}

func TestQueryUsesRunIDNotOpenAICompletionID(t *testing.T) {
	setupExpertTestDB(t)
	compatChatServer(t, `{"id":"chatcmpl-7","run_id":"run-7","report_revision":7,"choices":[{"message":{"content":"answer"}}]}`)

	out, err := NewService().Query(utils.WithRequestID(context.Background(), "web-req-7"), "alice", QueryInput{Query: "q"})
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	if out.BotRunID != "run-7" {
		t.Fatalf("bot_run_id=%q", out.BotRunID)
	}
	if out.BotRunID == "chatcmpl-7" {
		t.Fatal("OpenAI completion id used as Bot run id")
	}
	if out.ReportRevision != 7 || out.RequestID != "web-req-7" {
		t.Fatalf("metadata revision=%d request_id=%q", out.ReportRevision, out.RequestID)
	}
}

func TestQueryReturnsDegradedTrackingWithoutSyntheticRunID(t *testing.T) {
	setupExpertTestDB(t)
	compatChatServer(t, `{"id":"chatcmpl-8","run_id":null,"degraded_tracking":true,"choices":[{"message":{"content":"answer"}}]}`)

	out, err := NewService().Query(context.Background(), "alice", QueryInput{Query: "q"})
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	if out.BotRunID != "" || !out.TrackingDegraded {
		t.Fatalf("out=%#v", out)
	}
	encoded, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("marshal degraded response: %v", err)
	}
	if strings.Contains(string(encoded), "bot_run_id") || !strings.Contains(string(encoded), `"tracking_degraded":true`) {
		t.Fatalf("degraded response identity fields are wrong: %s", encoded)
	}
}

func TestQueryChatDoesNotEmitInteropProvenance(t *testing.T) {
	setupExpertTestDB(t)
	compatChatServer(t, `{"id":"chatcmpl-chat","run_id":"run-chat","choices":[{"message":{"content":"answer"}}]}`)

	out, err := NewService().Query(context.Background(), "alice", QueryInput{Query: "q"})
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	encoded, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}
	if strings.Contains(string(encoded), `"interop"`) || strings.Contains(string(encoded), `"degraded_interop"`) {
		t.Fatalf("chat response unexpectedly contains interop fields: %s", encoded)
	}
}

// TestQueryRejectsLegacyInstantAgentToolOnChatSurface locks the strict Chat
// boundary. Native run identity for these tools remains covered through the
// supported Expert route in TestQueryExpertUsesNativeIDAcrossResolvedAgentMatrix.
func TestQueryRejectsLegacyInstantAgentToolOnChatSurface(t *testing.T) {
	for _, tt := range []struct {
		tool string
		slug string
	}{
		{tool: "DataAgent", slug: "data"},
		{tool: "BriefGeneAgent", slug: "brief_gene"},
		{tool: "AnalystAgent", slug: "analyst"},
		{tool: "DeepGenomeAgent", slug: "deep_genome"},
	} {
		t.Run(tt.slug, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			hits := 0
			srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				hits++
			}))
			t.Cleanup(srv.Close)
			previousConfig := rxBot.BotConfig
			rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true}
			t.Cleanup(func() { rxBot.BotConfig = previousConfig })

			_, err := NewService().Query(context.Background(), "alice", QueryInput{
				Query: "q", Tool: tt.tool, Mode: "instant", Surface: QuerySurfaceChat,
			})
			if !errors.Is(err, ErrInvalidChatRouting) {
				t.Fatalf("Query error = %v, want ErrInvalidChatRouting", err)
			}
			if hits != 0 {
				t.Fatalf("legacy instant Chat tool reached Bot %d time(s)", hits)
			}
			var rows int64
			if err := gdb.Table("question_agent_logs").Count(&rows).Error; err != nil {
				t.Fatalf("count rows: %v", err)
			}
			if rows != 0 {
				t.Fatalf("legacy instant Chat tool persisted %d row(s)", rows)
			}
		})
	}
}

func TestQueryDedicatedProductUsesNativeIDAcrossRouteOwnedRunMatrix(t *testing.T) {
	tests := []struct {
		tool string
		slug string
	}{
		{tool: "InSilicoResearchAgent", slug: "research"},
		{tool: "GeneNetworkAgent", slug: "network"},
		{tool: "DigitalDesignAgent", slug: "design"},
	}

	for _, tt := range tests {
		t.Run(tt.slug, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			runID := "run-product-" + tt.slug
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path != "/v1/agents/"+tt.slug+"/runs" {
					w.WriteHeader(http.StatusNotFound)
					return
				}
				w.WriteHeader(http.StatusAccepted)
				_ = json.NewEncoder(w).Encode(map[string]interface{}{
					"id":       runID,
					"object":   "agent.run",
					"agent":    tt.slug,
					"status":   "running",
					"task_ids": []string{},
					"result": map[string]interface{}{
						"formatted": map[string]interface{}{
							"answer":              "",
							"follow_up_questions": []interface{}{},
							"references":          []interface{}{},
							"tabular":             map[string]interface{}{},
							"metadata":            map[string]interface{}{},
						},
						"execution": map[string]interface{}{
							"tracking":    map[string]interface{}{"degraded": false},
							"warnings":    []interface{}{},
							"tasks":       []interface{}{},
							"artifacts":   []interface{}{},
							"output_dirs": []interface{}{},
							"report":      nil,
							"diagnostics": []interface{}{},
						},
					},
				})
			}))
			t.Cleanup(srv.Close)
			previousConfig := rxBot.BotConfig
			rxBot.BotConfig = &rxBot.Config{
				BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5,
				ResearchEnabled: true, DesignEnabled: true, NetworkEnabled: true,
			}
			t.Cleanup(func() { rxBot.BotConfig = previousConfig })

			out, err := NewService().Query(context.Background(), "alice", QueryInput{
				Query: "q", Tool: tt.tool, Mode: "instant", Surface: QuerySurfaceAgentProduct,
			})
			if err != nil {
				t.Fatalf("Query: %v", err)
			}
			if out.BotRunID != runID || out.Status != "RUNNING" {
				t.Fatalf("native response identity/status = %#v, want run=%q status=RUNNING", out, runID)
			}
			if out.TaskId != "" || out.Answer != "" {
				t.Fatalf("fabricated child surface task=%q answer=%q", out.TaskId, out.Answer)
			}
			var persisted struct {
				RunID  string
				TaskID string
				Answer string
				Status string
			}
			if err := gdb.Raw(`SELECT COALESCE(bot_run_id,''), COALESCE(task_id,''),
				COALESCE(answer,''), status FROM question_agent_logs WHERE id=?`, out.Id).Row().Scan(
				&persisted.RunID, &persisted.TaskID, &persisted.Answer, &persisted.Status,
			); err != nil {
				t.Fatalf("read persisted run id: %v", err)
			}
			if persisted.RunID != runID || persisted.TaskID != "" || persisted.Answer != "" || persisted.Status != "RUNNING" {
				t.Fatalf("persisted accepted row=%#v", persisted)
			}
		})
	}
}

func TestQueryExpertUsesNativeIDAcrossResolvedAgentMatrix(t *testing.T) {
	tests := []struct {
		slug   string
		status string
	}{
		{slug: "chat", status: "succeeded"},
		{slug: "knowledge", status: "succeeded"},
		{slug: "data", status: "succeeded"},
		{slug: "analyst", status: "running"},
		{slug: "review", status: "succeeded"},
		{slug: "research", status: "running"},
		{slug: "network", status: "running"},
		{slug: "brief_gene", status: "succeeded"},
		{slug: "deep_genome", status: "running"},
		{slug: "design", status: "running"},
	}

	for _, tt := range tests {
		t.Run(tt.slug, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			runID := "run-expert-" + tt.slug
			taskIDs := []string{}
			result := map[string]interface{}{}
			if tt.status == "succeeded" {
				result["formatted"] = map[string]interface{}{"answer": "sync answer"}
			} else if tt.slug == "deep_genome" {
				taskIDs = []string{"task-expert-deep_genome"}
			}
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path != "/v1/query/route" {
					w.WriteHeader(http.StatusNotFound)
					return
				}
				response := map[string]interface{}{
					"id": runID, "object": "agent.run", "agent": tt.slug,
					"status": tt.status, "task_ids": taskIDs, "result": result,
				}
				if tt.slug == "review" {
					response["run_id"] = runID
				}
				_ = json.NewEncoder(w).Encode(response)
			}))
			t.Cleanup(srv.Close)
			rxBot.BotConfig = &rxBot.Config{
				BaseURL: srv.URL, ProxyEnabled: true, ExpertEnabled: true, TimeoutSeconds: 5,
				ResearchEnabled: true, DesignEnabled: true, NetworkEnabled: true,
			}
			t.Cleanup(func() { rxBot.BotConfig = nil })

			out, err := NewService().Query(context.Background(), "alice", QueryInput{
				Query: "q", Mode: "expert",
			})
			if err != nil {
				t.Fatalf("Query: %v", err)
			}
			if out.BotRunID != runID || out.Status != strings.ToUpper(tt.status) {
				t.Fatalf("expert response identity/status = %#v", out)
			}
			if tt.status == "running" && tt.slug != "deep_genome" {
				if out.TaskId != "" || out.Answer != "" {
					t.Fatalf("expert fabricated child surface task=%q answer=%q", out.TaskId, out.Answer)
				}
			}
			var persisted struct {
				RunID  string
				TaskID string
				Answer string
				Status string
			}
			if err := gdb.Raw(`SELECT COALESCE(bot_run_id,''), COALESCE(task_id,''),
				COALESCE(answer,''), status FROM question_agent_logs WHERE id=?`, out.Id).Row().Scan(
				&persisted.RunID, &persisted.TaskID, &persisted.Answer, &persisted.Status,
			); err != nil {
				t.Fatalf("read persisted run id: %v", err)
			}
			if persisted.RunID != runID {
				t.Fatalf("persisted bot_run_id = %q, want %q", persisted.RunID, runID)
			}
			if tt.status == "running" && tt.slug != "deep_genome" && (persisted.TaskID != "" || persisted.Answer != "" || persisted.Status != "RUNNING") {
				t.Fatalf("persisted accepted row=%#v", persisted)
			}
		})
	}
}

func TestQueryRemoteMissingRunIdentityDoesNotPersistPollableRow(t *testing.T) {
	gdb := setupExpertTestDB(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/query/route" {
			_, _ = w.Write([]byte(`{"id":null,"run_id":null,"status":"running","task_ids":["task-remote"],"degraded_tracking":false,"agent":"analyst","result":{}}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, ExpertEnabled: true, TimeoutSeconds: 5,
		ResearchEnabled: true, DesignEnabled: true, NetworkEnabled: true,
	}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	_, err := NewService().Query(context.Background(), "alice", QueryInput{Query: "q", Mode: "expert"})
	if !errors.Is(err, ErrMissingBotRunID) {
		t.Fatalf("missing umbrella run identity error=%v, want ErrMissingBotRunID", err)
	}
	var rows int64
	if err := gdb.Model(&struct{}{}).Table("question_agent_logs").Count(&rows).Error; err != nil {
		t.Fatalf("count rows: %v", err)
	}
	if rows != 0 {
		t.Fatalf("unpollable running response persisted %d row(s)", rows)
	}
}
