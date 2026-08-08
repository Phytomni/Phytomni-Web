package bot

import (
	"fmt"
	"sort"
	"strings"
)

const (
	ResearchInputProtocol        = "research_input_resolution_v1"
	ResearchInputProtocolVersion = 1

	maxResearchDatasetFormats    = 256
	maxResearchDatasetFormatSize = 64
)

var acceptedResearchArchiveFormats = map[string]struct{}{
	"zip": {}, "zipx": {},
	"tar": {}, "tgz": {}, "tbz": {}, "tbz2": {}, "txz": {}, "tlz": {}, "tzst": {},
	"gz": {}, "bgz": {}, "bgzf": {}, "bgzip": {}, "bz": {}, "bz2": {}, "xz": {}, "lz": {}, "lzma": {}, "lz4": {}, "lzo": {}, "br": {}, "z": {}, "zst": {},
	"7z": {}, "rar": {}, "cab": {}, "ace": {}, "arj": {},
}

// ResearchInputResolutionDescriptor is the bounded limit descriptor advertised
// beside the Bot protocol-version arrays.
type ResearchInputResolutionDescriptor struct {
	MaxUserQueryChars int `json:"max_user_query_chars"`
	MaxAttachments    int `json:"max_attachments_per_request"`
	MaxDatasetPaths   int `json:"max_research_dataset_paths"`
	MaxReferences     int `json:"max_research_input_references"`
}

// ResearchInputContract is the finite, detached projection used by Web-owned
// Research submission validation.
type ResearchInputContract struct {
	MaxUserQueryChars int
	MaxAttachments    int
	MaxDatasetPaths   int
	MaxReferences     int
	DatasetFormats    []string
}

// ResearchFormatsCompatible reports whether every Web-required format is
// covered by the Bot registry. A compound format may be covered by its exact
// token or by its advertised final archive suffix.
func ResearchFormatsCompatible(required, advertised []string) bool {
	if len(required) == 0 || len(advertised) == 0 {
		return false
	}
	advertisedSet := make(map[string]struct{}, len(advertised))
	for _, format := range advertised {
		advertisedSet[format] = struct{}{}
	}
	for _, format := range required {
		if _, ok := advertisedSet[format]; ok {
			continue
		}
		separator := strings.LastIndexByte(format, '.')
		if separator > 0 {
			archiveFormat := format[separator+1:]
			_, acceptedArchive := acceptedResearchArchiveFormats[archiveFormat]
			_, advertisedArchive := advertisedSet[archiveFormat]
			if acceptedArchive && advertisedArchive {
				continue
			}
		}
		return false
	}
	return true
}

// ValidateResearchInputContract validates the exact Research protocol and
// projects only the limits and normalized dataset formats Web consumes.
func ValidateResearchInputContract(response *AgentsListResponse) (ResearchInputContract, error) {
	if !supportsExactProtocol(response, ResearchInputProtocol, ResearchInputProtocolVersion) {
		return ResearchInputContract{}, fmt.Errorf("incompatible Research input protocol")
	}
	descriptor := response.ResearchInputResolution
	if descriptor == nil {
		return ResearchInputContract{}, fmt.Errorf("missing Research input descriptor")
	}
	if descriptor.MaxUserQueryChars < 1 || descriptor.MaxUserQueryChars > HardMaxUserQueryChars {
		return ResearchInputContract{}, fmt.Errorf("invalid Research query limit")
	}
	if descriptor.MaxAttachments < 1 || descriptor.MaxAttachments > HardMaxAssetAttachmentRefs {
		return ResearchInputContract{}, fmt.Errorf("invalid Research attachment limit")
	}
	if descriptor.MaxDatasetPaths < 1 || descriptor.MaxDatasetPaths > HardMaxResearchDatasetPaths {
		return ResearchInputContract{}, fmt.Errorf("invalid Research dataset-path limit")
	}
	if descriptor.MaxReferences < descriptor.MaxAttachments ||
		descriptor.MaxReferences < descriptor.MaxDatasetPaths ||
		descriptor.MaxReferences > HardMaxResearchInputReferences {
		return ResearchInputContract{}, fmt.Errorf("invalid Research reference limit")
	}

	presence, err := ValidateWebAgentDescriptors(response)
	if err != nil || !presence["research"].Present {
		return ResearchInputContract{}, fmt.Errorf("missing Research dataset capability")
	}
	capability, ok := FindAgentCapability(response, "research")
	if !ok || capability.Attachments.Datasets == nil {
		return ResearchInputContract{}, fmt.Errorf("missing Research dataset capability")
	}
	dataset := capability.Attachments.Datasets
	if dataset.MaxFiles < 1 || dataset.MaxFiles > HardMaxAssetAttachmentRefs {
		return ResearchInputContract{}, fmt.Errorf("invalid Research dataset file limit")
	}
	if dataset.MaxFileBytes < 1 || dataset.MaxFileBytes > maxResumableUploadFileBytes {
		return ResearchInputContract{}, fmt.Errorf("invalid Research dataset file-byte limit")
	}
	if dataset.MaxTotalBytes < dataset.MaxFileBytes ||
		exceedsPositiveProduct(dataset.MaxTotalBytes, maxResumableUploadFileBytes, HardMaxAssetAttachmentRefs) ||
		exceedsPositiveProduct(dataset.MaxTotalBytes, dataset.MaxFileBytes, dataset.MaxFiles) {
		return ResearchInputContract{}, fmt.Errorf("invalid Research dataset total-byte limit")
	}
	formats, err := normalizeResearchDatasetFormats(dataset.Formats)
	if err != nil {
		return ResearchInputContract{}, err
	}

	return ResearchInputContract{
		MaxUserQueryChars: descriptor.MaxUserQueryChars,
		MaxAttachments:    min(descriptor.MaxAttachments, dataset.MaxFiles),
		MaxDatasetPaths:   descriptor.MaxDatasetPaths,
		MaxReferences:     descriptor.MaxReferences,
		DatasetFormats:    formats,
	}, nil
}

func exceedsPositiveProduct(value, factor int64, count int) bool {
	quotient := value / factor
	return quotient > int64(count) || quotient == int64(count) && value%factor > 0
}

func normalizeResearchDatasetFormats(formats []string) ([]string, error) {
	if len(formats) < 1 || len(formats) > maxResearchDatasetFormats {
		return nil, fmt.Errorf("invalid Research dataset formats")
	}

	normalized := make([]string, 0, len(formats))
	seen := make(map[string]struct{}, len(formats))
	hasScientificFormat := false
	for _, raw := range formats {
		format := strings.ToLower(strings.TrimSpace(raw))
		if !safeResearchDatasetFormat(format) {
			return nil, fmt.Errorf("invalid Research dataset format")
		}
		if _, duplicate := seen[format]; duplicate {
			return nil, fmt.Errorf("duplicate Research dataset format")
		}
		seen[format] = struct{}{}
		normalized = append(normalized, format)
		if format != "csv" {
			hasScientificFormat = true
		}
	}
	if !hasScientificFormat {
		return nil, fmt.Errorf("insufficient Research dataset formats")
	}
	sort.Strings(normalized)
	return normalized, nil
}

func safeResearchDatasetFormat(format string) bool {
	if len(format) < 1 || len(format) > maxResearchDatasetFormatSize {
		return false
	}
	for index := 0; index < len(format); index++ {
		char := format[index]
		if char >= 'a' && char <= 'z' || char >= '0' && char <= '9' {
			continue
		}
		if index > 0 && (char == '.' || char == '+' || char == '-' || char == '_') {
			continue
		}
		return false
	}
	return true
}
