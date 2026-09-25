package bot

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestExecutionRuntimeV2TargetDeliveryUsesServiceScopedContent(t *testing.T) {
	t.Setenv("PHYTOMNI_BOT_SERVICE_TOKEN", "test-service-token")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Header.Get("X-Service-Token") != "test-service-token" || request.Header.Get("X-Phyto-Owner") != "alice" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch request.URL.Path {
		case "/v2/executions/turn-1/targets/artifact/artifact-report":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"schema_version":2,"execution_id":"turn-1","target":{"kind":"artifact","id":"artifact-report"},"resolution":"authorized","delivery_available":true,"name":"report.md","media_type":"text/markdown","size_bytes":12}`))
		case "/v2/executions/turn-1/targets/artifact/artifact-report/content":
			w.Header().Set("Content-Type", "text/markdown")
			w.Header().Set("Content-Disposition", `attachment; filename="report.md"`)
			_, _ = w.Write([]byte("hello report"))
		default:
			http.NotFound(w, request)
		}
	}))
	defer server.Close()
	client := &Client{http: server.Client(), baseURL: server.URL}

	resolution, _, err := client.ResolveExecutionTargetV2(context.Background(), "alice", "turn-1", "artifact", "artifact-report")
	if err != nil || !resolution.DeliveryAvailable || resolution.Name != "report.md" || resolution.MediaType != "text/markdown" || resolution.SizeBytes != 12 {
		t.Fatalf("resolution=%#v err=%v", resolution, err)
	}
	body, metadata, _, err := client.OpenExecutionTargetContentV2(context.Background(), "alice", "turn-1", "artifact", "artifact-report")
	if err != nil {
		t.Fatal(err)
	}
	defer body.Close()
	raw := new(strings.Builder)
	if _, err := io.Copy(raw, body); err != nil {
		t.Fatal(err)
	}
	if raw.String() != "hello report" || metadata.MediaType != "text/markdown" || metadata.FileName != "report.md" {
		t.Fatalf("body=%q metadata=%#v", raw.String(), metadata)
	}
}

func TestExecutionServiceAuthenticationPreflight(t *testing.T) {
	t.Setenv("PHYTOMNI_BOT_SERVICE_TOKEN", "test-service-token")
	t.Setenv("PHYTOMNI_API_SERVICE_TOKEN", "")

	t.Run("matching credential reaches owner-scoped not found", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
			if request.Header.Get("X-Service-Token") != "test-service-token" || request.Header.Get("X-Phyto-Owner") == "" {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			http.Error(w, "not found", http.StatusNotFound)
		}))
		defer server.Close()
		client := &Client{http: server.Client(), baseURL: server.URL}
		if err := client.ValidateExecutionServiceAuthentication(context.Background()); err != nil {
			t.Fatalf("matching credential preflight err=%v", err)
		}
	})

	t.Run("rejected credential fails preflight", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
		}))
		defer server.Close()
		client := &Client{http: server.Client(), baseURL: server.URL}
		err := client.ValidateExecutionServiceAuthentication(context.Background())
		if err == nil || errors.Is(err, ErrExecutionServiceTokenMissing) {
			t.Fatalf("rejected credential preflight err=%v", err)
		}
	})
}

func TestExecutionServiceTokenAcceptsCanonicalBotEnvironmentName(t *testing.T) {
	t.Setenv("PHYTOMNI_BOT_SERVICE_TOKEN", "")
	t.Setenv("PHYTOMNI_API_SERVICE_TOKEN", "shared-service-token")

	if token := executionServiceToken(); token != "shared-service-token" {
		t.Fatalf("executionServiceToken()=%q", token)
	}
}

func TestExecutionRuntimeV2ClientRejectsMalformedProjectionAndTarget(t *testing.T) {
	t.Setenv("PHYTOMNI_BOT_SERVICE_TOKEN", "test-service-token")
	tests := []struct {
		name string
		body string
	}{
		{
			name: "unknown target",
			body: `{"schema_version":2,"execution_id":"turn-1","status":"running","latest_seq":0,"output_revision":0,"output_offset":0,"operation_revision":0,"tracking_health":"healthy","active_span_ids":[],"todo_declared":false,"todos":[],"results":[],"targets":[{"kind":"direct_url","id":"target-1"}],"failed_work_unit_ids":[],"warnings":[],"input_required":null,"terminal":null}`,
		},
		{
			name: "unsupported status",
			body: `{"schema_version":2,"execution_id":"turn-1","status":"almost_done","latest_seq":0,"output_revision":0,"output_offset":0,"operation_revision":0,"tracking_health":"healthy","active_span_ids":[],"todo_declared":false,"todos":[],"results":[],"targets":[],"failed_work_unit_ids":[],"warnings":[],"input_required":null,"terminal":null}`,
		},
		{
			name: "unsafe target id",
			body: `{"schema_version":2,"execution_id":"turn-1","status":"running","latest_seq":0,"output_revision":0,"output_offset":0,"operation_revision":0,"tracking_health":"healthy","active_span_ids":[],"todo_declared":false,"todos":[],"results":[],"targets":[{"kind":"artifact","id":"https://evil.example/x"}],"failed_work_unit_ids":[],"warnings":[],"input_required":null,"terminal":null}`,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			client := &Client{http: server.Client(), baseURL: server.URL}
			if _, _, err := client.GetExecutionSnapshotV2(context.Background(), "alice", "turn-1"); err == nil {
				t.Fatal("malformed projection was accepted")
			}
		})
	}
}

func TestExecutionRuntimeV2ClientAcceptsRevisionedInputProjection(t *testing.T) {
	t.Setenv("PHYTOMNI_BOT_SERVICE_TOKEN", "test-service-token")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"schema_version":2,"execution_id":"turn-1","status":"waiting_input","latest_seq":4,"output_revision":1,"output_offset":2,"operation_revision":7,"tracking_health":"healthy","active_span_ids":[],"todo_declared":false,"todos":[],"results":[],"targets":[],"failed_work_unit_ids":[],"warnings":[],"input_required":{"surface_id":"surface-1","widget":"confirm","action_revision":7},"terminal":null}`))
	}))
	defer server.Close()
	client := &Client{http: server.Client(), baseURL: server.URL}
	projection, _, err := client.GetExecutionSnapshotV2(context.Background(), "alice", "turn-1")
	if err != nil {
		t.Fatal(err)
	}
	if projection.OperationRevision != 7 || projection.InputRequired == nil || projection.InputRequired.ActionRevision != 7 {
		t.Fatalf("projection=%#v", projection)
	}
}

