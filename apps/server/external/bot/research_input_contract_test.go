package bot

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

func validResearchCatalog() *AgentsListResponse {
	return &AgentsListResponse{
		Protocols: map[string][]int{
			ResearchInputProtocol: {ResearchInputProtocolVersion},
		},
		ResearchInputResolution: &ResearchInputResolutionDescriptor{
			MaxUserQueryChars: DefaultMaxUserQueryChars,
			MaxAttachments:    DefaultMaxAssetAttachmentRefs,
			MaxDatasetPaths:   DefaultMaxResearchDatasetPaths,
			MaxReferences:     DefaultMaxResearchInputReferences,
		},
		Data: []AgentDescriptor{{
			Slug: "research",
			Tool: "InSilicoResearchAgent",
			Capabilities: AgentDescriptorCapabilities{
				Attachments: AgentDescriptorAttachments{
					Datasets: &AgentDescriptorDatasetCapability{
						Formats:       []string{"vcf", " CSV ", "fastq.gz"},
						MaxFiles:      DefaultMaxAssetAttachmentRefs,
						MaxFileBytes:  10 << 30,
						MaxTotalBytes: 20 << 30,
					},
				},
			},
		}},
	}
}

func TestHeadResearchInputFixtureMatchesContract(t *testing.T) {
	raw, err := os.ReadFile("testdata/head/research_input_resolution_v1.json")
	if err != nil {
		t.Fatal(err)
	}
	if got := fmt.Sprintf("%x", sha256.Sum256(raw)); got != acceptedResearchInputFixtureSHA256 {
		t.Fatalf("fixture digest = %s, want accepted Bot digest", got)
	}
	var catalog AgentsListResponse
	if err := json.Unmarshal(raw, &catalog); err != nil {
		t.Fatal(err)
	}
	contract, err := ValidateResearchInputContract(&catalog)
	if err != nil {
		t.Fatal(err)
	}
	if contract.MaxUserQueryChars < DefaultMaxUserQueryChars ||
		contract.MaxAttachments < DefaultMaxAssetAttachmentRefs ||
		contract.MaxDatasetPaths < DefaultMaxResearchDatasetPaths ||
		contract.MaxReferences < DefaultMaxResearchInputReferences {
		t.Fatalf("fixture contract is below the Web floor: %#v", contract)
	}
}

func TestValidateResearchInputContract(t *testing.T) {
	response := validResearchCatalog()
	wantFormats := []string{"csv", "fastq.gz", "vcf"}

	got, err := ValidateResearchInputContract(response)
	if err != nil {
		t.Fatal(err)
	}
	if got.MaxUserQueryChars != DefaultMaxUserQueryChars ||
		got.MaxAttachments != DefaultMaxAssetAttachmentRefs ||
		got.MaxDatasetPaths != DefaultMaxResearchDatasetPaths ||
		got.MaxReferences != DefaultMaxResearchInputReferences {
		t.Fatalf("contract=%#v", got)
	}
	if !reflect.DeepEqual(got.DatasetFormats, wantFormats) {
		t.Fatalf("DatasetFormats=%v, want %v", got.DatasetFormats, wantFormats)
	}

	sourceFormats := response.Data[0].Capabilities.Attachments.Datasets.Formats
	if !reflect.DeepEqual(sourceFormats, []string{"vcf", " CSV ", "fastq.gz"}) {
		t.Fatalf("validator mutated source formats: %v", sourceFormats)
	}
	sourceFormats[0] = "bam"
	if !reflect.DeepEqual(got.DatasetFormats, wantFormats) {
		t.Fatalf("contract retained source formats: %v", got.DatasetFormats)
	}
	got.DatasetFormats[0] = "bed"
	if sourceFormats[0] != "bam" {
		t.Fatalf("source retained contract formats: %v", sourceFormats)
	}
}

func TestValidateResearchInputContractUsesLowerAttachmentAdvertisement(t *testing.T) {
	tests := []struct {
		name                  string
		descriptorAttachments int
		datasetFiles          int
	}{
		{name: "descriptor higher", descriptorAttachments: 128, datasetFiles: 64},
		{name: "dataset channel higher", descriptorAttachments: 64, datasetFiles: 128},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			response := validResearchCatalog()
			response.ResearchInputResolution.MaxAttachments = tc.descriptorAttachments
			response.Data[0].Capabilities.Attachments.Datasets.MaxFiles = tc.datasetFiles

			contract, err := ValidateResearchInputContract(response)
			if err != nil {
				t.Fatal(err)
			}
			if contract.MaxAttachments != 64 {
				t.Fatalf("MaxAttachments=%d, want lower advertised limit 64", contract.MaxAttachments)
			}
		})
	}
}

