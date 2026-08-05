package bot

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"
)

const (
	maxResultArchiveOutputDirs = 8
	maxResultArchiveNameRunes  = 128
	maxResultArchiveFieldRunes = 128
	maxResultArchiveSizeBytes  = int64(10 * 1024 * 1024 * 1024)
)

var resultArchiveDigestPattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)

var resultArchiveRetryability = map[string]bool{
	"artifact_listing_failed":          true,
	"artifact_manifest_invalid":        false,
	"no_user_deliverables":             false,
	"archive_inventory_limit_exceeded": false,
	"archive_generation_failed":        true,
	"archive_publish_failed":           true,
	"archive_contract_invalid":         false,
}

var resultArchiveNames = map[string]string{
	"analyst":  "analyst-results.zip",
	"research": "research-results.zip",
	"network":  "network-results.zip",
	"design":   "design-results.zip",
}

// RunArchiveDescriptor is the single immutable archive delivered for a run.
// DownloadRef is a Bot-to-Web resolver reference and must never be forwarded
// to a browser.
type RunArchiveDescriptor struct {
	Role                  string `json:"role"`
	Name                  string `json:"name"`
	MediaType             string `json:"media_type"`
	SizeBytes             int64  `json:"size_bytes"`
	Downloadable          bool   `json:"downloadable"`
	ReportContextEligible bool   `json:"report_context_eligible"`
	DownloadRef           string `json:"download_ref"`
	ObjectRef             string `json:"-"`
}

// RunDelivery is Bot's bounded archive-delivery state.
type RunDelivery struct {
	SchemaVersion   int                   `json:"schema_version"`
	Required        bool                  `json:"required"`
	Status          string                `json:"status"`
	Revision        int64                 `json:"revision"`
	InventoryDigest string                `json:"inventory_digest"`
	Archive         *RunArchiveDescriptor `json:"archive"`
	ErrorCode       string                `json:"error_code"`
	Retryable       bool                  `json:"retryable"`
}

// RunExecutionDelivery is the canonical delivery subset retained from
// result.execution. Other execution fields remain outside the Web projection.
type RunExecutionDelivery struct {
	OutputDirs      []string
	Delivery        *RunDelivery
	ResultArchiveV1 bool
}

type runDeliveryWire struct {
	SchemaVersion   *int            `json:"schema_version"`
	Required        *bool           `json:"required"`
	Status          *string         `json:"status"`
	Revision        *int64          `json:"revision"`
	InventoryDigest *string         `json:"inventory_digest"`
	Archive         json.RawMessage `json:"archive"`
	ErrorCode       json.RawMessage `json:"error_code"`
	Retryable       *bool           `json:"retryable"`
}

type runArchiveWire struct {
	Role                  *string `json:"role"`
	Name                  *string `json:"name"`
	MediaType             *string `json:"media_type"`
	SizeBytes             *int64  `json:"size_bytes"`
	Downloadable          *bool   `json:"downloadable"`
	ReportContextEligible *bool   `json:"report_context_eligible"`
	DownloadRef           *string `json:"download_ref"`
}

// DecodeRunExecutionDelivery decodes only the canonical output roots and
// delivery marker from result.execution. A missing or null delivery preserves
// historical flat-artifact behavior.
func DecodeRunExecutionDelivery(raw json.RawMessage, agent string) (RunExecutionDelivery, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return RunExecutionDelivery{}, nil
	}
	if err := rejectDuplicateJSONKeys(trimmed); err != nil {
		return RunExecutionDelivery{}, fmt.Errorf("execution: %w", err)
	}
	var wire struct {
		OutputDirs json.RawMessage `json:"output_dirs"`
		Delivery   json.RawMessage `json:"delivery"`
	}
	if err := json.Unmarshal(trimmed, &wire); err != nil {
		return RunExecutionDelivery{}, fmt.Errorf("execution must be an object: %w", err)
	}
	deliveryRaw := bytes.TrimSpace(wire.Delivery)
	if len(deliveryRaw) == 0 || bytes.Equal(deliveryRaw, []byte("null")) {
		return RunExecutionDelivery{}, nil
	}
	outputDirs, err := decodeResultArchiveOutputDirs(wire.OutputDirs)
	if err != nil {
		return RunExecutionDelivery{}, err
	}
	delivery, err := DecodeRunDelivery(deliveryRaw, agent, outputDirs)
	if err != nil {
		return RunExecutionDelivery{}, err
	}
	return RunExecutionDelivery{
		OutputDirs:      outputDirs,
		Delivery:        &delivery,
		ResultArchiveV1: true,
	}, nil
}