func TestExecutionRuntimeV2OperationProjectionDetailAndVersionFallback(t *testing.T) {
	t.Setenv("PHYTOMNI_BOT_SERVICE_TOKEN", "test-service-token")
	operation := `{"schema_version":1,"operation_id":"operation-1","work_unit_id":"work-1","operation_key":"knowledge.search","label_key":"execution.operation.knowledge.search","fallback_label":"Search knowledge","status":"running","started_at":"2026-08-22T08:00:00Z","last_observation_at":"2026-08-22T08:00:01Z","completed_at":null,"duration_ms":1000,"current_attempt":1,"attempts":[{"attempt":1,"status":"running","started_at":"2026-08-22T08:00:00Z","completed_at":null,"duration_ms":1000,"failure":null,"retry":null}],"progress":{"completed":1,"total":2,"unit":"repositories"},"detail":{"repository_count":2},"summary":null,"target":null}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Header.Get("X-Phyto-Owner") != "alice" {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/v2/executions/turn-operations":
			_, _ = w.Write([]byte(`{"schema_version":2,"execution_id":"turn-operations","agent_slug":"knowledge","status":"running","latest_seq":2,"output_revision":0,"output_offset":0,"operation_revision":0,"operations":[` + operation + `],"execution_stage":{"stage":"scientific_execution","child_status":null,"root_status":"running","answer_available":false,"todos":[{"id":"planning","status":"completed"},{"id":"analysis","status":"in_progress"},{"id":"consolidation","status":"pending"},{"id":"response","status":"pending"}],"pending_status_key":"execution.pending.running","clocks":{"last_execution_fact_at":"2026-08-22T08:00:01Z","last_provider_contact_at":null,"last_stream_contact_at":null}},"tracking_health":"healthy","active_span_ids":[],"todo_declared":false,"todos":[],"results":[],"targets":[],"failed_work_unit_ids":[],"warnings":[],"input_required":null,"context_stage":null,"terminal":null}`))
		case "/v2/executions/turn-operations/operations/operation-1":
			_, _ = w.Write([]byte(operation))
		default:
			http.NotFound(w, request)
		}
	}))
	defer server.Close()
	client := &Client{http: server.Client(), baseURL: server.URL}

	projection, _, err := client.GetExecutionSnapshotV2(context.Background(), "alice", "turn-operations")
	if err != nil {
		t.Fatal(err)
	}
	if len(projection.Operations) != 1 || projection.ExecutionStage == nil || projection.ExecutionStage.Stage != "scientific_execution" {
		t.Fatalf("projection=%#v", projection)
	}
	detail, _, err := client.GetExecutionOperationV2(context.Background(), "alice", "turn-operations", "operation-1")
	if err != nil || detail.OperationKey != "knowledge.search" || detail.Progress == nil || detail.Progress.Completed != 1 {
		t.Fatalf("detail=%#v err=%v", detail, err)
	}

	t.Run("unknown operation version is ignorable", func(t *testing.T) {
		unknown := strings.Replace(operation, `"schema_version":1`, `"schema_version":99`, 1)
		fallbackServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"schema_version":2,"execution_id":"turn-fallback","status":"running","latest_seq":2,"output_revision":0,"output_offset":0,"operation_revision":0,"operations":[` + unknown + `],"tracking_health":"healthy","active_span_ids":[],"todo_declared":false,"todos":[],"results":[],"targets":[],"failed_work_unit_ids":[],"warnings":[],"input_required":null,"context_stage":null,"terminal":null}`))
		}))
		defer fallbackServer.Close()
		fallbackClient := &Client{http: fallbackServer.Client(), baseURL: fallbackServer.URL}
		fallback, _, fallbackErr := fallbackClient.GetExecutionSnapshotV2(context.Background(), "alice", "turn-fallback")
		if fallbackErr != nil || len(fallback.Operations) != 0 {
			t.Fatalf("fallback=%#v err=%v", fallback, fallbackErr)
		}
	})
}