func TestResearchFormatsCompatibleCoversCompleteAndMissingMatrices(t *testing.T) {
	required := []string{"gz", "mtx", "tar", "tsv", "txt.gz", "mtx.gz", "tar.gz"}
	tests := []struct {
		name       string
		advertised []string
		want       bool
	}{
		{
			name:       "complete exact matrix",
			advertised: []string{"tar.gz", "txt.gz", "tsv", "mtx.gz", "tar", "gz", "mtx"},
			want:       true,
		},
		{
			name:       "complete archive-suffix matrix",
			advertised: []string{"tsv", "tar", "mtx", "gz"},
			want:       true,
		},
		{name: "missing gz semantics", advertised: []string{"tsv", "tar", "mtx"}},
		{name: "missing tsv", advertised: []string{"gz", "tar", "mtx"}},
		{name: "missing mtx", advertised: []string{"gz", "tar", "tsv"}},
		{name: "missing tar.gz semantics", advertised: []string{"gz", "mtx", "tsv"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			requiredBefore := append([]string(nil), required...)
			advertisedBefore := append([]string(nil), tt.advertised...)
			if got := ResearchFormatsCompatible(required, tt.advertised); got != tt.want {
				t.Fatalf("ResearchFormatsCompatible(%v, %v) = %v, want %v", required, tt.advertised, got, tt.want)
			}
			if !reflect.DeepEqual(required, requiredBefore) || !reflect.DeepEqual(tt.advertised, advertisedBefore) {
				t.Fatalf("compatibility check mutated inputs: required=%v advertised=%v", required, tt.advertised)
			}
		})
	}
}

func TestResearchFormatsCompatibleOnlyFallsBackToArchiveSuffixes(t *testing.T) {
	tests := []struct {
		name       string
		required   string
		advertised string
		want       bool
	}{
		{name: "exact compound token", required: "matrix.tsv", advertised: "matrix.tsv", want: true},
		{name: "accepted archive suffix", required: "matrix.mtx.gz", advertised: "gz", want: true},
		{name: "retired archive suffix", required: "matrix.mtx.zipx", advertised: "zipx", want: false},
		{name: "non-archive final segment", required: "matrix.tsv", advertised: "tsv", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ResearchFormatsCompatible([]string{tt.required}, []string{tt.advertised})
			if got != tt.want {
				t.Fatalf("ResearchFormatsCompatible(%q, %q) = %v, want %v", tt.required, tt.advertised, got, tt.want)
			}
		})
	}
}

func TestResearchArchiveFormatsIncludeCompoundArchives(t *testing.T) {
	for _, format := range []string{"tar.gz"} {
		if _, ok := acceptedResearchArchiveFormats[format]; !ok {
			t.Fatalf("acceptedResearchArchiveFormats missing %q", format)
		}
	}
}

