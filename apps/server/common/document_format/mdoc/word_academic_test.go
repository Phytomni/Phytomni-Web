package mdoc

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"encoding/xml"
	"errors"
	"image"
	"image/png"
	"io"
	"math"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"phytomni-server/common/citation"
)

const testWordNS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
const testRelNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

type wordNode struct {
	name     xml.Name
	attrs    []xml.Attr
	children []*wordNode
	text     string
}

func readWordNode(t *testing.T, data []byte) *wordNode {
	t.Helper()
	root := &wordNode{}
	stack := []*wordNode{root}
	d := xml.NewDecoder(bytes.NewReader(data))
	for {
		tok, err := d.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		switch e := tok.(type) {
		case xml.StartElement:
			n := &wordNode{name: e.Name, attrs: e.Attr}
			p := stack[len(stack)-1]
			p.children = append(p.children, n)
			stack = append(stack, n)
		case xml.EndElement:
			stack = stack[:len(stack)-1]
		case xml.CharData:
			stack[len(stack)-1].text += string(e)
		}
	}
	if len(root.children) != 1 {
		t.Fatal("expected one XML root")
	}
	return root.children[0]
}
func (n *wordNode) attr(ns, key string) string {
	for _, a := range n.attrs {
		if a.Name.Space == ns && a.Name.Local == key {
			return a.Value
		}
	}
	return ""
}
func (n *wordNode) child(local string) *wordNode {
	if n == nil {
		return nil
	}
	for _, c := range n.children {
		if c.name.Space == testWordNS && c.name.Local == local {
			return c
		}
	}
	return nil
}
func (n *wordNode) all(ns, local string) (out []*wordNode) {
	if n == nil {
		return
	}
	if n.name.Space == ns && n.name.Local == local {
		out = append(out, n)
	}
	for _, c := range n.children {
		out = append(out, c.all(ns, local)...)
	}
	return
}
func (n *wordNode) content() string {
	if n.name.Space == testWordNS && n.name.Local == "tab" {
		return "\t"
	}
	if n.name.Space == testWordNS && n.name.Local == "br" {
		return "\n"
	}
	s := n.text
	for _, c := range n.children {
		s += c.content()
	}
	return s
}
func wordParts(t *testing.T, data []byte) map[string][]byte {
	t.Helper()
	z, e := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if e != nil {
		t.Fatal(e)
	}
	out := map[string][]byte{}
	for _, f := range z.File {
		r, e := f.Open()
		if e != nil {
			t.Fatal(e)
		}
		b, e := io.ReadAll(r)
		r.Close()
		if e != nil {
			t.Fatal(e)
		}
		out[f.Name] = b
	}
	return out
}

// Resolve paragraph style ancestry before direct formatting: literal font
// occurrence in document.xml would miss template/theme inheritance regressions.
func resolvedWordProps(t *testing.T, styles, p, run *wordNode, property string) map[string]string {
	t.Helper()
	out := map[string]string{}
	merge := func(n *wordNode) {
		if n == nil {
			return
		}
		for _, c := range n.children {
			if c.name.Space != testWordNS {
				continue
			}
			if len(c.attrs) == 0 {
				out[c.name.Local] = "true"
			}
			for _, a := range c.attrs {
				if a.Name.Space == testWordNS {
					out[c.name.Local+"/"+a.Name.Local] = a.Value
				}
			}
		}
	}
	merge(styles.child("docDefaults").child(map[string]string{"pPr": "pPrDefault", "rPr": "rPrDefault"}[property]).child(property))
	byID := map[string]*wordNode{}
	for _, s := range styles.all(testWordNS, "style") {
		byID[s.attr(testWordNS, "styleId")] = s
	}
	var inherit func(string, int)
	inherit = func(id string, depth int) {
		if depth > 20 {
			t.Fatal("style cycle")
		}
		if s := byID[id]; s != nil {
			if b := s.child("basedOn"); b != nil {
				inherit(b.attr(testWordNS, "val"), depth+1)
			}
			merge(s.child(property))
		}
	}
	id := "Normal"
	if s := p.child("pPr").child("pStyle"); s != nil {
		id = s.attr(testWordNS, "val")
	}
	inherit(id, 0)
	if property == "pPr" {
		merge(p.child(property))
	} else if run != nil {
		if s := run.child("rPr").child("rStyle"); s != nil {
			inherit(s.attr(testWordNS, "val"), 0)
		}
		merge(run.child(property))
	}
	return out
}

