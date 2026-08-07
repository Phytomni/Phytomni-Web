package api_service

import (
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestClassifyAttachmentFilenameArchiveSuffixes(t *testing.T) {
	archiveSuffixes := []string{
		".zip", ".zipx",
		".tar", ".tgz", ".tbz", ".tbz2", ".txz", ".tlz", ".tzst",
		".gz", ".bgz", ".bgzf", ".bgzip", ".bz", ".bz2", ".xz", ".lz", ".lzma", ".lz4", ".lzo", ".br", ".z", ".zst",
		".7z", ".rar", ".cab", ".ace", ".arj",
	}

	for _, suffix := range archiveSuffixes {
		t.Run(suffix, func(t *testing.T) {
			assertAttachmentClass(t, "paper.pdf"+suffix, attachmentClassDataset)
			assertAttachmentClass(t, "PAPER.PDF"+strings.ToUpper(suffix), attachmentClassDataset)
		})
	}

	for _, filename := range []string{"READS.FASTQ.GZ", "variants.VCF.BGZ", "bundle.TAR.GZ"} {
		t.Run(filename, func(t *testing.T) {
			assertAttachmentClass(t, filename, attachmentClassDataset)
		})
	}
}

func TestClassifyAttachmentFilenameStrongSuffixFamilies(t *testing.T) {
	datasetFamilies := map[string][]string{
		"sequence":      {".fa", ".fasta", ".fna", ".ffn", ".faa", ".frn"},
		"reads":         {".fq", ".fastq", ".qual", ".sff", ".fast5", ".pod5", ".bcl", ".cbcl"},
		"records":       {".gb", ".gbk", ".genbank", ".embl"},
		"alignments":    {".sam", ".bam", ".cram"},
		"variants":      {".vcf", ".bcf", ".gvcf"},
		"intervals":     {".bed", ".bedgraph", ".broadpeak", ".narrowpeak", ".gappedpeak"},
		"annotations":   {".gff", ".gff3", ".gtf", ".wig", ".bw", ".bigwig", ".bb", ".bigbed"},
		"genome-maps":   {".maf", ".psl", ".chain", ".2bit"},
		"phylogenetics": {".aln", ".clustal", ".phy", ".phylip", ".nex", ".nexus", ".nwk", ".newick", ".tree", ".sto", ".stockholm"},
		"genotypes":     {".ped", ".map", ".bim", ".fam", ".pgen", ".pvar", ".psam", ".bgen", ".gen", ".haps", ".sample"},
		"matrices":      {".h5", ".hdf5", ".h5ad", ".loom", ".mtx", ".cool", ".mcool", ".hic"},
		"instruments":   {".cel", ".idat", ".fcs", ".biom", ".qza", ".qzv", ".sra", ".ab1"},
		"serialized":    {".rds", ".rdata", ".mat", ".npy", ".npz"},
		"columnar":      {".parquet", ".feather", ".arrow"},
		"tables":        {".csv", ".tsv", ".xls", ".xlsx"},
		"structured":    {".json", ".jsonl", ".ndjson", ".xml", ".yaml", ".yml"},
		"mass-spectra":  {".mzml", ".mzxml", ".mgf", ".mzid", ".pepxml", ".protxml", ".raw"},
		"structures":    {".pdb", ".cif", ".mmcif", ".sdf", ".mol", ".mol2"},
		"ontologies":    {".obo", ".owl", ".rdf"},
		"bioimaging":    {".tif", ".tiff", ".czi", ".nd2", ".lif", ".svs", ".dcm"},
	}

	for family, suffixes := range datasetFamilies {
		t.Run(family, func(t *testing.T) {
			for _, suffix := range suffixes {
				assertAttachmentClass(t, "input"+suffix, attachmentClassDataset)
			}
		})
	}

	documentFamilies := map[string][]string{
		"word-processing": {".pdf", ".doc", ".docx", ".odt", ".rtf"},
		"markup":          {".md", ".markdown", ".tex"},
		"presentations":   {".ppt", ".pptx", ".odp"},
		"web-and-ebooks":  {".html", ".htm", ".epub"},
	}

	for family, suffixes := range documentFamilies {
		t.Run(family, func(t *testing.T) {
			for _, suffix := range suffixes {
				assertAttachmentClass(t, "input"+suffix, attachmentClassDocument)
			}
		})
	}
}

func TestClassifyAttachmentFilenamePrecedence(t *testing.T) {
	tests := []struct {
		filename string
		want     attachmentClass
	}{
		{filename: "report.csv", want: attachmentClassDataset},
		{filename: "counts.pdf", want: attachmentClassDocument},
		{filename: "paper.pdf.zip", want: attachmentClassDataset},
	}

	for _, test := range tests {
		t.Run(test.filename, func(t *testing.T) {
			assertAttachmentClass(t, test.filename, test.want)
		})
	}
}

func TestClassifyAttachmentFilenameNeutralTokens(t *testing.T) {
	tokenSets := []struct {
		name   string
		tokens []string
		want   attachmentClass
	}{
		{
			name: "dataset",
			tokens: []string{
				"count", "counts", "matrix", "expression", "reads", "read", "sequence", "sequences",
				"variant", "variants", "genotype", "phenotype", "metadata", "sample", "samples",
				"abundance", "peak", "peaks", "annotation", "annotations", "coordinate", "coordinates",
				"network", "edge", "edges", "node", "nodes",
			},
			want: attachmentClassDataset,
		},
		{
			name: "document",
			tokens: []string{
				"readme", "license", "paper", "article", "manuscript", "protocol", "report",
				"reference", "references", "literature", "note", "notes",
			},
			want: attachmentClassDocument,
		},
	}

	for _, tokenSet := range tokenSets {
		t.Run(tokenSet.name, func(t *testing.T) {
			for _, token := range tokenSet.tokens {
				assertAttachmentClass(t, token+".txt", tokenSet.want)
				assertAttachmentClass(t, "experiment-"+token, tokenSet.want)
			}
		})
	}
}

func TestClassifyAttachmentFilenameErrors(t *testing.T) {
	tests := []struct {
		filename string
		wantErr  error
	}{
		{filename: "sample_report.txt", wantErr: ErrAttachmentTypeAmbiguous},
		{filename: "counts-paper", wantErr: ErrAttachmentTypeAmbiguous},
		{filename: "input.unknown", wantErr: ErrAttachmentTypeUnsupported},
		{filename: "misc.txt", wantErr: ErrAttachmentTypeUnsupported},
		{filename: "misc-01", wantErr: ErrAttachmentTypeUnsupported},
		{filename: "report.txt.bak", wantErr: ErrAttachmentTypeUnsupported},
		{filename: "discount.txt", wantErr: ErrAttachmentTypeUnsupported},
		{filename: "sequences2.txt", wantErr: ErrAttachmentTypeUnsupported},
	}

	for _, test := range tests {
		t.Run(test.filename, func(t *testing.T) {
			_, err := classifyAttachmentFilename(test.filename)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("classifyAttachmentFilename(%q) error = %v, want %v", test.filename, err, test.wantErr)
			}
		})
	}
}

