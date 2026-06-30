package api_handler

import (
	"fmt"
	"net/http"
	"testing"

	"phytomni-server/service/api_service"
)

// TestQueryErrorStatus_ExpertDisabled pins the 503 mapping for a dark Expert
// gateway, distinct from the generic 500 fallthrough. Wrapped with %w so
// errors.Is resolves.
func TestQueryErrorStatus_ExpertDisabled(t *testing.T) {
	status, msg := queryErrorStatus(fmt.Errorf("dispatch: %w", api_service.ErrExpertDisabled))
	if status != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d", status)
	}
	if msg != "expert mode not available" {
		t.Errorf("expected expert message, got %q", msg)
	}
}
