package bot

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
)

const (
	unifiedAttachmentContractProtocol = "phytomni-unified-attachments-v1"
	unifiedAttachmentContractVersion  = 1
	unifiedAttachmentContractQuery    = "Process the attached synthetic research assets."
	unifiedAttachmentContractTestRef  = "tests/server/test_unified_attachment_contract_fixtures.py::test_unified_attachment_contract_matches_real_projector"
)

var (
	unifiedAttachmentContractScenarioIDs = []string{
		"dual_pdf_fastq_archive",
		"document_only_mixed_classes",
		"dataset_only_mixed_classes",
		"zero_channel_rejected",
		"expert_authorized_capability_intersection",
	}
	unifiedAttachmentContractManifestFiles = []string{
		"request.json",
		"expected-channel-projection.json",
	}
	unifiedAttachmentContractDigests = map[string]string{
		"request.json":                     "0ce9a95c6294dc404761c58a126f07c0af36e0f5cd7e5788c02ab3dbc19f669a",
		"expected-channel-projection.json": "a1d65b1a4c05e605f3f28a40e3a01f34c3e2941fde9d24bbb5cbf0bb216fe1b4",
	}
	unifiedAttachmentForbiddenKeys = []string{
		"authorization",
		"bucket",
		"capability",
		"credential",
		"dataset_description",
		"description",
		"object_key",
		"owner_subject",
		"password",
		"provider",
		"purpose",
		"secret",
		"storage",
		"token",
		"upload_id",
	}
	unifiedAttachmentForbiddenMarkers = []string{
		"agent_data/uploads",
		"huaweicloud",
		"obs://",
		"signed_url",
		"x-obs-",
	}
	unifiedAttachmentExpertAllowedTools = []string{
		"DigitalDesignAgent",
		"AnalystAgent",
		"ChatAgent",
		"InSilicoResearchAgent",
		"ReviewAgent",
	}
	unifiedAttachmentContractExpectations = []unifiedAttachmentScenarioExpectation{
		{
			id:              "dual_pdf_fastq_archive",
			attachmentIDs:   []string{"file_fixture_reads_fastq_gz_0001", "file_fixture_reference_pdf_0002", "file_fixture_archive_zip_0003"},
			serverClasses:   []string{"dataset", "document", "dataset"},
			capabilityShape: "dual",
			obsAssetIDs:     []string{"file_fixture_reference_pdf_0002"},
			dataAssetIDs:    []string{"file_fixture_reads_fastq_gz_0001", "file_fixture_archive_zip_0003"},
			eligibleTools:   []string{},
		},
		{
			id:              "document_only_mixed_classes",
			attachmentIDs:   []string{"file_fixture_matrix_h5ad_0004", "file_fixture_annotations_gff3_0005"},
			serverClasses:   []string{"dataset", "document"},
			capabilityShape: "document_only",
			obsAssetIDs:     []string{"file_fixture_matrix_h5ad_0004", "file_fixture_annotations_gff3_0005"},
			dataAssetIDs:    []string{},
			eligibleTools:   []string{},
		},
		{
			id:              "dataset_only_mixed_classes",
			attachmentIDs:   []string{"file_fixture_variants_vcf_bgz_0006", "file_fixture_alignment_bam_0007"},
			serverClasses:   []string{"document", "dataset"},
			capabilityShape: "dataset_only",
			obsAssetIDs:     []string{},
			dataAssetIDs:    []string{"file_fixture_variants_vcf_bgz_0006", "file_fixture_alignment_bam_0007"},
			eligibleTools:   []string{},
		},
		{
			id:              "zero_channel_rejected",
			attachmentIDs:   []string{"file_fixture_zero_pdf_0008"},
			serverClasses:   []string{"document"},
			capabilityShape: "zero",
			obsAssetIDs:     []string{},
			dataAssetIDs:    []string{},
			errorCode:       "attachment_not_supported",
			eligibleTools:   []string{},
		},
		{
			id:              "expert_authorized_capability_intersection",
			attachmentIDs:   []string{"file_fixture_expert_archive_0009", "file_fixture_expert_pdf_0010"},
			serverClasses:   []string{"dataset", "document"},
			capabilityShape: "dual",
			obsAssetIDs:     []string{"file_fixture_expert_pdf_0010"},
			dataAssetIDs:    []string{"file_fixture_expert_archive_0009"},
			eligibleTools:   []string{"DigitalDesignAgent", "AnalystAgent", "ChatAgent"},
		},
	}
)