func TestClassifyAttachmentFilenameSafeBasenameEdges(t *testing.T) {
	tests := []struct {
		name     string
		filename string
		want     attachmentClass
		wantErr  error
	}{
		{name: "NFC Unicode", filename: "r\u00e9sum\u00e9_report.txt", want: attachmentClassDocument},
		{name: "surrounding Unicode whitespace", filename: "\u2003counts.csv\u00a0", want: attachmentClassDataset},
		{name: "hidden neutral name", filename: ".counts", want: attachmentClassDataset},
		{name: "trailing dot", filename: "counts.", wantErr: ErrAttachmentTypeUnsupported},
		{name: "safe markup-like basename", filename: "<img src=x onerror=alert(1)>.pdf", want: attachmentClassDocument},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := classifyAttachmentFilename(test.filename)
			if test.wantErr != nil {
				if !errors.Is(err, test.wantErr) {
					t.Fatalf("classifyAttachmentFilename(%q) error = %v, want %v", test.filename, err, test.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("classifyAttachmentFilename(%q) unexpected error: %v", test.filename, err)
			}
			if got != test.want {
				t.Fatalf("classifyAttachmentFilename(%q) = %q, want %q", test.filename, got, test.want)
			}
		})
	}
}

func TestClassifyAttachmentFilenameDoesNotAcceptMIME(t *testing.T) {
	var classifier func(string) (attachmentClass, error) = classifyAttachmentFilename
	got, err := classifier("reads.fastq")
	if err != nil || got != attachmentClassDataset {
		t.Fatalf("classifier(reads.fastq) = %q, %v; want %q, nil", got, err, attachmentClassDataset)
	}
}

func assertAttachmentClass(t *testing.T, filename string, want attachmentClass) {
	t.Helper()

	got, err := classifyAttachmentFilename(filename)
	if err != nil {
		t.Fatalf("classifyAttachmentFilename(%q) unexpected error: %v", filename, err)
	}
	if got != want {
		t.Fatalf("classifyAttachmentFilename(%q) = %q, want %q", filename, got, want)
	}
	if fmt.Sprint(got) != string(want) {
		t.Fatalf("attachment class display = %q, want %q", got, want)
	}
}
