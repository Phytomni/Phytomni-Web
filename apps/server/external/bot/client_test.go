package bot

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
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
	const sensitiveMessage = "PAPER_FULLTEXT_MARKER path=/private/papers/input.pdf prompt=classify-this"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"type":"bad_request","code":400,"message":"` + sensitiveMessage + `","request_id":"req-7"}}`))
	}))
	defer srv.Close()

	_, err := newTestClient(srv.URL).GetAgents(context.Background())
	if err == nil {
		t.Fatal("expected error for 400 response")
	}
	if contains(err.Error(), sensitiveMessage) || contains(err.Error(), "/private/papers/input.pdf") {
		t.Fatalf("typed error leaked Bot envelope message: %q", err.Error())
	}
	if got, want := err.Error(), "bot request failed: status 400"; got != want {
		t.Errorf("error = %q, want ordinary-log-safe text %q", got, want)
	}
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("error = %T, want *APIError", err)
	}
	if apiErr.Method != http.MethodGet || apiErr.Path != "/v1/agents" ||
		apiErr.Status != http.StatusBadRequest || apiErr.Message != sensitiveMessage ||
		apiErr.RequestID != "req-7" {
		t.Fatalf("structured APIError metadata changed: %#v", apiErr)
	}
	if message, ok := SurfaceableMessage(err); !ok || message != sensitiveMessage {
		t.Fatalf("same-user correction message changed: ok=%v message=%q", ok, message)
	}
}

func TestUploadControlStrictModeRejectsDuplicateNon2xxEnvelope(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"error":{"code":"unknown","code":"upload_state_conflict","message":"upload state conflict"}}`))
	}))
	defer srv.Close()

	client := newTestClient(srv.URL)
	_, strictErr := client.doJSONWithMetaOptions(
		context.Background(), http.MethodPost, "/v1/files", nil, nil, true,
	)
	if !errors.Is(strictErr, errDuplicateJSONKey) {
		t.Fatalf("strict upload error = %T %v, want duplicate-key rejection", strictErr, strictErr)
	}
	var strictAPIError *APIError
	if errors.As(strictErr, &strictAPIError) {
		t.Fatalf("strict upload error was decoded before duplicate validation: %#v", strictAPIError)
	}

	_, nonUploadErr := client.doJSONWithMetaOptions(
		context.Background(), http.MethodPost, "/v1/agents/analyst/runs", nil, nil, true,
	)
	var nonUploadAPIError *APIError
	if !errors.As(nonUploadErr, &nonUploadAPIError) || nonUploadAPIError.Code != "upload_state_conflict" {
		t.Fatalf("non-upload error behavior changed: %T %#v", nonUploadErr, nonUploadErr)
	}
}