// DecodeRunDelivery validates one exact versioned delivery object. Output
// roots are validated alongside the object because they define the only
// server-side storage scope associated with the opaque archive resolver.
func DecodeRunDelivery(raw json.RawMessage, agent string, outputDirs []string) (RunDelivery, error) {
	var wire runDeliveryWire
	if err := decodeStrictResultJSON(raw, &wire); err != nil {
		return RunDelivery{}, fmt.Errorf("delivery: %w", err)
	}
	if wire.SchemaVersion == nil || *wire.SchemaVersion != ResultArchiveProtocolVersion {
		return RunDelivery{}, fmt.Errorf("delivery: unsupported schema_version")
	}
	if wire.Required == nil || !*wire.Required {
		return RunDelivery{}, fmt.Errorf("delivery: required must be true")
	}
	if wire.Status == nil || len([]rune(*wire.Status)) > maxResultArchiveFieldRunes {
		return RunDelivery{}, fmt.Errorf("delivery: invalid status")
	}
	if wire.Revision == nil || *wire.Revision < 1 {
		return RunDelivery{}, fmt.Errorf("delivery: invalid revision")
	}
	if wire.InventoryDigest == nil || len([]rune(*wire.InventoryDigest)) > maxResultArchiveFieldRunes {
		return RunDelivery{}, fmt.Errorf("delivery: invalid inventory_digest")
	}
	if wire.Retryable == nil || len(wire.Archive) == 0 || len(wire.ErrorCode) == 0 {
		return RunDelivery{}, fmt.Errorf("delivery: missing required field")
	}
	if agent != "" {
		if _, ok := resultArchiveNames[agent]; !ok {
			return RunDelivery{}, fmt.Errorf("delivery: unsupported archive agent")
		}
		if _, err := validateResultArchiveOutputDirs(outputDirs); err != nil {
			return RunDelivery{}, err
		}
	}

	digest := *wire.InventoryDigest
	if digest != "" && !resultArchiveDigestPattern.MatchString(digest) {
		return RunDelivery{}, fmt.Errorf("delivery: malformed inventory_digest")
	}
	archive, err := decodeRunArchive(wire.Archive)
	if err != nil {
		return RunDelivery{}, err
	}
	errorCode, err := decodeDeliveryErrorCode(wire.ErrorCode)
	if err != nil {
		return RunDelivery{}, err
	}
	delivery := RunDelivery{
		SchemaVersion:   *wire.SchemaVersion,
		Required:        *wire.Required,
		Status:          *wire.Status,
		Revision:        *wire.Revision,
		InventoryDigest: digest,
		Archive:         archive,
		ErrorCode:       errorCode,
		Retryable:       *wire.Retryable,
	}
	if err := validateRunDeliveryState(delivery, agent); err != nil {
		return RunDelivery{}, err
	}
	if delivery.Archive != nil {
		archiveRef, err := deriveRunArchiveObjectRef(delivery, outputDirs)
		if err != nil {
			return RunDelivery{}, err
		}
		delivery.Archive.ObjectRef = archiveRef
	}
	return delivery, nil
}

func decodeStrictResultJSON(raw json.RawMessage, out interface{}) error {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return fmt.Errorf("JSON object is required")
	}
	if err := rejectDuplicateJSONKeys(trimmed); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(trimmed))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return err
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return fmt.Errorf("multiple JSON values")
		}
		return err
	}
	return nil
}

func decodeRunArchive(raw json.RawMessage) (*RunArchiveDescriptor, error) {
	trimmed := bytes.TrimSpace(raw)
	if bytes.Equal(trimmed, []byte("null")) {
		return nil, nil
	}
	var wire runArchiveWire
	if err := decodeStrictResultJSON(trimmed, &wire); err != nil {
		return nil, fmt.Errorf("delivery.archive: %w", err)
	}
	if wire.Role == nil || wire.Name == nil || wire.MediaType == nil || wire.SizeBytes == nil ||
		wire.Downloadable == nil || wire.ReportContextEligible == nil || wire.DownloadRef == nil {
		return nil, fmt.Errorf("delivery.archive: missing required field")
	}
	for field, value := range map[string]string{
		"role": *wire.Role, "name": *wire.Name, "media_type": *wire.MediaType, "download_ref": *wire.DownloadRef,
	} {
		limit := maxResultArchiveFieldRunes
		if field == "name" {
			limit = maxResultArchiveNameRunes
		}
		if value != strings.TrimSpace(value) || len([]rune(value)) > limit || strings.ContainsAny(value, "\x00\r\n\t") {
			return nil, fmt.Errorf("delivery.archive: malformed %s", field)
		}
	}
	if *wire.SizeBytes <= 0 || *wire.SizeBytes > maxResultArchiveSizeBytes {
		return nil, fmt.Errorf("delivery.archive: size_bytes is outside bounds")
	}
	return &RunArchiveDescriptor{
		Role:                  *wire.Role,
		Name:                  *wire.Name,
		MediaType:             *wire.MediaType,
		SizeBytes:             *wire.SizeBytes,
		Downloadable:          *wire.Downloadable,
		ReportContextEligible: *wire.ReportContextEligible,
		DownloadRef:           *wire.DownloadRef,
	}, nil
}

