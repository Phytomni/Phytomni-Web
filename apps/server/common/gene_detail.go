package common

import "encoding/json"

// GeneDetailResponse is the normalized, report-scoped public gene detail view.
type GeneDetailResponse struct {
	Id                 int64                   `json:"id"`
	FileName           string                  `json:"file_name"`
	GeneId             string                  `json:"gene_id"`
	SpeciesCode        string                  `json:"species_code"`
	Content            string                  `json:"content"`
	References         json.RawMessage         `json:"references"`
	Resources          []GeneReportResource    `json:"resources"`
	ReferenceMaterials []GeneReferenceMaterial `json:"reference_materials"`
	ReportRevision     string                  `json:"report_revision"`
}

// GeneReportResource contains presentation fields, never storage credentials or keys.
type GeneReportResource struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Kind         string `json:"kind"`
	MarkdownHref string `json:"markdownHref"`
	DisplayURL   string `json:"displayUrl,omitempty"`
}

// GeneReferenceMaterial binds an available source fragment to its numbered slot.
type GeneReferenceMaterial struct {
	ReferenceIndex int      `json:"referenceIndex"`
	Excerpt        string   `json:"excerpt,omitempty"`
	ResourceIDs    []string `json:"resourceIds"`
}
