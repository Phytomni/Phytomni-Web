package mdoc

import (
	"fmt"
	"html"
	"regexp"
	"strconv"
	"strings"

	"phytomni-server/common/citation"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

func reportMarkdown() goldmark.Markdown {
	return goldmark.New(goldmark.WithExtensions(extension.GFM, extension.CJK))
}

var explicitEntry = regexp.MustCompile(`^ {0,3}(?:([0-9]+)[.)]|\[([0-9]+)\])[ \t]+(.+)$`)

// SplitOwnedReferences removes only an exactly matched terminal bibliography.
// Structural nodes prevent headings inside code/quotes from claiming ownership;
// physical markers retain numbering that CommonMark's list AST discards.
func SplitOwnedReferences(src string, rows []citation.Row) (string, bool, error) {
	if len(rows) == 0 {
		return src, false, nil
	}
	raw := []byte(src)
	doc := reportMarkdown().Parser().Parse(text.NewReader(raw))
	var heading *ast.Heading
	for n := doc.FirstChild(); n != nil; n = n.NextSibling() {
		if h, ok := n.(*ast.Heading); ok {
			heading = h
		}
	}
	if heading == nil {
		return src, false, nil
	}
	label := strings.TrimSpace(decodedPlain(heading, raw))
	if strings.HasSuffix(label, ":") {
		label = strings.TrimSpace(strings.TrimSuffix(label, ":"))
	} else if strings.HasSuffix(label, "：") {
		label = strings.TrimSpace(strings.TrimSuffix(label, "："))
	}
	switch label {
	case "Reference", "References", "参考文献":
	default:
		return src, false, nil
	}
	if heading.Lines().Len() == 0 {
		return src, false, nil
	}
	start := lineStart(src, heading.Lines().At(0).Start)
	cursor := lineEnd(src, heading.Lines().At(heading.Lines().Len()-1).Start)
	// Setext underlines and ATX closing hashes belong to the heading span too.
	if !strings.HasPrefix(strings.TrimLeft(src[start:cursor], " \t"), "#") {
		cursor = lineEnd(src, cursor)
	}
	position := 0
	match := func(number int, value string) bool {
		if position >= len(rows) || number != position+1 {
			return false
		}
		row := rows[position]
		position++
		got := spaceNormalized(value)
		for _, candidate := range []string{row.Source.Title, row.Source.Formatted, citation.PlainText(row.Citation)} {
			if candidate != "" && got == spaceNormalized(decodedMarkdown(candidate)) {
				return true
			}
		}
		return false
	}
	for n := heading.NextSibling(); n != nil; n = n.NextSibling() {
		switch node := n.(type) {
		case *ast.List:
			if !node.IsOrdered() {
				return src, false, nil
			}
			for li := node.FirstChild(); li != nil; li = li.NextSibling() {
				child := li.FirstChild()
				if child == nil || child.NextSibling() != nil || (child.Kind() != ast.KindTextBlock && child.Kind() != ast.KindParagraph) || child.Lines().Len() == 0 {
					return src, false, nil
				}
				first := child.Lines().At(0)
				begin := lineStart(src, first.Start)
				if begin < cursor || strings.TrimSpace(src[cursor:begin]) != "" {
					return src, false, nil
				}
				end := child.Lines().At(child.Lines().Len() - 1).Stop
				marker := explicitEntry.FindStringSubmatch(strings.TrimRight(src[begin:lineEnd(src, begin)], "\r\n"))
				if marker == nil || marker[1] == "" {
					return src, false, nil
				}
				number, _ := strconv.Atoi(marker[1])
				if !match(number, decodedPlain(child, raw)) {
					return src, false, nil
				}
				cursor = end
			}
		case *ast.Paragraph:
			for i := 0; i < node.Lines().Len(); i++ {
				segment := node.Lines().At(i)
				begin := lineStart(src, segment.Start)
				if begin < cursor || strings.TrimSpace(src[cursor:begin]) != "" {
					return src, false, nil
				}
				marker := explicitEntry.FindStringSubmatch(strings.TrimRight(src[begin:segment.Stop], "\r\n"))
				if marker == nil || marker[2] == "" {
					return src, false, nil
				}
				number, _ := strconv.Atoi(marker[2])
				if !match(number, decodedMarkdown(marker[3])) {
					return src, false, nil
				}
				cursor = segment.Stop
			}
		default:
			return src, false, nil
		}
	}
	if position != len(rows) || strings.TrimSpace(src[cursor:]) != "" {
		return src, false, nil
	}
	return src[:start], true, nil
}

func lineStart(src string, offset int) int { return strings.LastIndexByte(src[:offset], '\n') + 1 }
func lineEnd(src string, offset int) int {
	if n := strings.IndexByte(src[offset:], '\n'); n >= 0 {
		return offset + n + 1
	}
	return len(src)
}
func spaceNormalized(src string) string { return strings.Join(strings.Fields(src), " ") }

func decodedPlain(n ast.Node, src []byte) string {
	var out strings.Builder
	_ = ast.Walk(n, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch t := node.(type) {
		case *ast.Text:
			value := t.Segment.Value(src)
			if !t.IsRaw() {
				value = util.UnescapePunctuations(value)
				out.WriteString(html.UnescapeString(string(value)))
			} else {
				out.Write(value)
			}
			if t.SoftLineBreak() || t.HardLineBreak() {
				out.WriteByte(' ')
			}
		case *ast.String:
			out.Write(t.Value)
		}
		return ast.WalkContinue, nil
	})
	return out.String()
}

