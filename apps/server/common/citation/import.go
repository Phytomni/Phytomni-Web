package citation

import (
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
	"golang.org/x/net/html"
)

type importStyle struct {
	bold   bool
	italic bool
}

type citationImporter struct {
	source     []byte
	runs       []Run
	links      []Link
	htmlBold   int
	htmlItalic int
}

func importCitation(raw string) Presentation {
	presentation := Presentation{Runs: []Run{}, Links: []Link{}}
	if strings.TrimSpace(raw) == "" {
		return presentation
	}

	source := []byte(raw)
	markdown := goldmark.New()
	document := markdown.Parser().Parse(text.NewReader(source))
	importer := citationImporter{source: source, runs: []Run{}, links: []Link{}}
	for node := document.FirstChild(); node != nil; node = node.NextSibling() {
		part := citationImporter{source: source, runs: []Run{}, links: []Link{}}
		part.collect(node, importStyle{})
		if strings.TrimSpace(PlainText(Presentation{Runs: part.runs})) == "" {
			importer.links = append(importer.links, part.links...)
			continue
		}
		if len(importer.runs) > 0 {
			importer.appendText(" ", importStyle{})
		}
		for _, run := range part.runs {
			appendRunToSlice(&importer.runs, run)
		}
		importer.links = append(importer.links, part.links...)
	}

	presentation.Runs = trimRuns(importer.runs)
	presentation.Links = importer.links
	return presentation
}

func (importer *citationImporter) collect(node ast.Node, inherited importStyle) {
	switch current := node.(type) {
	case *ast.Text:
		importer.appendText(decodedText(current.Segment.Value(importer.source)), importer.style(inherited))
		if current.SoftLineBreak() || current.HardLineBreak() {
			importer.appendText(" ", importer.style(inherited))
		}
		return
	case *ast.String:
		value := string(current.Value)
		if !current.IsRaw() && !current.IsCode() {
			value = decodedText(current.Value)
		}
		importer.appendText(value, importer.style(inherited))
		return
	case *ast.Emphasis:
		next := inherited
		if current.Level >= 2 {
			next.bold = true
		} else {
			next.italic = true
		}
		importer.collectChildren(current, next)
		return
	case *ast.CodeSpan:
		importer.appendText(codeSpanText(current, importer.source), importer.style(inherited))
		return
	case *ast.Link:
		label := plainNodeText(current, importer.source)
		importer.appendText(label, importer.style(inherited))
		importer.appendLink(label, string(current.Destination))
		return
	case *ast.AutoLink:
		label := string(current.Label(importer.source))
		importer.appendText(label, importer.style(inherited))
		importer.appendLink(label, string(current.URL(importer.source)))
		return
	case *ast.Image:
		importer.appendText(plainNodeText(current, importer.source), importer.style(inherited))
		return
	case *ast.RawHTML:
		importer.applyHTMLTag(rawHTMLSource(current, importer.source))
		return
	case *ast.HTMLBlock:
		importer.collectHTMLBlock(htmlBlockSource(current, importer.source), inherited)
		return
	case *ast.FencedCodeBlock, *ast.CodeBlock:
		importer.appendText(blockText(current, importer.source), importer.style(inherited))
		return
	}

	importer.collectChildren(node, inherited)
}

func rawHTMLSource(node *ast.RawHTML, source []byte) string {
	return string(node.Segments.Value(source))
}

func htmlBlockSource(node *ast.HTMLBlock, source []byte) string {
	var out strings.Builder
	out.Write(node.Lines().Value(source))
	if node.HasClosure() {
		closure := node.ClosureLine
		out.Write(closure.Value(source))
	}
	return out.String()
}

