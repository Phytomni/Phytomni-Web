package api_service

import (
	"errors"
	"testing"
)

func TestValidateExpertResolvedTool(t *testing.T) {
	tests := []struct {
		name        string
		resolved    string
		allowed     []string
		forced      string
		wantTool    string
		wantFailure bool
	}{
		{
			name:     "allowed autonomous",
			resolved: "data",
			allowed:  []string{"ChatAgent", "DataAgent"},
			wantTool: "DataAgent",
		},
		{
			name:     "allowed forced",
			resolved: "data",
			allowed:  []string{"ChatAgent", "DataAgent"},
			forced:   "DataAgent",
			wantTool: "DataAgent",
		},
		{
			name:        "outside allowlist",
			resolved:    "analyst",
			allowed:     []string{"ChatAgent", "DataAgent"},
			wantFailure: true,
		},
		{
			name:        "forced mismatch",
			resolved:    "analyst",
			allowed:     []string{"DataAgent", "AnalystAgent"},
			forced:      "DataAgent",
			wantFailure: true,
		},
		{
			name:        "unknown slug",
			resolved:    "missing",
			allowed:     []string{"ChatAgent"},
			wantFailure: true,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := validateExpertResolvedTool(tc.resolved, tc.allowed, tc.forced)
			if tc.wantFailure {
				if !errors.Is(err, ErrExpertRouteContract) {
					t.Fatalf("error = %v, want ErrExpertRouteContract", err)
				}
				if got != "" {
					t.Fatalf("tool = %q on failure, want empty", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("validateExpertResolvedTool: %v", err)
			}
			if got != tc.wantTool {
				t.Fatalf("tool = %q, want %q", got, tc.wantTool)
			}
		})
	}
}

func TestValidateExpertSubmissionAgent(t *testing.T) {
	if err := validateExpertSubmissionAgent("data", "data"); err != nil {
		t.Fatalf("matching submission agent: %v", err)
	}
	err := validateExpertSubmissionAgent("data", "analyst")
	if !errors.Is(err, ErrExpertRouteContract) {
		t.Fatalf("mismatched submission agent error = %v, want ErrExpertRouteContract", err)
	}
}
