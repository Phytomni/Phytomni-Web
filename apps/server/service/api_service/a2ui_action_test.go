package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

const validA2uiActionBody = `{"surface_id":"surface-1","widget":"confirm","action_id":"submit","run_id":"run-1","payload":{"accepted":true}}`

func TestDecodeA2uiSurfaceStrictBounds(t *testing.T) {
	base := `{"catalog_version":"v1.0","surface_id":"surface-1","widget":"confirm","props":{"title":"Approve","confirm_label":"Yes","cancel_label":"No"}}`
	tests := []struct {
		name string
		raw  string
		want bool
	}{
		{name: "valid", raw: base, want: true},
		{name: "minimal confirm", raw: `{"catalog_version":"v1.0","surface_id":"surface-1","widget":"confirm","props":{"title":"Approve"}}`, want: true},
		{name: "null optional confirm fields", raw: `{"catalog_version":"v1.0","surface_id":"surface-1","widget":"confirm","props":{"title":"Approve","body":null,"confirm_label":null,"cancel_label":null}}`, want: true},
		{name: "blank optional labels", raw: `{"catalog_version":"v1.0","surface_id":"surface-1","widget":"confirm","props":{"title":"Approve","confirm_label":"  ","cancel_label":""}}`, want: true},
		{name: "wrong optional label type", raw: `{"catalog_version":"v1.0","surface_id":"surface-1","widget":"confirm","props":{"title":"Approve","confirm_label":true}}`},
		{name: "unknown confirm key", raw: `{"catalog_version":"v1.0","surface_id":"surface-1","widget":"confirm","props":{"title":"Approve","onclick":"x"}}`},
		{name: "duplicate surface key", raw: `{"catalog_version":"v1.0","surface_id":"surface-1","surface_id":"surface-2","widget":"confirm","props":{"title":"Approve","confirm_label":"Yes","cancel_label":"No"}}`},
		{name: "unsupported widget", raw: `{"catalog_version":"v1.0","surface_id":"surface-1","widget":"button","props":{"title":"Approve"}}`},
		{name: "overlong title", raw: `{"catalog_version":"v1.0","surface_id":"surface-1","widget":"confirm","props":{"title":"` + strings.Repeat("x", a2uiLabelMaxChars+1) + `","confirm_label":"Yes","cancel_label":"No"}}`},
		{name: "duplicate choice id", raw: `{"catalog_version":"v1.0","surface_id":"surface-1","widget":"choice","props":{"title":"Choose","options":[{"id":"a","label":"A"},{"id":"a","label":"Again"}],"multiple":false}}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := DecodeA2uiSurface(json.RawMessage(tt.raw))
			if tt.want {
				if err != nil || got == nil {
					t.Fatalf("DecodeA2uiSurface: got=%#v err=%v", got, err)
				}
				return
			}
			if err == nil || got != nil {
				t.Fatalf("DecodeA2uiSurface accepted malformed surface: got=%#v err=%v", got, err)
			}
		})
	}
}

func TestA2uiAction_EnvelopeStrictDecode(t *testing.T) {
	validID := strings.Repeat("界", a2uiIdentifierMaxChars)
	validBoundaryBody := `{"surface_id":"` + validID + `","widget":"confirm","action_id":"submit","run_id":"run-1","payload":{}}`

	tests := []struct {
		name string
		body string
		want bool
	}{
		{name: "confirm", body: validA2uiActionBody, want: true},
		{name: "form", body: `{"surface_id":"s1","widget":"form","action_id":"submit","run_id":"run-1","payload":{"fields":{}}}`, want: true},
		{name: "choice", body: `{"surface_id":"s1","widget":"choice","action_id":"submit","run_id":"run-1","payload":{"selected":"a"}}`, want: true},
		{name: "identifier upper boundary", body: validBoundaryBody, want: true},
		{name: "missing surface id", body: `{"widget":"confirm","action_id":"submit","run_id":"run-1","payload":{}}`, want: false},
		{name: "missing payload", body: `{"surface_id":"s1","widget":"confirm","action_id":"submit","run_id":"run-1"}`, want: false},
		{name: "unknown top level field", body: `{"surface_id":"s1","widget":"confirm","action_id":"submit","run_id":"run-1","payload":{},"extra":1}`, want: false},
		{name: "duplicate top level field", body: `{"surface_id":"s1","widget":"confirm","action_id":"submit","run_id":"run-1","run_id":"run-1","payload":{}}`, want: false},
		{name: "concatenated values", body: validA2uiActionBody + `{}`, want: false},
		{name: "trailing non-whitespace", body: validA2uiActionBody + ` trailing`, want: false},
		{name: "trimmed surface id required", body: `{"surface_id":" s1","widget":"confirm","action_id":"submit","run_id":"run-1","payload":{}}`, want: false},
		{name: "trimmed action id required", body: `{"surface_id":"s1","widget":"confirm","action_id":"submit ","run_id":"run-1","payload":{}}`, want: false},
		{name: "trimmed run id required", body: `{"surface_id":"s1","widget":"confirm","action_id":"submit","run_id":"\trun-1","payload":{}}`, want: false},
		{name: "empty identifier", body: `{"surface_id":"","widget":"confirm","action_id":"submit","run_id":"run-1","payload":{}}`, want: false},
		{name: "overlong identifier", body: `{"surface_id":"` + strings.Repeat("界", a2uiIdentifierMaxChars+1) + `","widget":"confirm","action_id":"submit","run_id":"run-1","payload":{}}`, want: false},
		{name: "unknown widget", body: `{"surface_id":"s1","widget":"button","action_id":"submit","run_id":"run-1","payload":{}}`, want: false},
		{name: "null payload", body: `{"surface_id":"s1","widget":"confirm","action_id":"submit","run_id":"run-1","payload":null}`, want: false},
		{name: "array payload", body: `{"surface_id":"s1","widget":"confirm","action_id":"submit","run_id":"run-1","payload":[]}`, want: false},
		{name: "scalar payload", body: `{"surface_id":"s1","widget":"confirm","action_id":"submit","run_id":"run-1","payload":true}`, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := decodeA2uiActionEnvelope([]byte(tt.body))
			if tt.want {
				if err != nil {
					t.Fatalf("decodeA2uiActionEnvelope: %v", err)
				}
				if got.SurfaceID == "" || got.Widget == "" || got.ActionID == "" || got.RunID == "" || len(got.Payload) == 0 {
					t.Fatalf("decoded envelope is incomplete: %+v", got)
				}
				return
			}
			if err == nil {
				t.Fatalf("decodeA2uiActionEnvelope(%q) succeeded: %+v", tt.body, got)
			}
		})
	}
}

func setupA2uiActionTest(t *testing.T) {
	t.Helper()
	gdb := setupTestDB(t)
	if err := gdb.Exec(`
		INSERT INTO question_agent_logs
			(dialogue_id, user_name, bot_run_id, query, answer, tool_name, status, created_at)
		VALUES
			('dlg-1', 'alice@x.com', 'run-1', 'q', 'a', 'chat', 'INPUT_REQUIRED', datetime('now'))
	`).Error; err != nil {
		t.Fatalf("seed question_agent_logs: %v", err)
	}
	t.Cleanup(func() { rxBot.BotConfig = nil })
}

func configureA2uiActionServer(
	t *testing.T,
	runID string,
	actionBody string,
) func() (int32, int32) {
	t.Helper()
	var actionCalls, runCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/runs/"+runID+"/a2ui-actions":
			actionCalls.Add(1)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(actionBody))
		case r.Method == http.MethodGet:
			runCalls.Add(1)
			http.Error(w, "A2UI compatibility uplink must not fetch runs", http.StatusInternalServerError)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true,
		UserAPIKey: "test-user-key", TimeoutSeconds: 5,
	}
	return func() (int32, int32) { return actionCalls.Load(), runCalls.Load() }
}

func loadA2uiActionRow(t *testing.T) model.QuestionAgentLog {
	t.Helper()
	var row model.QuestionAgentLog
	if err := model.Default().
		Where("dialogue_id = ? AND user_name = ?", "dlg-1", "alice@x.com").
		First(&row).Error; err != nil {
		t.Fatalf("load A2UI action row: %v", err)
	}
	return row
}

func assertA2uiDurableRowUnchanged(t *testing.T, before model.QuestionAgentLog) {
	t.Helper()
	after := loadA2uiActionRow(t)
	if after.Id != before.Id ||
		after.Query != before.Query ||
		after.Answer != before.Answer ||
		after.Status != before.Status ||
		after.ToolName != before.ToolName ||
		after.BotRunId != before.BotRunId ||
		after.BotProjectionJSON != before.BotProjectionJSON ||
		after.BotReportRevision != before.BotReportRevision {
		t.Fatalf("A2UI command mutated durable projection: before=%#v after=%#v", before, after)
	}
}

func TestA2uiAction_NormalizesReviewedReferencesWithoutProjectionWrite(t *testing.T) {
	setupA2uiActionTest(t)
	before := loadA2uiActionRow(t)
	content, references, canonical := reviewedCitationFixture(t)
	response, err := json.Marshal(map[string]any{
		"status":          "succeeded",
		"run_id":          "run-1",
		"report_revision": json.RawMessage("9007199254740993"),
		"result": map[string]any{
			"a2ui": map[string]any{"widget": "confirm"},
			"formatted": map[string]any{
				"answer":     content,
				"references": references,
				"extension":  json.RawMessage("9007199254740993"),
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	calls := configureA2uiActionServer(t, "run-1", string(response))

	outcome, err := NewService().A2uiAction(
		context.Background(), "alice@x.com", "dlg-1", []byte(validA2uiActionBody),
	)
	if err != nil || outcome == nil || outcome.Status != http.StatusOK {
		t.Fatalf("reviewed action outcome=%+v error=%v", outcome, err)
	}
	actionCalls, runCalls := calls()
	if actionCalls != 1 || runCalls != 0 {
		t.Fatalf("A2UI compatibility uplink calls: action=%d run=%d, want 1/0", actionCalls, runCalls)
	}

	var returned struct {
		RunID          string          `json:"run_id"`
		ReportRevision json.RawMessage `json:"report_revision"`
		Result         struct {
			A2UI      json.RawMessage `json:"a2ui"`
			Formatted struct {
				Answer     string          `json:"answer"`
				References json.RawMessage `json:"references"`
				Extension  json.RawMessage `json:"extension"`
			} `json:"formatted"`
		} `json:"result"`
	}
	if err := json.Unmarshal(outcome.Body, &returned); err != nil {
		t.Fatal(err)
	}
	var gotReferences, wantReferences any
	if err := json.Unmarshal(returned.Result.Formatted.References, &gotReferences); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(canonical, &wantReferences); err != nil {
		t.Fatal(err)
	}
	if returned.RunID != "run-1" ||
		string(returned.ReportRevision) != "9007199254740993" ||
		returned.Result.Formatted.Answer != content ||
		string(returned.Result.Formatted.Extension) != "9007199254740993" ||
		!reflect.DeepEqual(gotReferences, wantReferences) ||
		!strings.Contains(string(returned.Result.A2UI), `"widget":"confirm"`) {
		t.Fatalf("normalized action response drift: %s", outcome.Body)
	}
	assertA2uiDurableRowUnchanged(t, before)
}

func TestA2uiAction_MalformedReferencesFailClosedWithoutProjectionWrite(t *testing.T) {
	setupA2uiActionTest(t)
	before := loadA2uiActionRow(t)
	response := `{"status":"succeeded","result":{"a2ui":{},"formatted":{"answer":"body [1]","references":"private invalid root"}}}`
	calls := configureA2uiActionServer(t, "run-1", response)

	outcome, err := NewService().A2uiAction(
		context.Background(), "alice@x.com", "dlg-1", []byte(validA2uiActionBody),
	)
	if outcome != nil || !errors.Is(err, ErrA2uiUpstreamProtocol) {
		t.Fatalf("malformed references outcome=%+v error=%v", outcome, err)
	}
	if strings.Contains(err.Error(), "private") {
		t.Fatalf("protocol error leaked malformed reference payload: %v", err)
	}
	actionCalls, runCalls := calls()
	if actionCalls != 1 || runCalls != 0 {
		t.Fatalf("malformed references retried/fetched run: action=%d run=%d", actionCalls, runCalls)
	}
	assertA2uiDurableRowUnchanged(t, before)
}

func TestA2uiAction_PreservesReferenceSlotsWithoutProjectionWrite(t *testing.T) {
	setupA2uiActionTest(t)
	before := loadA2uiActionRow(t)
	response := `{"status":"succeeded","result":{"a2ui":{},"formatted":{"answer":"body [3]","references":[{"title":"First"},null,{"title":"Third"}]}}}`
	calls := configureA2uiActionServer(t, "run-1", response)

	outcome, err := NewService().A2uiAction(
		context.Background(), "alice@x.com", "dlg-1", []byte(validA2uiActionBody),
	)
	if err != nil || outcome == nil {
		t.Fatalf("slot-preserving action outcome=%+v error=%v", outcome, err)
	}
	actionCalls, runCalls := calls()
	if actionCalls != 1 || runCalls != 0 {
		t.Fatalf("slot-preserving action fetched run: action=%d run=%d", actionCalls, runCalls)
	}

	var returned struct {
		Result struct {
			Formatted struct {
				Answer     string            `json:"answer"`
				References []json.RawMessage `json:"references"`
			} `json:"formatted"`
		} `json:"result"`
	}
	if err := json.Unmarshal(outcome.Body, &returned); err != nil {
		t.Fatal(err)
	}
	refs := returned.Result.Formatted.References
	if returned.Result.Formatted.Answer != "body [3]" ||
		len(refs) != 3 ||
		!strings.Contains(string(refs[0]), `"title":"First"`) ||
		!strings.Contains(string(refs[0]), `"citation"`) ||
		!strings.Contains(string(refs[1]), "Reference details unavailable.") ||
		!strings.Contains(string(refs[2]), `"title":"Third"`) ||
		!strings.Contains(string(refs[2]), `"citation"`) {
		t.Fatalf("reference slots shifted or lost canonical presentation: %s", outcome.Body)
	}
	assertA2uiDurableRowUnchanged(t, before)
}

func TestA2uiAction_PrivateReplacementRunIsAuthorizedAndOldPublicRunIsRetired(t *testing.T) {
	setupA2uiActionTest(t)
	gdb := model.Default()
	raw := `{"run_id":"run-1","agent":"review","status":"SUCCEEDED","report_revision":0,"conversation_context":{"client_turn_id":"a2ui-base-key","request_fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","replacement":{"client_turn_id":"a2ui-replacement-key","request_fingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","query":"replacement review","tool_name":"ReviewAgent","mode":"expert","active_status":"INPUT_REQUIRED","active_bot_run_id":"run-private-a2ui","active_a2ui":{"catalog_version":"v1.0","surface_id":"surface-private","widget":"confirm","props":{"title":"Approve replacement"}}}}}`
	if err := gdb.Model(&model.QuestionAgentLog{}).
		Where("dialogue_id = ? AND user_name = ?", "dlg-1", "alice@x.com").
		Updates(map[string]interface{}{
			"status": "SUCCEEDED", "bot_projection_json": raw,
			"bot_report_revision": 0,
		}).Error; err != nil {
		t.Fatal(err)
	}
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/problem+json")
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"error":"surface accepted"}`))
	}))
	t.Cleanup(server.Close)
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true,
		UserAPIKey: "test-user-key", TimeoutSeconds: 2,
	}

	privateBody := []byte(`{"surface_id":"surface-private","widget":"confirm","action_id":"submit","run_id":"run-private-a2ui","payload":{"accepted":true}}`)
	outcome, err := NewService().A2uiAction(context.Background(), "alice@x.com", "dlg-1", privateBody)
	if err != nil || outcome == nil || outcome.Status != http.StatusConflict {
		t.Fatalf("private replacement A2UI outcome=%+v error=%v", outcome, err)
	}
	if hits.Load() != 1 {
		t.Fatalf("private replacement A2UI Bot hits=%d, want 1", hits.Load())
	}
	oldBody := []byte(`{"surface_id":"surface-private","widget":"confirm","action_id":"submit","run_id":"run-1","payload":{"accepted":true}}`)
	if outcome, err := NewService().A2uiAction(context.Background(), "alice@x.com", "dlg-1", oldBody); outcome != nil || !errors.Is(err, ErrA2uiActionNotFound) {
		t.Fatalf("old public run during private replacement outcome=%+v error=%v, want not found", outcome, err)
	}
	if outcome, err := NewService().A2uiAction(context.Background(), "mallory@x.com", "dlg-1", privateBody); outcome != nil || !errors.Is(err, ErrA2uiActionNotFound) {
		t.Fatalf("cross-owner private replacement outcome=%+v error=%v, want not found", outcome, err)
	}
	if hits.Load() != 1 {
		t.Fatalf("retired/cross-owner A2UI called Bot: hits=%d", hits.Load())
	}
}

