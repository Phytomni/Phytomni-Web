package citation

import (
	"bytes"
	"strings"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
	"golang.org/x/net/html"
)

func importedScriptTag(raw string) (string, bool) {
	if raw == "" {
		return "", false
	}
	tokenizer := html.NewTokenizer(strings.NewReader(raw))
	kind := tokenizer.Next()
	if kind != html.StartTagToken && kind != html.EndTagToken && kind != html.SelfClosingTagToken {
		return "", false
	}
	token := tokenizer.Token()
	if token.Data != "sup" && token.Data != "sub" {
		return "", false
	}
	return token.Data, kind == html.EndTagToken
}

func importedRaw(node ast.Node, source []byte) (string, int, int) {
	if raw, ok := node.(*ast.RawHTML); ok && raw.Segments.Len() == 1 {
		segment := raw.Segments.At(0)
		return string(segment.Value(source)), segment.Start, segment.Stop
	}
	return "", -1, -1
}

func importedChildren(node ast.Node) []ast.Node {
	var nodes []ast.Node
	for child := node.FirstChild(); child != nil; child = child.NextSibling() {
		nodes = append(nodes, child)
	}
	return nodes
}

func importedSourceRange(node ast.Node) (int, int) {
	switch current := node.(type) {
	case *ast.Text:
		return current.Segment.Start, current.Segment.Stop
	case *ast.RawHTML:
		if current.Segments.Len() > 0 {
			return current.Segments.At(0).Start, current.Segments.At(current.Segments.Len() - 1).Stop
		}
	}
	start, stop := -1, -1
	for child := node.FirstChild(); child != nil; child = child.NextSibling() {
		first, last := importedSourceRange(child)
		if start < 0 && first >= 0 {
			start = first
		}
		stop = max(stop, last)
	}
	return start, stop
}

func (importer *citationImporter) sourceLineEnd(start int) int {
	end := start
	for end < len(importer.source) && importer.source[end] != '\r' && importer.source[end] != '\n' {
		end++
	}
	return end
}

// Pair only original raw nodes belonging to this inline container. The span is
// validated before any child is collected; rejected delimiters remain text.
func (importer *citationImporter) collectInlineChildren(node ast.Node, inherited importStyle) {
	nodes := importedChildren(node)
	var opaque []string
	for i := 0; i < len(nodes); i++ {
		current := inherited
		if start, _ := importedSourceRange(nodes[i]); current.literal && start >= current.literalEnd {
			current.literal = false
		}
		raw, start, _ := importedRaw(nodes[i], importer.source)
		if tag, closing := importedOpaqueTag(raw); tag != "" {
			if !closing {
				opaque = append(opaque, tag)
			} else if len(opaque) > 0 && opaque[len(opaque)-1] == tag {
				opaque = opaque[:len(opaque)-1]
			}
		}
		name, closing := importedScriptTag(raw)
		if current.literal || current.protected || len(opaque) > 0 || name == "" || closing {
			next := current
			next.protected = current.protected || len(opaque) > 0
			importer.collect(nodes[i], next)
			continue
		}
		end, stop, matched := importer.scriptEnd(nodes, i, name)
		accepted := matched && raw == "<"+name+">" && current.vertical == "" &&
			start >= 0 && stop >= start && !strings.ContainsAny(string(importer.source[start:stop]), "\r\n")
		if accepted {
			close, _, _ := importedRaw(nodes[end], importer.source)
			accepted = close == "</"+name+">" && importer.scriptChildrenAllowed(nodes[i+1:end])
		}
		next := current
		if accepted {
			if name == "sup" {
				next.vertical = VerticalSuperscript
			} else {
				next.vertical = VerticalSubscript
			}
			for _, child := range nodes[i+1 : end] {
				importer.collect(child, next)
			}
		} else {
			next.literal = true
			next.literalEnd = stop
			for _, child := range nodes[i : end+1] {
				importer.collect(child, next)
			}
		}
		i = end
	}
}

func importedOpaqueTag(raw string) (string, bool) {
	if raw == "" {
		return "", false
	}
	tokenizer := html.NewTokenizer(strings.NewReader(raw))
	kind := tokenizer.Next()
	if kind != html.StartTagToken && kind != html.EndTagToken {
		return "", false
	}
	name := tokenizer.Token().Data
	switch name {
	case "sup", "sub", "b", "strong", "i", "em", "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr":
		return "", false
	}
	return name, kind == html.EndTagToken
}

func (importer *citationImporter) scriptEnd(nodes []ast.Node, begin int, name string) (int, int, bool) {
	raw, start, openingStop := importedRaw(nodes[begin], importer.source)
	if strings.HasSuffix(strings.TrimSpace(raw), "/>") {
		return begin, openingStop, false
	}
	stack := []string{name}
	lineEnd := importer.sourceLineEnd(start)
	end := begin
	for i := begin + 1; i < len(nodes); i++ {
		first, stop := importedSourceRange(nodes[i])
		if first >= lineEnd {
			return end, lineEnd, false
		}
		end = i
		if text, ok := nodes[i].(*ast.Text); ok && (text.SoftLineBreak() || text.HardLineBreak()) {
			return i, lineEnd, false
		}
		var match ast.Node
		matchStop := lineEnd
		_ = ast.Walk(nodes[i], func(child ast.Node, entering bool) (ast.WalkStatus, error) {
			if !entering {
				return ast.WalkContinue, nil
			}
			switch child.(type) {
			case *ast.Link, *ast.Image, *ast.AutoLink, *ast.CodeSpan:
				return ast.WalkSkipChildren, nil
			}
			raw, position, rawStop := importedRaw(child, importer.source)
			if position >= lineEnd {
				return ast.WalkStop, nil
			}
			tag, closing := importedScriptTag(raw)
			if tag == "" || strings.HasSuffix(strings.TrimSpace(raw), "/>") {
				return ast.WalkContinue, nil
			}
			if closing {
				if stack[len(stack)-1] != tag {
					match = child
					matchStop = rawStop
					return ast.WalkStop, nil
				}
				stack = stack[:len(stack)-1]
				if len(stack) == 0 {
					match = child
					matchStop = rawStop
					return ast.WalkStop, nil
				}
			} else {
				stack = append(stack, tag)
			}
			return ast.WalkContinue, nil
		})
		if match != nil {
			return i, matchStop, len(stack) == 0 && match == nodes[i]
		}
		if stop > lineEnd {
			return i, lineEnd, false
		}
	}
	return end, lineEnd, false
}