func decodeDeliveryErrorCode(raw json.RawMessage) (string, error) {
	trimmed := bytes.TrimSpace(raw)
	if bytes.Equal(trimmed, []byte("null")) {
		return "", nil
	}
	var code string
	if err := json.Unmarshal(trimmed, &code); err != nil {
		return "", fmt.Errorf("delivery: error_code must be a string or null")
	}
	if code == "" || code != strings.TrimSpace(code) || len([]rune(code)) > maxResultArchiveFieldRunes || strings.ContainsAny(code, "\x00\r\n\t") {
		return "", fmt.Errorf("delivery: malformed error_code")
	}
	return code, nil
}

func validateRunDeliveryState(delivery RunDelivery, agent string) error {
	switch delivery.Status {
	case "pending":
		if delivery.Archive != nil || delivery.ErrorCode != "" || delivery.Retryable {
			return fmt.Errorf("delivery: contradictory pending state")
		}
		if delivery.InventoryDigest == "" && delivery.Revision != 1 {
			return fmt.Errorf("delivery: only the initial pending marker may omit inventory_digest")
		}
	case "ready":
		if delivery.InventoryDigest == "" || delivery.Archive == nil || delivery.ErrorCode != "" || delivery.Retryable {
			return fmt.Errorf("delivery: contradictory ready state")
		}
		archive := delivery.Archive
		expectedName, ok := resultArchiveNames[agent]
		if !ok || archive.Role != "result_archive" || archive.Name != expectedName || archive.MediaType != "application/zip" {
			return fmt.Errorf("delivery: invalid archive identity")
		}
		if !archive.Downloadable || archive.ReportContextEligible {
			return fmt.Errorf("delivery: invalid archive access flags")
		}
		if archive.DownloadRef != "result-archive:"+delivery.InventoryDigest {
			return fmt.Errorf("delivery: archive reference does not match inventory_digest")
		}
	case "failed":
		if delivery.InventoryDigest == "" || delivery.Archive != nil || delivery.ErrorCode == "" {
			return fmt.Errorf("delivery: contradictory failed state")
		}
		retryable, ok := resultArchiveRetryability[delivery.ErrorCode]
		if !ok {
			return fmt.Errorf("delivery: unsupported error_code")
		}
		if delivery.Retryable != retryable {
			return fmt.Errorf("delivery: retryable does not match error_code")
		}
	default:
		return fmt.Errorf("delivery: unsupported status")
	}
	return nil
}

// deriveRunArchiveObjectRef resolves Bot's opaque archive reference inside the
// one output root that defines the Web service's storage scope. The resulting
// path remains server-only and is never sent back to the browser.
func deriveRunArchiveObjectRef(delivery RunDelivery, outputDirs []string) (string, error) {
	if delivery.Status != "ready" || delivery.Archive == nil {
		return "", nil
	}
	roots, err := validateResultArchiveOutputDirs(outputDirs)
	if err != nil {
		return "", err
	}
	if len(roots) != 1 {
		return "", fmt.Errorf("execution.output_dirs: ready delivery requires exactly one root")
	}
	digestHex := strings.TrimPrefix(delivery.InventoryDigest, "sha256:")
	return roots[0] + "/delivery/" + digestHex + "/" + delivery.Archive.Name, nil
}

func decodeResultArchiveOutputDirs(raw json.RawMessage) ([]string, error) {
	var outputDirs []string
	if err := decodeStrictResultJSON(raw, &outputDirs); err != nil {
		return nil, fmt.Errorf("execution.output_dirs: %w", err)
	}
	return validateResultArchiveOutputDirs(outputDirs)
}

func validateResultArchiveOutputDirs(outputDirs []string) ([]string, error) {
	if len(outputDirs) == 0 || len(outputDirs) > maxResultArchiveOutputDirs {
		return nil, fmt.Errorf("execution.output_dirs: count is outside bounds")
	}
	bounded := make([]string, 0, len(outputDirs))
	seen := make(map[string]struct{}, len(outputDirs))
	for index, outputDir := range outputDirs {
		if err := ValidateProjectionOBSPath(outputDir); err != nil {
			return nil, fmt.Errorf("execution.output_dirs[%d]: %w", index, err)
		}
		if _, duplicate := seen[outputDir]; duplicate {
			return nil, fmt.Errorf("execution.output_dirs[%d]: duplicate root", index)
		}
		seen[outputDir] = struct{}{}
		bounded = append(bounded, outputDir)
	}
	return bounded, nil
}
