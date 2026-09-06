package citation

type Run struct {
	Text   string `json:"text"`
	Bold   bool   `json:"bold,omitempty"`
	Italic bool   `json:"italic,omitempty"`
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