type unifiedAttachmentContractManifest struct {
	Protocol    string                                  `json:"protocol"`
	Version     int                                     `json:"version"`
	ScenarioIDs []string                                `json:"scenario_ids"`
	Files       []unifiedAttachmentContractManifestFile `json:"files"`
	ProvingTest string                                  `json:"proving_test"`
}

type unifiedAttachmentContractManifestFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}

type unifiedAttachmentRequestFixture struct {
	Protocol  string                             `json:"protocol"`
	Version   int                                `json:"version"`
	Scenarios []unifiedAttachmentRequestScenario `json:"scenarios"`
}

type unifiedAttachmentRequestScenario struct {
	ID          string                             `json:"id"`
	Query       string                             `json:"query"`
	Attachments []unifiedAttachmentRequestAssetRef `json:"attachments"`
}

type unifiedAttachmentRequestAssetRef struct {
	AssetID string `json:"asset_id"`
}

type unifiedAttachmentExpectedFixture struct {
	Protocol  string                              `json:"protocol"`
	Version   int                                 `json:"version"`
	Scenarios []unifiedAttachmentExpectedScenario `json:"scenarios"`
}

type unifiedAttachmentExpectedScenario struct {
	ID              string                           `json:"id"`
	ServerAssets    []unifiedAttachmentExpectedAsset `json:"server_assets"`
	CapabilityShape string                           `json:"capability_shape"`
	OBSAssetIDs     []string                         `json:"obs_asset_ids"`
	DataAssetIDs    []string                         `json:"data_asset_ids"`
	ErrorCode       *string                          `json:"error_code"`
	EligibleTools   []string                         `json:"eligible_tools"`
}

type unifiedAttachmentExpectedAsset struct {
	AssetID     string `json:"asset_id"`
	ServerClass string `json:"server_class"`
}

type unifiedAttachmentScenarioExpectation struct {
	id              string
	attachmentIDs   []string
	serverClasses   []string
	capabilityShape string
	obsAssetIDs     []string
	dataAssetIDs    []string
	errorCode       string
	eligibleTools   []string
}

func TestUnifiedAttachmentContractManifestPinsFixtureBytes(t *testing.T) {
	manifestRaw := readUnifiedAttachmentFixtureBytes(t, "manifest.json")
	var manifest unifiedAttachmentContractManifest
	decodeStrictUnifiedAttachmentJSON(t, manifestRaw, &manifest)

	if manifest.Protocol != unifiedAttachmentContractProtocol {
		t.Fatalf("manifest protocol = %q, want %q", manifest.Protocol, unifiedAttachmentContractProtocol)
	}
	if manifest.Version != unifiedAttachmentContractVersion {
		t.Fatalf("manifest version = %d, want %d", manifest.Version, unifiedAttachmentContractVersion)
	}
	if !reflect.DeepEqual(manifest.ScenarioIDs, unifiedAttachmentContractScenarioIDs) {
		t.Fatalf("manifest scenario_ids = %#v, want %#v", manifest.ScenarioIDs, unifiedAttachmentContractScenarioIDs)
	}
	if manifest.ProvingTest != unifiedAttachmentContractTestRef {
		t.Fatalf("manifest proving_test = %q, want %q", manifest.ProvingTest, unifiedAttachmentContractTestRef)
	}
	if len(manifest.Files) != len(unifiedAttachmentContractDigests) {
		t.Fatalf("manifest files = %d, want %d", len(manifest.Files), len(unifiedAttachmentContractDigests))
	}
	gotPaths := make([]string, 0, len(manifest.Files))
	for _, entry := range manifest.Files {
		gotPaths = append(gotPaths, entry.Path)
	}
	if !reflect.DeepEqual(gotPaths, unifiedAttachmentContractManifestFiles) {
		t.Fatalf("manifest file order = %#v, want %#v", gotPaths, unifiedAttachmentContractManifestFiles)
	}

	for index, entry := range manifest.Files {
		wantDigest, ok := unifiedAttachmentContractDigests[entry.Path]
		if !ok {
			t.Fatalf("manifest file[%d] path = %q, want one of %#v", index, entry.Path, mapsKeys(unifiedAttachmentContractDigests))
		}
		if entry.SHA256 != wantDigest {
			t.Fatalf("manifest digest for %s = %q, want %q", entry.Path, entry.SHA256, wantDigest)
		}
		raw := readUnifiedAttachmentFixtureBytes(t, entry.Path)
		gotDigest := sha256.Sum256(raw)
		if entry.SHA256 != strings.ToLower(entry.SHA256) {
			t.Fatalf("manifest digest for %s is not lowercase hex: %q", entry.Path, entry.SHA256)
		}
		if entry.SHA256 != encodeHex(gotDigest[:]) {
			t.Fatalf("fixture digest for %s changed: manifest=%q actual=%q", entry.Path, entry.SHA256, encodeHex(gotDigest[:]))
		}
	}
}