func TestA2uiAction_OwnershipMiss404(t *testing.T) {
	tests := []struct {
		name     string
		username string
		body     string
	}{
		{name: "wrong owner", username: "bob@x.com", body: validA2uiActionBody},
		{
			name:     "wrong run",
			username: "alice@x.com",
			body:     `{"surface_id":"surface-1","widget":"confirm","action_id":"submit","run_id":"run-2","payload":{"accepted":true}}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setupA2uiActionTest(t)
			rxBot.BotConfig = &rxBot.Config{ProxyEnabled: true}

			outcome, err := (&Service{}).A2uiAction(
				context.Background(), tt.username, "dlg-1", []byte(tt.body),
			)

			if outcome != nil {
				t.Fatalf("outcome = %#v, want nil", outcome)
			}
			if !errors.Is(err, ErrA2uiActionNotFound) {
				t.Fatalf("error = %v, want ErrA2uiActionNotFound", err)
			}
		})
	}
}

func TestA2uiAction_RunMismatchDoesNotCallBot(t *testing.T) {
	setupA2uiActionTest(t)
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{
		ProxyEnabled:   true,
		BaseURL:        srv.URL,
		UserAPIKey:     "test-user-key",
		TimeoutSeconds: 5,
	}

	outcome, err := (&Service{}).A2uiAction(
		context.Background(), "alice@x.com", "dlg-1",
		[]byte(`{"surface_id":"surface-1","widget":"confirm","action_id":"submit","run_id":"run-mismatch","payload":{"accepted":true}}`),
	)

	if outcome != nil {
		t.Fatalf("outcome = %#v, want nil", outcome)
	}
	if !errors.Is(err, ErrA2uiActionNotFound) {
		t.Fatalf("error = %v, want ErrA2uiActionNotFound", err)
	}
	if got := hits.Load(); got != 0 {
		t.Fatalf("Bot hits = %d, want 0", got)
	}
}

func TestA2uiAction_ProxyDisabled503(t *testing.T) {
	setupA2uiActionTest(t)
	rxBot.BotConfig = &rxBot.Config{
		ProxyEnabled: false,
	}

	outcome, err := (&Service{}).A2uiAction(
		context.Background(), "alice@x.com", "dlg-1", []byte(validA2uiActionBody),
	)

	if outcome != nil {
		t.Fatalf("outcome = %#v, want nil", outcome)
	}
	if !errors.Is(err, ErrGatewayDisabled) {
		t.Fatalf("error = %v, want ErrGatewayDisabled", err)
	}
}

func TestA2uiAction_FlagOnPassthrough(t *testing.T) {
	setupA2uiActionTest(t)
	before := loadA2uiActionRow(t)
	var receivedPath string
	var receivedBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedPath = r.URL.Path
		raw, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read request body: %v", err)
		}
		receivedBody = string(raw)
		w.Header().Set("Content-Type", "application/problem+json")
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"error":"surface expired"}`))
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{
		ProxyEnabled:   true,
		BaseURL:        srv.URL,
		UserAPIKey:     "test-user-key",
		TimeoutSeconds: 5,
	}

	outcome, err := (&Service{}).A2uiAction(
		context.Background(), "alice@x.com", "dlg-1", []byte(validA2uiActionBody),
	)

	if err != nil {
		t.Fatalf("A2uiAction: %v", err)
	}
	if outcome.Status != http.StatusConflict {
		t.Fatalf("status = %d, want 409", outcome.Status)
	}
	if string(outcome.Body) != `{"error":"surface expired"}` {
		t.Fatalf("body = %q", outcome.Body)
	}
	if outcome.ContentType != "application/problem+json" {
		t.Fatalf("content type = %q", outcome.ContentType)
	}
	if !strings.HasSuffix(receivedPath, "/a2ui-actions") {
		t.Fatalf("path = %q, want suffix /a2ui-actions", receivedPath)
	}
	if receivedPath != "/v1/runs/run-1/a2ui-actions" {
		t.Fatalf("path = %q, want /v1/runs/run-1/a2ui-actions", receivedPath)
	}
	if receivedBody != validA2uiActionBody {
		t.Fatalf("forwarded body = %q, want raw body %q", receivedBody, validA2uiActionBody)
	}
	after := loadA2uiActionRow(t)
	if after.Status != before.Status || after.Answer != before.Answer ||
		after.BotRunId != before.BotRunId || after.BotProjectionJSON != before.BotProjectionJSON {
		t.Fatalf("non-2xx passthrough mutated durable row: before=%#v after=%#v", before, after)
	}
}

