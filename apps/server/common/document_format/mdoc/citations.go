package mdoc

import (
	"bytes"
	"html"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

type citationMark struct {
	text    string
	indices []int
	active  bool
}
type numericCitationNode struct {
	ast.BaseInline
	mark citationMark
}

var kindNumericCitation = ast.NewNodeKind("NumericCitation")

func (n *numericCitationNode) Kind() ast.NodeKind { return kindNumericCitation }
func (n *numericCitationNode) Dump(source []byte, level int) {
	ast.DumpHelper(n, source, level, map[string]string{"text": n.mark.text}, nil)
}

type citationLiteralNode struct {
	ast.BaseInline
	value string
}

var kindCitationLiteral = ast.NewNodeKind("CitationLiteral")

func (n *citationLiteralNode) Kind() ast.NodeKind { return kindCitationLiteral }
func (n *citationLiteralNode) Dump(source []byte, level int) {
	ast.DumpHelper(n, source, level, map[string]string{"text": n.value}, nil)
}

const numericCitationPattern = `[0-9]{1,3}(?:\s*-\s*[0-9]{1,3})?(?:\s*,\s*[0-9]{1,3}(?:\s*-\s*[0-9]{1,3})?)*`

var numericBody = regexp.MustCompile(`^` + numericCitationPattern + `$`)
var numericToken = regexp.MustCompile(`(?i)^\[(?:document(?:\s*:\s*|\s+))?` + numericCitationPattern + `\]$`)
var documentPrefix = regexp.MustCompile(`(?i)^document(?:\s*:\s*|\s+)`)
var markdownCharacterReference = regexp.MustCompile(`&(?:#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6}|[A-Za-z][A-Za-z0-9]*);`)

// Replace complete references in the original source once. HTML's decoder is
// used only for syntactically valid numeric tokens; exact Goldmark name lookup
// excludes HTML's legacy semicolonless/prefix matches. Replacements are not scanned.
func decodeCitationCharacterReferences(source []byte) string {
	return markdownCharacterReference.ReplaceAllStringFunc(string(source), func(reference string) string {
		if reference[1] == '#' {
			return html.UnescapeString(reference)
		}
		if entity, ok := util.LookUpHTML5EntityByName(reference[1 : len(reference)-1]); ok {
			return string(entity.Characters)
		}
		return reference
	})
}

// ECMAScript whitespace includes NBSP/BOM but not Go's extra U+0085. Normalize
// only that set before applying the browser's ASCII numeric-token grammar.
func normalizeCitationWhitespace(source string) string {
	return strings.Map(func(r rune) rune {
		if unicode.Is(unicode.Zs, r) || r == '\t' || r == '\n' || r == '\v' || r == '\f' || r == '\r' || r == '\u2028' || r == '\u2029' || r == '\uFEFF' {
			return ' '
		}
		return r
	}, source)
}

func parseNumericCitation(source string, count int) *citationMark {
	body := strings.Trim(normalizeCitationWhitespace(source), " ")
	if strings.HasPrefix(body, "[") || strings.HasSuffix(body, "]") {
		if !strings.HasPrefix(body, "[") || !strings.HasSuffix(body, "]") {
			return nil
		}
		body = strings.Trim(body[1:len(body)-1], " ")
	}
	body = documentPrefix.ReplaceAllString(body, "")
	if !numericBody.MatchString(body) {
		return nil
	}
	compact := strings.ReplaceAll(body, " ", "")
	mark := &citationMark{text: strings.ReplaceAll(compact, "-", "–"), active: count > 0}
	seen := map[int]bool{}
	for _, part := range strings.Split(compact, ",") {
		bounds := strings.Split(part, "-")
		start, _ := strconv.Atoi(bounds[0])
		end := start
		if len(bounds) == 2 {
			end, _ = strconv.Atoi(bounds[1])
		}
		if start < 1 || end < start || end > 999 || end-start+1 > 100 {
			return nil
		}
		for i := start; i <= end; i++ {
			if seen[i] || len(mark.indices) >= 100 {
				return nil
			}
			seen[i] = true
			mark.indices = append(mark.indices, i)
			mark.active = mark.active && i <= count
		}
	}
	return mark
}

// This parser sees source syntax before Goldmark resolves escapes and labels.
// Existing code/link parsers retain ownership of their protected constructs.
type numericCitationParser struct {
	count      int
	rawTags    map[ast.Node][]string
	protected  []text.Segment
	scientific *scientificInlinePlan
}

func (p *numericCitationParser) Trigger() []byte { return []byte{'[', '<', '$'} }
func (p *numericCitationParser) Parse(parent ast.Node, reader text.Reader, _ parser.Context) ast.Node {
	line, segment := reader.PeekLine()
	if len(line) == 0 {
		return nil
	}
	if p.scientific != nil {
		if boundary, ok := p.scientific.boundaries[segment.Start]; ok {
			reader.Advance(boundary.length)
			return &boundary
		}
	}
	for _, span := range p.protected {
		if segment.Start >= span.Start && segment.Start < span.Stop {
			return nil
		}
	}
	if line[0] == '$' {
		return parseMathLiteral(reader)
	}
	tags := p.rawTags[parent]
	if line[0] == '<' {
		tag := readTag(reader)
		length, name, closing, void := rawTag([]byte(tag))
		if length == 0 {
			return nil
		}
		if p.scientific != nil && withinScientificSpan(segment.Start, p.scientific.scopes) {
			if expected := p.scientific.rawClosers[segment.Start]; closing && expected == name && len(tags) > 0 && tags[len(tags)-1] == name {
				p.rawTags[parent] = tags[:len(tags)-1]
			}
			return &citationLiteralNode{value: tag}
		}
		if closing {
			if len(tags) > 0 && tags[len(tags)-1] == name {
				tags = tags[:len(tags)-1]
			}
		} else if !void {
			tags = append(tags, name)
		}
		if p.rawTags == nil {
			p.rawTags = map[ast.Node][]string{}
		}
		p.rawTags[parent] = tags
		return &citationLiteralNode{value: tag}
	}
	if len(tags) > 0 {
		return nil
	}
	if p.scientific != nil && withinScientificSpan(segment.Start, p.scientific.protected) {
		return nil
	}
	end := bytes.IndexByte(line, ']')
	if end < 0 {
		return nil
	}
	candidate := string(line[:end+1])
	// Explicit bracket tokens require their existing source-syntax boundaries.
	if !numericToken.MatchString(normalizeCitationWhitespace(candidate)) {
		return nil
	}
	mark := parseNumericCitation(candidate, p.count)
	if mark == nil {
		return nil
	}
	reader.Advance(end + 1)
	return &numericCitationNode{mark: *mark}
}

func readTag(reader text.Reader) string {
	var out strings.Builder
	quote := byte(0)
	for {
		line, _ := reader.PeekLine()
		if len(line) == 0 {
			return ""
		}
		for offset, ch := range line {
			if quote != 0 {
				if ch == quote {
					quote = 0
				}
				continue
			}
			if ch == '\'' || ch == '"' {
				quote = ch
				continue
			}
			if ch == '>' {
				out.Write(line[:offset+1])
				reader.Advance(offset + 1)
				return out.String()
			}
		}
		out.Write(line)
		reader.Advance(len(line))
	}
}

func citationLinkSpans(document ast.Node) []text.Segment {
	var spans []text.Segment
	_ = ast.Walk(document, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering || (node.Kind() != ast.KindLink && node.Kind() != ast.KindImage) {
			return ast.WalkContinue, nil
		}
		start, stop := -1, 0
		add := func(segment text.Segment) {
			if start < 0 || segment.Start < start {
				start = segment.Start
			}
			if segment.Stop > stop {
				stop = segment.Stop
			}
		}
		_ = ast.Walk(node, func(child ast.Node, entering bool) (ast.WalkStatus, error) {
			if entering {
				switch leaf := child.(type) {
				case *ast.Text:
					add(leaf.Segment)
				case *ast.RawHTML:
					for i := 0; i < leaf.Segments.Len(); i++ {
						add(leaf.Segments.At(i))
					}
				}
			}
			return ast.WalkContinue, nil
		})
		if start >= 0 {
			if start > 0 {
				start--
			}
			spans = append(spans, text.NewSegment(start, stop+1))
		}
		return ast.WalkSkipChildren, nil
	})
	return spans
}