func TestValidateResearchInputContractRejectsInvalidCatalog(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*AgentsListResponse)
	}{
		{name: "missing protocol", mutate: func(r *AgentsListResponse) { delete(r.Protocols, ResearchInputProtocol) }},
		{name: "wrong protocol version", mutate: func(r *AgentsListResponse) { r.Protocols[ResearchInputProtocol] = []int{2} }},
		{name: "mixed protocol versions", mutate: func(r *AgentsListResponse) { r.Protocols[ResearchInputProtocol] = []int{1, 2} }},
		{name: "zero query count", mutate: func(r *AgentsListResponse) { r.ResearchInputResolution.MaxUserQueryChars = 0 }},
		{name: "query count above hard limit", mutate: func(r *AgentsListResponse) { r.ResearchInputResolution.MaxUserQueryChars = HardMaxUserQueryChars + 1 }},
		{name: "zero attachment count", mutate: func(r *AgentsListResponse) { r.ResearchInputResolution.MaxAttachments = 0 }},
		{name: "attachment count above hard limit", mutate: func(r *AgentsListResponse) { r.ResearchInputResolution.MaxAttachments = HardMaxAssetAttachmentRefs + 1 }},
		{name: "zero dataset path count", mutate: func(r *AgentsListResponse) { r.ResearchInputResolution.MaxDatasetPaths = 0 }},
		{name: "dataset path count above hard limit", mutate: func(r *AgentsListResponse) {
			r.ResearchInputResolution.MaxDatasetPaths = HardMaxResearchDatasetPaths + 1
		}},
		{name: "zero combined count", mutate: func(r *AgentsListResponse) { r.ResearchInputResolution.MaxReferences = 0 }},
		{name: "combined count below attachments", mutate: func(r *AgentsListResponse) {
			r.ResearchInputResolution.MaxReferences = r.ResearchInputResolution.MaxAttachments - 1
		}},
		{name: "combined count below paths", mutate: func(r *AgentsListResponse) {
			r.ResearchInputResolution.MaxDatasetPaths = 129
			r.ResearchInputResolution.MaxReferences = 128
		}},
		{name: "combined count above hard limit", mutate: func(r *AgentsListResponse) {
			r.ResearchInputResolution.MaxReferences = HardMaxResearchInputReferences + 1
		}},
		{name: "missing limit descriptor", mutate: func(r *AgentsListResponse) { r.ResearchInputResolution = nil }},
		{name: "missing Research descriptor", mutate: func(r *AgentsListResponse) { r.Data = nil }},
		{name: "wrong Research tool", mutate: func(r *AgentsListResponse) { r.Data[0].Tool = "AnalystAgent" }},
		{name: "duplicate Research descriptor", mutate: func(r *AgentsListResponse) { r.Data = append(r.Data, r.Data[0]) }},
		{name: "missing dataset capability", mutate: func(r *AgentsListResponse) { r.Data[0].Capabilities.Attachments.Datasets = nil }},
		{name: "zero dataset max files", mutate: func(r *AgentsListResponse) { r.Data[0].Capabilities.Attachments.Datasets.MaxFiles = 0 }},
		{name: "negative dataset max files", mutate: func(r *AgentsListResponse) { r.Data[0].Capabilities.Attachments.Datasets.MaxFiles = -1 }},
		{name: "dataset max files above hard limit", mutate: func(r *AgentsListResponse) {
			r.Data[0].Capabilities.Attachments.Datasets.MaxFiles = HardMaxAssetAttachmentRefs + 1
		}},
		{name: "zero dataset max file bytes", mutate: func(r *AgentsListResponse) { r.Data[0].Capabilities.Attachments.Datasets.MaxFileBytes = 0 }},
		{name: "negative dataset max file bytes", mutate: func(r *AgentsListResponse) { r.Data[0].Capabilities.Attachments.Datasets.MaxFileBytes = -1 }},
		{name: "dataset max file bytes above hard limit", mutate: func(r *AgentsListResponse) {
			r.Data[0].Capabilities.Attachments.Datasets.MaxFileBytes = maxResumableUploadFileBytes + 1
		}},
		{name: "zero dataset max total bytes", mutate: func(r *AgentsListResponse) { r.Data[0].Capabilities.Attachments.Datasets.MaxTotalBytes = 0 }},
		{name: "negative dataset max total bytes", mutate: func(r *AgentsListResponse) { r.Data[0].Capabilities.Attachments.Datasets.MaxTotalBytes = -1 }},
		{name: "dataset max total below max file", mutate: func(r *AgentsListResponse) {
			r.Data[0].Capabilities.Attachments.Datasets.MaxTotalBytes = maxResumableUploadFileBytes - 1
		}},
		{name: "dataset max total above file times count", mutate: func(r *AgentsListResponse) {
			dataset := r.Data[0].Capabilities.Attachments.Datasets
			dataset.MaxFiles = 2
			dataset.MaxTotalBytes = dataset.MaxFileBytes*int64(dataset.MaxFiles) + 1
		}},
		{name: "dataset max total above absolute limit", mutate: func(r *AgentsListResponse) {
			dataset := r.Data[0].Capabilities.Attachments.Datasets
			dataset.MaxFiles = HardMaxAssetAttachmentRefs
			dataset.MaxFileBytes = maxResumableUploadFileBytes
			dataset.MaxTotalBytes = maxResumableUploadFileBytes*int64(HardMaxAssetAttachmentRefs) + 1
		}},
		{name: "missing formats", mutate: func(r *AgentsListResponse) { r.Data[0].Capabilities.Attachments.Datasets.Formats = nil }},
		{name: "blank format", mutate: func(r *AgentsListResponse) { r.Data[0].Capabilities.Attachments.Datasets.Formats[0] = " " }},
		{name: "normalized duplicate format", mutate: func(r *AgentsListResponse) {
			r.Data[0].Capabilities.Attachments.Datasets.Formats = []string{"csv", " CSV ", "vcf"}
		}},
		{name: "unsafe format", mutate: func(r *AgentsListResponse) { r.Data[0].Capabilities.Attachments.Datasets.Formats[0] = "../vcf" }},
		{name: "overlong format", mutate: func(r *AgentsListResponse) {
			r.Data[0].Capabilities.Attachments.Datasets.Formats[0] = strings.Repeat("a", 65)
		}},
		{name: "excessive formats", mutate: func(r *AgentsListResponse) {
			formats := make([]string, 257)
			for i := range formats {
				formats[i] = "format" + strconv.Itoa(i)
			}
			r.Data[0].Capabilities.Attachments.Datasets.Formats = formats
		}},
		{name: "CSV-only formats", mutate: func(r *AgentsListResponse) { r.Data[0].Capabilities.Attachments.Datasets.Formats = []string{"csv"} }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			response := validResearchCatalog()
			tt.mutate(response)
			if got, err := ValidateResearchInputContract(response); err == nil {
				t.Fatalf("accepted invalid catalog: %#v", got)
			}
		})
	}

	if got, err := ValidateResearchInputContract(nil); err == nil {
		t.Fatalf("accepted nil catalog: %#v", got)
	}
}

