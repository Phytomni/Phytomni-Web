package api_service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf16"
	"unicode/utf8"

	"phytomni-server/common"
)

const maxGeneManifestBytes = 6 << 20

var (
	ErrGeneManifestConflict = errors.New("invalid gene material manifest")
	ErrGeneMaterialContent  = errors.New("invalid gene material content")
	geneMaterialID          = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
	geneMaterialDigest      = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

// Storage locators belong only to this private, validated registration.
type geneManifestResource struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Kind         string `json:"kind"`
	MarkdownHref string `json:"markdown_href"`
	ObjectKey    string `json:"object_key"`
	MediaType    string `json:"media_type"`
	SizeBytes    int64  `json:"size_bytes"`
	SHA256       string `json:"sha256"`
}

type geneManifestMaterial struct {
	ReferenceIndex int      `json:"reference_index"`
	Excerpt        string   `json:"excerpt"`
	ResourceIDs    []string `json:"resource_ids"`
}

type geneManifest struct {
	SchemaVersion      int                    `json:"schema_version"`
	GeneID             string                 `json:"gene_id"`
	ReportFile         string                 `json:"report_file"`
	ReportSHA256       string                 `json:"report_sha256"`
	ReferenceCount     int                    `json:"reference_count"`
	Resources          []geneManifestResource `json:"resources"`
	ReferenceMaterials []geneManifestMaterial `json:"reference_materials"`
}

type geneReportBundle struct {
	report     *common.GeneDetailResponse
	source     geneObjectSource
	registered map[string]geneManifestResource
}

// Validate structure before allocating typed slices: every array in the
// contract is bounded, and duplicate/null fields must never be normalized away.
func geneManifestJSONValue(decoder *json.Decoder, depth int) error {
	if depth > 8 {
		return ErrGeneManifestConflict
	}
	token, err := decoder.Token()
	if err != nil || token == nil {
		return ErrGeneManifestConflict
	}
	delimiter, container := token.(json.Delim)
	if !container {
		return nil
	}
	if delimiter != '{' && delimiter != '[' {
		return ErrGeneManifestConflict
	}
	seen := make(map[string]bool)
	count := 0
	for decoder.More() {
		count++
		if count > maxGeneReferenceIndex {
			return ErrGeneManifestConflict
		}
		if delimiter == '{' {
			key, keyErr := decoder.Token()
			name, ok := key.(string)
			if keyErr != nil || !ok || seen[name] {
				return ErrGeneManifestConflict
			}
			seen[name] = true
		}
		if err := geneManifestJSONValue(decoder, depth+1); err != nil {
			return err
		}
	}
	_, err = decoder.Token()
	if err != nil {
		return ErrGeneManifestConflict
	}
	return nil
}

func geneManifestFields(data []byte, fields ...string) bool {
	var object map[string]json.RawMessage
	if json.Unmarshal(data, &object) != nil || len(object) != len(fields) {
		return false
	}
	for _, field := range fields {
		if _, ok := object[field]; !ok {
			return false
		}
	}
	return true
}

