package api_service

import (
	"errors"
	"sort"
	"strings"
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

var textAttachmentSuffixes = map[string]struct{}{
	".txt": {}, ".text": {},
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
	return classifyAttachment(filename, nil)
}

func classifyAttachment(filename string, allowed []attachmentClass) (attachmentClass, error) {
	comparisonKey := strings.ToLower(strings.TrimSpace(filename))

	strong := false
	var class attachmentClass
	switch {
	case hasAttachmentSuffix(comparisonKey, archiveAttachmentSuffixes),
		hasAttachmentSuffix(comparisonKey, datasetAttachmentSuffixes):
		strong = true
		class = attachmentClassDataset
	case hasAttachmentSuffix(comparisonKey, documentAttachmentSuffixes):
		strong = true
		class = attachmentClassDocument
	case hasAttachmentSuffix(comparisonKey, textAttachmentSuffixes):
		class = attachmentClassDocument
	default:
		class = attachmentClassDataset
	}
	if strong {
		return class, nil
	}
	return applyAllowedChannels(class, allowed)
}

func applyAllowedChannels(class attachmentClass, allowed []attachmentClass) (attachmentClass, error) {
	if allowed == nil {
		return class, nil
	}
	if len(allowed) == 0 {
		return "", ErrAttachmentTypeUnsupported
	}
	var hasDocument, hasDataset bool
	for _, purpose := range allowed {
		switch purpose {
		case attachmentClassDocument:
			hasDocument = true
		case attachmentClassDataset:
			hasDataset = true
		}
	}
	switch {
	case hasDocument && hasDataset:
		return class, nil
	case hasDataset:
		return attachmentClassDataset, nil
	case hasDocument:
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
