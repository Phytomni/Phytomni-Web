package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	rxBot "phytomni-server/external/bot"
)

type interopDelegationServer struct {
	server         *httptest.Server
	discoveryHits  atomic.Int64
	submissionHits atomic.Int64
	mu             sync.Mutex
	args           map[string]interface{}
}

func newInteropDelegationServer(t *testing.T, discoveryStatus int, discoveryBody string) *interopDelegationServer {
	t.Helper()
	h := &interopDelegationServer{}
	h.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/interop/capabilities":
			h.discoveryHits.Add(1)
			if discoveryStatus != http.StatusOK {
				w.WriteHeader(discoveryStatus)
				return
			}
			_, _ = w.Write([]byte(discoveryBody))
		case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/v1/agents/") && strings.HasSuffix(r.URL.Path, "/runs"):
			var request rxBot.AgentRunRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Errorf("decode agent submission: %v", err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			h.submissionHits.Add(1)
			h.mu.Lock()
			h.args = request.Arguments
			h.mu.Unlock()
			parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
			slug := "research"
			if len(parts) >= 4 && parts[2] != "" {
				slug = parts[2]
			}
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"id": "completion-" + slug, "run_id": "run-" + slug,
				"object": "agent.run", "agent": slug, "status": "running",
				"task_ids": []string{"child-" + slug}, "result": map[string]interface{}{},
			})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(h.server.Close)
	return h
}

func (h *interopDelegationServer) configure(t *testing.T) {
	t.Helper()
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: h.server.URL, ProxyEnabled: true, TimeoutSeconds: 5,
		InteropEnabled: true, ResearchEnabled: true, DesignEnabled: true,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })
}

func (h *interopDelegationServer) arguments() map[string]interface{} {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.args
}

func TestResearchInteropOffSkipsDiscoveryAndForwardsNoTargets(t *testing.T) {
	setupExpertTestDB(t)
	h := newInteropDelegationServer(t, http.StatusOK, `{"object":"list","data":[{"target_id":"mcp-peer","kind":"mcp"}],"errors":[]}`)
	h.configure(t)

	out, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "research", Tool: "InSilicoResearchAgent", InteropMode: "off", InteropTargets: []string{"mcp-peer"},
	})
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	if got := h.discoveryHits.Load(); got != 0 {
		t.Fatalf("off mode must skip discovery, hits=%d", got)
	}
	if got := h.submissionHits.Load(); got != 1 {
		t.Fatalf("submission hits=%d, want 1", got)
	}
	args := h.arguments()
	if got := args["interop_mode"]; got != "off" {
		t.Fatalf("interop_mode=%v, want off", got)
	}
	if got, ok := args["interop_targets"].([]interface{}); !ok || len(got) != 0 {
		t.Fatalf("interop_targets=%#v, want empty array", args["interop_targets"])
	}
	if out.InterOp == nil || out.InterOp.Status != "local" || out.DegradedInterop {
		t.Fatalf("local provenance=%#v degraded=%v", out.InterOp, out.DegradedInterop)
	}
}

func TestResearchInteropAutoFallsBackWithoutPseudoSuccess(t *testing.T) {
	setupExpertTestDB(t)
	h := newInteropDelegationServer(t, http.StatusServiceUnavailable, "upstream unavailable")
	h.configure(t)

	out, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "research", Tool: "InSilicoResearchAgent", InteropMode: "auto", InteropTargets: []string{"mcp-peer"},
	})
	if err != nil {
		t.Fatalf("auto fallback Query: %v", err)
	}
	if h.discoveryHits.Load() != 1 || h.submissionHits.Load() != 1 {
		t.Fatalf("discovery=%d submission=%d, want 1/1", h.discoveryHits.Load(), h.submissionHits.Load())
	}
	args := h.arguments()
	if args["interop_mode"] != "off" {
		t.Fatalf("fallback interop_mode=%v, want off", args["interop_mode"])
	}
	if targets, ok := args["interop_targets"].([]interface{}); !ok || len(targets) != 0 {
		t.Fatalf("fallback targets=%#v, want empty array", args["interop_targets"])
	}
	if out.InterOp == nil || out.InterOp.Status != "degraded" || !out.DegradedInterop || out.InterOp.Code != "unavailable" {
		t.Fatalf("degraded provenance=%#v degraded=%v", out.InterOp, out.DegradedInterop)
	}
	projection, err := LoadBotRunProjection(context.Background(), "alice", out.Id)
	if err != nil {
		t.Fatalf("load fallback projection: %v", err)
	}
	if projection.InterOp == nil || projection.InterOp.Status != "degraded" || !projection.DegradedInterop {
		t.Fatalf("persisted degraded provenance=%#v degraded=%v", projection.InterOp, projection.DegradedInterop)
	}
}

