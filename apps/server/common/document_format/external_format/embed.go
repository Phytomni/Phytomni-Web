package external_format

import "embed"

//go:embed empty.docx template.docx simsun.ttf msyh.ttf
var files embed.FS
