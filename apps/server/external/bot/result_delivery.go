package bot

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"
	"unicode"
)

const (
	maxResultArchiveOutputDirs = MaxProjectionArtifactCount
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

func inventoryBuildFailureOmitsDigest(code string) bool {
	switch code {
	case "artifact_listing_failed",
		"artifact_manifest_invalid",
		"no_user_deliverables",
		"archive_inventory_limit_exceeded",
		"archive_contract_invalid":
		return true
	default:
		return false
	}
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

// RunExecutionDelivery is the public subset retained from result.execution.
// Other execution fields remain outside the Web projection.
type RunExecutionDelivery struct {
	OutputDirs           []string
	OutputDirectoryCount int
	TrackingDegraded     bool
	Delivery             *RunDelivery
	ResultArchiveV1      bool
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

// DecodeRunExecutionDelivery decodes only the canonical output roots, tracking
// state, and delivery marker from result.execution.
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
		Tracking   json.RawMessage `json:"tracking"`
		Delivery   json.RawMessage `json:"delivery"`
	}
	if err := json.Unmarshal(trimmed, &wire); err != nil {
		return RunExecutionDelivery{}, fmt.Errorf("execution must be an object: %w", err)
	}
	outputDirs, outputDirectoryCount, err := decodeProjectionOutputDirs(wire.OutputDirs)
	if err != nil {
		return RunExecutionDelivery{}, err
	}
	trackingDegraded, err := decodeExecutionTracking(wire.Tracking)
	if err != nil {
		return RunExecutionDelivery{}, err
	}
	projection := RunExecutionDelivery{
		OutputDirs:           outputDirs,
		OutputDirectoryCount: outputDirectoryCount,
		TrackingDegraded:     trackingDegraded,
	}
	deliveryRaw := bytes.TrimSpace(wire.Delivery)
	if len(deliveryRaw) == 0 || bytes.Equal(deliveryRaw, []byte("null")) {
		return projection, nil
	}
	if len(outputDirs) != outputDirectoryCount {
		return RunExecutionDelivery{}, fmt.Errorf("execution.output_dirs: delivery requires OBS roots")
	}
	delivery, err := DecodeRunDelivery(deliveryRaw, agent, outputDirs)
	if err != nil {
		return RunExecutionDelivery{}, err
	}
	projection.Delivery = &delivery
	projection.ResultArchiveV1 = true
	return projection, nil
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
		if !isInitialPendingDeliveryMarker(*wire.Status, *wire.Revision, *wire.InventoryDigest) {
			if _, err := validateResultArchiveOutputDirs(outputDirs); err != nil {
				return RunDelivery{}, err
			}
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
		if delivery.Archive != nil || delivery.ErrorCode == "" {
			return fmt.Errorf("delivery: contradictory failed state")
		}
		retryable, ok := resultArchiveRetryability[delivery.ErrorCode]
		if !ok {
			return fmt.Errorf("delivery: unsupported error_code")
		}
		if delivery.Retryable != retryable {
			return fmt.Errorf("delivery: retryable does not match error_code")
		}
		if delivery.InventoryDigest == "" && !inventoryBuildFailureOmitsDigest(delivery.ErrorCode) {
			return fmt.Errorf("delivery: contradictory failed state")
		}
	default:
		return fmt.Errorf("delivery: unsupported status")
	}
	return nil
}

// deriveRunArchiveObjectRef resolves Bot's opaque archive reference inside the
// one publish root that defines the Web service's storage scope. Sibling
// children/part-NNN directories and obs:// vs /obs/ spellings collapse to that
// shared root; unrelated run roots still fail. The resulting path remains
// server-only and is never sent back to the browser.
func deriveRunArchiveObjectRef(delivery RunDelivery, outputDirs []string) (string, error) {
	if delivery.Status != "ready" || delivery.Archive == nil {
		return "", nil
	}
	roots, err := validateResultArchiveOutputDirs(outputDirs)
	if err != nil {
		return "", err
	}
	publishRoots := uniqueResultArchivePublishRoots(roots)
	if len(publishRoots) != 1 {
		return "", fmt.Errorf("execution.output_dirs: ready delivery requires exactly one publish root")
	}
	digestHex := strings.TrimPrefix(delivery.InventoryDigest, "sha256:")
	return publishRoots[0] + "/delivery/" + digestHex + "/" + delivery.Archive.Name, nil
}

func uniqueResultArchivePublishRoots(outputDirs []string) []string {
	seen := make(map[string]struct{}, len(outputDirs))
	roots := make([]string, 0, 1)
	for _, outputDir := range outputDirs {
		root := resultArchivePublishRoot(outputDir)
		key := canonicalOBSPath(root)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		roots = append(roots, root)
	}
	return roots
}

func canonicalOBSPath(value string) string {
	const scheme = "obs://"
	if strings.HasPrefix(value, scheme) {
		return "/obs/" + strings.TrimPrefix(value, scheme)
	}
	return value
}

var resultChildPart = regexp.MustCompile(`^part-(?:00[1-9]|0[1-9][0-9]|1[0-9]{2})$`)

func ResultArchiveRunRoot(outputDir string) string {
	return resultArchiveRunRoot(outputDir)
}

func resultArchiveRunRoot(outputDir string) string {
	return resultArchivePublishRoot(outputDir)
}

func resultArchivePublishRoot(outputDir string) string {
	root, part, ok := strings.Cut(strings.TrimRight(outputDir, "/"), "/children/")
	if !ok || root == "" || !resultChildPart.MatchString(part) {
		return outputDir
	}
	return root + "/children"
}

// CanonicalResultArchiveRef rewrites a part-scoped archive path to the
// directory Bot actually publishes into: the parent of part-NNN.
func CanonicalResultArchiveRef(ref string) string {
	trimmed := strings.TrimRight(ref, "/")
	childAt := strings.Index(trimmed, "/children/")
	deliveryAt := strings.Index(trimmed, "/delivery/")
	partStart := childAt + len("/children/")
	if childAt < 0 || deliveryAt < 0 || deliveryAt <= partStart {
		return ref
	}
	part := trimmed[partStart:deliveryAt]
	if !resultChildPart.MatchString(part) {
		return ref
	}
	return trimmed[:childAt] + "/children" + trimmed[deliveryAt:]
}

func decodeProjectionOutputDirs(raw json.RawMessage) ([]string, int, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return nil, 0, nil
	}
	var outputDirs []string
	if err := decodeStrictResultJSON(trimmed, &outputDirs); err != nil {
		return nil, 0, fmt.Errorf("execution.output_dirs: %w", err)
	}
	if len(outputDirs) > MaxProjectionArtifactCount {
		return nil, 0, fmt.Errorf("execution.output_dirs: count exceeds %d", MaxProjectionArtifactCount)
	}
	public := make([]string, 0, len(outputDirs))
	seen := make(map[string]struct{}, len(outputDirs))
	for index, outputDir := range outputDirs {
		if err := validateExecutionOutputDir(outputDir); err != nil {
			return nil, 0, fmt.Errorf("execution.output_dirs[%d]: %w", index, err)
		}
		if _, duplicate := seen[outputDir]; duplicate {
			return nil, 0, fmt.Errorf("execution.output_dirs[%d]: duplicate root", index)
		}
		seen[outputDir] = struct{}{}
		if ValidateProjectionOBSPath(outputDir) == nil {
			public = append(public, outputDir)
		}
	}
	return public, len(outputDirs), nil
}

