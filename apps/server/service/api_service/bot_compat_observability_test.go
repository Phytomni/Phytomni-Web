package api_service

import (
	"strings"
	"testing"
)

// TestProjectionLogsContainOnlyBoundedMetadata locks the transport/persistence
// boundary used by observability: provider request ids are diagnostic-only and
// raw payloads (including tokens and private artifact paths) never enter the
// bounded projection JSON that can be inspected with a row.
func TestProjectionLogsContainOnlyBoundedMetadata(t *testing.T) {
	encoded, err := marshalPersistedProjection(BotRunProjection{
		RunID:      "run-observe-1",
		Agent:      "deep_genome",
		Status:     "SUCCEEDED",
		RequestID:  "bot-request-secret",
		RawPayload: []byte(`{"token":"secret","private_path":"/srv/private"}`),
	})
	if err != nil {
		t.Fatalf("marshal projection: %v", err)
	}
	if strings.Contains(encoded, "bot-request-secret") ||
		strings.Contains(encoded, "token") ||
		strings.Contains(encoded, "private_path") {
		t.Fatalf("unbounded transport data crossed projection boundary: %s", encoded)
	}
	if !strings.Contains(encoded, `"run_id":"run-observe-1"`) ||
		!strings.Contains(encoded, `"status":"SUCCEEDED"`) {
		t.Fatalf("bounded projection metadata missing: %s", encoded)
	}
}
