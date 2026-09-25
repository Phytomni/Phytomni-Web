package mdoc

import (
	"archive/zip"
	"bytes"
	"io"
	"reflect"
	"testing"
)

func TestWordPackageRejectsInvalidCoordinatesAndURLs(t *testing.T) {
	data, e := RenderWord("one **two** three", Options{})
	if e != nil {
		t.Fatal(e)
	}
	for _, links := range [][]wordLinkPatch{
		{{-1, 0, 1, "https://example.org"}}, {{0, -1, 1, "https://example.org"}}, {{0, 0, 0, "https://example.org"}}, {{1, 0, 1, "https://example.org"}}, {{0, 0, 4, "https://example.org"}},
		{{0, 0, 2, "https://example.org"}, {0, 1, 2, "https://example.org"}}, {{0, 0, 1, "javascript:alert(1)"}}, {{0, 0, 1, "https://user:pass@example.org"}}, {{0, 0, 1, "file:///tmp/a"}}, {{0, 0, 1, "https://"}}, {{0, 0, 1, "https://example.org/\nfoo"}},
		{{0, 0, 1, "https://example.org/%0A"}}, {{0, 0, 1, "https://example.org/?x=%0D"}}, {{0, 0, 1, "https://example.org/#%00"}},
	} {
		out, e := patchWordPackage(data, wordPackagePlan{links: links})
		if e == nil || out != nil {
			t.Errorf("invalid patch accepted: %+v", links)
		}
	}
}

