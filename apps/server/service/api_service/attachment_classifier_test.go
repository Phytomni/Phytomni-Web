package api_service

import (
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func TestResearchFormatContractCoversPaperSample(t *testing.T) {
	paths := []string{
		"GSM4363196_9311RPM.txt.gz",
		"GSM4363200_9311_matrix.mtx.gz",
		"A_thaliana_pep__v__NIP_genome_pep.tsv",
		"org.Osativa.eg.db.tar.gz",
	}
	for _, path := range paths {
		if class, err := classifyAttachmentFilename(path); err != nil || class != attachmentClassDataset {
			t.Fatalf("%s class=%q err=%v", path, class, err)
		}
	}
}

func TestResearchFormatsRequiredAreSortedDetachedSuffixTokens(t *testing.T) {
	first := RequiredResearchDatasetFormats()
	second := RequiredResearchDatasetFormats()
	if len(first) == 0 || !sort.StringsAreSorted(first) {
		t.Fatalf("required formats are not a non-empty sorted list: %v", first)
	}

	requiredSamples := map[string]bool{"gz": false, "mtx": false, "tar": false, "tsv": false}
	for _, format := range first {
		if format != strings.ToLower(format) || strings.HasPrefix(format, ".") {
			t.Fatalf("format %q is not a lower-case suffix token", format)
		}
		if _, ok := requiredSamples[format]; ok {
			requiredSamples[format] = true
		}
	}
	for format, found := range requiredSamples {
		if !found {
			t.Fatalf("required formats omitted %q: %v", format, first)
		}
	}

	if !reflect.DeepEqual(first, second) {
		t.Fatalf("repeated calls differ: first=%v second=%v", first, second)
	}
	first[0] = "mutated"
	if second[0] == "mutated" || reflect.DeepEqual(first, second) {
		t.Fatalf("required formats share caller-owned storage: first=%v second=%v", first, second)
	}
}

func TestClassifyAttachmentFilenameArchiveSuffixes(t *testing.T) {
	archiveSuffixes := []string{
		".zip", ".tar", ".tgz", ".gz", ".bgzf",
		".bz2", ".xz", ".zst", ".7z", ".rar",
	}

	for _, suffix := range archiveSuffixes {
		t.Run(suffix, func(t *testing.T) {
			assertAttachmentClass(t, "paper.pdf"+suffix, attachmentClassDataset)
			assertAttachmentClass(t, "PAPER.PDF"+strings.ToUpper(suffix), attachmentClassDataset)
		})
	}

	for _, filename := range []string{
		"READS.FASTQ.GZ", "variants.VCF.BGZF", "bundle.TAR.GZ",
		"reads.FaStQ.Gz", "variants.VcF.BgZf", "bundle.TaR.Gz",
	} {
		t.Run(filename, func(t *testing.T) {
			assertAttachmentClass(t, filename, attachmentClassDataset)
		})
	}

	for _, suffix := range []string{
		".zipx", ".tbz", ".tbz2", ".txz", ".tlz", ".tzst",
		".bgz", ".bgzip", ".bz", ".lz", ".lzma", ".lz4", ".lzo", ".br", ".z",
		".cab", ".ace", ".arj",
	} {
		t.Run("unknown"+suffix, func(t *testing.T) {
			assertAttachmentClass(t, "bundle"+suffix, attachmentClassDataset)
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

func TestClassifyAttachmentFilenameTextAndUnknownDefaults(t *testing.T) {
	tests := []struct {
		filename string
		want     attachmentClass
	}{
		{filename: "test.txt", want: attachmentClassDocument},
		{filename: "notes.txt", want: attachmentClassDocument},
		{filename: "counts.txt", want: attachmentClassDocument},
		{filename: "sample_report.txt", want: attachmentClassDocument},
		{filename: "misc.txt", want: attachmentClassDocument},
		{filename: "readme.text", want: attachmentClassDocument},
		{filename: "input.unknown", want: attachmentClassDataset},
		{filename: "image.png", want: attachmentClassDataset},
		{filename: "script.py", want: attachmentClassDataset},
		{filename: "sample.bin", want: attachmentClassDataset},
		{filename: "report.txt.bak", want: attachmentClassDataset},
		{filename: "misc-01", want: attachmentClassDataset},
		{filename: "counts-paper", want: attachmentClassDataset},
	}

	for _, test := range tests {
		t.Run(test.filename, func(t *testing.T) {
			assertAttachmentClass(t, test.filename, test.want)
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
		{name: "trailing dot", filename: "counts.", want: attachmentClassDataset},
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

func TestClassifyAttachmentUsesAgentChannelsForNeutralNames(t *testing.T) {
	documentOnly := []attachmentClass{attachmentClassDocument}
	datasetOnly := []attachmentClass{attachmentClassDataset}
	both := []attachmentClass{attachmentClassDocument, attachmentClassDataset}

	tests := []struct {
		filename string
		allowed  []attachmentClass
		want     attachmentClass
		wantErr  error
	}{
		{filename: "test.txt", allowed: documentOnly, want: attachmentClassDocument},
		{filename: "loc_gene_id.txt", allowed: documentOnly, want: attachmentClassDocument},
		{filename: "test.txt", allowed: datasetOnly, want: attachmentClassDataset},
		{filename: "test.txt", allowed: both, want: attachmentClassDocument},
		{filename: "notes.txt", allowed: both, want: attachmentClassDocument},
		{filename: "counts.txt", allowed: documentOnly, want: attachmentClassDocument},
		{filename: "counts-paper.txt", allowed: documentOnly, want: attachmentClassDocument},
		{filename: "counts-paper.txt", allowed: both, want: attachmentClassDocument},
		{filename: "image.png", allowed: both, want: attachmentClassDataset},
		{filename: "image.png", allowed: documentOnly, want: attachmentClassDocument},
		{filename: "sample.bin", allowed: both, want: attachmentClassDataset},
		{filename: "paper.pdf", allowed: datasetOnly, want: attachmentClassDocument},
		{filename: "test.yaml", allowed: documentOnly, want: attachmentClassDataset},
		{filename: "test.txt", allowed: nil, want: attachmentClassDocument},
		{filename: "image.png", allowed: []attachmentClass{}, wantErr: ErrAttachmentTypeUnsupported},
	}

	for _, test := range tests {
		t.Run(fmt.Sprintf("%s/%v", test.filename, test.allowed), func(t *testing.T) {
			got, err := classifyAttachment(test.filename, test.allowed)
			if test.wantErr != nil {
				if !errors.Is(err, test.wantErr) {
					t.Fatalf("classifyAttachment(%q, %v) err=%v, want %v", test.filename, test.allowed, err, test.wantErr)
				}
				return
			}
			if err != nil || got != test.want {
				t.Fatalf("classifyAttachment(%q, %v) = %q, %v; want %q, nil", test.filename, test.allowed, got, err, test.want)
			}
		})
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
