package api_service

import (
	"errors"
	"sort"
	"strings"
	"unicode"
)

type attachmentClass string

const (
	attachmentClassDataset  attachmentClass = "dataset"
	attachmentClassDocument attachmentClass = "document"
)

var (
	ErrAttachmentTypeUnsupported = errors.New("attachment_type_unsupported")
	ErrAttachmentTypeAmbiguous   = errors.New("attachment_type_ambiguous")
)

var archiveAttachmentSuffixes = map[string]struct{}{
	".zip": {}, ".tar": {}, ".tgz": {}, ".gz": {}, ".bgzf": {},
	".bz2": {}, ".xz": {}, ".zst": {}, ".7z": {}, ".rar": {},
}

var datasetAttachmentSuffixes = map[string]struct{}{
	".fa": {}, ".fasta": {}, ".fna": {}, ".ffn": {}, ".faa": {}, ".frn": {},
	".fq": {}, ".fastq": {}, ".qual": {}, ".sff": {}, ".fast5": {}, ".pod5": {}, ".bcl": {}, ".cbcl": {},
	".gb": {}, ".gbk": {}, ".genbank": {}, ".embl": {},
	".sam": {}, ".bam": {}, ".cram": {},
	".vcf": {}, ".bcf": {}, ".gvcf": {},
	".bed": {}, ".bedgraph": {}, ".broadpeak": {}, ".narrowpeak": {}, ".gappedpeak": {},
	".gff": {}, ".gff3": {}, ".gtf": {}, ".wig": {}, ".bw": {}, ".bigwig": {}, ".bb": {}, ".bigbed": {},
	".maf": {}, ".psl": {}, ".chain": {}, ".2bit": {},
	".aln": {}, ".clustal": {}, ".phy": {}, ".phylip": {}, ".nex": {}, ".nexus": {}, ".nwk": {}, ".newick": {}, ".tree": {}, ".sto": {}, ".stockholm": {},
	".ped": {}, ".map": {}, ".bim": {}, ".fam": {}, ".pgen": {}, ".pvar": {}, ".psam": {}, ".bgen": {}, ".gen": {}, ".haps": {}, ".sample": {},
	".h5": {}, ".hdf5": {}, ".h5ad": {}, ".loom": {}, ".mtx": {}, ".cool": {}, ".mcool": {}, ".hic": {},
	".cel": {}, ".idat": {}, ".fcs": {}, ".biom": {}, ".qza": {}, ".qzv": {}, ".sra": {}, ".ab1": {},
	".rds": {}, ".rdata": {}, ".mat": {}, ".npy": {}, ".npz": {},
	".parquet": {}, ".feather": {}, ".arrow": {},
	".csv": {}, ".tsv": {}, ".xls": {}, ".xlsx": {},
	".json": {}, ".jsonl": {}, ".ndjson": {}, ".xml": {}, ".yaml": {}, ".yml": {},
	".mzml": {}, ".mzxml": {}, ".mgf": {}, ".mzid": {}, ".pepxml": {}, ".protxml": {}, ".raw": {},
	".pdb": {}, ".cif": {}, ".mmcif": {}, ".sdf": {}, ".mol": {}, ".mol2": {},
	".obo": {}, ".owl": {}, ".rdf": {},
	".tif": {}, ".tiff": {}, ".czi": {}, ".nd2": {}, ".lif": {}, ".svs": {}, ".dcm": {},
}

var documentAttachmentSuffixes = map[string]struct{}{
	".pdf": {}, ".doc": {}, ".docx": {}, ".odt": {}, ".rtf": {},
	".md": {}, ".markdown": {}, ".tex": {},
	".ppt": {}, ".pptx": {}, ".odp": {},
	".html": {}, ".htm": {}, ".epub": {},
}

var datasetAttachmentTokens = map[string]struct{}{
	"count": {}, "counts": {}, "matrix": {}, "expression": {}, "reads": {}, "read": {}, "sequence": {}, "sequences": {},
	"variant": {}, "variants": {}, "genotype": {}, "phenotype": {}, "metadata": {}, "sample": {}, "samples": {},
	"abundance": {}, "peak": {}, "peaks": {}, "annotation": {}, "annotations": {}, "coordinate": {}, "coordinates": {},
	"network": {}, "edge": {}, "edges": {}, "node": {}, "nodes": {},
}

var documentAttachmentTokens = map[string]struct{}{
	"readme": {}, "license": {}, "paper": {}, "article": {}, "manuscript": {}, "protocol": {}, "report": {},
	"reference": {}, "references": {}, "literature": {}, "note": {}, "notes": {},
}

// RequiredResearchDatasetFormats returns the detached scientific suffix
// contract accepted by Web for Research datasets.
func RequiredResearchDatasetFormats() []string {
	formats := make([]string, 0, len(datasetAttachmentSuffixes)+len(archiveAttachmentSuffixes))
	for suffix := range datasetAttachmentSuffixes {
		formats = append(formats, strings.ToLower(strings.TrimPrefix(suffix, ".")))
	}
	for suffix := range archiveAttachmentSuffixes {
		formats = append(formats, strings.ToLower(strings.TrimPrefix(suffix, ".")))
	}
	sort.Strings(formats)
	return formats
}

func classifyAttachmentFilename(filename string) (attachmentClass, error) {
	comparisonKey := strings.ToLower(strings.TrimSpace(filename))

	if hasAttachmentSuffix(comparisonKey, archiveAttachmentSuffixes) {
		return attachmentClassDataset, nil
	}
	if hasAttachmentSuffix(comparisonKey, datasetAttachmentSuffixes) {
		return attachmentClassDataset, nil
	}
	if hasAttachmentSuffix(comparisonKey, documentAttachmentSuffixes) {
		return attachmentClassDocument, nil
	}

	neutralKey, ok := neutralAttachmentKey(comparisonKey)
	if !ok {
		return "", ErrAttachmentTypeUnsupported
	}

	var hasDatasetToken, hasDocumentToken bool
	for _, token := range strings.FieldsFunc(neutralKey, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	}) {
		_, datasetMatch := datasetAttachmentTokens[token]
		_, documentMatch := documentAttachmentTokens[token]
		hasDatasetToken = hasDatasetToken || datasetMatch
		hasDocumentToken = hasDocumentToken || documentMatch
	}

	switch {
	case hasDatasetToken && hasDocumentToken:
		return "", ErrAttachmentTypeAmbiguous
	case hasDatasetToken:
		return attachmentClassDataset, nil
	case hasDocumentToken:
		return attachmentClassDocument, nil
	default:
		return "", ErrAttachmentTypeUnsupported
	}
}

func hasAttachmentSuffix(filename string, suffixes map[string]struct{}) bool {
	for suffix := range suffixes {
		if strings.HasSuffix(filename, suffix) {
			return true
		}
	}
	return false
}

func neutralAttachmentKey(comparisonKey string) (string, bool) {
	if strings.HasSuffix(comparisonKey, ".txt") {
		return strings.TrimSuffix(comparisonKey, ".txt"), true
	}

	withoutLeadingDots := strings.TrimLeft(comparisonKey, ".")
	if !strings.ContainsRune(withoutLeadingDots, '.') {
		return withoutLeadingDots, true
	}
	return "", false
}