func TestUnifiedAttachmentContractFixturesStaySanitized(t *testing.T) {
	for _, name := range []string{"manifest.json", "request.json", "expected-channel-projection.json"} {
		raw := readUnifiedAttachmentFixtureBytes(t, name)
		forbiddenRaw := strings.ToLower(string(raw))
		for _, marker := range unifiedAttachmentForbiddenMarkers {
			if strings.Contains(forbiddenRaw, strings.ToLower(marker)) {
				t.Fatalf("%s contains forbidden marker %q", name, marker)
			}
		}

		var value any
		if err := json.Unmarshal(raw, &value); err != nil {
			t.Fatalf("decode %s for sanitization: %v", name, err)
		}
		for _, key := range collectJSONKeys(value) {
			for _, forbidden := range unifiedAttachmentForbiddenKeys {
				if strings.EqualFold(key, forbidden) {
					t.Fatalf("%s contains forbidden key %q", name, key)
				}
			}
		}
	}
}

func TestUnifiedAttachmentContractScenarioProjectionOrder(t *testing.T) {
	requestRaw := readUnifiedAttachmentFixtureBytes(t, "request.json")
	expectedRaw := readUnifiedAttachmentFixtureBytes(t, "expected-channel-projection.json")

	var request unifiedAttachmentRequestFixture
	var expected unifiedAttachmentExpectedFixture
	decodeStrictUnifiedAttachmentJSON(t, requestRaw, &request)
	decodeStrictUnifiedAttachmentJSON(t, expectedRaw, &expected)

	if request.Protocol != unifiedAttachmentContractProtocol || expected.Protocol != unifiedAttachmentContractProtocol {
		t.Fatalf("fixture protocol mismatch: request=%q expected=%q", request.Protocol, expected.Protocol)
	}
	if request.Version != unifiedAttachmentContractVersion || expected.Version != unifiedAttachmentContractVersion {
		t.Fatalf("fixture version mismatch: request=%d expected=%d", request.Version, expected.Version)
	}
	if len(request.Scenarios) != len(unifiedAttachmentContractExpectations) || len(expected.Scenarios) != len(unifiedAttachmentContractExpectations) {
		t.Fatalf("scenario counts request=%d expected=%d want=%d", len(request.Scenarios), len(expected.Scenarios), len(unifiedAttachmentContractExpectations))
	}

	for index, contract := range unifiedAttachmentContractExpectations {
		requestScenario := request.Scenarios[index]
		expectedScenario := expected.Scenarios[index]

		if requestScenario.ID != contract.id || expectedScenario.ID != contract.id {
			t.Fatalf("scenario %d ids request=%q expected=%q want=%q", index, requestScenario.ID, expectedScenario.ID, contract.id)
		}
		if requestScenario.Query != unifiedAttachmentContractQuery {
			t.Fatalf("scenario %s query = %q, want %q", contract.id, requestScenario.Query, unifiedAttachmentContractQuery)
		}
		if got := requestAttachmentIDs(requestScenario.Attachments); !reflect.DeepEqual(got, contract.attachmentIDs) {
			t.Fatalf("scenario %s request attachments = %#v, want %#v", contract.id, got, contract.attachmentIDs)
		}
		if got := expectedAssetIDs(expectedScenario.ServerAssets); !reflect.DeepEqual(got, contract.attachmentIDs) {
			t.Fatalf("scenario %s server asset ids = %#v, want %#v", contract.id, got, contract.attachmentIDs)
		}
		if got := expectedServerClasses(expectedScenario.ServerAssets); !reflect.DeepEqual(got, contract.serverClasses) {
			t.Fatalf("scenario %s server classes = %#v, want %#v", contract.id, got, contract.serverClasses)
		}
		if expectedScenario.CapabilityShape != contract.capabilityShape {
			t.Fatalf("scenario %s capability_shape = %q, want %q", contract.id, expectedScenario.CapabilityShape, contract.capabilityShape)
		}
		if !reflect.DeepEqual(expectedScenario.OBSAssetIDs, contract.obsAssetIDs) {
			t.Fatalf("scenario %s obs asset ids = %#v, want %#v", contract.id, expectedScenario.OBSAssetIDs, contract.obsAssetIDs)
		}
		if !reflect.DeepEqual(expectedScenario.DataAssetIDs, contract.dataAssetIDs) {
			t.Fatalf("scenario %s data asset ids = %#v, want %#v", contract.id, expectedScenario.DataAssetIDs, contract.dataAssetIDs)
		}
		switch {
		case contract.errorCode == "" && expectedScenario.ErrorCode != nil:
			t.Fatalf("scenario %s error_code = %q, want nil", contract.id, *expectedScenario.ErrorCode)
		case contract.errorCode != "":
			if expectedScenario.ErrorCode == nil || *expectedScenario.ErrorCode != contract.errorCode {
				t.Fatalf("scenario %s error_code = %v, want %q", contract.id, expectedScenario.ErrorCode, contract.errorCode)
			}
		}
		if !reflect.DeepEqual(expectedScenario.EligibleTools, contract.eligibleTools) {
			t.Fatalf("scenario %s eligible_tools = %#v, want %#v", contract.id, expectedScenario.EligibleTools, contract.eligibleTools)
		}
		if contract.id == "expert_authorized_capability_intersection" {
			for _, tool := range expectedScenario.EligibleTools {
				if !slices.Contains(unifiedAttachmentExpertAllowedTools, tool) {
					t.Fatalf("scenario %s eligible tool %q escaped allowed_tools %#v", contract.id, tool, unifiedAttachmentExpertAllowedTools)
				}
			}
			if slices.Contains(expectedScenario.EligibleTools, "InSilicoResearchAgent") {
				t.Fatalf("scenario %s leaked dataset-only tool into eligible_tools: %#v", contract.id, expectedScenario.EligibleTools)
			}
		}
	}
}