func parseGeneManifest(data []byte, report *common.GeneDetailResponse) (*geneManifest, error) {
	if len(data) > maxGeneManifestBytes {
		return nil, ErrGeneResourceTooLarge
	}
	if !utf8.Valid(data) {
		return nil, ErrGeneMaterialContent
	}
	if !validGeneJSONUnicode(data) {
		return nil, ErrGeneManifestConflict
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if geneManifestJSONValue(decoder, 0) != nil {
		return nil, ErrGeneManifestConflict
	}
	if _, err := decoder.Token(); err != io.EOF {
		return nil, ErrGeneManifestConflict
	}
	if !geneManifestFields(data, "schema_version", "gene_id", "report_file", "report_sha256", "reference_count", "resources", "reference_materials") {
		return nil, ErrGeneManifestConflict
	}
	var raw struct {
		Resources []json.RawMessage `json:"resources"`
		Materials []json.RawMessage `json:"reference_materials"`
	}
	if json.Unmarshal(data, &raw) != nil {
		return nil, ErrGeneManifestConflict
	}
	for _, resource := range raw.Resources {
		if !geneManifestFields(resource, "id", "name", "kind", "markdown_href", "object_key", "media_type", "size_bytes", "sha256") {
			return nil, ErrGeneManifestConflict
		}
	}
	for _, material := range raw.Materials {
		if !geneManifestFields(material, "reference_index", "excerpt", "resource_ids") {
			return nil, ErrGeneManifestConflict
		}
	}
	var manifest geneManifest
	if json.Unmarshal(data, &manifest) != nil {
		return nil, ErrGeneManifestConflict
	}
	var references []json.RawMessage
	if json.Unmarshal(report.References, &references) != nil || manifest.SchemaVersion != 1 ||
		!geneCuratedID.MatchString(manifest.GeneID) || manifest.GeneID != report.GeneId || manifest.ReportFile != report.FileName ||
		!geneMaterialDigest.MatchString(manifest.ReportSHA256) || manifest.ReportSHA256 != report.ReportRevision ||
		manifest.ReferenceCount != len(references) || manifest.ReferenceCount > maxGeneReferenceIndex || manifest.ReferenceCount < 0 ||
		len(manifest.ReferenceMaterials) != manifest.ReferenceCount {
		return nil, ErrGeneManifestConflict
	}
	ids, hrefs := make(map[string]bool), make(map[string]bool)
	for _, resource := range manifest.Resources {
		if !validGeneManifestResource(resource, manifest.GeneID, manifest.ReportSHA256) || ids[resource.ID] || hrefs[resource.MarkdownHref] {
			return nil, ErrGeneManifestConflict
		}
		ids[resource.ID], hrefs[resource.MarkdownHref] = true, true
	}
	totalExcerptBytes := 0
	for i, material := range manifest.ReferenceMaterials {
		totalExcerptBytes += len(material.Excerpt)
		if material.ReferenceIndex != i+1 || len(material.Excerpt) > 64<<10 || totalExcerptBytes > 4<<20 {
			return nil, ErrGeneManifestConflict
		}
		seen := make(map[string]bool)
		for _, id := range material.ResourceIDs {
			if !ids[id] || seen[id] {
				return nil, ErrGeneManifestConflict
			}
			seen[id] = true
		}
	}
	return &manifest, nil
}

// encoding/json replaces unpaired UTF-16 escapes with U+FFFD. Reject those
// escapes first so approved excerpts are never silently rewritten. The JSON
// decoder still owns all syntax and type validation, including other escapes.
func validGeneJSONUnicode(data []byte) bool {
	for i := 0; i < len(data); i++ {
		if data[i] != '\\' {
			continue
		}
		i++
		if i >= len(data) || data[i] != 'u' {
			continue
		}
		if i+5 > len(data) {
			return false
		}
		first, err := strconv.ParseUint(string(data[i+1:i+5]), 16, 16)
		if err != nil {
			return false
		}
		i += 4
		if !utf16.IsSurrogate(rune(first)) {
			continue
		}
		if i+7 > len(data) || data[i+1] != '\\' || data[i+2] != 'u' {
			return false
		}
		second, err := strconv.ParseUint(string(data[i+3:i+7]), 16, 16)
		if err != nil || utf16.DecodeRune(rune(first), rune(second)) == utf8.RuneError {
			return false
		}
		i += 6
	}
	return true
}

func validGeneManifestResource(resource geneManifestResource, gene, revision string) bool {
	extension, mediaType := "", ""
	switch resource.Kind {
	case "image":
		extension, mediaType = ".png", "image/png"
	case "cif":
		extension, mediaType = ".cif", "chemical/x-cif"
	case "markdown":
		extension, mediaType = ".md", "text/markdown"
	default:
		return false
	}
	if !geneMaterialID.MatchString(resource.ID) || !geneMaterialDigest.MatchString(resource.SHA256) ||
		resource.SizeBytes < 1 || resource.SizeBytes > maxGeneReportTextBytes || resource.MediaType != mediaType ||
		len(resource.Name) < 1 || len(resource.Name) > 255 || strings.ContainsAny(resource.Name, `/\`) ||
		strings.IndexFunc(resource.Name, unicode.IsControl) >= 0 || path.Ext(resource.Name) != extension ||
		!validGeneMaterialHref(resource.MarkdownHref) {
		return false
	}
	key := geneRelayRoot + "materials/" + gene + "/" + revision + "/" + resource.ID + extension
	if resource.Kind == "image" {
		key = geneRelayRoot + "img/" + gene + "/" + gene + "_" + resource.ID + extension
	}
	return resource.ObjectKey == key
}

func validGeneMaterialHref(href string) bool {
	if len(href) < 1 || len(href) > 2048 || strings.TrimSpace(href) != href || strings.ContainsAny(href, `\?#%<>"'`) ||
		strings.IndexFunc(href, unicode.IsControl) >= 0 || strings.HasPrefix(href, "//") ||
		strings.HasPrefix(href, "/") && !strings.HasPrefix(href, "/api/") {
		return false
	}
	parsed, err := url.Parse(href)
	return err == nil && parsed.Scheme == "" && parsed.Host == "" && parsed.Path != ""
}

func (bundle *geneReportBundle) loadManifest(ctx context.Context) error {
	report := bundle.report
	reader, size, err := bundle.source.open(ctx, "manifests", report.GeneId+"_result.json", geneCuratedID.MatchString(report.GeneId))
	if errors.Is(err, ErrGeneResourceNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	defer reader.Close()
	data, err := readGeneResourceBytes(ctx, reader, size, maxGeneManifestBytes)
	if err != nil {
		return err
	}
	manifest, err := parseGeneManifest(data, report)
	if err != nil {
		return err
	}
	manifestSHA := fmt.Sprintf("%x", sha256.Sum256(data))
	bundle.registered = make(map[string]geneManifestResource, len(manifest.Resources))
	publicIDs := make(map[string]string, len(manifest.Resources))
	positions := make(map[string]int, len(report.Resources))
	for i, resource := range report.Resources {
		positions[resource.MarkdownHref] = i
	}
	for _, resource := range manifest.Resources {
		identity := strings.Join([]string{report.FileName, report.GeneId, report.ReportRevision, manifestSHA, resource.ID, resource.ObjectKey, resource.SHA256}, "\x00")
		id := fmt.Sprintf("gene-%x", sha256.Sum256([]byte(identity)))
		public := common.GeneReportResource{ID: id, Name: resource.Name, Kind: resource.Kind, MarkdownHref: resource.MarkdownHref}
		if resource.Kind == "image" {
			public.DisplayURL = geneImageHrefPrefix + report.GeneId + "/" + path.Base(resource.ObjectKey)
		}
		if i, exists := positions[resource.MarkdownHref]; exists {
			report.Resources[i] = public
		} else {
			report.Resources = append(report.Resources, public)
		}
		bundle.registered[id], publicIDs[resource.ID] = resource, id
	}
	for _, material := range manifest.ReferenceMaterials {
		ids := make([]string, 0, len(material.ResourceIDs))
		for _, id := range material.ResourceIDs {
			ids = append(ids, publicIDs[id])
		}
		report.ReferenceMaterials = append(report.ReferenceMaterials, common.GeneReferenceMaterial{
			ReferenceIndex: material.ReferenceIndex, Excerpt: material.Excerpt, ResourceIDs: ids,
		})
	}
	return nil
}
