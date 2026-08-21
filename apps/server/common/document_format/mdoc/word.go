package mdoc

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"

	"github.com/gomutex/godocx"
	"github.com/gomutex/godocx/common/units"
	"github.com/gomutex/godocx/docx"
	"github.com/gomutex/godocx/wml/stypes"
)

const (
	wordMaxImageInchW = 6.2
	wordMaxImageInchH = 8.0
)

// RenderWord turns Markdown into a structured .docx.
func RenderWord(src string, opts Options) ([]byte, error) {
	blocks, err := parse(src, opts)
	if err != nil {
		return nil, err
	}
	doc, err := godocx.NewDocument()
	if err != nil {
		return nil, fmt.Errorf("create word document: %w", err)
	}
	tmp, err := os.MkdirTemp("", "phytomni-mdoc-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)

	w := &wordWriter{doc: doc, tmp: tmp}
	if err := w.writeBlocks(blocks, 0); err != nil {
		return nil, err
	}
	buf := new(bytes.Buffer)
	if err := doc.Write(buf); err != nil {
		return nil, fmt.Errorf("write word document: %w", err)
	}
	return buf.Bytes(), nil
}

type wordWriter struct {
	doc  *docx.RootDoc
	tmp  string
	imgN int
}

func (w *wordWriter) writeBlocks(blocks []block, indent int) error {
	for _, b := range blocks {
		if err := w.writeBlock(b, indent); err != nil {
			return err
		}
	}
	return nil
}

func (w *wordWriter) writeBlock(b block, indent int) error {
	switch b.kind {
	case blockHeading:
		level := b.level
		if level < 1 {
			level = 1
		}
		if level > 6 {
			level = 6
		}
		p := w.doc.AddEmptyParagraph()
		p.Style(fmt.Sprintf("Heading%d", level))
		return w.writeInlines(p, b.inlines)
	case blockParagraph:
		p := w.doc.AddEmptyParagraph()
		return w.writeInlines(p, b.inlines)
	case blockList:
		return w.writeList(b, indent)
	case blockCode:
		p := w.doc.AddEmptyParagraph()
		run := p.AddText(b.code)
		run.Highlight("lightGray")
		return nil
	case blockQuote:
		return w.writeBlocks(b.children, indent+1)
	case blockHR:
		w.doc.AddEmptyParagraph()
		return nil
	case blockTable:
		return w.writeTable(b)
	default:
		return nil
	}
}

func (w *wordWriter) writeList(b block, indent int) error {
	pad := ""
	if indent > 0 {
		pad = "    "
	}
	for i, item := range b.items {
		prefix := pad + "• "
		if b.ordered {
			prefix = pad + fmt.Sprintf("%d. ", i+1)
		}
		first := true
		for _, child := range item {
			if child.kind == blockList {
				if err := w.writeList(child, indent+1); err != nil {
					return err
				}
				continue
			}
			p := w.doc.AddEmptyParagraph()
			if first && (child.kind == blockParagraph || child.kind == blockHeading) {
				p.AddText(prefix)
				if err := w.writeInlines(p, child.inlines); err != nil {
					return err
				}
				first = false
				continue
			}
			if err := w.writeBlock(child, indent+1); err != nil {
				return err
			}
			first = false
		}
		if first {
			p := w.doc.AddEmptyParagraph()
			p.AddText(prefix)
		}
	}
	return nil
}

func (w *wordWriter) writeTable(b block) error {
	tbl := w.doc.AddTable()
	tbl.Style("TableGrid")
	for _, row := range b.rows {
		wr := tbl.AddRow()
		for _, cell := range row {
			c := wr.AddCell()
			p := c.AddEmptyPara()
			if err := w.writeInlines(p, cell); err != nil {
				return err
			}
		}
	}
	return nil
}

func (w *wordWriter) writeInlines(p *docx.Paragraph, inlines []inline) error {
	for _, in := range inlines {
		if in.kind == inlineImage {
			if in.image != nil {
				if err := w.addPicture(p, in.image); err == nil {
					continue
				}
			}
			if in.text != "" {
				p.AddText(in.text)
			}
			continue
		}
		if in.text == "" {
			continue
		}
		run := p.AddText(in.text)
		if in.style.bold {
			run.Bold(true)
		}
		if in.style.italic {
			run.Italic(true)
		}
		if in.style.strike {
			run.Strike(true)
		}
		if in.style.code {
			run.Highlight("lightGray")
		}
		if in.href != "" {
			run.Color("0563C1")
			run.Underline(stypes.UnderlineSingle)
		}
	}
	return nil
}

func (w *wordWriter) addPicture(p *docx.Paragraph, img *Image) error {
	path, err := w.tempImage(img)
	if err != nil {
		return err
	}
	pxW, pxH := imageSize(img)
	var inchW, inchH float64
	if pxW > 0 {
		inchW, inchH = scaleTo(pxW, pxH, wordMaxImageInchW*96, wordMaxImageInchH*96)
		inchW /= 96
		inchH /= 96
	} else {
		inchW, inchH = wordMaxImageInchW, wordMaxImageInchW*0.6
	}
	_, err = p.AddPicture(path, units.Inch(inchW), units.Inch(inchH))
	return err
}

func (w *wordWriter) tempImage(img *Image) (string, error) {
	w.imgN++
	path := filepath.Join(w.tmp, fmt.Sprintf("img-%d%s", w.imgN, imageExt(img.MIME)))
	if err := os.WriteFile(path, img.Bytes, 0o600); err != nil {
		return "", err
	}
	return path, nil
}