func TestResearchInteropAutoDelegatesOnlyDiscoveredTarget(t *testing.T) {
	setupExpertTestDB(t)
	h := newInteropDelegationServer(t, http.StatusOK, `{"object":"list","data":[{"target_id":"mcp-peer","kind":"mcp"}],"errors":[]}`)
	h.configure(t)

	out, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "research", Tool: "InSilicoResearchAgent", InteropMode: "auto", InteropTargets: []string{"mcp-peer"},
	})
	if err != nil {
		t.Fatalf("delegated Query: %v", err)
	}
	if h.discoveryHits.Load() != 1 || h.submissionHits.Load() != 1 {
		t.Fatalf("discovery=%d submission=%d, want 1/1", h.discoveryHits.Load(), h.submissionHits.Load())
	}
	args := h.arguments()
	if args["interop_mode"] != "auto" {
		t.Fatalf("interop_mode=%v, want auto", args["interop_mode"])
	}
	targets, ok := args["interop_targets"].([]interface{})
	if !ok || len(targets) != 1 || targets[0] != "mcp-peer" {
		t.Fatalf("interop_targets=%#v, want [mcp-peer]", args["interop_targets"])
	}
	if out.InterOp == nil || out.InterOp.Status != "delegated" || out.InterOp.TargetID != "mcp-peer" || out.InterOp.Kind != "mcp" || out.DegradedInterop {
		t.Fatalf("delegated provenance=%#v degraded=%v", out.InterOp, out.DegradedInterop)
	}
	projection, err := LoadBotRunProjection(context.Background(), "alice", out.Id)
	if err != nil {
		t.Fatalf("load delegated projection: %v", err)
	}
	encoded, err := json.Marshal(projection)
	if err != nil {
		t.Fatalf("marshal projection: %v", err)
	}
	if strings.Contains(string(encoded), "endpoint") || strings.Contains(string(encoded), "credential") {
		t.Fatalf("projection contains forbidden interop metadata: %s", encoded)
	}
}

func TestDesignInteropDelegationPreservesControls(t *testing.T) {
	setupExpertTestDB(t)
	h := newInteropDelegationServer(t, http.StatusOK, `{"object":"list","data":[{"target_id":"a2a-peer","kind":"a2a"}],"errors":[]}`)
	h.configure(t)

	out, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "design", Tool: "DigitalDesignAgent", InteropMode: "required", InteropTargets: []string{"a2a-peer"},
	})
	if err != nil {
		t.Fatalf("design Query: %v", err)
	}
	args := h.arguments()
	if args["interop_mode"] != "required" {
		t.Fatalf("design interop_mode=%v, want required", args["interop_mode"])
	}
	if targets, ok := args["interop_targets"].([]interface{}); !ok || len(targets) != 1 || targets[0] != "a2a-peer" {
		t.Fatalf("design interop_targets=%#v", args["interop_targets"])
	}
	if out.InterOp == nil || out.InterOp.Status != "delegated" || out.InterOp.Kind != "a2a" {
		t.Fatalf("design provenance=%#v", out.InterOp)
	}
}

func TestRequiredInteropFailsBeforeAgentSubmission(t *testing.T) {
	setupExpertTestDB(t)
	h := newInteropDelegationServer(t, http.StatusOK, `{"object":"list","data":[],"errors":[{"target_id":"mcp-peer","kind":"mcp","code":"discovery_failed"}]}`)
	h.configure(t)

	out, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "research", Tool: "InSilicoResearchAgent", InteropMode: "required", InteropTargets: []string{"mcp-peer"},
	})
	if !errors.Is(err, ErrInteropRequired) {
		t.Fatalf("error=%v, want ErrInteropRequired", err)
	}
	if out == nil || out.Status != "FAILED" || out.InterOp == nil || out.InterOp.Status != "failed" {
		t.Fatalf("failed response=%#v", out)
	}
	if h.discoveryHits.Load() != 1 || h.submissionHits.Load() != 0 {
		t.Fatalf("discovery=%d submission=%d, want 1/0", h.discoveryHits.Load(), h.submissionHits.Load())
	}
}

func TestInteropUnknownTargetFailsBeforeAgentSubmission(t *testing.T) {
	setupExpertTestDB(t)
	h := newInteropDelegationServer(t, http.StatusOK, `{"object":"list","data":[{"target_id":"mcp-peer","kind":"mcp"}],"errors":[]}`)
	h.configure(t)

	out, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "research", Tool: "InSilicoResearchAgent", InteropMode: "auto", InteropTargets: []string{"unknown-peer"},
	})
	if !errors.Is(err, ErrInteropTargetForbidden) {
		t.Fatalf("error=%v, want ErrInteropTargetForbidden", err)
	}
	if out == nil || out.Status != "FAILED" || out.InterOp == nil || out.InterOp.Code != "target_unavailable" {
		t.Fatalf("unknown target response=%#v", out)
	}
	if h.submissionHits.Load() != 0 {
		t.Fatalf("unknown target must not submit, hits=%d", h.submissionHits.Load())
	}
}