// Consume math as literal source, without providing an equation engine.
func parseMathLiteral(reader text.Reader) ast.Node {
	line, _ := reader.PeekLine()
	width := 1
	if len(line) > 1 && line[1] == '$' {
		width = 2
	}
	delimiter := strings.Repeat("$", width)
	var out strings.Builder
	out.WriteString(delimiter)
	reader.Advance(width)
	for {
		current, _ := reader.PeekLine()
		if len(current) == 0 {
			return nil
		}
		for offset := 0; offset+width <= len(current); offset++ {
			// Match the browser's source delimiter boundary, not a new TeX parser.
			if string(current[offset:offset+width]) == delimiter {
				out.Write(current[:offset+width])
				reader.Advance(offset + width)
				return &citationLiteralNode{value: out.String()}
			}
		}
		out.Write(current)
		reader.Advance(len(current))
	}
}

// Match a single complete tag, respecting quotes. Autolinks are not tags.
func rawTag(line []byte) (length int, name string, closing, void bool) {
	if len(line) < 3 || line[0] != '<' {
		return
	}
	cursor := 1
	if line[cursor] == '/' {
		closing = true
		cursor++
	}
	start := cursor
	for cursor < len(line) && ((line[cursor] >= 'a' && line[cursor] <= 'z') || (line[cursor] >= 'A' && line[cursor] <= 'Z') || (cursor > start && line[cursor] >= '0' && line[cursor] <= '9') || line[cursor] == '-') {
		cursor++
	}
	if cursor == start || cursor == len(line) {
		return 0, "", false, false
	}
	if line[cursor] != '>' && line[cursor] != '/' && !util.IsSpace(line[cursor]) {
		return 0, "", false, false
	}
	name = strings.ToLower(string(line[start:cursor]))
	suffix := cursor
	quote := byte(0)
	for ; cursor < len(line); cursor++ {
		ch := line[cursor]
		if quote != 0 {
			if ch == quote {
				quote = 0
			}
			continue
		}
		if ch == '\'' || ch == '"' {
			quote = ch
			continue
		}
		if ch != '>' {
			continue
		}
		if closing && strings.TrimSpace(string(line[suffix:cursor])) != "" {
			return 0, "", false, false
		}
		void = strings.HasSuffix(strings.TrimSpace(string(line[suffix:cursor])), "/")
		switch name {
		case "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr":
			void = true
		}
		return cursor + 1, name, closing, void
	}
	return 0, "", false, false
}