func TestCitedWordUsesRealSuperscript(t *testing.T) {
	rows, e := citation.DecodeRows(json.RawMessage(`[{"title":"A study","di":"10.1000/test"}]`))
	if e != nil {
		t.Fatal(e)
	}
	doc, e := BuildCited("# Plant adaptation\n\n## Abstract\n\nEvidence [1].", rows, Options{})
	if e != nil {
		t.Fatal(e)
	}
	data, e := RenderCitedWord(doc)
	if e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(wordDocumentXML(t, data), "superscript") {
		t.Fatal("missing superscript")
	}
	parts := wordParts(t, data)
	tree := readWordNode(t, parts["word/document.xml"])
	styles := readWordNode(t, parts["word/styles.xml"])
	found := false
	for _, p := range tree.all(testWordNS, "p") {
		for _, r := range p.all(testWordNS, "r") {
			if r.content() == "1" {
				props := resolvedWordProps(t, styles, p, r, "rPr")
				if props["vertAlign/val"] != "superscript" || props["sz/val"] != "16" || props["rFonts/ascii"] != "Times New Roman" {
					t.Fatalf("citation properties %v", props)
				}
				found = true
			}
		}
	}
	if !found {
		t.Fatal("missing citation text")
	}
}

func TestCitedWordAcademicLayoutAndReferenceGroups(t *testing.T) {
	doc := Document{blocks: []block{
		{kind: blockHeading, role: roleTitle, level: 1, inlines: []inline{{text: "Title"}}},
		{kind: blockHeading, role: roleSection, level: 2, inlines: []inline{{text: "Section"}}},
		{kind: blockHeading, role: roleSubsection, level: 3, inlines: []inline{{text: "Subsection"}}},
		{kind: blockHeading, role: roleSubsection, level: 4, inlines: []inline{{text: "Deeper"}}},
		{role: roleLead, inlines: []inline{{text: "Lead"}}}, {role: roleBody, inlines: []inline{{text: "Body"}}},
		{role: roleReference, referenceIndex: 1, inlines: []inline{{text: "Study", style: style{bold: true, italic: true}}, {text: " < & details"}}},
		{role: roleReferenceLinks, referenceIndex: 1, inlines: []inline{{text: "Article", href: "https://example.org/?a=1&b=2"}}},
		{role: roleReference, referenceIndex: 2, inlines: []inline{{text: "No links"}}},
		{kind: blockCode, code: "literal < &\n  spacing"}, {role: roleCaption, inlines: []inline{{text: "Caption"}}},
	}}
	data, e := RenderCitedWord(doc)
	if e != nil {
		t.Fatal(e)
	}
	parts := wordParts(t, data)
	tree := readWordNode(t, parts["word/document.xml"])
	styles := readWordNode(t, parts["word/styles.xml"])
	ps := tree.all(testWordNS, "p")
	if len(ps) != 11 {
		t.Fatalf("paragraph count %d", len(ps))
	}
	wants := []struct{ size, jc, line, before, after, first, hanging, outline string }{
		{"32", "center", "240", "0", "240", "0", "", "0"}, {"28", "left", "240", "240", "120", "0", "", "1"},
		{"24", "left", "240", "180", "80", "0", "", "2"}, {"24", "left", "240", "180", "80", "0", "", "3"},
		{"24", "both", "360", "0", "120", "0", "", ""}, {"24", "both", "360", "0", "120", "425", "", ""},
		{"24", "both", "360", "0", "0", "", "425", ""}, {"20", "left", "240", "0", "120", "0", "", ""},
		{"24", "both", "360", "0", "120", "", "425", ""}, {"18", "left", "240", "0", "120", "0", "", ""}, {"20", "left", "288", "0", "0", "0", "", ""},
	}
	for i, w := range wants {
		pp := resolvedWordProps(t, styles, ps[i], nil, "pPr")
		if wrap := pp["wordWrap/val"]; wrap != "" && wrap != "true" && wrap != "1" {
			t.Errorf("paragraph %d forces character-level word splitting: %s", i, wrap)
		}
		if pp["keepLines/val"] != "false" {
			t.Errorf("paragraph %d may be kept as one unbreakable block", i)
		}
		rp := resolvedWordProps(t, styles, ps[i], ps[i].all(testWordNS, "r")[0], "rPr")
		for k, v := range map[string]string{"jc/val": w.jc, "spacing/line": w.line, "spacing/lineRule": "auto", "spacing/before": w.before, "spacing/after": w.after, "ind/firstLine": w.first, "ind/hanging": w.hanging, "outlineLvl/val": w.outline} {
			if pp[k] != v {
				t.Errorf("paragraph %d %s=%q want %q", i, k, pp[k], v)
			}
		}
		if rp["sz/val"] != w.size {
			t.Errorf("size p%d: %v", i, rp)
		}
		if rp["szCs/val"] != w.size {
			t.Errorf("complex-script size p%d: %v", i, rp)
		}
		if i < 4 && rp["b/val"] != "true" {
			t.Errorf("heading p%d lost bold font: %v", i, rp)
		}
		family := "Times New Roman"
		if i == 9 {
			family = "Courier New"
		}
		for _, k := range []string{"ascii", "hAnsi", "cs"} {
			if rp["rFonts/"+k] != family {
				t.Errorf("font p%d %s: %v", i, k, rp)
			}
		}
		if rp["rFonts/eastAsia"] != "Microsoft YaHei" {
			t.Errorf("CJK p%d: %v", i, rp)
		}
		for _, k := range []string{"asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"} {
			if rp["rFonts/"+k] != "" {
				t.Errorf("competing theme: %v", rp)
			}
		}
		if pp["widowControl/val"] != "true" && pp["widowControl/val"] != "1" {
			t.Errorf("widow control p%d: %v", i, pp)
		}
		if i < 4 && pp["keepNext/val"] != "true" && pp["keepNext/val"] != "1" {
			t.Errorf("heading keepNext: %v", pp)
		}
	}
	for _, i := range []int{6, 7, 8} {
		if resolvedWordProps(t, styles, ps[i], nil, "pPr")["ind/left"] != "425" {
			t.Errorf("reference inset p%d", i)
		}
	}
	if !strings.HasPrefix(ps[6].content(), "1.\tStudy") || !strings.HasPrefix(ps[8].content(), "2.\tNo links") {
		t.Fatal("bibliography numbering not owned by writer")
	}
	rp := resolvedWordProps(t, styles, ps[6], ps[6].all(testWordNS, "r")[1], "rPr")
	if rp["b/val"] != "true" || rp["i/val"] != "true" {
		t.Errorf("combined emphasis: %v", rp)
	}
	if !strings.Contains(ps[6].content(), "< &") {
		t.Fatal("literal text lost")
	}
	s := tree.all(testWordNS, "sectPr")[0]
	if s.child("pgSz").attr(testWordNS, "w") != "11906" || s.child("pgSz").attr(testWordNS, "h") != "16838" {
		t.Fatal("not A4")
	}
	if s.child("pgSz").attr(testWordNS, "orient") != "portrait" {
		t.Fatal("not portrait")
	}
	if cols := s.child("cols"); cols != nil && cols.attr(testWordNS, "num") != "1" {
		t.Fatal("not single column")
	}
	if s.child("pgMar").attr(testWordNS, "footer") != "709" {
		t.Fatal("footer not inside page margin")
	}
	for _, a := range []string{"top", "bottom", "left", "right"} {
		if s.child("pgMar").attr(testWordNS, a) != "1417" {
			t.Fatal("wrong margin")
		}
	}
}