func syntheticWordPackage(t *testing.T, parts map[string][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	for name, b := range parts {
		h := &zip.FileHeader{Name: name, Method: zip.Deflate, Comment: "synthetic preservation fixture", Extra: []byte{0xff, 0xff, 0, 0}}
		h.SetMode(0600)
		w, err := z.CreateHeader(h)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = w.Write(b); err != nil {
			t.Fatal(err)
		}
	}
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestWordPackageNamespaceCoordinatesAndCollisionFreePreservation(t *testing.T) {
	base, err := RenderWord("seed", Options{})
	if err != nil {
		t.Fatal(err)
	}
	parts := wordParts(t, base)
	// Application-owned synthetic XML deliberately uses a foreign p/r and
	// repeated visible text. Only the Word namespace and actual coordinates count.
	parts["word/document.xml"] = []byte(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:x="urn:fixture" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x"><w:body><x:p><x:r>same</x:r></x:p><w:p><w:r><w:t>same</w:t></w:r><w:r><w:t>same</w:t></w:r></w:p><w:tbl><w:tblPr/><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>tail</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`)
	parts["word/_rels/document.xml.rels"] = []byte(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`)
	parts["word/footer1.xml"] = []byte(`<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`)
	parts["customXml/task10.bin"] = []byte{0, 1, 2, 255}
	input := syntheticWordPackage(t, parts)
	output, err := patchWordPackage(input, wordPackagePlan{academic: true, links: []wordLinkPatch{{2, 0, 1, "https://example.org/tail"}, {0, 1, 1, "https://example.org/same"}, {1, 0, 1, "https://example.org/cell"}}})
	if err != nil {
		t.Fatal(err)
	}
	after := wordParts(t, output)
	tree := readWordNode(t, after["word/document.xml"])
	if tree.attr("http://schemas.openxmlformats.org/markup-compatibility/2006", "Ignorable") != "x" || tree.attr("xmlns", "x") != "urn:fixture" {
		t.Fatal("namespace prefixes corrupted")
	}
	ps := tree.all(testWordNS, "p")
	if len(ps) != 3 || ps[0].child("r") == nil || len(ps[0].all(testWordNS, "hyperlink")) != 1 {
		t.Fatal("foreign namespace changed paragraph/run coordinates")
	}
	rels := readWordNode(t, after["word/_rels/document.xml.rels"])
	targets := map[string]string{}
	for _, r := range rels.children {
		id := r.attr("", "Id")
		if targets[id] != "" {
			t.Fatal("duplicate relationship ID")
		}
		targets[id] = r.attr("", "Target")
	}
	for i, want := range []string{"https://example.org/same", "https://example.org/cell", "https://example.org/tail"} {
		l := ps[i].all(testWordNS, "hyperlink")[0]
		if targets[l.attr(testRelNS, "id")] != want {
			t.Fatalf("coordinate p%d changed", i)
		}
	}
	cell := tree.all(testWordNS, "tc")[0]
	if cell.child("tcPr").child("vAlign").attr(testWordNS, "val") != "top" {
		t.Fatal("academic adapter omitted cell top alignment")
	}
	if !bytes.Equal(after["word/footer1.xml"], parts["word/footer1.xml"]) || len(after["word/footer2.xml"]) == 0 {
		t.Fatal("existing footer overwritten")
	}
	zin, _ := zip.NewReader(bytes.NewReader(input), int64(len(input)))
	zout, _ := zip.NewReader(bytes.NewReader(output), int64(len(output)))
	for _, old := range zin.File {
		if old.Name == "word/document.xml" || old.Name == "word/_rels/document.xml.rels" || old.Name == "[Content_Types].xml" {
			continue
		}
		var current *zip.File
		for _, f := range zout.File {
			if f.Name == old.Name {
				current = f
			}
		}
		if current == nil || !reflect.DeepEqual(old.FileHeader, current.FileHeader) {
			t.Fatalf("ZIP header changed: %s", old.Name)
		}
		a, e := old.OpenRaw()
		if e != nil {
			t.Fatal(e)
		}
		b, e := current.OpenRaw()
		if e != nil {
			t.Fatal(e)
		}
		ab, e := io.ReadAll(a)
		if e != nil {
			t.Fatal(e)
		}
		bb, e := io.ReadAll(b)
		if e != nil {
			t.Fatal(e)
		}
		if !bytes.Equal(ab, bb) {
			t.Fatalf("unrelated compressed bytes changed: %s", old.Name)
		}
	}
}

func TestWordPackageRejectsNoncontiguousAndInvalidGeneratedPackages(t *testing.T) {
	base, err := RenderWord("seed", Options{})
	if err != nil {
		t.Fatal(err)
	}
	parts := wordParts(t, base)
	parts["word/document.xml"] = []byte(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>a</w:t></w:r><w:bookmarkStart w:id="1" w:name="synthetic"/><w:r><w:t>b</w:t></w:r></w:p><w:p/></w:body></w:document>`)
	for _, plan := range []wordPackagePlan{{links: []wordLinkPatch{{0, 0, 2, "https://example.org"}}}, {links: []wordLinkPatch{{1, 0, 1, "https://example.org"}}}, {academic: true}} {
		data, err := patchWordPackage(syntheticWordPackage(t, parts), plan)
		if err == nil || data != nil {
			t.Fatal("invalid generated package partially patched")
		}
	}
	for _, input := range [][]byte{nil, []byte("not ZIP")} {
		if out, err := patchWordPackage(input, wordPackagePlan{}); err == nil || out != nil {
			t.Fatal("invalid ZIP accepted")
		}
	}
	parts["word/document.xml"] = []byte(`<document xmlns="urn:wrong"/>`)
	if out, err := patchWordPackage(syntheticWordPackage(t, parts), wordPackagePlan{}); err == nil || out != nil {
		t.Fatal("wrong document namespace accepted")
	}
}

func TestWordPackageRejectsInvalidNativeNumberingPlans(t *testing.T) {
	data, err := RenderWord("seed", Options{})
	if err != nil {
		t.Fatal(err)
	}
	for _, plan := range []wordPackagePlan{
		{numbering: []wordNumberingPatch{{10, 7}}},
		{academic: true, numbering: []wordNumberingPatch{{0, 7}}},
		{academic: true, numbering: []wordNumberingPatch{{1, 7}}},
		{academic: true, numbering: []wordNumberingPatch{{10, 99}}},
		{academic: true, numbering: []wordNumberingPatch{{10, 7}, {10, 3}}},
	} {
		if output, err := patchWordPackage(data, plan); err == nil || output != nil {
			t.Fatal("invalid numbering returned a package")
		}
	}
}

func TestWordPackageFooterResetsInheritedBodyIndent(t *testing.T) {
	doc, err := BuildCited("Academic body.", nil, Options{})
	if err != nil {
		t.Fatal(err)
	}
	data, err := RenderCitedWord(doc)
	if err != nil {
		t.Fatal(err)
	}
	parts := wordParts(t, data)
	styles := readWordNode(t, parts["word/styles.xml"])
	footer := readWordNode(t, parts["word/footer1.xml"])
	props := resolvedWordProps(t, styles, footer.child("p"), nil, "pPr")
	for key, want := range map[string]string{
		"jc/val": "center", "ind/left": "0", "ind/right": "0", "ind/firstLine": "0",
	} {
		if props[key] != want {
			t.Errorf("resolved footer %s = %q, want %q; properties: %v", key, props[key], want, props)
		}
	}
}

func TestWordPackagePreservesMembersAndCreatesActualFooter(t *testing.T) {
	data, e := RenderWord("first **second** third", Options{})
	if e != nil {
		t.Fatal(e)
	}
	before := wordParts(t, data)
	out, e := patchWordPackage(data, wordPackagePlan{academic: true, links: []wordLinkPatch{{0, 1, 2, "https://example.org/?a=1&b=%3Cvalue%3E"}}})
	if e != nil {
		t.Fatal(e)
	}
	after := wordParts(t, out)
	for name, b := range before {
		if name != "word/document.xml" && name != "word/_rels/document.xml.rels" && name != "[Content_Types].xml" {
			if !bytes.Equal(b, after[name]) {
				t.Errorf("unrelated member changed: %s", name)
			}
		}
	}
	for name, b := range after {
		if len(b) > 0 && (name == "word/document.xml" || name == "word/styles.xml" || name == "word/footer1.xml" || name == "word/_rels/document.xml.rels" || name == "[Content_Types].xml") {
			readWordNode(t, b)
		}
	}
	footer := readWordNode(t, after["word/footer1.xml"])
	if footer.name.Space != testWordNS || footer.name.Local != "ftr" {
		t.Fatal("footer namespace")
	}
	p := footer.child("p")
	if p.child("pPr").child("jc").attr(testWordNS, "val") != "center" {
		t.Fatal("footer not centered")
	}
	fields := footer.all(testWordNS, "fldChar")
	if len(fields) != 3 {
		t.Fatal("not a real PAGE field")
	}
	for i, v := range []string{"begin", "separate", "end"} {
		if fields[i].attr(testWordNS, "fldCharType") != v {
			t.Fatal("field sequence")
		}
	}
	if footer.all(testWordNS, "instrText")[0].content() != " PAGE " {
		t.Fatal("wrong field")
	}
	for _, r := range footer.all(testWordNS, "r") {
		if r.child("rPr").child("sz").attr(testWordNS, "val") != "18" || r.child("rPr").child("rFonts").attr(testWordNS, "ascii") != "Times New Roman" {
			t.Fatal("footer font")
		}
	}
	document := readWordNode(t, after["word/document.xml"])
	section := document.all(testWordNS, "sectPr")[0]
	if section.children[0].name.Local != "footerReference" {
		t.Fatal("footer schema order")
	}
	rid := section.children[0].attr(testRelNS, "id")
	rels := readWordNode(t, after["word/_rels/document.xml.rels"])
	found := false
	ids := map[string]bool{}
	for _, r := range rels.children {
		id := r.attr("", "Id")
		if ids[id] {
			t.Fatal("duplicate relationship")
		}
		ids[id] = true
		if id == rid && r.attr("", "Target") == "footer1.xml" {
			found = true
		}
	}
	if !found {
		t.Fatal("footer relationship missing")
	}
	cts := readWordNode(t, after["[Content_Types].xml"])
	found = false
	for _, c := range cts.children {
		if c.attr("", "PartName") == "/word/footer1.xml" && c.attr("", "ContentType") == "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml" {
			found = true
		}
	}
	if !found {
		t.Fatal("footer content type missing")
	}
}