func TestA2uiAction_UpstreamValidation(t *testing.T) {
	const succeeded = `{"status":"succeeded","result":{"a2ui":{}}}`
	const inputRequired = `{"status":"input_required","interrupt":{"draft":{"a2ui":{}}}}`

	tests := []struct {
		name        string
		status      int
		contentType string
		body        string
		wantErr     error
		wantBody    string
		wantType    string
	}{
		{name: "application json succeeded", status: http.StatusOK, contentType: "application/json", body: succeeded, wantBody: succeeded, wantType: "application/json"},
		{name: "vendor json input required", status: http.StatusAccepted, contentType: "application/vnd.phytomni+json", body: inputRequired, wantBody: inputRequired, wantType: "application/vnd.phytomni+json"},
		{name: "missing content type", status: http.StatusOK, body: succeeded, wantErr: ErrA2uiUpstreamProtocol},
		{name: "invalid content type", status: http.StatusOK, contentType: "application/json; charset=\"", body: succeeded, wantErr: ErrA2uiUpstreamProtocol},
		{name: "text html content type", status: http.StatusOK, contentType: "text/html", body: succeeded, wantErr: ErrA2uiUpstreamProtocol},
		{name: "empty body", status: http.StatusOK, contentType: "application/json", wantErr: ErrA2uiUpstreamProtocol},
		{name: "malformed body", status: http.StatusOK, contentType: "application/json", body: `{"status":"succeeded"`, wantErr: ErrA2uiUpstreamProtocol},
		{name: "array body", status: http.StatusOK, contentType: "application/json", body: `[]`, wantErr: ErrA2uiUpstreamProtocol},
		{name: "scalar body", status: http.StatusOK, contentType: "application/json", body: `true`, wantErr: ErrA2uiUpstreamProtocol},
		{name: "trailing value", status: http.StatusOK, contentType: "application/json", body: succeeded + ` {}`, wantErr: ErrA2uiUpstreamProtocol},
		{name: "succeeded missing result", status: http.StatusOK, contentType: "application/json", body: `{"status":"succeeded"}`, wantErr: ErrA2uiUpstreamProtocol},
		{name: "succeeded missing a2ui", status: http.StatusOK, contentType: "application/json", body: `{"status":"succeeded","result":{}}`, wantErr: ErrA2uiUpstreamProtocol},
		{name: "succeeded non object a2ui", status: http.StatusOK, contentType: "application/json", body: `{"status":"succeeded","result":{"a2ui":null}}`, wantErr: ErrA2uiUpstreamProtocol},
		{name: "input required missing interrupt", status: http.StatusOK, contentType: "application/json", body: `{"status":"input_required"}`, wantErr: ErrA2uiUpstreamProtocol},
		{name: "input required missing draft a2ui", status: http.StatusOK, contentType: "application/json", body: `{"status":"input_required","interrupt":{"draft":{}}}`, wantErr: ErrA2uiUpstreamProtocol},
		{name: "input required non object a2ui", status: http.StatusOK, contentType: "application/json", body: `{"status":"input_required","interrupt":{"draft":{"a2ui":[]}}}`, wantErr: ErrA2uiUpstreamProtocol},
		{name: "unknown success status", status: http.StatusOK, contentType: "application/json", body: `{"status":"queued"}`, wantErr: ErrA2uiUpstreamProtocol},
		{name: "non 2xx object pass through", status: http.StatusConflict, contentType: "application/problem+json", body: `{"error":"surface expired"}`, wantBody: `{"error":"surface expired"}`, wantType: "application/problem+json"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setupA2uiActionTest(t)
			before := loadA2uiActionRow(t)
			var runFetches atomic.Int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodGet {
					runFetches.Add(1)
					w.WriteHeader(http.StatusInternalServerError)
					return
				}
				if tt.contentType != "" {
					w.Header().Set("Content-Type", tt.contentType)
				}
				w.WriteHeader(tt.status)
				_, _ = w.Write([]byte(tt.body))
			}))
			t.Cleanup(srv.Close)
			rxBot.BotConfig = &rxBot.Config{
				ProxyEnabled: true, BaseURL: srv.URL,
				UserAPIKey: "test-user-key", TimeoutSeconds: 5,
			}

			outcome, err := (&Service{}).A2uiAction(
				context.Background(), "alice@x.com", "dlg-1", []byte(validA2uiActionBody),
			)
			if got := runFetches.Load(); got != 0 {
				t.Fatalf("authoritative run fetches=%d, want 0", got)
			}
			assertA2uiDurableRowUnchanged(t, before)
			if tt.wantErr != nil {
				if outcome != nil {
					t.Fatalf("outcome = %#v, want nil", outcome)
				}
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("error = %v, want %v", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("A2uiAction: %v", err)
			}
			if outcome.Status != tt.status {
				t.Fatalf("status = %d, want %d", outcome.Status, tt.status)
			}
			if outcome.ContentType != tt.wantType {
				t.Fatalf("content type = %q, want %q", outcome.ContentType, tt.wantType)
			}
			if string(outcome.Body) != tt.wantBody {
				t.Fatalf("body = %q, want %q", outcome.Body, tt.wantBody)
			}
		})
	}
}

