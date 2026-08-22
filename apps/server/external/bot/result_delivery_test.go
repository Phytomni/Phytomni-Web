package bot

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const testArchiveDigest = "sha256:2222222222222222222222222222222222222222222222222222222222222222"

func readyDeliveryPayload(agent string) map[string]interface{} {
	return map[string]interface{}{
		"schema_version":   1,
		"required":         true,
		"status":           "ready",
		"revision":         1,
		"inventory_digest": testArchiveDigest,
		"archive": map[string]interface{}{
			"role":                    "result_archive",
			"name":                    agent + "-results.zip",
			"media_type":              "application/zip",
			"size_bytes":              4097,
			"downloadable":            true,
			"report_context_eligible": false,
			"download_ref":            "result-archive:" + testArchiveDigest,
		},
		"error_code": nil,
		"retryable":  false,
	}
}

func encodeDeliveryPayload(t *testing.T, payload map[string]interface{}) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestDecodeRunDeliveryAcceptsReadyArchive(t *testing.T) {
	got, err := DecodeRunDelivery(
		encodeDeliveryPayload(t, readyDeliveryPayload("research")),
		"research",
		[]string{"obs://bucket/owner/run"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if got.Archive == nil || got.Archive.Name != "research-results.zip" {
		t.Fatalf("archive = %#v", got.Archive)
	}
	if got.InventoryDigest != testArchiveDigest || got.Archive.DownloadRef != "result-archive:"+testArchiveDigest {
		t.Fatalf("delivery = %#v", got)
	}
	expectedObjectRef := "obs://bucket/owner/run/delivery/" + strings.TrimPrefix(testArchiveDigest, "sha256:") + "/research-results.zip"
	if got.Archive.ObjectRef != expectedObjectRef {
		t.Fatalf("object ref = %q, want %q", got.Archive.ObjectRef, expectedObjectRef)
	}
}

func TestDecodeRunDeliveryResolvesArchiveUnderResultChildRoot(t *testing.T) {
	got, err := DecodeRunDelivery(
		encodeDeliveryPayload(t, readyDeliveryPayload("analyst")),
		"analyst",
		[]string{"/obs/bucket/owner/run/children/part-001"},
	)
	if err != nil {
		t.Fatal(err)
	}
	expectedObjectRef := "/obs/bucket/owner/run/children/delivery/" + strings.TrimPrefix(testArchiveDigest, "sha256:") + "/analyst-results.zip"
	if got.Archive == nil || got.Archive.ObjectRef != expectedObjectRef {
		t.Fatalf("object ref = %#v, want %q", got.Archive, expectedObjectRef)
	}
}

func TestCanonicalResultArchiveRefCollapsesChildDeliveryPath(t *testing.T) {
	digest := strings.TrimPrefix(testArchiveDigest, "sha256:")
	child := "/obs/bucket/owner/run/children/part-001/delivery/" + digest + "/analyst-results.zip"
	want := "/obs/bucket/owner/run/children/delivery/" + digest + "/analyst-results.zip"
	if got := CanonicalResultArchiveRef(child); got != want {
		t.Fatalf("CanonicalResultArchiveRef() = %q, want %q", got, want)
	}
	if got := CanonicalResultArchiveRef(want); got != want {
		t.Fatalf("already-canonical ref changed: %q", got)
	}
}

func TestDecodeRunExecutionAcceptsInitialPendingWithoutOutputRoots(t *testing.T) {
	execution := json.RawMessage(`{
		"tracking":{"degraded":false},
		"output_dirs":[],
		"delivery":{
			"schema_version":1,
			"required":true,
			"status":"pending",
			"revision":1,
			"inventory_digest":"",
			"archive":null,
			"error_code":null,
			"retryable":false
		}
	}`)
	got, err := DecodeRunExecutionDelivery(execution, "research")
	if err != nil {
		t.Fatalf("initial pending research delivery without roots: %v", err)
	}
	if !got.ResultArchiveV1 || got.Delivery == nil || got.Delivery.Status != "pending" || got.Delivery.Revision != 1 {
		t.Fatalf("pending delivery = %#v", got)
	}
	if len(got.OutputDirs) != 0 || got.OutputDirectoryCount != 0 {
		t.Fatalf("output roots = %#v", got)
	}
}

func TestDecodeRunDeliveryAcceptsOnlyInitialPendingWithoutDigest(t *testing.T) {
	pending := map[string]interface{}{
		"schema_version":   1,
		"required":         true,
		"status":           "pending",
		"revision":         1,
		"inventory_digest": "",
		"archive":          nil,
		"error_code":       nil,
		"retryable":        false,
	}
	if _, err := DecodeRunDelivery(encodeDeliveryPayload(t, pending), "research", nil); err != nil {
		t.Fatalf("initial pending marker without roots rejected: %v", err)
	}
	if _, err := DecodeRunDelivery(encodeDeliveryPayload(t, readyDeliveryPayload("research")), "research", nil); err == nil {
		t.Fatal("ready archive accepted without output roots")
	}
	if _, err := DecodeRunDelivery(encodeDeliveryPayload(t, pending), "analyst", []string{"/obs/bucket/owner/run"}); err != nil {
		t.Fatalf("initial pending marker rejected: %v", err)
	}
	pending["revision"] = 2
	if _, err := DecodeRunDelivery(encodeDeliveryPayload(t, pending), "analyst", []string{"/obs/bucket/owner/run"}); err == nil {
		t.Fatal("retry pending marker accepted without inventory digest")
	}
}

func TestDecodeRunDeliveryRejectsMalformedContracts(t *testing.T) {
	root := []string{"obs://bucket/owner/run"}
	cases := []struct {
		name   string
		mutate func(map[string]interface{})
		roots  []string
	}{
		{name: "wrong schema", mutate: func(p map[string]interface{}) { p["schema_version"] = 2 }},
		{name: "wrong status", mutate: func(p map[string]interface{}) { p["status"] = "complete" }},
		{name: "wrong role", mutate: func(p map[string]interface{}) { p["archive"].(map[string]interface{})["role"] = "scientific_data" }},
		{name: "wrong name", mutate: func(p map[string]interface{}) { p["archive"].(map[string]interface{})["name"] = "analyst-results.zip" }},
		{name: "overlong name", mutate: func(p map[string]interface{}) {
			p["archive"].(map[string]interface{})["name"] = strings.Repeat("a", 129)
		}},
		{name: "wrong media type", mutate: func(p map[string]interface{}) {
			p["archive"].(map[string]interface{})["media_type"] = "application/octet-stream"
		}},
		{name: "zero size", mutate: func(p map[string]interface{}) { p["archive"].(map[string]interface{})["size_bytes"] = 0 }},
		{name: "over bound size", mutate: func(p map[string]interface{}) {
			p["archive"].(map[string]interface{})["size_bytes"] = int64(10*1024*1024*1024 + 1)
		}},
		{name: "not downloadable", mutate: func(p map[string]interface{}) { p["archive"].(map[string]interface{})["downloadable"] = false }},
		{name: "report context eligible", mutate: func(p map[string]interface{}) {
			p["archive"].(map[string]interface{})["report_context_eligible"] = true
		}},
		{name: "ready without archive", mutate: func(p map[string]interface{}) { p["archive"] = nil }},
		{name: "ready with error", mutate: func(p map[string]interface{}) { p["error_code"] = "archive_publish_failed" }},
		{name: "ready retryable", mutate: func(p map[string]interface{}) { p["retryable"] = true }},
		{name: "malformed digest", mutate: func(p map[string]interface{}) { p["inventory_digest"] = "sha256:ABC" }},
		{name: "digest mismatch", mutate: func(p map[string]interface{}) {
			p["archive"].(map[string]interface{})["download_ref"] = "result-archive:sha256:" + strings.Repeat("3", 64)
		}},
		{name: "url reference", mutate: func(p map[string]interface{}) {
			p["archive"].(map[string]interface{})["download_ref"] = "https://example.invalid/results.zip"
		}},
		{name: "traversal reference", mutate: func(p map[string]interface{}) {
			p["archive"].(map[string]interface{})["download_ref"] = "result-archive:../results.zip"
		}},
		{name: "control character reference", mutate: func(p map[string]interface{}) {
			p["archive"].(map[string]interface{})["download_ref"] = "result-archive:\n" + testArchiveDigest
		}},
		{name: "raw obs reference", mutate: func(p map[string]interface{}) {
			p["archive"].(map[string]interface{})["download_ref"] = "obs://bucket/owner/other/research-results.zip"
		}},
		{name: "missing root", mutate: func(map[string]interface{}) {}, roots: []string{}},
		{name: "multiple roots", mutate: func(map[string]interface{}) {}, roots: []string{"obs://bucket/owner/run", "obs://bucket/owner/second-run"}},
		{name: "url root", mutate: func(map[string]interface{}) {}, roots: []string{"https://example.invalid/run"}},
		{name: "traversal root", mutate: func(map[string]interface{}) {}, roots: []string{"obs://bucket/owner/../run"}},
		{name: "control character root", mutate: func(map[string]interface{}) {}, roots: []string{"obs://bucket/owner/\nrun"}},
		{name: "duplicate roots", mutate: func(map[string]interface{}) {}, roots: []string{"obs://bucket/owner/run", "obs://bucket/owner/run"}},
		{name: "too many roots", mutate: func(map[string]interface{}) {}, roots: []string{
			"obs://bucket/owner/run-1", "obs://bucket/owner/run-2", "obs://bucket/owner/run-3",
			"obs://bucket/owner/run-4", "obs://bucket/owner/run-5", "obs://bucket/owner/run-6",
			"obs://bucket/owner/run-7", "obs://bucket/owner/run-8", "obs://bucket/owner/run-9",
		}},
		{name: "overlong root", mutate: func(map[string]interface{}) {}, roots: []string{"obs://bucket/owner/" + strings.Repeat("a", 513)}},
		{name: "unknown field", mutate: func(p map[string]interface{}) { p["provider_error"] = "private" }},
		{name: "unknown archive field", mutate: func(p map[string]interface{}) {
			p["archive"].(map[string]interface{})["source_path"] = "/private/archive.zip"
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			payload := readyDeliveryPayload("research")
			tc.mutate(payload)
			roots := tc.roots
			if roots == nil {
				roots = root
			}
			if got, err := DecodeRunDelivery(encodeDeliveryPayload(t, payload), "research", roots); err == nil {
				t.Fatalf("malformed contract accepted: %#v", got)
			}
		})
	}
}

func TestDecodeRunDeliveryAcceptsStableFailureCodes(t *testing.T) {
	for code, retryable := range resultArchiveRetryability {
		t.Run(code, func(t *testing.T) {
			payload := map[string]interface{}{
				"schema_version":   1,
				"required":         true,
				"status":           "failed",
				"revision":         1,
				"inventory_digest": testArchiveDigest,
				"archive":          nil,
				"error_code":       code,
				"retryable":        retryable,
			}
			got, err := DecodeRunDelivery(encodeDeliveryPayload(t, payload), "design", []string{"obs://bucket/owner/run"})
			if err != nil {
				t.Fatal(err)
			}
			if got.ErrorCode != code || got.Retryable != retryable {
				t.Fatalf("failure = %#v", got)
			}
		})
	}
}

func TestDecodeRunDeliveryAcceptsInventoryBuildFailuresWithoutDigest(t *testing.T) {
	codes := []string{
		"artifact_listing_failed",
		"artifact_manifest_invalid",
		"no_user_deliverables",
		"archive_inventory_limit_exceeded",
		"archive_contract_invalid",
	}
	for agent := range resultArchiveNames {
		for _, code := range codes {
			t.Run(agent+"/"+code, func(t *testing.T) {
				payload := map[string]interface{}{
					"schema_version":   1,
					"required":         true,
					"status":           "failed",
					"revision":         1,
					"inventory_digest": "",
					"archive":          nil,
					"error_code":       code,
					"retryable":        resultArchiveRetryability[code],
				}
				got, err := DecodeRunDelivery(encodeDeliveryPayload(t, payload), agent, []string{"obs://bucket/owner/run"})
				if err != nil {
					t.Fatal(err)
				}
				if got.Status != "failed" || got.ErrorCode != code || got.InventoryDigest != "" || got.Archive != nil {
					t.Fatalf("inventory failure = %#v", got)
				}
			})
		}
	}
}

func TestDecodeRunDeliveryRejectsInvalidFailureStates(t *testing.T) {
	cases := []struct {
		name      string
		code      interface{}
		retryable bool
		digest    string
		archive   interface{}
	}{
		{name: "unknown error", code: "provider_exception", retryable: false, digest: testArchiveDigest},
		{name: "retryable mismatch true", code: "artifact_manifest_invalid", retryable: true, digest: testArchiveDigest},
		{name: "retryable mismatch false", code: "archive_publish_failed", retryable: false, digest: testArchiveDigest},
		{name: "missing error", code: nil, retryable: false, digest: testArchiveDigest},
		{name: "publish missing digest", code: "archive_publish_failed", retryable: true, digest: ""},
		{name: "generation missing digest", code: "archive_generation_failed", retryable: true, digest: ""},
		{name: "failed with archive", code: "archive_publish_failed", retryable: true, digest: testArchiveDigest, archive: readyDeliveryPayload("research")["archive"]},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			payload := map[string]interface{}{
				"schema_version":   1,
				"required":         true,
				"status":           "failed",
				"revision":         1,
				"inventory_digest": tc.digest,
				"archive":          tc.archive,
				"error_code":       tc.code,
				"retryable":        tc.retryable,
			}
			if got, err := DecodeRunDelivery(encodeDeliveryPayload(t, payload), "research", []string{"obs://bucket/owner/run"}); err == nil {
				t.Fatalf("invalid failure accepted: %#v", got)
			}
		})
	}
}

