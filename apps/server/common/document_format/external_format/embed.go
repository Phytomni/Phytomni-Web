package external_format

import "embed"

//go:embed empty.docx template.docx simsun.ttf msyh.ttf noto_sans_symbols_2.ttf noto_sans_symbols_2.OFL.txt
var files embed.FS
