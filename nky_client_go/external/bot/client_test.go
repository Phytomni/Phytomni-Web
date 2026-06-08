package bot

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// newTestClient points a Client at an httptest server.
func newTestClient(url string) *Client {
	return &Client{http: http.DefaultClient, baseURL: url, userKey: "ptm_test"}
}

func TestListRunsSendsDialogueFilter(t *testing.T) {
	var gotQuery, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.Query().Get("dialogue_id")
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"object":"list","data":[{"run_id":"r1","answer":"hi","query":"q","tool_name":"chat"}]}`))
	}))
	defer srv.Close()

	resp, err := newTestClient(srv.URL).ListRuns(context.Background(), "dlg-9")
	if err != nil {
		t.Fatalf("ListRuns error: %v", err)
	}
	if gotQuery != "dlg-9" {
		t.Errorf("dialogue_id filter = %q, want dlg-9", gotQuery)
	}
	if gotAuth != "Bearer ptm_test" {
		t.Errorf("Authorization = %q, want Bearer ptm_test", gotAuth)
	}
	if len(resp.Data) != 1 || resp.Data[0].Answer != "hi" {
		t.Errorf("unexpected runs payload: %+v", resp.Data)
	}
}

func TestDoJSONDecodesErrorEnvelope(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"type":"bad_request","code":400,"message":"streaming unsupported","request_id":"req-7"}}`))
	}))
	defer srv.Close()

	_, err := newTestClient(srv.URL).GetAgents(context.Background())
	if err == nil {
		t.Fatal("expected error for 400 response")
	}
	if want := "streaming unsupported"; !contains(err.Error(), want) {
		t.Errorf("error %q does not surface envelope message %q", err.Error(), want)
	}
	if !contains(err.Error(), "req-7") {
		t.Errorf("error %q does not surface request id", err.Error())
	}
}

func TestInvokeAgentDedupHit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"id":null,"object":"agent.run","agent":"analyst","status":"running","task_ids":[],"result":{"dedup_hit":true,"task_id":"task-prior"}}`))
	}))
	defer srv.Close()

	resp, err := newTestClient(srv.URL).InvokeAgent(context.Background(), "analyst", AgentRunRequest{Arguments: map[string]interface{}{"user_query": "x"}})
	if err != nil {
		t.Fatalf("InvokeAgent error: %v", err)
	}
	if resp.ID != nil {
		t.Errorf("dedup hit id = %v, want nil", *resp.ID)
	}
	if !resp.Result.DedupHit || resp.Result.TaskID != "task-prior" {
		t.Errorf("dedup hit not surfaced: %+v", resp.Result)
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