func decodedMarkdown(src string) string {
	raw := []byte(src)
	return decodedPlain(reportMarkdown().Parser().Parse(text.NewReader(raw)), raw)
}

func BuildCited(src string, rows []citation.Row, opts Options) (Document, error) {
	body, _, err := SplitOwnedReferences(src, rows)
	if err != nil {
		return Document{}, err
	}
	md := reportMarkdown()
	raw := []byte(body)
	// Resolve actual links once with Goldmark, retaining source spans rather than
	// guessing from following punctuation (which also occurs in ordinary prose).
	protected := citationLinkSpans(reportMarkdown().Parser().Parse(text.NewReader(raw)))
	md.Parser().AddOptions(parser.WithInlineParsers(util.Prioritized(&numericCitationParser{count: len(rows), protected: protected}, 150)))
	tree := md.Parser().Parse(text.NewReader(raw))
	blocks := collectBlocks(tree, raw, opts.FetchImage, &imageBudget{})
	assignRoles(blocks, selectedTitle(tree, blocks) != nil)
	if len(rows) > 0 {
		blocks = append(blocks, block{kind: blockHeading, role: roleSection, level: 2, inlines: []inline{{kind: inlineText, text: "References"}}})
		for i, row := range rows {
			entry := block{kind: blockParagraph, role: roleReference, referenceIndex: i + 1}
			for _, run := range row.Citation.Runs {
				entry.inlines = append(entry.inlines, inline{kind: inlineText, text: run.Text, style: style{bold: run.Bold, italic: run.Italic}})
			}
			blocks = append(blocks, entry)
			if len(row.Citation.Links) > 0 {
				links := block{kind: blockParagraph, role: roleReferenceLinks, referenceIndex: i + 1}
				for j, link := range row.Citation.Links {
					if j > 0 {
						links.inlines = append(links.inlines, inline{kind: inlineText, text: " · "})
					}
					links.inlines = append(links.inlines, inline{kind: inlineText, text: link.Label, href: link.Href})
				}
				blocks = append(blocks, links)
			}
		}
	}
	return Document{blocks: blocks}, nil
}

// CitedMarkdown uses the same ownership/title decision as the semantic document.
func CitedMarkdown(src string, rows []citation.Row) (string, error) {
	body, _, err := SplitOwnedReferences(src, rows)
	if err != nil {
		return "", err
	}
	raw := []byte(body)
	tree := reportMarkdown().Parser().Parse(text.NewReader(raw))
	blocks := collectBlocks(tree, raw, nil, &imageBudget{})
	if heading := selectedTitle(tree, blocks); heading != nil {
		segment := heading.Lines().At(0)
		// Remove only a literal explicit label at the selected heading's source start.
		label := string(segment.Value(raw))
		_, prefix := titleLabel(label)
		if prefix > 0 {
			end := segment.Start + prefix
			for end < len(body) && (body[end] == ' ' || body[end] == '\t') {
				end++
			}
			body = body[:segment.Start] + body[end:]
		}
	}
	if len(rows) == 0 {
		return body, nil
	}
	var out strings.Builder
	out.WriteString(body)
	if !strings.HasSuffix(body, "\n\n") {
		if !strings.HasSuffix(body, "\n") {
			out.WriteByte('\n')
		}
		out.WriteByte('\n')
	}
	out.WriteString("## References\n\n")
	for i, row := range rows {
		lines := strings.Split(citation.Markdown(row.Citation), "\n")
		prefix := fmt.Sprintf("%d. ", i+1)
		out.WriteString(prefix + lines[0] + "\n")
		for _, line := range lines[1:] {
			if line != "" {
				out.WriteString(strings.Repeat(" ", len(prefix)) + line)
			}
			out.WriteByte('\n')
		}
		out.WriteByte('\n')
	}
	return out.String(), nil
}