func TestChatCompletionClientsDropObsoleteDatasetDescriptionAcrossRequestPaths(t *testing.T) {
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode %s request: %v", r.URL.Path, err)
			return
		}
		if _, leaked := body["dataset_description"]; leaked {
			t.Errorf("%s leaked obsolete dataset_description: %#v", r.URL.Path, body)
		}
		if body["owner_subject"] != "alice@example.com" {
			t.Errorf("%s owner_subject=%v, want authenticated owner", r.URL.Path, body["owner_subject"])
		}
		switch r.URL.Path {
		case "/v1/chat/completions":
			if body["stream"] == true {
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = w.Write([]byte("event: RunFinished\\ndata: {\\\"type\\\":\\\"RunFinished\\\"}\\n\\n"))
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"chat","object":"chat.completion","choices":[],"formatted":{}}`))
		case "/v1/agents/data/runs", "/v1/query/route":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"run","run_id":"run","object":"agent.run","agent":"data","status":"succeeded","task_ids":[],"result":{}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	client := newTestClient(srv.URL)
	var chat ChatCompletionRequest
	if err := json.Unmarshal([]byte(`{"model":"phyto-chat","messages":[{"role":"user","content":"analyze"}],"attachments":[{"asset_id":"file_chat"}],"owner_subject":"alice@example.com","dataset_description":"obsolete"}`), &chat); err != nil {
		t.Fatalf("decode crafted chat request: %v", err)
	}
	if _, err := client.ChatCompletion(context.Background(), chat); err != nil {
		t.Fatalf("ChatCompletion: %v", err)
	}
	stream, err := client.ChatCompletionStream(context.Background(), chat)
	if err != nil {
		t.Fatalf("ChatCompletionStream: %v", err)
	}
	_ = stream.Close()
	var agent AgentRunRequest
	if err := json.Unmarshal([]byte(`{"arguments":{"user_query":"analyze","gene_id":"AT1G01010"},"attachments":[{"asset_id":"file_agent"}],"owner_subject":"alice@example.com","dataset_description":"obsolete"}`), &agent); err != nil {
		t.Fatalf("decode crafted agent request: %v", err)
	}
	if _, err := client.InvokeAgent(context.Background(), "data", agent); err != nil {
		t.Fatalf("InvokeAgent: %v", err)
	}
	var route RouteQueryRequest
	if err := json.Unmarshal([]byte(`{"user_query":"analyze","attachments":[{"asset_id":"file_route"}],"owner_subject":"alice@example.com","allowed_tools":["ChatAgent","DataAgent"],"forced_tool":null,"dataset_description":"obsolete"}`), &route); err != nil {
		t.Fatalf("decode crafted route request: %v", err)
	}
	if _, err := client.RouteQuery(context.Background(), route); err != nil {
		t.Fatalf("RouteQuery: %v", err)
	}
	if got := strings.Join(paths, ","); got != "/v1/chat/completions,/v1/chat/completions,/v1/agents/data/runs,/v1/query/route" {
		t.Fatalf("request paths=%q", got)
	}
}

func TestChatCompletionRejectsMismatchedContextTurn(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"conversation_context":{"schema_version":1,"turn_id":"8","selected_agent_id":"ChatAgent","route_source":"instant_lock","route_reason_code":"INSTANT_LOCK","base_business_context_version":0,"proposed_business_context_version":1,"last_applied_ledger_cursor":6,"context_truncated":false,"context_rebuilt":false,"context_degraded":false}}`))
	}))
	defer srv.Close()
	envelope := validConversationEnvelope()
	envelope.Mode = "instant"
	envelope.RequestedAgentID = nil
	envelope.AllowedAgentIDs = []string{"ChatAgent"}
	_, err := newTestClient(srv.URL).ChatCompletion(context.Background(), ChatCompletionRequest{Model: "phyto-chat", Conversation: &envelope})
	if err == nil || !contains(err.Error(), "turn_id") {
		t.Fatalf("mismatched response turn was accepted: %v", err)
	}
}

