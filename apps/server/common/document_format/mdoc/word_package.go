package mdoc

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

const wordXMLNS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
const wordRelationshipNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
const wordPackageRelationshipNS = "http://schemas.openxmlformats.org/package/2006/relationships"
const wordContentTypeNS = "http://schemas.openxmlformats.org/package/2006/content-types"

type wordLinkPatch struct {
	paragraph, firstRun, runCount int
	href                          string
}
type wordNumberingPatch struct{ id, abstract int }
type wordPackagePlan struct {
	links     []wordLinkPatch
	academic  bool
	numbering []wordNumberingPatch
}

// These offsets are obtained only by namespace-aware token decoding of our own
// generated package. Original lexical prefixes and mc:Ignorable stay untouched.
type wordElement struct {
	name                            xml.Name
	attrs                           []xml.Attr
	start, openEnd, closeStart, end int
	children                        []*wordElement
}

func (n *wordElement) attr(ns, key string) string {
	for _, a := range n.attrs {
		if a.Name.Space == ns && a.Name.Local == key {
			return a.Value
		}
	}
	return ""
}
func (n *wordElement) childrenNamed(ns, local string) (out []*wordElement) {
	for _, c := range n.children {
		if c.name.Space == ns && c.name.Local == local {
			out = append(out, c)
		}
	}
	return
}
func (n *wordElement) descendants(ns, local string) (out []*wordElement) {
	if n.name.Space == ns && n.name.Local == local {
		out = append(out, n)
	}
	for _, c := range n.children {
		out = append(out, c.descendants(ns, local)...)
	}
	return
}
func readGeneratedWordXML(data []byte, ns, local string) (*wordElement, error) {
	d := xml.NewDecoder(bytes.NewReader(data))
	var root *wordElement
	var stack []*wordElement
	for {
		start := int(d.InputOffset())
		token, err := d.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, errors.New("invalid generated word XML")
		}
		end := int(d.InputOffset())
		switch e := token.(type) {
		case xml.StartElement:
			n := &wordElement{name: e.Name, attrs: e.Attr, start: start, openEnd: end}
			if len(stack) == 0 {
				if root != nil {
					return nil, errors.New("multiple word XML roots")
				}
				root = n
			} else {
				p := stack[len(stack)-1]
				p.children = append(p.children, n)
			}
			stack = append(stack, n)
		case xml.EndElement:
			if len(stack) == 0 {
				return nil, errors.New("unbalanced word XML")
			}
			n := stack[len(stack)-1]
			n.closeStart = start
			n.end = end
			stack = stack[:len(stack)-1]
		case xml.Directive:
			return nil, errors.New("unsupported generated word XML directive")
		}
	}
	if root == nil || root.name.Space != ns || root.name.Local != local || len(stack) != 0 {
		return nil, errors.New("unexpected generated word XML root")
	}
	return root, nil
}

type wordXMLEdit struct {
	start, end int
	text       string
}

func applyWordXMLEdits(data []byte, edits []wordXMLEdit) ([]byte, error) {
	sort.SliceStable(edits, func(i, j int) bool { return edits[i].start < edits[j].start })
	var out bytes.Buffer
	cursor := 0
	for _, e := range edits {
		if e.start < cursor || e.end < e.start || e.end > len(data) {
			return nil, errors.New("overlapping word XML edits")
		}
		out.Write(data[cursor:e.start])
		out.WriteString(e.text)
		cursor = e.end
	}
	out.Write(data[cursor:])
	return out.Bytes(), nil
}
func wordEscape(value string) string {
	var out bytes.Buffer
	_ = xml.EscapeText(&out, []byte(value))
	return out.String()
}
func validWordLink(value string) bool {
	if value == "" || strings.ContainsAny(value, "\\\"<>") || strings.IndexFunc(value, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }) >= 0 {
		return false
	}
	u, err := url.Parse(value)
	if err != nil || (!strings.EqualFold(u.Scheme, "http") && !strings.EqualFold(u.Scheme, "https")) || u.Hostname() == "" || u.User != nil || u.Opaque != "" {
		return false
	}
	query, err := url.QueryUnescape(u.RawQuery)
	return err == nil && strings.IndexFunc(u.Path+query+u.Fragment, unicode.IsControl) < 0
}