func TestCitedWordNativeListsTablesAndLinks(t *testing.T) {
	src := "1. [**same** *label*](https://example.org/list)\n\n   continuation\n\n   - nested\n\n2. second\n\nBreak\n\n1. restarted\n\n| Left | Center | Right |\n|:--|:--:|--:|\n| [cell](https://example.org/cell) | x | y |\n\n[tail](https://example.org/tail)"
	doc, e := BuildCited(src, nil, Options{})
	if e != nil {
		t.Fatal(e)
	}
	data, e := RenderCitedWord(doc)
	if e != nil {
		t.Fatal(e)
	}
	parts := wordParts(t, data)
	tree := readWordNode(t, parts["word/document.xml"])
	ps := tree.all(testWordNS, "p")
	if len(ps) != 13 {
		t.Fatalf("unexpected paragraphs %d", len(ps))
	}
	for _, p := range ps {
		if strings.Contains(p.content(), "•") || strings.HasPrefix(p.content(), "1. ") {
			t.Fatal("literal marker")
		}
	}
	first := ps[0].child("pPr").child("numPr")
	second := ps[3].child("pPr").child("numPr")
	restart := ps[5].child("pPr").child("numPr")
	if first == nil || second == nil || restart == nil {
		t.Fatal("missing numbering")
	}
	id := first.child("numId").attr(testWordNS, "val")
	if id != second.child("numId").attr(testWordNS, "val") || id == restart.child("numId").attr(testWordNS, "val") {
		t.Fatal("ordered instances fail restart")
	}
	if ps[1].child("pPr").child("numPr") != nil {
		t.Fatal("continuation numbered")
	}
	if ps[2].child("pPr").child("numPr").child("ilvl").attr(testWordNS, "val") != "0" {
		t.Fatal("single-level template depth misuse")
	}
	nums := readWordNode(t, parts["word/numbering.xml"])
	for _, wanted := range []string{id, restart.child("numId").attr(testWordNS, "val")} {
		found := false
		for _, n := range nums.all(testWordNS, "num") {
			if n.attr(testWordNS, "numId") == wanted {
				found = true
				if n.child("lvlOverride").child("startOverride").attr(testWordNS, "val") != "1" {
					t.Fatal("no explicit restart")
				}
			}
		}
		if !found {
			t.Fatal("unresolved numbering")
		}
	}
	links := tree.all(testWordNS, "hyperlink")
	if len(links) != 3 || links[0].content() != "same label" || len(links[0].all(testWordNS, "r")) != 3 {
		t.Fatalf("wrong multi-run link %d", len(links))
	}
	rels := readWordNode(t, parts["word/_rels/document.xml.rels"])
	targets := map[string]string{}
	for _, r := range rels.children {
		if r.attr("", "TargetMode") == "External" {
			targets[r.attr("", "Id")] = r.attr("", "Target")
		}
	}
	for i, want := range []string{"https://example.org/list", "https://example.org/cell", "https://example.org/tail"} {
		if targets[links[i].attr(testRelNS, "id")] != want {
			t.Errorf("link %d unresolved", i)
		}
	}
	tbl := tree.all(testWordNS, "tbl")[0]
	if tbl.child("tblPr").child("tblW").attr(testWordNS, "w") != "9071" {
		t.Fatal("table outside printable width")
	}
	if len(tbl.child("tblGrid").children) != 3 {
		t.Fatal("grid missing")
	}
	for i, col := range tbl.child("tblGrid").children {
		if col.attr(testWordNS, "w") != []string{"3024", "3024", "3023"}[i] {
			t.Fatal("grid widths do not sum to printable width")
		}
	}
	for i, cell := range tbl.all(testWordNS, "tc") {
		width := cell.child("tcPr").child("tcW")
		if width.attr(testWordNS, "w") != []string{"3024", "3024", "3023"}[i%3] || width.attr(testWordNS, "type") != "dxa" {
			t.Fatal("cell/grid widths differ")
		}
	}
	if len(tbl.all(testWordNS, "tblHeader")) != 1 {
		t.Fatal("only first row may repeat as header")
	}
	rows := tbl.all(testWordNS, "tr")
	for _, row := range rows {
		if row.child("trPr").child("cantSplit") != nil {
			t.Fatal("unmeasured rows must remain splittable")
		}
	}
	if rows[0].child("trPr").child("tblHeader") == nil {
		t.Fatal("header not repeated")
	}
	styles := readWordNode(t, parts["word/styles.xml"])
	for i, p := range ps[6:12] {
		pp := resolvedWordProps(t, styles, p, nil, "pPr")
		rp := resolvedWordProps(t, styles, p, p.all(testWordNS, "r")[0], "rPr")
		if pp["jc/val"] != []string{"left", "center", "right"}[i%3] || pp["spacing/line"] != "288" || rp["sz/val"] != "20" {
			t.Errorf("cell metrics %v %v", pp, rp)
		}
	}
}