func TestExecutionRuntimeV2RejectsMalformedOperationAndStageDetail(t *testing.T) {
	valid := ExecutionOperationRecordV2{
		SchemaVersion: 1, OperationID: "operation-1", WorkUnitID: "work-1",
		OperationKey: "knowledge.search", LabelKey: "execution.operation.knowledge.search",
		FallbackLabel: "Search knowledge", Status: "running",
		StartedAt: "2026-08-22T08:00:00Z", LastObservationAt: "2026-08-22T08:00:01Z",
		DurationMS: 1000, CurrentAttempt: 1, Detail: map[string]any{"repository_count": float64(2)},
		Attempts: []ExecutionOperationAttemptV2{{
			Attempt: 1, Status: "running", StartedAt: "2026-08-22T08:00:00Z", DurationMS: 1000,
		}},
	}
	if err := validateExecutionOperationV2(valid); err != nil {
		t.Fatalf("valid operation rejected: %v", err)
	}
	malformed := valid
	malformed.Attempts = make([]ExecutionOperationAttemptV2, 9)
	if err := validateExecutionOperationV2(malformed); err == nil {
		t.Fatal("unbounded attempt history accepted")
	}
	malformed = valid
	malformed.Detail = map[string]any{"sql": "SELECT * FROM private_table"}
	if err := validateExecutionOperationV2(malformed); err == nil {
		t.Fatal("private operation detail accepted")
	}
	booleanDetail := valid
	booleanDetail.OperationKey = "design.validate_target"
	booleanDetail.Detail = map[string]any{"target_validated": true}
	if err := validateExecutionOperationV2(booleanDetail); err != nil {
		t.Fatalf("valid boolean operation detail rejected: %v", err)
	}
	booleanDetail.Detail = map[string]any{"target_validated": "true"}
	if err := validateExecutionOperationV2(booleanDetail); err == nil {
		t.Fatal("string accepted for boolean operation detail")
	}
	stage := ExecutionStageStateV2{
		Stage: "scientific_execution", RootStatus: "running",
		Todos: []ExecutionStageTodoV2{
			{ID: "planning", Status: "completed"},
			{ID: "analysis", Status: "in_progress"},
			{ID: "consolidation", Status: "pending"},
			{ID: "response", Status: "pending"},
		},
	}
	if err := validateExecutionStageV2(stage); err != nil {
		t.Fatalf("valid stage rejected: %v", err)
	}
	stage.Stage = "regressed_private_stage"
	if err := validateExecutionStageV2(stage); err == nil {
		t.Fatal("unknown execution stage accepted")
	}
}

