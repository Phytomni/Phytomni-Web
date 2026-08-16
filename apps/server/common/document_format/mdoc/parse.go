package mdoc

import (
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	east "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
)

func parse(src string, opts Options) ([]block, error) {
	md := goldmark.New(
		goldmark.WithExtensions(extension.GFM, extension.CJK),
		goldmark.WithParserOptions(parser.WithAttribute()),
	)
	raw := []byte(src)
	doc := md.Parser().Parse(text.NewReader(raw))
	budget := &imageBudget{}
	return collectBlocks(doc, raw, opts.FetchImage, budget), nil
}

func collectBlocks(n ast.Node, src []byte, fetch ImageFetcher, budget *imageBudget) []block {
	var out []block
	for c := n.FirstChild(); c != nil; c = c.NextSibling() {
		switch t := c.(type) {
		case *ast.Heading:
			out = append(out, block{
				kind:    blockHeading,
				level:   t.Level,
				inlines: collectInlines(t, src, style{}, fetch, budget),
			})
		case *ast.Paragraph:
			out = append(out, block{
				kind:    blockParagraph,
				inlines: collectInlines(t, src, style{}, fetch, budget),
			})
		case *ast.TextBlock:
			out = append(out, block{
				kind:    blockParagraph,
				inlines: collectInlines(t, src, style{}, fetch, budget),
			})
		case *ast.List:
			item := block{kind: blockList, ordered: t.IsOrdered()}
			for li := t.FirstChild(); li != nil; li = li.NextSibling() {
				item.items = append(item.items, collectBlocks(li, src, fetch, budget))
			}
			out = append(out, item)
		case *ast.ListItem:
			out = append(out, collectBlocks(t, src, fetch, budget)...)
		case *ast.FencedCodeBlock:
			out = append(out, block{kind: blockCode, code: codeText(t, src)})
		case *ast.CodeBlock:
			out = append(out, block{kind: blockCode, code: codeText(t, src)})
		case *ast.Blockquote:
			out = append(out, block{kind: blockQuote, children: collectBlocks(t, src, fetch, budget)})
		case *ast.ThematicBreak:
			out = append(out, block{kind: blockHR})
		case *east.Table:
			out = append(out, collectTable(t, src, fetch, budget))
		case *ast.HTMLBlock:
			// Raw HTML is not imported. Match the chat renderer (allow-html=false).
		default:
			if c.HasChildren() {
				out = append(out, collectBlocks(c, src, fetch, budget)...)
			}
		}
	}
	return out
}

func collectTable(n ast.Node, src []byte, fetch ImageFetcher, budget *imageBudget) block {
	tbl := block{kind: blockTable}
	for row := n.FirstChild(); row != nil; row = row.NextSibling() {
		var cells [][]inline
		for cell := row.FirstChild(); cell != nil; cell = cell.NextSibling() {
			cells = append(cells, collectInlines(cell, src, style{}, fetch, budget))
		}
		if len(cells) > 0 {
			tbl.rows = append(tbl.rows, cells)
		}
	}
	return tbl
}

func collectInlines(n ast.Node, src []byte, st style, fetch ImageFetcher, budget *imageBudget) []inline {
	var out []inline
	for c := n.FirstChild(); c != nil; c = c.NextSibling() {
		switch t := c.(type) {
		case *ast.Text:
			out = append(out, inline{kind: inlineText, text: string(t.Segment.Value(src)), style: st})
			if t.SoftLineBreak() {
				out = append(out, inline{kind: inlineText, text: " ", style: st})
			}
			if t.HardLineBreak() {
				out = append(out, inline{kind: inlineText, text: "\n", style: st})
			}
		case *ast.String:
			out = append(out, inline{kind: inlineText, text: string(t.Value), style: st})
		case *ast.Emphasis:
			next := st
			if t.Level >= 2 {
				next.bold = true
			} else {
				next.italic = true
			}
			out = append(out, collectInlines(t, src, next, fetch, budget)...)
		case *ast.CodeSpan:
			next := st
			next.code = true
			out = append(out, inline{kind: inlineText, text: nodePlain(t, src), style: next})
		case *ast.Link:
			kids := collectInlines(t, src, st, fetch, budget)
			if href := displayLink(string(t.Destination)); href != "" {
				for i := range kids {
					if kids[i].href == "" {
						kids[i].href = href
					}
				}
			}
			out = append(out, kids...)
		case *ast.AutoLink:
			url := string(t.URL(src))
			out = append(out, inline{kind: inlineText, text: url, href: displayLink(url), style: st})
		case *ast.Image:
			alt := strings.TrimSpace(nodePlain(t, src))
			href := string(t.Destination)
			out = append(out, inline{
				kind:  inlineImage,
				text:  alt,
				href:  href,
				style: st,
				image: fetchImage(fetch, href, budget),
			})
		case *east.Strikethrough:
			next := st
			next.strike = true
			out = append(out, collectInlines(t, src, next, fetch, budget)...)
		case *ast.RawHTML:
			// Drop raw HTML tags; keep nothing.
		default:
			if c.HasChildren() {
				out = append(out, collectInlines(c, src, st, fetch, budget)...)
			}
		}
	}
	return out
}

func fetchImage(fetch ImageFetcher, href string, budget *imageBudget) *Image {
	if fetch == nil || href == "" {
		return nil
	}
	img, err := fetch(href)
	if err != nil || img == nil || len(img.Bytes) == 0 {
		return nil
	}
	ready := embeddableImage(img.Bytes)
	if ready == nil || !budget.allow(len(ready.Bytes)) {
		return nil
	}
	return ready
}

func codeText(n ast.Node, src []byte) string {
	var b strings.Builder
	lines := n.Lines()
	for i := 0; i < lines.Len(); i++ {
		seg := lines.At(i)
		b.Write(seg.Value(src))
	}
	return strings.TrimRight(b.String(), "\n")
}

func nodePlain(n ast.Node, src []byte) string {
	var b strings.Builder
	_ = ast.Walk(n, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		if t, ok := n.(*ast.Text); ok {
			b.Write(t.Segment.Value(src))
		}
		return ast.WalkContinue, nil
	})
	return b.String()
}

func plainText(inlines []inline) string {
	var b strings.Builder
	for _, in := range inlines {
		b.WriteString(in.text)
	}
	return b.String()
}
