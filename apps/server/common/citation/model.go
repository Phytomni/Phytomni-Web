package citation

type Vertical string

const (
	VerticalSuperscript Vertical = "superscript"
	VerticalSubscript   Vertical = "subscript"
)

type Run struct {
	Text     string   `json:"text"`
	Bold     bool     `json:"bold,omitempty"`
	Italic   bool     `json:"italic,omitempty"`
	Vertical Vertical `json:"vertical,omitempty"`
}

type Link struct {
	Label string `json:"label"`
	Href  string `json:"href"`
}

type Presentation struct {
	Runs  []Run  `json:"runs"`
	Links []Link `json:"links"`
}

type Source struct {
	Title, AU, TI, SO, VL, BP, EP, AR, PY, DI, DL, PM, Formatted string
}