type importedScriptSourceParser struct{}

func (*importedScriptSourceParser) Trigger() []byte { return []byte{'<'} }

// Goldmark treats malformed attribute lists as text. Preserve only their
// original scientific-tag identity so the importer rejects the whole span.
func (*importedScriptSourceParser) Parse(_ ast.Node, reader text.Reader, _ parser.Context) ast.Node {
	line, segment := reader.PeekLine()
	tokenizer := html.NewTokenizer(bytes.NewReader(line))
	kind := tokenizer.Next()
	if kind != html.StartTagToken && kind != html.EndTagToken && kind != html.SelfClosingTagToken {
		return nil
	}
	raw := string(tokenizer.Raw())
	if name, _ := importedScriptTag(raw); name == "" {
		return nil
	}
	node := ast.NewRawHTML()
	node.Segments.Append(text.NewSegment(segment.Start, segment.Start+len(raw)))
	reader.Advance(len(raw))
	return node
}

func (importer *citationImporter) scriptChildrenAllowed(nodes []ast.Node) bool {
	var stack []string
	for _, node := range nodes {
		switch current := node.(type) {
		case *ast.Text:
			if current.SoftLineBreak() || current.HardLineBreak() || strings.ContainsAny(string(current.Segment.Value(importer.source)), "\r\n") {
				return false
			}
		case *ast.String:
			if current.IsCode() {
				return false
			}
		case *ast.Emphasis:
			if !importer.scriptChildrenAllowed(importedChildren(current)) {
				return false
			}
		case *ast.RawHTML:
			raw := strings.ToLower(rawHTMLSource(current, importer.source))
			name := strings.TrimPrefix(strings.TrimSuffix(raw, ">"), "<")
			closing := strings.HasPrefix(name, "/")
			name = strings.TrimPrefix(name, "/")
			if name != "b" && name != "strong" && name != "i" && name != "em" {
				return false
			}
			if closing {
				if len(stack) == 0 || stack[len(stack)-1] != name {
					return false
				}
				stack = stack[:len(stack)-1]
			} else {
				stack = append(stack, name)
			}
		default:
			return false
		}
	}
	return len(stack) == 0
}

type importedMathParser struct{}

func (*importedMathParser) Trigger() []byte { return []byte{'$'} }

// Keep existing equation source opaque; this adds no mathematical renderer.
func (*importedMathParser) Parse(_ ast.Node, reader text.Reader, _ parser.Context) ast.Node {
	line, _ := reader.PeekLine()
	width := 1
	if len(line) > 1 && line[1] == '$' {
		width = 2
	}
	delimiter := append([]byte(nil), line[:width]...)
	var source strings.Builder
	source.Write(delimiter)
	reader.Advance(width)
	for {
		line, _ = reader.PeekLine()
		if len(line) == 0 {
			return nil
		}
		if end := bytes.Index(line, delimiter); end >= 0 {
			source.Write(line[:end+width])
			reader.Advance(end + width)
			node := ast.NewString([]byte(source.String()))
			node.SetCode(true)
			return node
		}
		source.Write(line)
		reader.Advance(len(line))
	}
}

// Scientific tags classified as HTML blocks cannot satisfy the inline grammar.
// Keep their original tags (including case/attributes) while retaining the
// established bibliography emphasis behavior of unrelated HTML wrappers.
func (importer *citationImporter) collectScientificHTMLBlock(raw string, inherited importStyle) bool {
	if name, _ := importedScriptTag(strings.TrimLeft(raw, " \t")); name != "" {
		// A rejected block candidate is literal source, not an HTML text node.
		importer.appendText(strings.TrimRight(raw, "\r\n"), importer.style(inherited))
		return true
	}
	tokens := html.NewTokenizer(strings.NewReader(strings.TrimRight(raw, "\r\n")))
	type tokenSource struct {
		kind html.TokenType
		raw  string
		data string
	}
	var source []tokenSource
	found := false
	for {
		kind := tokens.Next()
		if kind == html.ErrorToken {
			break
		}
		value := string(tokens.Raw())
		name := tokens.Token().Data
		found = found || ((kind == html.StartTagToken || kind == html.EndTagToken || kind == html.SelfClosingTagToken) && (name == "sup" || name == "sub"))
		source = append(source, tokenSource{kind, value, name})
	}
	if !found {
		return false
	}
	for _, token := range source {
		if token.kind == html.TextToken {
			importer.appendText(token.data, importer.style(inherited))
		} else if token.data == "sup" || token.data == "sub" {
			importer.appendText(token.raw, importer.style(inherited))
		} else {
			importer.applyHTMLTag(token.raw)
		}
	}
	return true
}
