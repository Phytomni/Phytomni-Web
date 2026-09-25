package api_service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

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
			slug := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v1/agents/"), "/runs")
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"run-agent","run_id":"run-agent","object":"agent.run","agent":"` + slug + `","status":"running","task_ids":[],"result":{}}`))
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
// and brief_gene) is invoked directly on /v1/chat/completions, never the LLM
// router. This is the fix for the @KnowledgeAgent 502 (forced tool no longer
// depends on Pangu's rejected named-tool tool_choice).
func TestQuery_ExpertForcedChatFamilyDispatchesToChatCompletions(t *testing.T) {
	for _, tool := range []string{"ChatAgent", "KnowledgeAgent", "BriefGeneAgent"} {
		t.Run(tool, func(t *testing.T) {
			setupExpertTestDB(t)
			var hit string
			forcedDispatchServer(t, &hit, nil)

			_, err := NewService().Query(context.Background(), "alice", QueryInput{
				Query: "rice breeding", Mode: "expert", Tool: tool,
			})
			if err != nil {
				t.Fatalf("Query: %v", err)
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
// non-chat local agent is invoked directly on /v1/agents/{slug}/runs, not the
// router. (analyst/deep_genome/research/design/network follow the same branch.)
func TestQuery_ExpertForcedNonChatDispatchesToAgentRuns(t *testing.T) {
	for _, tc := range []struct{ tool, path string }{
		{tool: "DataAgent", path: "/v1/agents/data/runs"},
		{tool: "ReviewAgent", path: "/v1/agents/review/runs"},
	} {
		t.Run(tc.tool, func(t *testing.T) {
			setupExpertTestDB(t)
			var hit string
			forcedDispatchServer(t, &hit, nil)

			out, err := NewService().Query(context.Background(), "alice", QueryInput{
				Query: "run local agent", Mode: "expert", Tool: tc.tool,
			})
			if err != nil {
				t.Fatalf("Query: %v", err)
			}
			if out.Status != "RUNNING" || out.BotRunID != "run-agent" {
				t.Fatalf("result = %#v, want durable RUNNING", out)
			}
			if hit != tc.path {
				t.Fatalf("forced %s must dispatch to %s, hit %q", tc.tool, tc.path, hit)
			}
		})
	}
}

// TestQuery_ExpertAutonomousStillUsesRouter is the regression lock for the ONE
// remaining router use: Expert with NO forced tool must still hit /v1/query/route
// so Bot's LLM picks the agent.
func TestQuery_ExpertAutonomousStillUsesRouter(t *testing.T) {
	gdb := setupExpertTestDB(t)
	var hit string
	botRouter(t, &hit)

	out, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "what can you do", Mode: "expert",
	})
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	if out == nil || out.Id <= 0 {
		t.Fatalf("Query = %#v, want durable Expert Auto row", out)
	}
	_ = waitForDetachedQueryProgress(t, gdb, out.Id)
	if hit != "/v1/query/route" {
		t.Fatalf("autonomous Expert must still hit /v1/query/route, hit %q", hit)
	}
}

func TestQuery_ExpertAutonomousRoutedKnowledgeStartsRunStreamOnce(t *testing.T) {
	gdb := setupExpertTestDB(t)
	var routerCalls, unexpectedCalls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost && r.URL.Path == "/v1/query/route" {
			routerCalls.Add(1)
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"run-auto-knowledge","run_id":"run-auto-knowledge","object":"agent.run","agent":"knowledge","status":"running","task_ids":[],"result":{}}`))
			return
		}
		unexpectedCalls.Add(1)
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	streamer := &fakeRunStream{body: strings.Join([]string{
		`event: RunStarted` + "\n" + `data: {"type":"RunStarted","run_id":"run-auto-knowledge"}` + "\n",
		`event: TextMessageContent` + "\n" + `data: {"type":"TextMessageContent","delta":"routed knowledge"}` + "\n",
		`event: RunFinished` + "\n" + `data: {"type":"RunFinished","run_id":"run-auto-knowledge"}` + "\n",
	}, "\n")}
	svc := NewService()
	svc.runStream = streamer

	out, err := svc.Query(context.Background(), "alice", QueryInput{
		Query: "route and stream", Mode: "expert", Surface: QuerySurfaceChat,
	})
	if err != nil || out == nil || out.Id <= 0 {
		t.Fatalf("Query = %#v, error = %v", out, err)
	}
	row := waitForQuestionRowTerminal(t, gdb, out.Id)
	if row.Status != "SUCCEEDED" || row.ToolName != "KnowledgeAgent" || row.BotRunId != "run-auto-knowledge" {
		t.Fatalf("settled routed stream row = %#v", row)
	}
	if !strings.Contains(row.Answer, "routed knowledge") {
		t.Fatalf("routed stream answer = %q", row.Answer)
	}
	streamCalls, runID, after := streamer.snapshot()
	if routerCalls.Load() != 1 || streamCalls != 1 || runID != "run-auto-knowledge" || after != 0 || unexpectedCalls.Load() != 0 {
		t.Fatalf("router=%d stream=%d run=%q after=%d unexpected=%d", routerCalls.Load(), streamCalls, runID, after, unexpectedCalls.Load())
	}
}

func TestQuery_ExpertAutonomousRoutedDataKeepsWaitingWithoutRunStream(t *testing.T) {
	gdb := setupExpertTestDB(t)
	var routerCalls, unexpectedCalls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost && r.URL.Path == "/v1/query/route" {
			routerCalls.Add(1)
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"run-auto-data","run_id":"run-auto-data","object":"agent.run","agent":"data","status":"running","task_ids":[],"result":{}}`))
			return
		}
		unexpectedCalls.Add(1)
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	streamStarted := make(chan struct{})
	streamer := &fakeRunStream{started: streamStarted}
	svc := NewService()
	svc.runStream = streamer

	out, err := svc.Query(context.Background(), "alice", QueryInput{
		Query: "route and wait", Mode: "expert", Surface: QuerySurfaceChat,
	})
	if err != nil || out == nil || out.Id <= 0 {
		t.Fatalf("Query = %#v, error = %v", out, err)
	}
	row := waitForDetachedQueryProgress(t, gdb, out.Id)
	if row.Status != "RUNNING" || row.ToolName != "DataAgent" || row.BotRunId != "run-auto-data" {
		t.Fatalf("routed wait row = %#v", row)
	}
	select {
	case <-streamStarted:
		t.Fatal("routed DataAgent must not open a chat-family run stream")
	case <-time.After(100 * time.Millisecond):
	}
	streamCalls, _, _ := streamer.snapshot()
	if routerCalls.Load() != 1 || streamCalls != 0 || unexpectedCalls.Load() != 0 {
		t.Fatalf("router=%d stream=%d unexpected=%d", routerCalls.Load(), streamCalls, unexpectedCalls.Load())
	}
}
