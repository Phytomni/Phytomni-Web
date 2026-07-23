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

func TestQueryNativeAgentUsesNativeIDAcrossDirectAgentRunMatrix(t *testing.T) {
	tests := []struct {
		tool       string
		slug       string
		status     string
		httpStatus int
	}{
		{tool: "DataAgent", slug: "data", status: "succeeded", httpStatus: http.StatusOK},
		{tool: "BriefGeneAgent", slug: "brief_gene", status: "succeeded", httpStatus: http.StatusOK},
		{tool: "AnalystAgent", slug: "analyst", status: "running", httpStatus: http.StatusAccepted},
		{tool: "DeepGenomeAgent", slug: "deep_genome", status: "running", httpStatus: http.StatusAccepted},
		{tool: "InSilicoResearchAgent", slug: "research", status: "running", httpStatus: http.StatusAccepted},
		{tool: "GeneNetworkAgent", slug: "network", status: "running", httpStatus: http.StatusAccepted},
		{tool: "DigitalDesignAgent", slug: "design", status: "running", httpStatus: http.StatusAccepted},
	}

	for _, tt := range tests {
		t.Run(tt.slug, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			runID := "run-direct-" + tt.slug
			taskID := "task-direct-" + tt.slug
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path != "/v1/agents/"+tt.slug+"/runs" {
					w.WriteHeader(http.StatusNotFound)
					return
				}
				result := map[string]interface{}{}
				taskIDs := []string{taskID}
				if tt.status == "succeeded" {
					result["formatted"] = map[string]interface{}{"answer": "sync answer"}
					taskIDs = []string{}
				}
				w.WriteHeader(tt.httpStatus)
				_ = json.NewEncoder(w).Encode(map[string]interface{}{
					"id": runID, "object": "agent.run", "agent": tt.slug,
					"status": tt.status, "task_ids": taskIDs, "result": result,
				})
			}))
			t.Cleanup(srv.Close)
			rxBot.BotConfig = &rxBot.Config{
				BaseURL: srv.URL, ProxyEnabled: true, ExpertEnabled: true, TimeoutSeconds: 5,
				ResearchEnabled: true, DesignEnabled: true, NetworkEnabled: true,
			}
			t.Cleanup(func() { rxBot.BotConfig = nil })

			out, err := NewService().Query(context.Background(), "alice", QueryInput{
				Query: "q", Tool: tt.tool, Mode: "instant",
			})
			if err != nil {
				t.Fatalf("Query: %v", err)
			}
			wantStatus := strings.ToUpper(tt.status)
			if out.BotRunID != runID || out.Status != wantStatus {
				t.Fatalf("native response identity/status = %#v, want run=%q status=%q", out, runID, wantStatus)
			}
			var persistedRunID string
			if err := gdb.Raw(`SELECT COALESCE(bot_run_id,'') FROM question_agent_logs WHERE id=?`, out.Id).Row().Scan(&persistedRunID); err != nil {
				t.Fatalf("read persisted run id: %v", err)
			}
			if persistedRunID != runID {
				t.Fatalf("persisted bot_run_id = %q, want %q", persistedRunID, runID)
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
			taskIDs := []string{"task-expert-" + tt.slug}
			result := map[string]interface{}{}
			if tt.status == "succeeded" {
				taskIDs = []string{}
				result["formatted"] = map[string]interface{}{"answer": "sync answer"}
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
			var persistedRunID string
			if err := gdb.Raw(`SELECT COALESCE(bot_run_id,'') FROM question_agent_logs WHERE id=?`, out.Id).Row().Scan(&persistedRunID); err != nil {
				t.Fatalf("read persisted run id: %v", err)
			}
			if persistedRunID != runID {
				t.Fatalf("persisted bot_run_id = %q, want %q", persistedRunID, runID)
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
