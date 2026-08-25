package bot

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

const validExecutionTraceV1 = `{
  "schema_version":1,
  "target":{"kind":"trace","id":"trc_A1b2C3d4E5f6G7h8"},
  "health":"healthy",
  "operation":{
    "operation_id":"op-analysis","operation_key":"remote.analysis",
    "label_key":"execution.operation.remote.analysis","fallback_label":"Run analysis",
    "status":"running","started_at":"2026-08-23T08:00:00Z",
    "last_observation_at":"2026-08-23T08:00:02Z","completed_at":null,
    "duration_ms":2000,"current_attempt":1,"attempts":[],"progress":null,
    "detail":{"provider_state":"running"},"summary":null,
    "target":{"kind":"trace","id":"trc_A1b2C3d4E5f6G7h8"}
  },
  "last_semantic_activity_at":"2026-08-23T08:00:02Z",
  "last_provider_contact_at":"2026-08-23T08:00:03Z",
  "items":[{
    "schema_version":1,"item_id":"item-1","seq":7,"kind":"phase",
    "operation_key":"gene_network.prepare_inputs",
    "label_key":"execution.trace.geneNetwork.prepareInputs",
    "fallback_label":"Prepare analysis inputs","status":"succeeded","attempt":1,
    "occurred_at":"2026-08-23T08:00:02Z","duration_ms":1200,"progress":null,
    "attempts":[],"detail":{"input_count":2},"summary":"Prepare analysis inputs completed",
    "target":null
  }],
  "next_after_seq":7,"has_more":false
}`

func TestResolveExecutionTraceV1UsesOwnerAndBoundedCursor(t *testing.T) {
	t.Setenv("PHYTOMNI_BOT_SERVICE_TOKEN", "test-service-token")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Header.Get("X-Phyto-Owner") != "alice" || request.Header.Get("X-Service-Token") != "test-service-token" {
			http.NotFound(w, request)
			return
		}
		if request.URL.Query().Get("after_seq") != "4" || request.URL.Query().Get("limit") != "25" {
			http.Error(w, "bad cursor", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(validExecutionTraceV1))
	}))
	defer server.Close()

	client := &Client{http: server.Client(), baseURL: server.URL}
	trace, _, err := client.ResolveExecutionTraceV1(
		context.Background(), "alice", "turn-1", "trc_A1b2C3d4E5f6G7h8", 4, 25,
	)
	if err != nil || len(trace.Items) != 1 || trace.Items[0].Kind != "phase" || trace.NextAfterSeq != 7 {
		t.Fatalf("trace=%#v err=%v", trace, err)
	}
}

func TestResolveExecutionTraceV1RejectsUnknownFieldsAndVersion(t *testing.T) {
	for name, body := range map[string]string{
		"unknown field":   validExecutionTraceV1[:len(validExecutionTraceV1)-1] + `,"provider_body":"secret"}`,
		"raw task logs":   validExecutionTraceV1[:len(validExecutionTraceV1)-1] + `,"task_logs":[{"content":"private provider stdout"}]}`,
		"unknown version": `{"schema_version":2}`,
	} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("PHYTOMNI_BOT_SERVICE_TOKEN", "test-service-token")
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(body))
			}))
			defer server.Close()
			client := &Client{http: server.Client(), baseURL: server.URL}
			if _, _, err := client.ResolveExecutionTraceV1(context.Background(), "alice", "turn-1", "trc_A1b2C3d4E5f6G7h8", 0, 50); err == nil {
				t.Fatal("unsupported trace response was accepted")
			}
		})
	}
}

func TestExecutionTraceV1SharedGoldenSafetyReplayAndBounds(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(
		"..", "..", "..", "..", "..", "Phytomni-Bot", "docs", "contracts",
		"agent-work-trace", "v1", "fixtures.json",
	))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		PrivateObservationContract struct {
			ForbiddenFields []string `json:"forbidden_fields"`
		} `json:"private_observation_contract"`
		TraceTargetContract struct {
			Kind string `json:"kind"`
		} `json:"trace_target_contract"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	var first ExecutionTraceResolutionV1
	var replay ExecutionTraceResolutionV1
	if err := decodeFiniteV2([]byte(validExecutionTraceV1), &first); err != nil {
		t.Fatal(err)
	}
	if err := decodeFiniteV2([]byte(validExecutionTraceV1), &replay); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, replay) || fixture.TraceTargetContract.Kind != "trace" {
		t.Fatal("shared golden replay was not deterministic")
	}
	if err := validateExecutionTraceV1(first, first.Target.ID, 0, 50); err != nil {
		t.Fatalf("shared golden-compatible trace rejected: %v", err)
	}
	for _, forbidden := range fixture.PrivateObservationContract.ForbiddenFields {
		t.Run("forbidden "+forbidden, func(t *testing.T) {
			adversarial := replay
			adversarial.Items = append([]ExecutionTraceFeedItemV1(nil), replay.Items...)
			adversarial.Items[0].Detail = map[string]any{forbidden: "private-value"}
			if err := validateExecutionTraceV1(adversarial, adversarial.Target.ID, 0, 50); err == nil {
				t.Fatalf("forbidden field %q was accepted", forbidden)
			}
		})
	}
	truncated := replay
	extra := replay.Items[0]
	extra.ItemID = "item-2"
	extra.Seq = 8
	truncated.Items = append(truncated.Items, extra)
	truncated.NextAfterSeq = 8
	if err := validateExecutionTraceV1(truncated, truncated.Target.ID, 0, 1); err == nil {
		t.Fatal("response larger than the requested page bound was accepted")
	}
	shortTarget := replay
	shortTarget.Target.ID = "trc_short"
	shortTarget.Operation.Target.ID = "trc_short"
	if err := validateExecutionTraceV1(shortTarget, "trc_short", 0, 50); err == nil {
		t.Fatal("trace id outside the shared opaque-id contract was accepted")
	}
}
