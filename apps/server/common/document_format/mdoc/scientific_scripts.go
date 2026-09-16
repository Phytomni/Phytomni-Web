package mdoc

import "strings"

type scientificScript struct {
	ascii    rune
	vertical verticalPosition
}

var scientificScripts = map[rune]scientificScript{
	'⁰': {'0', verticalSuperscript},
	'¹': {'1', verticalSuperscript},
	'²': {'2', verticalSuperscript},
	'³': {'3', verticalSuperscript},
	'⁴': {'4', verticalSuperscript},
	'⁵': {'5', verticalSuperscript},
	'⁶': {'6', verticalSuperscript},
	'⁷': {'7', verticalSuperscript},
	'⁸': {'8', verticalSuperscript},
	'⁹': {'9', verticalSuperscript},
	'⁺': {'+', verticalSuperscript},
	'⁻': {'-', verticalSuperscript},
	'⁼': {'=', verticalSuperscript},
	'⁽': {'(', verticalSuperscript},
	'⁾': {')', verticalSuperscript},
	'₀': {'0', verticalSubscript},
	'₁': {'1', verticalSubscript},
	'₂': {'2', verticalSubscript},
	'₃': {'3', verticalSubscript},
	'₄': {'4', verticalSubscript},
	'₅': {'5', verticalSubscript},
	'₆': {'6', verticalSubscript},
	'₇': {'7', verticalSubscript},
	'₈': {'8', verticalSubscript},
	'₉': {'9', verticalSubscript},
	'₊': {'+', verticalSubscript},
	'₋': {'-', verticalSubscript},
	'₌': {'=', verticalSubscript},
	'₍': {'(', verticalSubscript},
	'₎': {')', verticalSubscript},
}

func normalizeScientificDocument(document Document) Document {
	return Document{blocks: cloneScientificBlocks(document.blocks)}
}

func cloneScientificBlocks(blocks []block) []block {
	if blocks == nil {
		return nil
	}
	out := make([]block, len(blocks))
	for i, b := range blocks {
		cloned := b
		cloned.inlines = cloneScientificInlines(b.inlines)
		cloned.items = cloneScientificItems(b.items)
		cloned.children = cloneScientificBlocks(b.children)
		cloned.rows = cloneScientificRows(b.rows)
		if b.alignments != nil {
			cloned.alignments = append([]tableAlignment(nil), b.alignments...)
		}
		out[i] = cloned
	}
	return out
}

func cloneScientificItems(items [][]block) [][]block {
	if items == nil {
		return nil
	}
	out := make([][]block, len(items))
	for i, item := range items {
		out[i] = cloneScientificBlocks(item)
	}
	return out
}

func cloneScientificRows(rows [][][]inline) [][][]inline {
	if rows == nil {
		return nil
	}
	out := make([][][]inline, len(rows))
	for i, row := range rows {
		if row == nil {
			continue
		}
		cells := make([][]inline, len(row))
		for j, cell := range row {
			cells[j] = cloneScientificInlines(cell)
		}
		out[i] = cells
	}
	return out
}

func cloneScientificInlines(inlines []inline) []inline {
	if inlines == nil {
		return nil
	}
	out := make([]inline, 0, len(inlines))
	for _, in := range inlines {
		out = append(out, normalizeScientificInline(in)...)
	}
	return out
}

func cloneScientificInline(in inline) inline {
	out := in
	out.image = cloneScientificImage(in.image)
	out.citation = cloneScientificCitation(in.citation)
	return out
}

func cloneScientificImage(img *Image) *Image {
	if img == nil {
		return nil
	}
	cloned := *img
	if img.Bytes != nil {
		cloned.Bytes = append([]byte(nil), img.Bytes...)
	}
	return &cloned
}

func cloneScientificCitation(mark *citationMark) *citationMark {
	if mark == nil {
		return nil
	}
	cloned := *mark
	if mark.indices != nil {
		cloned.indices = append([]int(nil), mark.indices...)
	}
	return &cloned
}

func normalizeScientificInline(in inline) []inline {
	if in.kind != inlineText || in.style.code || in.style.vertical != verticalBaseline {
		return []inline{cloneScientificInline(in)}
	}
	return splitScientificText(in)
}

func splitScientificText(in inline) []inline {
	if in.text == "" {
		return []inline{cloneScientificInline(in)}
	}
	var (
		out     []inline
		buf     strings.Builder
		current verticalPosition
		started bool
	)
	flush := func() {
		if !started {
			return
		}
		run := cloneScientificInline(in)
		run.text = buf.String()
		run.style.vertical = current
		out = append(out, run)
		buf.Reset()
	}
	for _, r := range in.text {
		ascii, vertical := r, verticalBaseline
		if mapped, ok := scientificScripts[r]; ok {
			ascii, vertical = mapped.ascii, mapped.vertical
		}
		if !started {
			current = vertical
			started = true
		} else if vertical != current {
			flush()
			current = vertical
		}
		buf.WriteRune(ascii)
	}
	flush()
	return out
}