func TestInvokeAgentForwardsConversationAndValidatesContext(t *testing.T) {
	envelope := validConversationEnvelope()
	var captured AgentRunRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Errorf("decode agent request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id":"run-data","object":"agent.run","agent":"data","status":"succeeded","task_ids":[],
			"result":{"formatted":{"answer":"ok"}},
			"conversation_context":{
				"schema_version":1,"turn_id":"7","selected_agent_id":"DataAgent",
				"route_source":"explicit_selection","route_reason_code":"EXPLICIT_SELECTION",
				"base_business_context_version":2,"proposed_business_context_version":3,
				"last_applied_ledger_cursor":6,"context_truncated":false,
				"context_rebuilt":false,"context_degraded":false
			}
		}`))
	}))
	defer srv.Close()

	response, err := newTestClient(srv.URL).InvokeAgent(
		context.Background(),
		"data",
		AgentRunRequest{
			Arguments:    map[string]interface{}{"user_query": "next"},
			DialogueID:   envelope.DialogueID,
			Conversation: &envelope,
		},
	)
	if err != nil {
		t.Fatalf("InvokeAgent: %v", err)
	}
	if captured.Conversation == nil || captured.Conversation.TurnID != envelope.TurnID {
		t.Fatalf("conversation envelope=%#v", captured.Conversation)
	}
	if response.ConversationContext == nil || response.ConversationContext.SelectedAgentID != "DataAgent" {
		t.Fatalf("conversation context=%#v", response.ConversationContext)
	}
}

func TestInvokeAgentRejectsMismatchedContextTurn(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id":"run-data","object":"agent.run","agent":"data","status":"succeeded","task_ids":[],
			"conversation_context":{
				"schema_version":1,"turn_id":"8","selected_agent_id":"DataAgent",
				"route_source":"explicit_selection","route_reason_code":"EXPLICIT_SELECTION",
				"base_business_context_version":2,"proposed_business_context_version":3,
				"last_applied_ledger_cursor":6,"context_truncated":false,
				"context_rebuilt":false,"context_degraded":false
			}
		}`))
	}))
	defer srv.Close()
	envelope := validConversationEnvelope()
	_, err := newTestClient(srv.URL).InvokeAgent(
		context.Background(),
		"data",
		AgentRunRequest{Arguments: map[string]interface{}{}, Conversation: &envelope},
	)
	if err == nil || !contains(err.Error(), "turn_id") {
		t.Fatalf("mismatched response turn was accepted: %v", err)
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

func TestInvokeAgentRejectsDuplicateRunIdentityKeys(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"run-first","id":"run-last","object":"agent.run","agent":"analyst","status":"running","task_ids":["task-1"],"result":{}}`))
	}))
	defer srv.Close()

	response, err := newTestClient(srv.URL).InvokeAgent(
		context.Background(),
		"analyst",
		AgentRunRequest{Arguments: map[string]interface{}{"user_query": "x"}},
	)
	if err == nil {
		t.Fatalf("InvokeAgent accepted duplicate identity keys: %#v", response)
	}
	if !errors.Is(err, errDuplicateJSONKey) {
		t.Fatalf("InvokeAgent error = %T %v, want errDuplicateJSONKey", err, err)
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

func TestSurfaceableMessage(t *testing.T) {
	// 4xx (except auth) with a message → surface it.
	if msg, ok := SurfaceableMessage(&APIError{Status: 400, Message: "cannot parse gene"}); !ok || msg != "cannot parse gene" {
		t.Errorf("400 should surface: ok=%v msg=%q", ok, msg)
	}
	if _, ok := SurfaceableMessage(&APIError{Status: 413, Message: "too big"}); !ok {
		t.Error("413 should surface")
	}
	// auth + server errors → not surfaced (avoid bouncing the user to login / leaking internals).
	if _, ok := SurfaceableMessage(&APIError{Status: 401, Message: "unauthorized"}); ok {
		t.Error("401 must NOT surface")
	}
	if _, ok := SurfaceableMessage(&APIError{Status: 403, Message: "forbidden"}); ok {
		t.Error("403 must NOT surface")
	}
	if _, ok := SurfaceableMessage(&APIError{Status: 500, Message: "boom"}); ok {
		t.Error("500 must NOT surface")
	}
	// no envelope message, or a non-APIError → not surfaced.
	if _, ok := SurfaceableMessage(&APIError{Status: 400, Message: ""}); ok {
		t.Error("empty message must NOT surface")
	}
	if _, ok := SurfaceableMessage(errors.New("plain")); ok {
		t.Error("non-APIError must NOT surface")
	}
}

func TestAPIErrorErrorEmitsOnlyLocalTextAndStatus(t *testing.T) {
	const sensitiveMessage = "PAPER_PROMPT_MARKER path=/private/papers/study.pdf prompt=extract-all"
	const methodMarker = "METHOD_MARKER\r\nforged-log-line"
	const pathMarker = "PATH_MARKER\t/private/papers/study.pdf"
	const stageMarker = "STAGE_MARKER\nresolver-detail"
	const requestIDMarker = "REQUEST_ID_MARKER\rforged-correlation"
	oversizedCode := "CODE_MARKER\n" + strings.Repeat("untrusted-code", 256)
	err := &APIError{
		Method:    methodMarker,
		Path:      pathMarker,
		Status:    http.StatusUnprocessableEntity,
		Code:      oversizedCode,
		Message:   sensitiveMessage,
		Stage:     stageMarker,
		Retryable: true,
		RequestID: requestIDMarker,
	}

	for name, tc := range map[string]struct {
		got  string
		want string
	}{
		"direct": {
			got:  err.Error(),
			want: "bot request failed: status 422",
		},
		"wrapped": {
			got:  fmt.Errorf("submit research: %w", err).Error(),
			want: "submit research: bot request failed: status 422",
		},
	} {
		t.Run(name, func(t *testing.T) {
			for _, marker := range []string{
				"METHOD_MARKER", "PATH_MARKER", "CODE_MARKER", "STAGE_MARKER",
				"REQUEST_ID_MARKER", "PAPER_PROMPT_MARKER", "forged-log-line",
			} {
				if contains(tc.got, marker) {
					t.Fatalf("error leaked untrusted marker %q: %q", marker, tc.got)
				}
			}
			if tc.got != tc.want {
				t.Errorf("error = %q, want %q", tc.got, tc.want)
			}
		})
	}
}

func TestAPIErrorErrorRedactsShortAndLongRawBodies(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{name: "short", body: "RAW_PAPER_PATH_MARKER=/private/papers/short.pdf"},
		{name: "long", body: "RAW_LONG_PROMPT_MARKER=" + strings.Repeat("secret-paper-content", 100)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := botError("GET", "/v1/runs", http.StatusInternalServerError, []byte(tt.body))
			for name, tc := range map[string]struct {
				got  string
				want string
			}{
				"direct": {
					got:  err.Error(),
					want: "bot request failed: status 500",
				},
				"wrapped": {
					got:  fmt.Errorf("poll research: %w", err).Error(),
					want: "poll research: bot request failed: status 500",
				},
			} {
				t.Run(name, func(t *testing.T) {
					if contains(tc.got, tt.body) || contains(tc.got, "RAW_PAPER_PATH_MARKER") || contains(tc.got, "RAW_LONG_PROMPT_MARKER") {
						t.Fatalf("error leaked raw Bot body: %q", tc.got)
					}
					if tc.got != tc.want {
						t.Errorf("error = %q, want %q", tc.got, tc.want)
					}
				})
			}
		})
	}
}

func TestBotErrorIsTyped(t *testing.T) {
	err := botError("POST", "/v1/agents/deep_genome/runs", 400,
		[]byte(`{"error":{"type":"invalid","code":400,"message":"cannot parse gene","request_id":"r1"}}`))
	var ae *APIError
	if !errors.As(err, &ae) {
		t.Fatalf("botError should return *APIError, got %T", err)
	}
	if ae.Status != 400 || ae.Message != "cannot parse gene" || ae.RequestID != "r1" {
		t.Errorf("APIError fields wrong: %+v", ae)
	}
}

func TestDoJSON_WrapsTimeoutAsErrBotTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond) // longer than the client timeout, to force a real client-timeout error
	}))
	defer srv.Close()
	c := &Client{
		http:    &http.Client{Timeout: 20 * time.Millisecond},
		baseURL: srv.URL,
		userKey: "ptm_test",
	}
	err := c.doJSON(context.Background(), http.MethodGet, "/v1/agents", nil, nil)
	if !errors.Is(err, ErrBotTimeout) {
		t.Fatalf("err = %v, want wrapped ErrBotTimeout", err)
	}
}

func TestChatCompletionWrapperPreservesTimeoutContract(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
	}))
	defer srv.Close()

	c := newTestClient(srv.URL)
	c.http = &http.Client{Timeout: 20 * time.Millisecond}
	response, err := c.ChatCompletion(context.Background(), ChatCompletionRequest{})
	if response != nil {
		t.Fatalf("response=%#v, want nil on timeout", response)
	}
	if err == nil || !errors.Is(err, ErrBotTimeout) {
		t.Fatalf("err=%v, want wrapped ErrBotTimeout", err)
	}
}

func TestNewClientWithTimeoutUsesExplicitDuration(t *testing.T) {
	previous := BotConfig
	BotConfig = &Config{
		BaseURL:        "http://bot.test",
		UserAPIKey:     "ptm_test",
		TimeoutSeconds: 17,
	}
	t.Cleanup(func() { BotConfig = previous })

	client := NewClientWithTimeout(125 * time.Millisecond)
	if got := client.http.Timeout; got != 125*time.Millisecond {
		t.Fatalf("explicit timeout=%s, want 125ms", got)
	}
}

func TestNewClientUsesGlobalTimeout(t *testing.T) {
	previous := BotConfig
	BotConfig = &Config{
		BaseURL:        "http://bot.test",
		UserAPIKey:     "ptm_test",
		TimeoutSeconds: 17,
	}
	t.Cleanup(func() { BotConfig = previous })

	client := NewClient()
	if got := client.http.Timeout; got != 17*time.Second {
		t.Fatalf("global timeout=%s, want 17s", got)
	}
}