// patchWordPackage accepts only a newly generated godocx package and writer-owned
// coordinates. It is deliberately not an arbitrary DOCX transformation API.
func patchWordPackage(data []byte, plan wordPackagePlan) ([]byte, error) {
	z, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, errors.New("invalid generated word package")
	}
	parts := map[string][]byte{}
	for _, f := range z.File {
		if _, ok := parts[f.Name]; ok {
			return nil, errors.New("duplicate word package member")
		}
		r, e := f.Open()
		if e != nil {
			return nil, e
		}
		b, e := io.ReadAll(r)
		r.Close()
		if e != nil {
			return nil, e
		}
		parts[f.Name] = b
	}
	doc, err := readGeneratedWordXML(parts["word/document.xml"], wordXMLNS, "document")
	if err != nil {
		return nil, err
	}
	rels, err := readGeneratedWordXML(parts["word/_rels/document.xml.rels"], wordPackageRelationshipNS, "Relationships")
	if err != nil {
		return nil, err
	}
	used := map[string]bool{}
	for _, r := range rels.childrenNamed(wordPackageRelationshipNS, "Relationship") {
		id := r.attr("", "Id")
		if id == "" || used[id] {
			return nil, errors.New("invalid word relationship IDs")
		}
		used[id] = true
	}
	nextID := func() string {
		for i := 1; ; i++ {
			id := "rId" + strconv.Itoa(i)
			if !used[id] {
				used[id] = true
				return id
			}
		}
	}
	bodies := doc.childrenNamed(wordXMLNS, "body")
	if len(bodies) != 1 {
		return nil, errors.New("expected generated word body")
	}
	body := bodies[0]
	paragraphs := body.descendants(wordXMLNS, "p")
	var edits []wordXMLEdit
	var relationships strings.Builder
	for _, link := range plan.links {
		if !validWordLink(link.href) || link.paragraph < 0 || link.paragraph >= len(paragraphs) || link.firstRun < 0 || link.runCount <= 0 {
			return nil, errors.New("invalid word link patch")
		}
		runs := paragraphs[link.paragraph].childrenNamed(wordXMLNS, "r")
		if link.firstRun >= len(runs) || link.runCount > len(runs)-link.firstRun {
			return nil, errors.New("word link range out of bounds")
		}
		selected := runs[link.firstRun : link.firstRun+link.runCount]
		for i := 1; i < len(selected); i++ {
			if selected[i-1].end != selected[i].start {
				return nil, errors.New("noncontiguous word link runs")
			}
		}
		first, last := selected[0], selected[len(selected)-1]
		id := nextID()
		edits = append(edits, wordXMLEdit{first.start, last.end, `<w:hyperlink xmlns:w="` + wordXMLNS + `" xmlns:r="` + wordRelationshipNS + `" r:id="` + id + `">` + string(parts["word/document.xml"][first.start:last.end]) + `</w:hyperlink>`})
		relationships.WriteString(`<Relationship xmlns="` + wordPackageRelationshipNS + `" Id="` + id + `" Type="` + wordRelationshipNS + `/hyperlink" Target="` + wordEscape(link.href) + `" TargetMode="External"/>`)
	}
	changed := map[string][]byte{}
	if plan.academic {
		sections := body.childrenNamed(wordXMLNS, "sectPr")
		if len(sections) != 1 || len(sections[0].childrenNamed(wordXMLNS, "footerReference")) != 0 {
			return nil, errors.New("unexpected generated academic section")
		}
		section := sections[0]
		id := nextID()
		name := ""
		for i := 1; ; i++ {
			name = fmt.Sprintf("footer%d.xml", i)
			if _, exists := parts["word/"+name]; !exists {
				break
			}
		}
		edits = append(edits, wordXMLEdit{section.openEnd, section.openEnd, `<w:footerReference xmlns:w="` + wordXMLNS + `" xmlns:r="` + wordRelationshipNS + `" w:type="default" r:id="` + id + `"/>`})
		relationships.WriteString(`<Relationship xmlns="` + wordPackageRelationshipNS + `" Id="` + id + `" Type="` + wordRelationshipNS + `/footer" Target="` + name + `"/>`)
		changed["word/"+name] = academicWordFooter()
		cts, e := readGeneratedWordXML(parts["[Content_Types].xml"], wordContentTypeNS, "Types")
		if e != nil {
			return nil, e
		}
		var contentTypeEdits []wordXMLEdit
		defaults := map[string]string{}
		// godocx adds a Default for every picture, but OPC permits only one per
		// extension. Keep the first declaration and all image parts untouched.
		for _, entry := range cts.childrenNamed(wordContentTypeNS, "Default") {
			extension := strings.ToLower(entry.attr("", "Extension"))
			contentType := entry.attr("", "ContentType")
			if previous, exists := defaults[extension]; exists {
				if previous != contentType {
					return nil, errors.New("conflicting generated word content types")
				}
				contentTypeEdits = append(contentTypeEdits, wordXMLEdit{entry.start, entry.end, ""})
			} else {
				defaults[extension] = contentType
			}
		}
		contentTypeEdits = append(contentTypeEdits, wordXMLEdit{cts.closeStart, cts.closeStart, `<Override xmlns="` + wordContentTypeNS + `" PartName="/word/` + name + `" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>`})
		changed["[Content_Types].xml"], err = applyWordXMLEdits(parts["[Content_Types].xml"], contentTypeEdits)
		if err != nil {
			return nil, err
		}
		tableEdits, e := academicWordTableEdits(body)
		if e != nil {
			return nil, e
		}
		edits = append(edits, tableEdits...)
	}
	if len(plan.numbering) > 0 {
		if !plan.academic {
			return nil, errors.New("numbering requires academic package")
		}
		numbers, e := readGeneratedWordXML(parts["word/numbering.xml"], wordXMLNS, "numbering")
		if e != nil {
			return nil, e
		}
		ids := map[int]bool{}
		abstracts := map[int]bool{}
		for _, n := range numbers.childrenNamed(wordXMLNS, "num") {
			i, e := strconv.Atoi(n.attr(wordXMLNS, "numId"))
			if e != nil {
				return nil, errors.New("invalid numbering ID")
			}
			ids[i] = true
		}
		for _, n := range numbers.childrenNamed(wordXMLNS, "abstractNum") {
			i, e := strconv.Atoi(n.attr(wordXMLNS, "abstractNumId"))
			if e != nil {
				return nil, errors.New("invalid abstract numbering ID")
			}
			abstracts[i] = true
		}
		var added strings.Builder
		for _, n := range plan.numbering {
			if n.id <= 0 || ids[n.id] || !abstracts[n.abstract] {
				return nil, errors.New("invalid academic numbering plan")
			}
			ids[n.id] = true
			fmt.Fprintf(&added, `<w:num xmlns:w="%s" w:numId="%d"><w:abstractNumId w:val="%d"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`, wordXMLNS, n.id, n.abstract)
		}
		changed["word/numbering.xml"], err = applyWordXMLEdits(parts["word/numbering.xml"], []wordXMLEdit{{numbers.closeStart, numbers.closeStart, added.String()}})
		if err != nil {
			return nil, err
		}
	}
	changed["word/document.xml"], err = applyWordXMLEdits(parts["word/document.xml"], edits)
	if err != nil {
		return nil, err
	}
	changed["word/_rels/document.xml.rels"], err = applyWordXMLEdits(parts["word/_rels/document.xml.rels"], []wordXMLEdit{{rels.closeStart, rels.closeStart, relationships.String()}})
	if err != nil {
		return nil, err
	}
	var out bytes.Buffer
	zw := zip.NewWriter(&out)
	for _, f := range z.File {
		if b, ok := changed[f.Name]; ok {
			h := f.FileHeader
			writer, e := zw.CreateHeader(&h)
			if e != nil {
				return nil, e
			}
			if _, e = writer.Write(b); e != nil {
				return nil, e
			}
			delete(changed, f.Name)
		} else if e := zw.Copy(f); e != nil {
			return nil, e
		}
	}
	for name, b := range changed {
		writer, e := zw.Create(name)
		if e != nil {
			return nil, e
		}
		if _, e = writer.Write(b); e != nil {
			return nil, e
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func academicWordFooter() []byte {
	pr := fmt.Sprintf(`<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Microsoft YaHei"/><w:sz w:val="%d"/><w:szCs w:val="%d"/></w:rPr>`, academicFooterFontSizePt*2, academicFooterFontSizePt*2)
	var b strings.Builder
	b.WriteString(`<w:ftr xmlns:w="` + wordXMLNS + `"><w:p><w:pPr><w:ind w:left="0" w:right="0" w:firstLine="0"/><w:jc w:val="center"/></w:pPr>`)
	for _, field := range []string{`<w:fldChar w:fldCharType="begin"/>`, `<w:instrText xml:space="preserve"> PAGE </w:instrText>`, `<w:fldChar w:fldCharType="separate"/>`, `<w:t>1</w:t>`, `<w:fldChar w:fldCharType="end"/>`} {
		b.WriteString(`<w:r>` + pr + field + `</w:r>`)
	}
	b.WriteString(`</w:p></w:ftr>`)
	return []byte(b.String())
}

// Preserve TableGrid's existing side margins explicitly; image measurement and
// generated table properties must use the same drawable cell geometry.
const academicWordCellSideMarginTwips = 108

func academicWordColumnWidth(columns, column int) int {
	width := wordTwips(academicPageWidthMM - 2*academicPageMarginMM)
	return width/columns + boolWordInt(column < width%columns)
}

// The generated table API exposes no grid/cell width or repeating-header
// setters. Apply this single policy to generated tables, never to agent XML.
func academicWordTableEdits(body *wordElement) ([]wordXMLEdit, error) {
	var edits []wordXMLEdit
	width := wordTwips(academicPageWidthMM - 2*academicPageMarginMM)
	for _, table := range body.descendants(wordXMLNS, "tbl") {
		rows := table.childrenNamed(wordXMLNS, "tr")
		if len(rows) == 0 {
			continue
		}
		columns := len(rows[0].childrenNamed(wordXMLNS, "tc"))
		if columns == 0 {
			return nil, errors.New("empty academic table row")
		}
		props := table.childrenNamed(wordXMLNS, "tblPr")
		if len(props) != 1 {
			return nil, errors.New("unexpected generated table properties")
		}
		pr := props[0]
		edits = append(edits, wordXMLEdit{pr.start, pr.end, fmt.Sprintf(`<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="%d" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="%d" w:type="dxa"/><w:right w:w="%d" w:type="dxa"/></w:tblCellMar></w:tblPr>`, width, academicWordCellSideMarginTwips, academicWordCellSideMarginTwips)})
		var grid strings.Builder
		grid.WriteString(`<w:tblGrid>`)
		for i := 0; i < columns; i++ {
			fmt.Fprintf(&grid, `<w:gridCol w:w="%d"/>`, academicWordColumnWidth(columns, i))
		}
		grid.WriteString(`</w:tblGrid>`)
		grids := table.childrenNamed(wordXMLNS, "tblGrid")
		if len(grids) > 1 {
			return nil, errors.New("duplicate table grid")
		}
		if len(grids) == 1 {
			edits = append(edits, wordXMLEdit{grids[0].start, grids[0].end, grid.String()})
		} else {
			edits = append(edits, wordXMLEdit{pr.end, pr.end, grid.String()})
		}
		for i, row := range rows {
			cells := row.childrenNamed(wordXMLNS, "tc")
			if len(cells) != columns {
				return nil, errors.New("nonrectangular academic table")
			}
			// Word may split rows; long-row layout acceptance belongs to the
			// pagination work, not a blanket cantSplit on unmeasured content.
			rowPr := `<w:trPr>`
			if i == 0 {
				rowPr += `<w:tblHeader/>`
			}
			rowPr += `</w:trPr>`
			rps := row.childrenNamed(wordXMLNS, "trPr")
			if len(rps) > 1 {
				return nil, errors.New("duplicate row properties")
			}
			if len(rps) == 1 {
				edits = append(edits, wordXMLEdit{rps[0].start, rps[0].end, rowPr})
			} else {
				edits = append(edits, wordXMLEdit{row.openEnd, row.openEnd, rowPr})
			}
			for j, cell := range cells {
				cps := cell.childrenNamed(wordXMLNS, "tcPr")
				if len(cps) > 1 {
					return nil, errors.New("unexpected generated cell properties")
				}
				text := fmt.Sprintf(`<w:tcPr><w:tcW w:w="%d" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>`, academicWordColumnWidth(columns, j))
				if len(cps) == 1 {
					cp := cps[0]
					edits = append(edits, wordXMLEdit{cp.start, cp.end, text})
				} else {
					edits = append(edits, wordXMLEdit{cell.openEnd, cell.openEnd, text})
				}
			}
		}
	}
	return edits, nil
}
func boolWordInt(v bool) int {
	if v {
		return 1
	}
	return 0
}
