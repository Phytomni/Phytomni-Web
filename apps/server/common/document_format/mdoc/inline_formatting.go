package mdoc

import (
	"bytes"
	"strings"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

type scientificBoundaryNode struct {
	ast.BaseInline
	name    string
	closing bool
	length  int
}

var kindScientificBoundary = ast.NewNodeKind("ScientificBoundary")

func (n *scientificBoundaryNode) Kind() ast.NodeKind { return kindScientificBoundary }
func (n *scientificBoundaryNode) Dump(source []byte, level int) {
	ast.DumpHelper(n, source, level, nil, nil)
}

type scientificLiteralBlock struct {
	ast.BaseBlock
	value string
}

var kindScientificLiteralBlock = ast.NewNodeKind("ScientificLiteralBlock")

func (n *scientificLiteralBlock) Kind() ast.NodeKind { return kindScientificLiteralBlock }
func (n *scientificLiteralBlock) Dump(source []byte, level int) {
	ast.DumpHelper(n, source, level, nil, nil)
}

// The first Markdown AST owns container/escape boundaries and literal source-tag
// candidates. The cited parse recognizes only original tag offsets validated here.
type scientificInlinePlan struct {
	boundaries map[int]scientificBoundaryNode
	rawClosers map[int]string
	scopes     []text.Segment
	protected  []text.Segment
}

func scientificName(name string) bool {
	return name == "sup" || name == "sub" || name == "i" || name == "em"
}
func scriptName(name string) bool { return name == "sup" || name == "sub" }
func withinScientificSpan(offset int, spans []text.Segment) bool {
	for _, span := range spans {
		if offset >= span.Start && offset < span.Stop {
			return true
		}
	}
	return false
}

func scientificRaw(node ast.Node, src []byte) (string, int, int) {
	if raw, ok := node.(*ast.RawHTML); ok && raw.Segments.Len() == 1 {
		segment := raw.Segments.At(0)
		return string(segment.Value(src)), segment.Start, segment.Stop
	}
	return "", -1, -1
}

func scientificSameLine(src []byte, start, end int) bool {
	return start >= 0 && end >= start && !bytes.ContainsAny(src[start:end], "\r\n")
}

func scientificSourceStop(node ast.Node) int {
	stop := 0
	switch n := node.(type) {
	case *ast.Text:
		return n.Segment.Stop
	case *ast.RawHTML:
		if n.Segments.Len() > 0 {
			return n.Segments.At(n.Segments.Len() - 1).Stop
		}
	}
	for child := node.FirstChild(); child != nil; child = child.NextSibling() {
		stop = max(stop, scientificSourceStop(child))
	}
	return stop
}

func scientificSourceStart(node ast.Node) int {
	switch n := node.(type) {
	case *ast.Text:
		return n.Segment.Start
	case *ast.RawHTML:
		if n.Segments.Len() > 0 {
			return n.Segments.At(0).Start
		}
	}
	for child := node.FirstChild(); child != nil; child = child.NextSibling() {
		if start := scientificSourceStart(child); start >= 0 {
			return start
		}
	}
	return -1
}

func scientificRawDescendants(node ast.Node) []ast.Node {
	switch node.(type) {
	case *ast.CodeSpan, *ast.Link, *ast.Image, *ast.AutoLink, *citationLiteralNode:
		return nil
	case *ast.RawHTML:
		return []ast.Node{node}
	}
	var out []ast.Node
	for child := node.FirstChild(); child != nil; child = child.NextSibling() {
		out = append(out, scientificRawDescendants(child)...)
	}
	return out
}

// End at the first mismatched closer, unless a balanced nested candidate owns
// its own closer. Missing closers protect only the rest of the physical line.
func scientificCandidate(nodes []ast.Node, begin int, src []byte) (int, int, bool) {
	opening, start, _ := scientificRaw(nodes[begin], src)
	_, name, _, _ := rawTag([]byte(opening))
	stack := []string{name}
	end := start
	for end < len(src) && src[end] != '\r' && src[end] != '\n' {
		end++
	}
	containerEnd := 0
	for _, node := range nodes {
		containerEnd = max(containerEnd, scientificSourceStop(node))
	}
	if containerEnd > start {
		end = min(end, containerEnd)
	}
	for i := begin + 1; i < len(nodes); i++ {
		for _, child := range scientificRawDescendants(nodes[i]) {
			raw, pos, stop := scientificRaw(child, src)
			if pos < 0 || pos >= end {
				continue
			}
			_, tag, closing, void := rawTag([]byte(raw))
			if !scientificName(tag) || void {
				continue
			}
			if closing {
				if stack[len(stack)-1] != tag {
					return i, stop, false
				}
				stack = stack[:len(stack)-1]
				if len(stack) == 0 {
					return i, stop, child == nodes[i]
				}
			} else {
				stack = append(stack, tag)
			}
		}
	}
	return len(nodes), end, false
}

func scientificChildrenAllowed(nodes []ast.Node, src []byte, script bool) bool {
	for i := 0; i < len(nodes); i++ {
		node := nodes[i]
		switch n := node.(type) {
		case *ast.Text:
			if !scientificSameLine(src, n.Segment.Start, n.Segment.Stop) || n.SoftLineBreak() || n.HardLineBreak() {
				return false
			}
		case *ast.String:
		case *ast.Emphasis:
			if !scientificChildrenAllowed(scientificChildren(n), src, script) {
				return false
			}
		case *ast.RawHTML:
			raw, start, _ := scientificRaw(n, src)
			_, name, closing, void := rawTag([]byte(raw))
			if !scientificName(name) || closing || void || raw != "<"+name+">" || (script && scriptName(name)) {
				return false
			}
			end, stop, matched := scientificCandidate(nodes, i, src)
			if !matched || end >= len(nodes) || !scientificSameLine(src, start, stop) {
				return false
			}
			close, _, _ := scientificRaw(nodes[end], src)
			if close != "</"+name+">" || !scientificChildrenAllowed(nodes[i+1:end], src, script || scriptName(name)) {
				return false
			}
			i = end
		default:
			return false
		}
	}
	return true
}

func scientificChildren(node ast.Node) []ast.Node {
	var children []ast.Node
	for child := node.FirstChild(); child != nil; child = child.NextSibling() {
		children = append(children, child)
	}
	return children
}

// Rejected scientific content is inert, but it may contain the actual closer
// of an already-open raw wrapper. Track fresh nested wrappers separately so a
// same-named inner closer cannot prematurely end that enclosing protection.
func (p *scientificInlinePlan) closeEnclosingRawWrappers(nodes []ast.Node, src []byte, span text.Segment, outer []string) []string {
	var inner []string
	for _, node := range nodes {
		_ = ast.Walk(node, func(child ast.Node, entering bool) (ast.WalkStatus, error) {
			if !entering {
				return ast.WalkContinue, nil
			}
			switch child.(type) {
			case *ast.CodeSpan, *ast.CodeBlock, *ast.FencedCodeBlock, *ast.Link, *ast.Image, *ast.AutoLink, *citationLiteralNode:
				return ast.WalkSkipChildren, nil
			}
			raw, start, _ := scientificRaw(child, src)
			if raw == "" || start < span.Start || start >= span.Stop {
				return ast.WalkContinue, nil
			}
			_, name, closing, void := rawTag([]byte(raw))
			if scientificName(name) {
				return ast.WalkContinue, nil
			}
			if closing {
				if len(inner) > 0 {
					if inner[len(inner)-1] == name {
						inner = inner[:len(inner)-1]
					}
				} else if len(outer) > 0 && outer[len(outer)-1] == name {
					outer = outer[:len(outer)-1]
					p.rawClosers[start] = name
				}
			} else if !void {
				inner = append(inner, name)
			}
			return ast.WalkContinue, nil
		})
	}
	return outer
}

func planScientificInlines(tree ast.Node, src []byte) *scientificInlinePlan {
	plan := &scientificInlinePlan{boundaries: map[int]scientificBoundaryNode{}, rawClosers: map[int]string{}}
	var visit func([]ast.Node)
	visit = func(nodes []ast.Node) {
		var rawStack []string
		for i := 0; i < len(nodes); i++ {
			node := nodes[i]
			switch node.(type) {
			case *ast.CodeSpan, *ast.CodeBlock, *ast.FencedCodeBlock, *ast.Image, *ast.AutoLink, *citationLiteralNode:
				continue
			}
			raw, start, _ := scientificRaw(node, src)
			if raw == "" {
				if len(rawStack) == 0 {
					visit(scientificChildren(node))
				}
				continue
			}
			if withinScientificSpan(start, plan.protected) {
				continue
			}
			_, name, closing, void := rawTag([]byte(raw))
			if scientificName(name) && !closing {
				// An unsupported self-closing token has already ended. It cannot
				// own a later closer, script, or citation on the same line.
				if void {
					continue
				}
				end, stop, matched := scientificCandidate(nodes, i, src)
				span := text.NewSegment(start, stop)
				plan.scopes = append(plan.scopes, span)
				accepted := len(rawStack) == 0 && matched && raw == "<"+name+">" && scientificSameLine(src, start, stop)
				if accepted {
					close, closeStart, _ := scientificRaw(nodes[end], src)
					accepted = close == "</"+name+">" && scientificChildrenAllowed(nodes[i+1:end], src, scriptName(name))
					if accepted {
						plan.boundaries[start] = scientificBoundaryNode{name: name, length: len(raw)}
						plan.boundaries[closeStart] = scientificBoundaryNode{name: name, closing: true, length: len(close)}
						visit(nodes[i+1 : end])
					}
				}
				if !accepted || scriptName(name) {
					plan.protected = append(plan.protected, span)
				}
				if !accepted && len(rawStack) > 0 {
					rawStack = plan.closeEnclosingRawWrappers(nodes[i:], src, span, rawStack)
				}
				if !accepted && len(rawStack) == 0 {
					// A Markdown emphasis child may cross this physical line.
					// Revisit that container with this rejected prefix protected,
					// so independently valid formatting on its next line survives.
					for _, child := range nodes[i+1 : min(end+1, len(nodes))] {
						if scientificSourceStart(child) < stop && scientificSourceStop(child) > stop {
							visit(scientificChildren(child))
						}
					}
				}
				if end < len(nodes) {
					i = end
				} else {
					for i+1 < len(nodes) {
						_, next, _ := scientificRaw(nodes[i+1], src)
						if next >= stop {
							break
						}
						i++
					}
				}
				continue
			}
			if closing {
				if len(rawStack) > 0 && rawStack[len(rawStack)-1] == name {
					rawStack = rawStack[:len(rawStack)-1]
				}
			} else if !void {
				rawStack = append(rawStack, name)
			}
		}
	}
	visit(scientificChildren(tree))
	return plan
}

type scientificMathParser struct{}

func (*scientificMathParser) Trigger() []byte { return []byte{'$'} }
func (*scientificMathParser) Parse(_ ast.Node, reader text.Reader, _ parser.Context) ast.Node {
	return parseMathLiteral(reader)
}

// Goldmark leaves malformed attribute lists as text. Retain their original
// source identity in this planning-only tree so rejection still has the same
// bounded scope as other scientific candidates. Nothing here grants formatting.
type scientificSourceTagParser struct{}

func (*scientificSourceTagParser) Trigger() []byte { return []byte{'<'} }
func (*scientificSourceTagParser) Parse(_ ast.Node, reader text.Reader, _ parser.Context) ast.Node {
	line, segment := reader.PeekLine()
	length, name, _, _ := rawTag(line)
	if length == 0 || !scientificName(name) {
		return nil
	}
	node := ast.NewRawHTML()
	node.Segments.Append(text.NewSegment(segment.Start, segment.Start+length))
	reader.Advance(length)
	return node
}

func scientificSourceTree(src []byte) ast.Node {
	md := reportMarkdown()
	md.Parser().AddOptions(parser.WithInlineParsers(util.Prioritized(&scientificMathParser{}, 150), util.Prioritized(&scientificSourceTagParser{}, 150)))
	return md.Parser().Parse(text.NewReader(src))
}

// Only the cited path preserves rejected scientific HTML blocks. Other HTML
// blocks retain the existing exclusion, and ordinary Chat never calls this.
func preserveScientificBlocks(tree ast.Node, src []byte) {
	for node := tree.FirstChild(); node != nil; {
		next := node.NextSibling()
		if html, ok := node.(*ast.HTMLBlock); ok {
			value := string(html.Lines().Value(src))
			if html.HasClosure() {
				value += string(html.ClosureLine.Value(src))
			}
			_, name, _, _ := rawTag([]byte(strings.TrimSpace(value)))
			if scientificName(name) {
				tree.ReplaceChild(tree, node, &scientificLiteralBlock{value: strings.TrimRight(value, "\r\n")})
			}
		} else {
			preserveScientificBlocks(node, src)
		}
		node = next
	}
}

func decodeScientificSourceText(source []byte) string {
	var out strings.Builder
	start := 0
	for i := 0; i+1 < len(source); i++ {
		if source[i] == '\\' && util.IsPunct(source[i+1]) {
			out.WriteString(decodeCitationCharacterReferences(source[start:i]))
			out.WriteByte(source[i+1])
			i++
			start = i + 1
		}
	}
	out.WriteString(decodeCitationCharacterReferences(source[start:]))
	return out.String()
}

// Decode text only after all source-syntax decisions have finished. The emitted
// literal nodes are never reparsed, including encoded strings that look like tags.
func decodeCitedText(tree ast.Node, src []byte) {
	switch tree.(type) {
	case *ast.CodeSpan, *ast.CodeBlock, *ast.FencedCodeBlock, *ast.Image, *ast.AutoLink:
		return
	}
	for node := tree.FirstChild(); node != nil; {
		next := node.NextSibling()
		if value, ok := node.(*ast.Text); ok {
			content := string(value.Segment.Value(src))
			if !value.IsRaw() {
				content = decodeScientificSourceText(value.Segment.Value(src))
			}
			if value.SoftLineBreak() {
				content += " "
			}
			if value.HardLineBreak() {
				content += "\n"
			}
			tree.ReplaceChild(tree, node, &citationLiteralNode{value: content})
		} else {
			decodeCitedText(node, src)
		}
		node = next
	}
}