func TestDecodeRunDeliveryRejectsDuplicateKeys(t *testing.T) {
	raw := json.RawMessage(`{
		"schema_version":1,"required":true,"status":"pending","status":"ready",
		"revision":1,"inventory_digest":"","archive":null,"error_code":null,"retryable":false
	}`)
	if _, err := DecodeRunDelivery(raw, "analyst", []string{"obs://bucket/owner/run"}); err == nil {
		t.Fatal("duplicate delivery key accepted")
	}
}

func TestRetryRunDeliveryUsesStrictAuthenticatedPost(t *testing.T) {
	var gotMethod, gotEscapedPath, gotAuth, gotContentType string
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotEscapedPath = r.URL.EscapedPath()
		gotAuth = r.Header.Get("Authorization")
		gotContentType = r.Header.Get("Content-Type")
		gotBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"schema_version":1,"required":true,"status":"pending","revision":2,"inventory_digest":"` + testArchiveDigest + `","archive":null,"error_code":null,"retryable":false}`))
	}))
	defer srv.Close()

	got, err := newTestClient(srv.URL).RetryRunDelivery(context.Background(), "run/with space")
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "pending" || got.Revision != 2 {
		t.Fatalf("delivery = %#v", got)
	}
	if gotMethod != http.MethodPost || gotEscapedPath != "/v1/runs/run%2Fwith%20space/delivery/retry" {
		t.Fatalf("request = %s %s", gotMethod, gotEscapedPath)
	}
	if gotAuth != "Bearer ptm_test" || gotContentType != "" || len(gotBody) != 0 {
		t.Fatalf("headers/body auth=%q content-type=%q body=%q", gotAuth, gotContentType, gotBody)
	}
}

func TestRetryRunDeliveryRejectsDuplicateAndNonPendingResponses(t *testing.T) {
	responses := []string{
		`{"schema_version":1,"required":true,"status":"pending","status":"failed","revision":2,"inventory_digest":"` + testArchiveDigest + `","archive":null,"error_code":"archive_publish_failed","retryable":true}`,
		string(encodeDeliveryPayload(t, readyDeliveryPayload("research"))),
	}
	for _, response := range responses {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(response))
		}))
		_, err := newTestClient(srv.URL).RetryRunDelivery(context.Background(), "run-1")
		srv.Close()
		if err == nil {
			t.Fatalf("invalid retry response accepted: %s", response)
		}
	}
}