func TestCitedWordImagesRemainAuthorizedBoundedAndLinked(t *testing.T) {
	var large bytes.Buffer
	if err := png.Encode(&large, image.NewRGBA(image.Rect(0, 0, 2400, 600))); err != nil {
		t.Fatal(err)
	}
	var tall bytes.Buffer
	if err := png.Encode(&tall, image.NewRGBA(image.Rect(0, 0, 60, 2400))); err != nil {
		t.Fatal(err)
	}
	fetch := func(href string) (*Image, error) {
		switch href {
		case "/allowed/wide.png":
			return &Image{Bytes: large.Bytes()}, nil
		case "/allowed/tall.png":
			return &Image{Bytes: tall.Bytes()}, nil
		default:
			return nil, errors.New("not authorized")
		}
	}
	doc, err := BuildCited("![wide](/allowed/wide.png) [after image](https://example.org/image)\n\n![tall](/allowed/tall.png)\n\n![private alt](/denied/secret.png) [after alt](https://example.org/alt)", nil, Options{FetchImage: fetch})
	if err != nil {
		t.Fatal(err)
	}
	data, err := RenderCitedWord(doc)
	if err != nil {
		t.Fatal(err)
	}
	if !wordZipHasMediaPNG(t, data) {
		t.Fatal("missing images")
	}
	parts := wordParts(t, data)
	tree := readWordNode(t, parts["word/document.xml"])
	rels := readWordNode(t, parts["word/_rels/document.xml.rels"])
	targets := map[string]string{}
	for _, r := range rels.children {
		targets[r.attr("", "Id")] = r.attr("", "Target")
	}
	blips := tree.all("http://schemas.openxmlformats.org/drawingml/2006/main", "blip")
	if len(blips) != 2 {
		t.Fatalf("embedded image count %d", len(blips))
	}
	for _, b := range blips {
		target := targets[b.attr(testRelNS, "embed")]
		if len(parts["word/"+target]) == 0 {
			t.Fatalf("unresolved image %s", target)
		}
	}
	extents := tree.all("http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing", "extent")
	for i, x := range extents {
		cx, e := strconv.Atoi(x.attr("", "cx"))
		if e != nil {
			t.Fatal(e)
		}
		cy, e := strconv.Atoi(x.attr("", "cy"))
		if e != nil {
			t.Fatal(e)
		}
		if cx > 5760000 || cy > 8892000 {
			t.Fatalf("image outside 160 x 247 mm: %d %d", cx, cy)
		}
		ratio := 4.0
		if i == 1 {
			ratio = 0.025
		}
		if math.Abs(float64(cx)/float64(cy)-ratio) > 0.00001 {
			t.Fatal("aspect ratio lost")
		}
	}
	ps := tree.all(testWordNS, "p")
	if !strings.Contains(ps[2].content(), "private alt") {
		t.Fatal("missing unavailable image alt")
	}
	links := tree.all(testWordNS, "hyperlink")
	if len(links) != 2 || links[0].content() != "after image" || links[1].content() != "after alt" {
		t.Fatal("image/fallback changed run coordinates")
	}
	for _, part := range parts {
		if bytes.Contains(part, []byte("/denied/secret.png")) {
			t.Fatal("unauthorized image path leaked")
		}
	}
	budgetDoc, err := BuildCited(strings.Repeat("![budget alt](/allowed/pixel.png)\n\n", 17), nil, Options{FetchImage: func(string) (*Image, error) { return &Image{Bytes: png1x1}, nil }})
	if err != nil {
		t.Fatal(err)
	}
	budgetData, err := RenderCitedWord(budgetDoc)
	if err != nil {
		t.Fatal(err)
	}
	budgetTree := readWordNode(t, wordParts(t, budgetData)["word/document.xml"])
	if len(budgetTree.all(testWordNS, "drawing")) != 16 || !strings.Contains(budgetTree.content(), "budget alt") {
		t.Fatal("existing image count budget not retained")
	}
}