func TestA2uiAction_UpstreamOversizeReturnsSentinel(t *testing.T) {
	setupA2uiActionTest(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"succeeded","result":{"a2ui":{}}}`))
		_, _ = w.Write(make([]byte, int(rxBot.A2uiActionMaxResponseBytes)))
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{
		ProxyEnabled: true, BaseURL: srv.URL,
		UserAPIKey: "test-user-key", TimeoutSeconds: 5,
	}

	outcome, err := (&Service{}).A2uiAction(
		context.Background(), "alice@x.com", "dlg-1", []byte(validA2uiActionBody),
	)
	if outcome != nil {
		t.Fatalf("outcome = %#v, want nil", outcome)
	}
	if !errors.Is(err, rxBot.ErrA2uiResponseTooLarge) {
		t.Fatalf("error = %v, want ErrA2uiResponseTooLarge", err)
	}
}

func TestA2uiAction_BadEnvelope(t *testing.T) {
	setupA2uiActionTest(t)
	rxBot.BotConfig = &rxBot.Config{ProxyEnabled: true}

	outcome, err := (&Service{}).A2uiAction(
		context.Background(),
		"alice@x.com",
		"dlg-1",
		[]byte(`{"surface_id":"surface-1","widget":"confirm","action_id":"submit","payload":{}}`),
	)

	if outcome != nil {
		t.Fatalf("outcome = %#v, want nil", outcome)
	}
	if !errors.Is(err, ErrA2uiActionBadRequest) {
		t.Fatalf("error = %v, want ErrA2uiActionBadRequest", err)
	}
}

func a2uiActionBody(widget, payload string) []byte {
	return []byte(`{"surface_id":"surface-1","widget":"` + widget + `","action_id":"submit","run_id":"run-1","payload":` + payload + `}`)
}

func TestValidateA2uiPayload_Matrix(t *testing.T) {
	valid := []struct {
		name    string
		widget  string
		payload string
	}{
		{name: "confirm true", widget: "confirm", payload: `{"accepted":true}`},
		{name: "confirm false", widget: "confirm", payload: `{"accepted":false}`},
		{name: "empty form", widget: "form", payload: `{"fields":{}}`},
		{name: "form cancellation", widget: "form", payload: `{"cancelled":true}`},
		{name: "form values", widget: "form", payload: `{"fields":{"name":"","count":1.25}}`},
		{name: "form field and value upper bounds", widget: "form", payload: `{"fields":{"` + strings.Repeat("界", a2uiIdentifierMaxChars) + `":"` + strings.Repeat("v", a2uiFormValueMaxChars) + `"}}`},
		{name: "form twenty fields", widget: "form", payload: `{"fields":{` + strings.Join(makeA2uiFields(a2uiFormFieldMaxCount), ",") + `}}`},
		{name: "choice single", widget: "choice", payload: `{"selected":"option-a"}`},
		{name: "choice upper bounds", widget: "choice", payload: `{"selected":"` + strings.Repeat("界", a2uiIdentifierMaxChars) + `"}`},
		{name: "choice multiple", widget: "choice", payload: `{"selected":["option-a","option-b"]}`},
		{name: "choice one hundred", widget: "choice", payload: `{"selected":[` + strings.Join(makeA2uiStrings(a2uiChoiceMaxCount), ",") + `]}`},
		{name: "choice cancellation", widget: "choice", payload: `{"cancelled":true}`},
	}
	for _, tt := range valid {
		t.Run(tt.name, func(t *testing.T) {
			if err := validateA2uiPayload(tt.widget, json.RawMessage(tt.payload)); err != nil {
				t.Fatalf("validateA2uiPayload: %v", err)
			}
		})
	}

	invalid := []struct {
		name    string
		widget  string
		payload string
		secret  string
	}{
		{name: "confirm missing accepted", widget: "confirm", payload: `{}`},
		{name: "confirm unknown key", widget: "confirm", payload: `{"accepted":true,"extra":"secret-confirm"}`, secret: "secret-confirm"},
		{name: "confirm duplicate accepted", widget: "confirm", payload: `{"accepted":true,"accepted":false}`},
		{name: "confirm non boolean", widget: "confirm", payload: `{"accepted":1}`},
		{name: "form unknown key", widget: "form", payload: `{"fields":{},"extra":"secret-form"}`, secret: "secret-form"},
		{name: "form cancelled false", widget: "form", payload: `{"cancelled":false}`},
		{name: "form cancelled with fields", widget: "form", payload: `{"cancelled":true,"fields":{}}`},
		{name: "form duplicate field", widget: "form", payload: `{"fields":{"name":"first","name":"second"}}`, secret: "second"},
		{name: "form nested value", widget: "form", payload: `{"fields":{"nested":{"secret":"nested"}}}`, secret: "nested"},
		{name: "form array value", widget: "form", payload: `{"fields":{"items":[1]}}`},
		{name: "form boolean value", widget: "form", payload: `{"fields":{"enabled":true}}`},
		{name: "form null value", widget: "form", payload: `{"fields":{"empty":null}}`},
		{name: "form unsafe field", widget: "form", payload: `{"fields":{"__proto__":"secret"}}`, secret: "secret"},
		{name: "form prototype field", widget: "form", payload: `{"fields":{"prototype":"secret"}}`, secret: "secret"},
		{name: "form constructor field", widget: "form", payload: `{"fields":{"constructor":"secret"}}`, secret: "secret"},
		{name: "form empty field name", widget: "form", payload: `{"fields":{"":"value"}}`},
		{name: "form overlong field name", widget: "form", payload: `{"fields":{"` + strings.Repeat("界", a2uiIdentifierMaxChars+1) + `":"value"}}`},
		{name: "form overlong value", widget: "form", payload: `{"fields":{"name":"` + strings.Repeat("v", 4097) + `"}}`},
		{name: "form too many fields", widget: "form", payload: `{"fields":{` + strings.Join(makeA2uiFields(21), ",") + `}}`},
		{name: "choice missing selected", widget: "choice", payload: `{}`},
		{name: "choice unknown key", widget: "choice", payload: `{"selected":"one","extra":"secret-choice"}`, secret: "secret-choice"},
		{name: "choice selected empty", widget: "choice", payload: `{"selected":""}`},
		{name: "choice selected overlong", widget: "choice", payload: `{"selected":"` + strings.Repeat("界", a2uiIdentifierMaxChars+1) + `"}`},
		{name: "choice selected empty array", widget: "choice", payload: `{"selected":[]}`},
		{name: "choice selected duplicate", widget: "choice", payload: `{"selected":["one","one"]}`},
		{name: "choice selected mixed types", widget: "choice", payload: `{"selected":["one",2]}`},
		{name: "choice selected too many", widget: "choice", payload: `{"selected":[` + strings.Join(makeA2uiStrings(101), ",") + `]}`},
		{name: "choice cancelled false", widget: "choice", payload: `{"cancelled":false}`},
		{name: "choice cancelled with selected", widget: "choice", payload: `{"cancelled":true,"selected":"one"}`},
	}

	for _, tt := range invalid {
		t.Run(tt.name, func(t *testing.T) {
			setupA2uiActionTest(t)
			var hits atomic.Int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				hits.Add(1)
				w.WriteHeader(http.StatusNoContent)
			}))
			t.Cleanup(srv.Close)
			rxBot.BotConfig = &rxBot.Config{
				ProxyEnabled: true, BaseURL: srv.URL,
				UserAPIKey: "test-user-key", TimeoutSeconds: 5,
			}

			outcome, err := (&Service{}).A2uiAction(
				context.Background(), "alice@x.com", "dlg-1", a2uiActionBody(tt.widget, tt.payload),
			)
			if outcome != nil {
				t.Fatalf("outcome = %#v, want nil", outcome)
			}
			if !errors.Is(err, ErrA2uiActionBadRequest) {
				t.Fatalf("error = %v, want ErrA2uiActionBadRequest", err)
			}
			if tt.secret != "" && strings.Contains(err.Error(), tt.secret) {
				t.Fatalf("error leaked submitted value %q: %v", tt.secret, err)
			}
			if got := hits.Load(); got != 0 {
				t.Fatalf("Bot hits = %d, want 0", got)
			}
		})
	}
}

func makeA2uiFields(count int) []string {
	fields := make([]string, count)
	for i := range fields {
		fields[i] = `"field-` + strconv.Itoa(i) + `":"value"`
	}
	return fields
}

func makeA2uiStrings(count int) []string {
	values := make([]string, count)
	for i := range values {
		values[i] = `"option-` + strconv.Itoa(i) + `"`
	}
	return values
}
