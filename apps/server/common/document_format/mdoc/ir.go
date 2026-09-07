package mdoc

// Image is a raster payload fetched for a Markdown image destination.
type Image struct {
	Bytes []byte
	MIME  string
}

// ImageFetcher loads one Markdown image href. A nil fetcher or a fetch error
// leaves the image as alt text; it must not fail the whole document.
type ImageFetcher func(href string) (*Image, error)

// Options control Markdown-to-document rendering.
type Options struct {
	FetchImage ImageFetcher
}

type inlineKind int

const (
	inlineText inlineKind = iota
	inlineImage
)

type style struct {
	bold     bool
	italic   bool
	code     bool
	strike   bool
	vertical verticalPosition
}

type verticalPosition string

const (
	verticalBaseline    verticalPosition = ""
	verticalSuperscript verticalPosition = "superscript"
	verticalSubscript   verticalPosition = "subscript"
)

type inline struct {
	kind     inlineKind
	text     string
	href     string
	style    style
	image    *Image
	citation *citationMark
}

type blockKind int

const (
	blockParagraph blockKind = iota
	blockHeading
	blockList
	blockCode
	blockQuote
	blockHR
	blockTable
)

type block struct {
	kind           blockKind
	level          int
	ordered        bool
	inlines        []inline
	items          [][]block
	children       []block
	code           string
	rows           [][][]inline
	role           reportRole
	referenceIndex int
	alignments     []tableAlignment
}

// Document is the shared semantic cited report consumed by document writers.
type Document struct{ blocks []block }

const (
	maxImages          = 16
	maxImageBytes      = 8 << 20
	maxTotalImageBytes = 24 << 20
)

type imageBudget struct {
	count int
	bytes int
}

func (b *imageBudget) allow(n int) bool {
	if n <= 0 || n > maxImageBytes {
		return false
	}
	if b.count >= maxImages || b.bytes+n > maxTotalImageBytes {
		return false
	}
	b.count++
	b.bytes += n
	return true
}