func TestCitedWordDropsUnsafeLinkTargetsWithoutLosingText(t *testing.T) {
	doc := Document{blocks: []block{{role: roleBody, inlines: []inline{{text: "unsafe", href: "https://user:password@example.org"}, {text: "encoded", href: "https://example.org/%0A"}, {text: "safe", href: "https://example.org/?x=1&y=2"}}}}}
	data, err := RenderCitedWord(doc)
	if err != nil {
		t.Fatal(err)
	}
	parts := wordParts(t, data)
	tree := readWordNode(t, parts["word/document.xml"])
	if tree.all(testWordNS, "p")[0].content() != "unsafeencodedsafe" {
		t.Fatal("text lost")
	}
	links := tree.all(testWordNS, "hyperlink")
	if len(links) != 1 || links[0].content() != "safe" {
		t.Fatal("unsafe link exposed")
	}
	if bytes.Contains(parts["word/_rels/document.xml.rels"], []byte("password")) {
		t.Fatal("credentials leaked to relationship")
	}
}

func TestCitedWordCitationsAndCodeDoNotCreateFakeAnchors(t *testing.T) {
	rows, err := citation.DecodeRows(json.RawMessage(`[{"title":"A study","di":"10.1000/test","pm":"12345"}]`))
	if err != nil {
		t.Fatal(err)
	}
	doc, err := BuildCited("## Abstract\n\n[1] and [9] and `literal [1]`\n\n```\n[1]\n  < &\n```", rows, Options{})
	if err != nil {
		t.Fatal(err)
	}
	data, err := RenderCitedWord(doc)
	if err != nil {
		t.Fatal(err)
	}
	parts := wordParts(t, data)
	tree := readWordNode(t, parts["word/document.xml"])
	if len(tree.all(testWordNS, "bookmarkStart")) != 0 {
		t.Fatal("optional bookmarks unexpectedly present")
	}
	sup := tree.all(testWordNS, "vertAlign")
	if len(sup) != 2 {
		t.Fatalf("literal/code citation recognition changed: %d", len(sup))
	}
	for _, l := range tree.all(testWordNS, "hyperlink") {
		if l.attr(testWordNS, "anchor") != "" {
			t.Fatal("fake internal hyperlink")
		}
	}
	styles := readWordNode(t, parts["word/styles.xml"])
	ps := tree.all(testWordNS, "p")
	if resolvedWordProps(t, styles, ps[0], ps[0].all(testWordNS, "r")[0], "rPr")["sz/val"] != "28" {
		t.Fatal("standard section promoted to title")
	}
	if !strings.Contains(ps[2].content(), "[1]\n  < &") {
		t.Fatal("code literal breaks lost")
	}
	rels := readWordNode(t, parts["word/_rels/document.xml.rels"])
	targets := map[string]bool{}
	for _, r := range rels.children {
		if r.attr("", "TargetMode") == "External" {
			targets[r.attr("", "Target")] = true
		}
	}
	for _, target := range []string{"https://doi.org/10.1000/test", "https://pubmed.ncbi.nlm.nih.gov/12345/", "https://scholar.google.com/scholar?q=A+study"} {
		if !targets[target] {
			t.Errorf("canonical target missing: %s", target)
		}
	}
}