func TestExecutionRuntimeV2OperationRegistryMatchesSharedContract(t *testing.T) {
	path := filepath.Join(
		"..", "..", "..", "..", "docs", "reference",
		"execution-runtime.v2.fixtures.json",
	)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read shared execution runtime fixture: %v", err)
	}
	var fixtures struct {
		Capabilities struct {
			OperationRecords struct {
				UnknownPresenter struct {
					OperationKey        string            `json:"operation_key"`
					AllowedDetailFields map[string]string `json:"allowed_detail_fields"`
				} `json:"unknown_presenter"`
				Presenters []struct {
					OperationKey        string            `json:"operation_key"`
					AllowedDetailFields map[string]string `json:"allowed_detail_fields"`
				} `json:"presenters"`
			} `json:"operation_records"`
		} `json:"capabilities"`
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatalf("decode shared execution runtime fixture: %v", err)
	}

	want := map[string]map[string]string{}
	operationRecords := fixtures.Capabilities.OperationRecords
	want[operationRecords.UnknownPresenter.OperationKey] = operationRecords.UnknownPresenter.AllowedDetailFields
	for _, presenter := range operationRecords.Presenters {
		want[presenter.OperationKey] = presenter.AllowedDetailFields
	}
	if !reflect.DeepEqual(executionV2OperationDetailFields, want) {
		t.Fatalf("operation registry drifted from shared contract\ngot:  %#v\nwant: %#v", executionV2OperationDetailFields, want)
	}
}

func TestExecutionRuntimeV2AcceptsBoundedReconstructibleMessageChunk(t *testing.T) {
	text := strings.Repeat("a", 8192)
	digest := fmt.Sprintf("%x", sha256.Sum256([]byte(text)))
	event := ExecutionEventV2{
		SchemaVersion: 2,
		EventID:       "event-message-1",
		ExecutionID:   "turn-1",
		Seq:           1,
		Type:          "message.completed",
		Status:        "succeeded",
		OccurredAt:    time.Now().UTC().Format(time.RFC3339Nano),
		Source:        "message",
		SpanID:        "root",
		Attempt:       1,
		Summary:       ExecutionSafeSummaryV2{Key: "message.completed", Text: "Answer completed"},
		PublicPayload: map[string]any{
			"output_revision": float64(1), "message_id": "msg-assistant-1", "source_message_id": "msg-assistant-1",
			"base_offset": float64(0), "offset": float64(8192), "total_length": float64(8192),
			"chunk_index": float64(0), "chunk_count": float64(1), "content_sha256": digest, "text": text,
			"references": []any{
				map[string]any{
					"title": "Drought epigenetics", "di": "10.1000/safe-doi",
					"formatted_citation": "Rich *citation*.",
					"citation": map[string]any{
						"runs":  []any{map[string]any{"text": "forged"}},
						"links": []any{map[string]any{"label": "Article", "href": "https://evil.example/private"}},
					},
				},
				nil,
			},
		},
	}
	if err := validateExecutionEventV2(event, event.ExecutionID); err != nil {
		t.Fatalf("valid reconstructible message chunk rejected: %v", err)
	}
	references, ok := event.PublicPayload["references"].([]any)
	if !ok || len(references) != 2 {
		t.Fatalf("canonical references=%#v", event.PublicPayload["references"])
	}
	first, ok := references[0].(map[string]any)
	if !ok || first["formatted_citation"] != "Rich *citation*." {
		t.Fatalf("canonical first reference=%#v", references[0])
	}
	encodedCitation, _ := json.Marshal(first["citation"])
	if bytes.Contains(encodedCitation, []byte("forged")) || bytes.Contains(encodedCitation, []byte("evil.example")) ||
		!bytes.Contains(encodedCitation, []byte("Rich")) || !bytes.Contains(encodedCitation, []byte("https://doi.org/10.1000/safe-doi")) {
		t.Fatalf("citation was not safely rebuilt: %s", encodedCitation)
	}
	second, ok := references[1].(map[string]any)
	if !ok {
		t.Fatalf("neutral slot shifted: %#v", references)
	}
	encodedNeutral, _ := json.Marshal(second["citation"])
	if !bytes.Contains(encodedNeutral, []byte("Reference details unavailable.")) {
		t.Fatalf("neutral slot lost: %s", encodedNeutral)
	}

	for _, forbidden := range []map[string]any{
		{"title": "unsafe", "dl": "https://evil.example/reference"},
		{"title": "private", "file_id": "secret"},
		{"title": "unknown", "private": "secret"},
		{"title": "https://evil.example/smuggled"},
	} {
		candidate := event
		candidate.PublicPayload = maps.Clone(event.PublicPayload)
		candidate.PublicPayload["references"] = []any{forbidden}
		if err := validateExecutionEventV2(candidate, candidate.ExecutionID); err == nil {
			t.Fatalf("unsafe citation reference accepted: %#v", forbidden)
		}
	}
	event.PublicPayload["references"] = []any{map[string]any{"title": "Drought epigenetics", "di": "10.1000/safe-doi"}}
	event.PublicPayload["text"] = text + "x"
	event.PublicPayload["offset"] = float64(8193)
	event.PublicPayload["total_length"] = float64(8193)
	if err := validateExecutionEventV2(event, event.ExecutionID); err == nil {
		t.Fatal("oversized message chunk accepted")
	}
}
