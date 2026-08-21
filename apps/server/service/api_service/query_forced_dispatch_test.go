package api_service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	rxBot "phytomni-server/external/bot"
)

// forcedDispatchServer records the hit path and (for chat-completions) the
// decoded request body, answering both chat-completions and agents/runs so a
// test can assert which endpoint a forced Expert selection dispatches to. It
// never serves /v1/query/route: any forced tool that reaches the router would
// 404 here, turning a routing regression into a hard failure.
func forcedDispatchServer(t *testing.T, hitPath *string, chatBody *rxBot.ChatCompletionRequest) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*hitPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/v1/chat/completions":
			if chatBody != nil {
				raw, _ := io.ReadAll(r.Body)
				_ = json.Unmarshal(raw, chatBody)
			}
			_, _ = w.Write([]byte(`{"id":"c1","run_id":"run-chat","object":"chat.completion","status":"succeeded","choices":[{"index":0,"message":{"role":"assistant","content":"hi"}}],"formatted":{"answer":"hi"}}`))
		case strings.HasPrefix(r.URL.Path, "/v1/agents/") && strings.HasSuffix(r.URL.Path, "/runs"):
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"run-agent","object":"agent.run","agent":"data","status":"succeeded","task_ids":[],"result":{"formatted":{"answer":"ok"}}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5,
	}
	t.Cleanup(func() { rxBot.BotConfig = nil })
}

// TestQuery_ExpertForcedChatFamilyDispatchesToChatCompletions locks the core of
// the direct-dispatch change: every chat-family forced tool (chat, knowledge,
// review, brief_gene) is invoked directly on /v1/chat/completions, never the LLM
// router. This is the fix for the @KnowledgeAgent 502 (forced tool no longer
// depends on Pangu's rejected named-tool tool_choice).
func TestQuery_ExpertForcedChatFamilyDispatchesToChatCompletions(t *testing.T) {
	for _, tool := range []string{"ChatAgent", "KnowledgeAgent", "ReviewAgent", "BriefGeneAgent"} {
		t.Run(tool, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			var hit string
			forcedDispatchServer(t, &hit, nil)

			out, err := NewService().Query(context.Background(), "alice", QueryInput{
				Query: "rice breeding", Mode: "expert", Tool: tool,
			})
			if err != nil {
				t.Fatalf("Query: %v", err)
			}
			if tool == "ReviewAgent" {
				_ = waitForQuestionRowTerminal(t, gdb, out.Id)
			}
			if hit != "/v1/chat/completions" {
				t.Fatalf("forced %s must dispatch to /v1/chat/completions, hit %q", tool, hit)
			}
		})
	}
}

// TestQuery_ExpertForcedBriefGeneSetsResolveGeneID pins refinement #2: a forced
// BriefGene call carries resolve_gene_id=true so Bot resolves the free-form query
// into a canonical gene id before invoking the tool. The other chat models must
// NOT send the flag (Bot rejects it with 400), which the omitempty tag enforces.
func TestQuery_ExpertForcedBriefGeneSetsResolveGeneID(t *testing.T) {
	setupExpertTestDB(t)
	var hit string
	var body rxBot.ChatCompletionRequest
	forcedDispatchServer(t, &hit, &body)

	if _, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "grain size gene in rice", Mode: "expert", Tool: "BriefGeneAgent",
	}); err != nil {
		t.Fatalf("Query: %v", err)
	}
	if hit != "/v1/chat/completions" {
		t.Fatalf("forced BriefGene must dispatch to /v1/chat/completions, hit %q", hit)
	}
	if body.Model != "phyto-brief-gene" {
		t.Fatalf("model = %q, want phyto-brief-gene", body.Model)
	}
	if !body.ResolveGeneID {
		t.Fatal("forced BriefGene must send resolve_gene_id=true")
	}
}

// TestQuery_ExpertForcedNonChatOmitsResolveGeneID guards the omitempty contract:
// a forced chat-family tool that is NOT brief_gene (knowledge) must never send
// resolve_gene_id, or Bot would reject the call with HTTP 400.
func TestQuery_ExpertForcedNonBriefGeneOmitsResolveGeneID(t *testing.T) {
	setupExpertTestDB(t)
	var hit string
	var body rxBot.ChatCompletionRequest
	forcedDispatchServer(t, &hit, &body)

	if _, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "rice breeding", Mode: "expert", Tool: "KnowledgeAgent",
	}); err != nil {
		t.Fatalf("Query: %v", err)
	}
	if body.Model != "phyto-knowledge" {
		t.Fatalf("model = %q, want phyto-knowledge", body.Model)
	}
	if body.ResolveGeneID {
		t.Fatal("forced KnowledgeAgent must NOT send resolve_gene_id (Bot rejects it)")
	}
}

// TestQuery_ExpertForcedNonChatDispatchesToAgentRuns locks that a forced
// non-chat agent (data) is invoked directly on /v1/agents/{slug}/runs, not the
// router. (analyst/deep_genome/research/design/network follow the same branch.)
func TestQuery_ExpertForcedNonChatDispatchesToAgentRuns(t *testing.T) {
	gdb := setupExpertTestDB(t)
	var hit string
	forcedDispatchServer(t, &hit, nil)

	out, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "show me the table", Mode: "expert", Tool: "DataAgent",
	})
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	_ = waitForQuestionRowTerminal(t, gdb, out.Id)
	if hit != "/v1/agents/data/runs" {
		t.Fatalf("forced DataAgent must dispatch to /v1/agents/data/runs, hit %q", hit)
	}
}

// TestQuery_ExpertAutonomousStillUsesRouter is the regression lock for the ONE
// remaining router use: Expert with NO forced tool must still hit /v1/query/route
// so Bot's LLM picks the agent.
func TestQuery_ExpertAutonomousStillUsesRouter(t *testing.T) {
	setupExpertTestDB(t)
	var hit string
	botRouter(t, &hit)

	if _, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "what can you do", Mode: "expert",
	}); err != nil {
		t.Fatalf("Query: %v", err)
	}
	if hit != "/v1/query/route" {
		t.Fatalf("autonomous Expert must still hit /v1/query/route, hit %q", hit)
	}
}