func TestCitedWordNavigationWithoutTitleStartsAtZero(t *testing.T) {
	doc, err := BuildCited("# Abstract\n\nlead\n\n## Subsection\n\n### Deep subsection", nil, Options{})
	if err != nil {
		t.Fatal(err)
	}
	data, err := RenderCitedWord(doc)
	if err != nil {
		t.Fatal(err)
	}
	parts := wordParts(t, data)
	tree := readWordNode(t, parts["word/document.xml"])
	styles := readWordNode(t, parts["word/styles.xml"])
	ps := tree.all(testWordNS, "p")
	for i, want := range map[int]string{0: "0", 2: "1", 3: "2"} {
		if got := resolvedWordProps(t, styles, ps[i], nil, "pPr")["outlineLvl/val"]; got != want {
			t.Errorf("outline p%d=%s want%s", i, got, want)
		}
	}
}

func TestCitedWordNativeListEmptyAndLiteralItemsKeepMarkers(t *testing.T) {
	doc := Document{blocks: []block{
		{kind: blockList, items: [][]block{
			nil,
			{{kind: blockCode, code: "literal\n  code"}},
			{{kind: blockList, items: [][]block{{{inlines: []inline{{text: "nested"}}}}}}},
		}},
		{inlines: []inline{{text: "tail", href: "HTTPS://example.org/tail"}}},
	}}
	data, err := RenderCitedWord(doc)
	if err != nil {
		t.Fatal(err)
	}
	tree := readWordNode(t, wordParts(t, data)["word/document.xml"])
	ps := tree.all(testWordNS, "p")
	if len(ps) != 5 {
		t.Fatalf("unexpected list paragraphs: %d", len(ps))
	}
	for i := 0; i < 4; i++ {
		if ps[i].child("pPr").child("numPr") == nil {
			t.Errorf("item paragraph %d lost native marker", i)
		}
	}
	if ps[1].content() != "literal\n  code" || ps[2].content() != "" || ps[3].content() != "nested" {
		t.Fatal("literal or nested item order changed")
	}
	links := ps[4].all(testWordNS, "hyperlink")
	if len(links) != 1 || links[0].content() != "tail" {
		t.Fatal("safe case-insensitive HTTP scheme or paragraph coordinate lost")
	}
}

func TestCitedWordRetainsImageByteBudgets(t *testing.T) {
	payload := make([]byte, 8<<20)
	copy(payload, png1x1)
	for _, tt := range []struct {
		name, markdown string
		payload        []byte
		drawings       int
	}{
		{"single-over-limit", "![byte alt](image)", append(payload, 0), 0},
		{"total-over-limit", strings.Repeat("![byte alt](image)\n\n", 4), payload, 3},
	} {
		t.Run(tt.name, func(t *testing.T) {
			doc, err := BuildCited(tt.markdown, nil, Options{FetchImage: func(string) (*Image, error) { return &Image{Bytes: tt.payload}, nil }})
			if err != nil {
				t.Fatal(err)
			}
			data, err := RenderCitedWord(doc)
			if err != nil {
				t.Fatal(err)
			}
			tree := readWordNode(t, wordParts(t, data)["word/document.xml"])
			if len(tree.all(testWordNS, "drawing")) != tt.drawings || !strings.Contains(tree.content(), "byte alt") {
				t.Fatal("image byte budget or alt fallback regressed")
			}
		})
	}
}

func TestWordTableRaggedRowsTopAlignmentAndFollowingLinks(t *testing.T) {
	doc := Document{blocks: []block{
		{kind: blockTable, alignments: []tableAlignment{alignLeft, alignCenter, alignRight}, rows: [][][]inline{
			{{{text: "HEADONE"}}, {{text: "HEADTWO"}}},
			{{{text: "CELLONE"}}, {{text: strings.Repeat("LONGCELL ", 1800)}}, {{text: "THIRDCELL", href: "https://example.org/cell"}}},
			{{{text: "RAGGEDLAST"}}},
		}},
		{inlines: []inline{{text: "TAIL", href: "https://example.org/tail"}}},
	}}
	data, err := RenderCitedWord(doc)
	if err != nil {
		t.Fatal(err)
	}
	parts := wordParts(t, data)
	tree := readWordNode(t, parts["word/document.xml"])
	rows := tree.all(testWordNS, "tr")
	for _, row := range rows {
		cells := row.all(testWordNS, "tc")
		if len(cells) != 3 {
			t.Fatal("ragged table not rectangular")
		}
		for _, cell := range cells {
			v := cell.child("tcPr").child("vAlign")
			if v == nil || v.attr(testWordNS, "val") != "top" {
				t.Fatal("cell not top aligned")
			}
		}
	}
	for _, token := range []string{"HEADONE", "HEADTWO", "CELLONE", "THIRDCELL", "RAGGEDLAST", "TAIL"} {
		if strings.Count(tree.content(), token) != 1 {
			t.Fatalf("lost/duplicated %s", token)
		}
	}
	if strings.Count(tree.content(), "LONGCELL") != 1800 || len(tree.all(testWordNS, "cantSplit")) != 0 {
		t.Fatal("long cells cannot split losslessly")
	}
	links := tree.all(testWordNS, "hyperlink")
	if len(links) != 2 || links[0].content() != "THIRDCELL" || links[1].content() != "TAIL" {
		t.Fatal("padded cells changed link coordinates")
	}
}