func validateExecutionOutputDir(value string) error {
	if ValidateProjectionOBSPath(value) == nil {
		return nil
	}
	if value == "" || value != strings.TrimSpace(value) || len([]rune(value)) > MaxProjectionArtifactPathLen {
		return fmt.Errorf("path is empty, overlong, or has surrounding whitespace")
	}
	if strings.Contains(value, "://") || strings.HasPrefix(value, "/obs/") || strings.ContainsAny(value, "\\?#") {
		return fmt.Errorf("path is not an internal output directory")
	}
	for _, char := range value {
		if unicode.IsControl(char) || unicode.IsSpace(char) {
			return fmt.Errorf("path contains whitespace or control characters")
		}
	}
	segments := strings.Split(strings.TrimPrefix(value, "/"), "/")
	if len(segments) == 0 {
		return fmt.Errorf("path has no segments")
	}
	for _, segment := range segments {
		if segment == "" || segment == "." || segment == ".." {
			return fmt.Errorf("path contains an invalid segment")
		}
	}
	return nil
}

func decodeExecutionTracking(raw json.RawMessage) (bool, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return false, nil
	}
	var tracking struct {
		Degraded *bool `json:"degraded"`
	}
	if err := decodeStrictResultJSON(trimmed, &tracking); err != nil {
		return false, fmt.Errorf("execution.tracking: %w", err)
	}
	if tracking.Degraded == nil {
		return false, fmt.Errorf("execution.tracking: degraded is required")
	}
	return *tracking.Degraded, nil
}

func isInitialPendingDeliveryMarker(status string, revision int64, digest string) bool {
	return status == "pending" && revision == 1 && digest == ""
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