func readUnifiedAttachmentFixtureBytes(t *testing.T, name string) []byte {
	t.Helper()
	path := filepath.Join("testdata", "unified-attachments", name)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return raw
}

func decodeStrictUnifiedAttachmentJSON(t *testing.T, raw []byte, out any) {
	t.Helper()
	if err := rejectDuplicateJSONKeys(raw); err != nil {
		t.Fatalf("duplicate JSON keys: %v", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		t.Fatalf("strict decode failed: %v", err)
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			t.Fatal("fixture contains multiple JSON values")
		}
		t.Fatalf("decode trailing JSON: %v", err)
	}
}

func collectJSONKeys(value any) []string {
	switch typed := value.(type) {
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key, child := range typed {
			keys = append(keys, key)
			keys = append(keys, collectJSONKeys(child)...)
		}
		return keys
	case []any:
		keys := make([]string, 0, len(typed))
		for _, child := range typed {
			keys = append(keys, collectJSONKeys(child)...)
		}
		return keys
	default:
		return nil
	}
}

func requestAttachmentIDs(attachments []unifiedAttachmentRequestAssetRef) []string {
	ids := make([]string, 0, len(attachments))
	for _, attachment := range attachments {
		ids = append(ids, attachment.AssetID)
	}
	return ids
}

func expectedAssetIDs(assets []unifiedAttachmentExpectedAsset) []string {
	ids := make([]string, 0, len(assets))
	for _, asset := range assets {
		ids = append(ids, asset.AssetID)
	}
	return ids
}

func expectedServerClasses(assets []unifiedAttachmentExpectedAsset) []string {
	classes := make([]string, 0, len(assets))
	for _, asset := range assets {
		classes = append(classes, asset.ServerClass)
	}
	return classes
}

func encodeHex(data []byte) string {
	const table = "0123456789abcdef"
	buf := make([]byte, len(data)*2)
	for i, value := range data {
		buf[i*2] = table[value>>4]
		buf[i*2+1] = table[value&0x0f]
	}
	return string(buf)
}

func mapsKeys(values map[string]string) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	return keys
}