func TestWordTableRectangularCellsTopAligned(t *testing.T) {
	doc, err := BuildCited("| A | B |\n|--|--|\n| C | D |", nil, Options{})
	if err != nil {
		t.Fatal(err)
	}
	data, err := RenderCitedWord(doc)
	if err != nil {
		t.Fatal(err)
	}
	tree := readWordNode(t, wordParts(t, data)["word/document.xml"])
	for _, cell := range tree.all(testWordNS, "tc") {
		v := cell.child("tcPr").child("vAlign")
		if v == nil || v.attr(testWordNS, "val") != "top" {
			t.Fatal("cell not top aligned")
		}
	}
}

func TestWordTableAuthoredHeadingBaseIgnoresCanonicalReferences(t *testing.T) {
	for _, title := range []string{"", "# Report\n\n"} {
		doc, err := BuildCited(title+"### Introduction\n\nLead\n\n#### Detail\n\nBody\n\n###### Gap\n\nMore", []citation.Row{{Citation: citation.Presentation{Runs: []citation.Run{{Text: "Entry"}}}}}, Options{})
		if err != nil {
			t.Fatal(err)
		}
		data, err := RenderCitedWord(doc)
		if err != nil {
			t.Fatal(err)
		}
		parts := wordParts(t, data)
		tree := readWordNode(t, parts["word/document.xml"])
		styles := readWordNode(t, parts["word/styles.xml"])
		offset := 0
		if title != "" {
			offset = 1
		}
		for _, p := range tree.all(testWordNS, "p") {
			want, ok := map[string]int{"Introduction": offset, "Detail": offset + 1, "Gap": offset + 3, "References": offset}[p.content()]
			if ok && resolvedWordProps(t, styles, p, nil, "pPr")["outlineLvl/val"] != strconv.Itoa(want) {
				t.Errorf("%q outline differs from authored base", p.content())
			}
		}
	}
}

func TestWordTableImagesFitCellsAndPreserveFollowingLink(t *testing.T) {
	doc, err := BuildCited("| A | B |\n|:--|--:|\n| Before ![available](asset) [after](https://example.org/after) | ![available](asset) ![unavailable](denied) |", nil, Options{FetchImage: func(href string) (*Image, error) {
		if href == "asset" {
			return tableTestImage(t, 2400, 600), nil
		}
		return nil, errors.New("unavailable")
	}})
	if err != nil {
		t.Fatal(err)
	}
	data, err := RenderCitedWord(doc)
	if err != nil {
		t.Fatal(err)
	}
	parts := wordParts(t, data)
	tree := readWordNode(t, parts["word/document.xml"])
	styles := readWordNode(t, parts["word/styles.xml"])
	table := tree.all(testWordNS, "tbl")[0]
	cells := table.all(testWordNS, "tr")[1].all(testWordNS, "tc")
	if len(cells) != 2 {
		t.Fatal("expected first and last data cells")
	}
	for i, cell := range cells {
		extents := cell.all("http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing", "extent")
		if len(extents) != 1 {
			t.Fatalf("cell %d admitted image lost", i)
		}
		cx, _ := strconv.Atoi(extents[0].attr("", "cx"))
		cy, _ := strconv.Atoi(extents[0].attr("", "cy"))
		gridWidth, _ := strconv.Atoi(table.child("tblGrid").children[i].attr(testWordNS, "w"))
		cellWidth, _ := strconv.Atoi(cell.child("tcPr").child("tcW").attr(testWordNS, "w"))
		left := resolvedWordCellMargin(t, styles, table, cell, "left")
		right := resolvedWordCellMargin(t, styles, table, cell, "right")
		if left != 108 || right != 108 || cellWidth != gridWidth {
			t.Fatal("retained grid/margin policy drift")
		}
		drawable := (cellWidth - left - right) * 635
		if cx > drawable || math.Abs(float64(cx-drawable)) > 1 || math.Abs(float64(cx)/float64(cy)-4) > 0.00001 {
			t.Errorf("cell %d image exceeds drawable width or changes aspect: cx=%d cy=%d drawable=%d (grid=%d margins=%d+%d)", i, cx, cy, drawable, cellWidth, left, right)
		}
		if resolvedWordProps(t, styles, cell.child("p"), nil, "pPr")["jc/val"] != []string{"left", "right"}[i] {
			t.Errorf("cell %d image paragraph alignment lost", i)
		}
	}
	links := tree.all(testWordNS, "hyperlink")
	if len(links) != 1 || links[0].content() != "after" || !strings.Contains(tree.content(), "unavailable") {
		t.Fatal("image/alt disturbed cell hyperlink")
	}
}