func (importer *citationImporter) collectHTMLBlock(raw string, inherited importStyle) {
	document, err := html.Parse(strings.NewReader(raw))
	if err != nil {
		return
	}
	var collect func(*html.Node, importStyle)
	collect = func(node *html.Node, style importStyle) {
		if node.Type == html.TextNode {
			importer.appendText(node.Data, style)
			return
		}
		next := style
		if node.Type == html.ElementNode {
			if len(node.Attr) == 0 {
				switch strings.ToLower(node.Data) {
				case "b", "strong":
					next.bold = true
				case "i", "em":
					next.italic = true
				}
			}
			if strings.EqualFold(node.Data, "a") {
				label := htmlNodeText(node)
				importer.appendText(label, style)
				for _, attribute := range node.Attr {
					if strings.EqualFold(attribute.Key, "href") {
						importer.appendLink(label, attribute.Val)
						break
					}
				}
				return
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			collect(child, next)
		}
	}
	collect(document, inherited)
}

func htmlNodeText(node *html.Node) string {
	var out strings.Builder
	var collect func(*html.Node)
	collect = func(current *html.Node) {
		if current.Type == html.TextNode {
			out.WriteString(current.Data)
		}
		for child := current.FirstChild; child != nil; child = child.NextSibling {
			collect(child)
		}
	}
	collect(node)
	return out.String()
}

func (importer *citationImporter) collectChildren(node ast.Node, inherited importStyle) {
	for child := node.FirstChild(); child != nil; child = child.NextSibling() {
		importer.collect(child, inherited)
	}
}

func (importer *citationImporter) style(inherited importStyle) importStyle {
	return importStyle{
		bold:   inherited.bold || importer.htmlBold > 0,
		italic: inherited.italic || importer.htmlItalic > 0,
	}
}

func (importer *citationImporter) appendText(value string, style importStyle) {
	appendRunToSlice(&importer.runs, Run{Text: value, Bold: style.bold, Italic: style.italic})
}

func (importer *citationImporter) appendLink(label, destination string) {
	href := safeHTTPURL(destination)
	if href == "" {
		return
	}
	importer.links = append(importer.links, Link{Label: classifyLink(label, href), Href: href})
}

func (importer *citationImporter) applyHTMLTag(raw string) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "<b>", "<strong>":
		importer.htmlBold++
	case "</b>", "</strong>":
		if importer.htmlBold > 0 {
			importer.htmlBold--
		}
	case "<i>", "<em>":
		importer.htmlItalic++
	case "</i>", "</em>":
		if importer.htmlItalic > 0 {
			importer.htmlItalic--
		}
	}
}

func plainNodeText(node ast.Node, source []byte) string {
	var out strings.Builder
	_ = ast.Walk(node, func(child ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering || child == node {
			return ast.WalkContinue, nil
		}
		switch current := child.(type) {
		case *ast.Text:
			out.WriteString(decodedText(current.Segment.Value(source)))
			if current.SoftLineBreak() || current.HardLineBreak() {
				out.WriteByte(' ')
			}
			return ast.WalkSkipChildren, nil
		case *ast.String:
			if current.IsRaw() || current.IsCode() {
				out.Write(current.Value)
			} else {
				out.WriteString(decodedText(current.Value))
			}
			return ast.WalkSkipChildren, nil
		case *ast.CodeSpan:
			out.WriteString(codeSpanText(current, source))
			return ast.WalkSkipChildren, nil
		case *ast.RawHTML:
			return ast.WalkSkipChildren, nil
		}
		return ast.WalkContinue, nil
	})
	return out.String()
}

func codeSpanText(node *ast.CodeSpan, source []byte) string {
	var out strings.Builder
	for child := node.FirstChild(); child != nil; child = child.NextSibling() {
		current, ok := child.(*ast.Text)
		if !ok {
			continue
		}
		value := current.Segment.Value(source)
		if strings.HasSuffix(string(value), "\n") {
			out.Write(value[:len(value)-1])
			out.WriteByte(' ')
		} else {
			out.Write(value)
		}
	}
	return out.String()
}

func decodedText(value []byte) string {
	value = util.UnescapePunctuations(value)
	value = util.ResolveNumericReferences(value)
	value = util.ResolveEntityNames(value)
	return string(value)
}

func blockText(node ast.Node, source []byte) string {
	lines := node.Lines()
	var out strings.Builder
	for index := 0; index < lines.Len(); index++ {
		segment := lines.At(index)
		out.Write(segment.Value(source))
	}
	return strings.TrimRight(out.String(), "\r\n")
}