func TestValidateResearchInputContractRejectsNonIntegralAndOverflowCounts(t *testing.T) {
	raw, err := json.Marshal(validResearchCatalog())
	if err != nil {
		t.Fatal(err)
	}
	fields := []struct {
		name  string
		value int
	}{
		{name: "max_user_query_chars", value: DefaultMaxUserQueryChars},
		{name: "max_attachments_per_request", value: DefaultMaxAssetAttachmentRefs},
		{name: "max_research_dataset_paths", value: DefaultMaxResearchDatasetPaths},
		{name: "max_research_input_references", value: DefaultMaxResearchInputReferences},
	}
	for _, field := range fields {
		needle := []byte(`"` + field.name + `":` + strconv.Itoa(field.value))
		for _, replacement := range []struct {
			name  string
			value string
		}{
			{name: "fractional", value: "1.5"},
			{name: "overflow", value: "9223372036854775808"},
		} {
			t.Run(field.name+"/"+replacement.name, func(t *testing.T) {
				malformed := bytes.Replace(raw, needle, []byte(`"`+field.name+`":`+replacement.value), 1)
				if bytes.Equal(malformed, raw) {
					t.Fatalf("fixture did not contain %s", needle)
				}
				var decoded AgentsListResponse
				if err := json.Unmarshal(malformed, &decoded); err == nil {
					t.Fatal("decoded a non-integral or overflowing count")
				}
			})
		}
	}
}

func TestResearchCatalogTypesDiscardUnknownFields(t *testing.T) {
	raw := `{
		"protocols":{"research_input_resolution_v1":[1]},
		"research_input_resolution":{"max_user_query_chars":131072,"max_attachments_per_request":64,"max_research_dataset_paths":64,"max_research_input_references":128,"private_limit":"secret"},
		"data":[{"slug":"research","tool":"InSilicoResearchAgent","capabilities":{"attachments":{"datasets":{"formats":["csv","vcf"],"max_files":64,"max_file_bytes":10737418240,"max_total_bytes":21474836480,"private_token":"secret"}}}}]
	}`
	var response AgentsListResponse
	if err := json.Unmarshal([]byte(raw), &response); err != nil {
		t.Fatal(err)
	}
	if _, err := ValidateResearchInputContract(&response); err != nil {
		t.Fatal(err)
	}
	reencoded, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(reencoded), "private_limit") || strings.Contains(string(reencoded), "private_token") || strings.Contains(string(reencoded), "secret") {
		t.Fatalf("unknown upstream fields were retained: %s", reencoded)
	}
}