func resolvedWordCellMargin(t *testing.T, styles, table, cell *wordNode, side string) int {
	t.Helper()
	value := 0
	apply := func(margins *wordNode) {
		if margin := margins.child(side); margin != nil {
			if margin.attr(testWordNS, "type") != "dxa" {
				t.Fatal("expected twip cell margin")
			}
			var err error
			value, err = strconv.Atoi(margin.attr(testWordNS, "w"))
			if err != nil {
				t.Fatal(err)
			}
		}
	}
	byID := map[string]*wordNode{}
	for _, s := range styles.all(testWordNS, "style") {
		byID[s.attr(testWordNS, "styleId")] = s
	}
	var inherit func(string, int)
	inherit = func(id string, depth int) {
		if depth > 20 {
			t.Fatal("table style cycle")
		}
		if s := byID[id]; s != nil {
			if parent := s.child("basedOn"); parent != nil {
				inherit(parent.attr(testWordNS, "val"), depth+1)
			}
			apply(s.child("tblPr").child("tblCellMar"))
		}
	}
	inherit(table.child("tblPr").child("tblStyle").attr(testWordNS, "val"), 0)
	apply(table.child("tblPr").child("tblCellMar"))
	apply(cell.child("tcPr").child("tcMar"))
	return value
}

func TestWordTableRejectsCellsWithoutDrawableImageWidth(t *testing.T) {
	row := make([][]inline, 43)
	row[0] = []inline{{kind: inlineImage, image: tableTestImage(t, 2400, 600), text: "Image"}}
	data, err := RenderCitedWord(Document{blocks: []block{{kind: blockTable, rows: [][][]inline{row}}}})
	if err == nil || data != nil {
		t.Fatal("cell narrower than retained margins produced a document")
	}
	row[0] = []inline{{text: "Text-only cell"}}
	if _, err := RenderCitedWord(Document{blocks: []block{{kind: blockTable, rows: [][][]inline{row}}}}); err != nil {
		t.Fatal("image geometry guard changed text-only table behavior")
	}
}

func TestWordTableFixtureAllSourceAndGridPolicy(t *testing.T) {
	src, err := os.ReadFile("../testdata/academic-table.txt")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := BuildCited(string(src), []citation.Row{{Citation: citation.Presentation{Runs: []citation.Run{{Text: "Reference entry"}}}}}, Options{})
	if err != nil {
		t.Fatal(err)
	}
	data, err := RenderCitedWord(doc)
	if err != nil {
		t.Fatal(err)
	}
	parts := wordParts(t, data)
	tree := readWordNode(t, parts["word/document.xml"])
	styles := readWordNode(t, parts["word/styles.xml"])
	content := tree.content()
	for _, token := range regexp.MustCompile(`\b(?:R\d{3}[LR]|T\d{4}|H\d{4}|E\d{3}[LR])\b`).FindAllString(string(src), -1) {
		if strings.Count(content, token) != 1 {
			t.Errorf("source label lost/duplicated: %s", token)
		}
	}
	tables := tree.all(testWordNS, "tbl")
	if len(tables) != 2 {
		t.Fatal("fixture tables lost")
	}
	for _, table := range tables {
		if table.child("tblPr").child("tblW").attr(testWordNS, "w") != "9071" || len(table.all(testWordNS, "tblHeader")) != 1 || len(table.all(testWordNS, "cantSplit")) != 0 {
			t.Fatal("width/header/splitting policy lost")
		}
		cols := table.child("tblGrid").children
		if len(cols) != 2 || cols[0].attr(testWordNS, "w") != "4536" || cols[1].attr(testWordNS, "w") != "4535" {
			t.Fatal("equal grid does not sum to printable width")
		}
		for i, cell := range table.all(testWordNS, "tc") {
			if cell.child("tcPr").child("vAlign").attr(testWordNS, "val") != "top" || cell.child("tcPr").child("tcW").attr(testWordNS, "w") != []string{"4536", "4535"}[i%2] {
				t.Fatal("cell width/top policy lost")
			}
			p := cell.child("p")
			pr := resolvedWordProps(t, styles, p, nil, "pPr")
			if pr["jc/val"] != []string{"left", "right"}[i%2] || pr["spacing/line"] != "288" {
				t.Fatal("semantic alignment/table spacing lost")
			}
		}
	}
	for _, link := range tree.all(testWordNS, "hyperlink") {
		if link.content() == "LINKCELL" {
			for _, rel := range readWordNode(t, parts["word/_rels/document.xml.rels"]).children {
				if rel.attr("", "Id") == link.attr(testRelNS, "id") && rel.attr("", "Target") == "https://example.org/table" {
					return
				}
			}
		}
	}
	t.Fatal("table link relationship lost")
}
