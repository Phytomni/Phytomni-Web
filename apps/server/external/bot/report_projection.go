package bot

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
)

// RunReport contains scientific availability, independently of execution and delivery.
type RunReport struct {
	State               string `json:"state"`
	Degraded            bool   `json:"degraded"`
	SourceArtifactCount int64  `json:"source_artifact_count"`
}

func decodeExecutionReport(raw json.RawMessage) (*RunReport, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return nil, nil
	}
	var wire struct {
		State               *string `json:"state"`
		Degraded            *bool   `json:"degraded"`
		SourceArtifactCount *int64  `json:"source_artifact_count"`
	}
	if err := json.Unmarshal(trimmed, &wire); err != nil {
		return nil, errors.New("execution.report: malformed descriptor")
	}
	if wire.State == nil || wire.Degraded == nil || wire.SourceArtifactCount == nil {
		return nil, errors.New("execution.report: required field missing")
	}
	switch *wire.State {
	case "none", "intermediate", "final", "degraded":
	default:
		return nil, errors.New("execution.report: unsupported state")
	}
	if *wire.SourceArtifactCount < 0 || *wire.SourceArtifactCount > MaxProjectionProgressCounter {
		return nil, errors.New("execution.report: source_artifact_count outside bounds")
	}
	return &RunReport{
		State: *wire.State, Degraded: *wire.Degraded,
		SourceArtifactCount: *wire.SourceArtifactCount,
	}, nil
}

func decodeReportWarningCodes(raw json.RawMessage) ([]string, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return nil, nil
	}
	var warnings []struct {
		Code *string `json:"code"`
	}
	if err := json.Unmarshal(trimmed, &warnings); err != nil {
		return nil, errors.New("execution.warnings: malformed list")
	}
	if len(warnings) > MaxProjectionArtifactCount {
		return nil, errors.New("execution.warnings: count outside bounds")
	}
	codes := make([]string, 0, len(warnings))
	seen := make(map[string]bool, len(warnings))
	for _, warning := range warnings {
		if warning.Code == nil || *warning.Code == "" ||
			len([]rune(*warning.Code)) > MaxProjectionFailureField ||
			strings.TrimSpace(*warning.Code) != *warning.Code ||
			strings.ContainsAny(*warning.Code, "\x00\r\n\t") {
			return nil, errors.New("execution.warnings: malformed code")
		}
		code := *warning.Code
		switch code {
		case "report_artifact_count_capped", "report_context_truncated",
			"report_artifact_size_exceeded", "report_artifact_read_failed",
			"report_artifact_empty", "report_no_scientific_text",
			"report_synthesis_failed", "deep_genome_report_degraded":
			if !seen[code] {
				codes = append(codes, code)
				seen[code] = true
			}
		}
	}
	return codes, nil
}
