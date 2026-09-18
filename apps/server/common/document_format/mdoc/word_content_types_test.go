package mdoc

import (
	"bytes"
	"fmt"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"path"
	"strings"
	"testing"
)

func TestCitedWordImageContentTypesAreUniqueWithoutLosingContent(t *testing.T) {
	images := map[string][]byte{}
	for _, format := range []string{"png", "jpeg", "gif"} {
		var data bytes.Buffer
		img := image.NewRGBA(image.Rect(0, 0, 16, 8))
		var err error
		switch format {
		case "png":
			err = png.Encode(&data, img)
		case "jpeg":
			err = jpeg.Encode(&data, img, nil)
		case "gif":
			err = gif.Encode(&data, img, nil)
		}
		if err != nil {
			t.Fatal(err)
		}
		images[format] = data.Bytes()
	}
	for _, tc := range []struct {
		name    string
		formats []string
	}{
		{"repeated PNG", []string{"png", "png"}},
		{"single JPEG keeps distinct template extension", []string{"jpeg"}},
		{"repeated JPEG", []string{"jpeg", "jpeg"}},
		{"mixed PNG JPEG GIF", []string{"png", "jpeg", "gif", "png", "gif"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var markdown strings.Builder
			markdown.WriteString("# Image report\n\n*OsD18* H<sub>2</sub>O Fe<sup>3+</sup> [source](https://example.org/source)\n\n")
			for i, format := range tc.formats {
				fmt.Fprintf(&markdown, "![image %d](/images/%s)\n\n", i, format)
			}
			doc, err := BuildCited(markdown.String(), nil, Options{FetchImage: func(href string) (*Image, error) {
				data, ok := images[path.Base(href)]
				if !ok {
					return nil, fmt.Errorf("unexpected fixture image %s", href)
				}
				return &Image{Bytes: data}, nil
			}})
			if err != nil {
				t.Fatal(err)
			}
			data, err := RenderCitedWord(doc)
			if err != nil {
				t.Fatal(err)
			}
			parts := wordParts(t, data)
			contentTypes := assertUniqueWordContentTypes(t, parts["[Content_Types].xml"])
			// The template declares jpeg, while tempImage currently writes jpg.
			// Both aliases remain necessary; sharing a MIME type is not a duplicate.
			if contentTypes["jpeg"] != "image/jpeg" {
				t.Error("template JPEG declaration was lost")
			}
			tree := readWordNode(t, parts["word/document.xml"])
			rels := readWordNode(t, parts["word/_rels/document.xml.rels"])
			targets := map[string]string{}
			imageRelations := 0
			for _, rel := range rels.children {
				id := rel.attr("", "Id")
				if id == "" || targets[id] != "" {
					t.Fatalf("missing or duplicate relationship ID %q", id)
				}
				targets[id] = rel.attr("", "Target")
				if rel.attr("", "Type") == testRelNS+"/image" {
					imageRelations++
				}
			}
			blips := tree.all("http://schemas.openxmlformats.org/drawingml/2006/main", "blip")
			if len(blips) != len(tc.formats) || imageRelations != len(tc.formats) || len(tree.all(testWordNS, "drawing")) != len(tc.formats) {
				t.Fatalf("image count changed: blips=%d relationships=%d want=%d", len(blips), imageRelations, len(tc.formats))
			}
			seenTargets := map[string]bool{}
			for i, blip := range blips {
				target := "word/" + targets[blip.attr(testRelNS, "embed")]
				if seenTargets[target] || !bytes.Equal(parts[target], images[tc.formats[i]]) {
					t.Fatalf("image %d lost, duplicated, reordered, or changed: %s", i, target)
				}
				seenTargets[target] = true
				extension := strings.ToLower(strings.TrimPrefix(path.Ext(target), "."))
				if contentTypes[extension] != "image/"+tc.formats[i] {
					t.Errorf("media %s has content type %q", target, contentTypes[extension])
				}
			}
			for name := range parts {
				if strings.HasPrefix(name, "word/media/") && !seenTargets[name] {
					t.Errorf("unreferenced media member %s", name)
				}
			}
			links := tree.all(testWordNS, "hyperlink")
			if len(links) != 1 || links[0].content() != "source" || targets[links[0].attr(testRelNS, "id")] != "https://example.org/source" {
				t.Fatal("authored hyperlink changed")
			}
			styles := readWordNode(t, parts["word/styles.xml"])
			seenRuns := map[string]bool{}
			for _, p := range tree.all(testWordNS, "p") {
				for _, run := range p.all(testWordNS, "r") {
					value := run.content()
					if value != "OsD18" && value != "2" && value != "3+" {
						continue
					}
					seenRuns[value] = true
					props := resolvedWordProps(t, styles, p, run, "rPr")
					wantVertical := map[string]string{"2": "subscript", "3+": "superscript"}[value]
					if props["vertAlign/val"] != wantVertical || props["rFonts/ascii"] != "Times New Roman" || props["sz/val"] != "24" || (value == "OsD18" && props["i/val"] != "true") {
						t.Errorf("scientific formatting changed for %s: %v", value, props)
					}
				}
			}
			if len(seenRuns) != 3 || !strings.Contains(tree.content(), "H2O Fe3+") {
				t.Fatal("scientific text was lost")
			}
		})
	}
}

func assertUniqueWordContentTypes(t *testing.T, data []byte) map[string]string {
	t.Helper()
	root := readWordNode(t, data)
	defaults := map[string]string{}
	for _, entry := range root.all(wordContentTypeNS, "Default") {
		extension := strings.ToLower(entry.attr("", "Extension"))
		if _, exists := defaults[extension]; exists {
			t.Errorf("duplicate Default declaration for extension %q", extension)
		}
		defaults[extension] = entry.attr("", "ContentType")
	}
	return defaults
}

func TestWordPackageContentTypesDeduplicateEquivalentDeclarationsAndPreserveMembers(t *testing.T) {
	base, err := RenderWord("untouched source", Options{})
	if err != nil {
		t.Fatal(err)
	}
	parts := wordParts(t, base)
	first := `<ct:Default Extension="png" ContentType="image/png"></ct:Default>`
	jpeg := `<ct:Default Extension="jpeg" ContentType="image/jpeg"/>`
	foreign := `<x:Default Extension="png" ContentType="foreign/type"/>`
	originalOverride := `<ct:Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`
	parts["[Content_Types].xml"] = []byte(`<ct:Types xmlns:ct="` + wordContentTypeNS + `" xmlns:x="urn:fixture">` + first + jpeg + `<other:Default xmlns:other="` + wordContentTypeNS + `" ContentType="image/png" Extension="PNG"/>` + jpeg + foreign + originalOverride + `</ct:Types>`)
	parts["customXml/preservation.bin"] = []byte{0, 255, 2, 19}
	parts["word/media/preservation.png"] = png1x1
	out, err := patchWordPackage(syntheticWordPackage(t, parts), wordPackagePlan{academic: true})
	if err != nil {
		t.Fatal(err)
	}
	after := wordParts(t, out)
	defaults := assertUniqueWordContentTypes(t, after["[Content_Types].xml"])
	if len(defaults) != 2 || defaults["png"] != "image/png" || defaults["jpeg"] != "image/jpeg" {
		t.Fatalf("changed original type declaration: %v", defaults)
	}
	for _, preserved := range []string{first, jpeg, foreign, originalOverride} {
		if !bytes.Contains(after["[Content_Types].xml"], []byte(preserved)) {
			t.Errorf("unrelated or retained declaration was rewritten: %s", preserved)
		}
	}
	footerOverride := false
	for _, entry := range readWordNode(t, after["[Content_Types].xml"]).all(wordContentTypeNS, "Override") {
		if entry.attr("", "PartName") == "/word/footer1.xml" && entry.attr("", "ContentType") == "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml" {
			footerOverride = true
		}
	}
	if !footerOverride || len(after["word/footer1.xml"]) == 0 || len(after) != len(parts)+1 {
		t.Fatal("existing academic footer package edit changed")
	}
	for name, before := range parts {
		switch name {
		case "[Content_Types].xml", "word/document.xml", "word/_rels/document.xml.rels":
			continue
		}
		if !bytes.Equal(after[name], before) {
			t.Errorf("unrelated member changed: %s", name)
		}
	}
	if readWordNode(t, after["word/document.xml"]).content() != readWordNode(t, parts["word/document.xml"]).content() {
		t.Fatal("document text changed")
	}
}

func TestWordPackageContentTypesRejectConflictingDefaults(t *testing.T) {
	base, err := RenderWord("source", Options{})
	if err != nil {
		t.Fatal(err)
	}
	for _, extension := range []string{"png", "PNG"} {
		t.Run(extension, func(t *testing.T) {
			parts := wordParts(t, base)
			parts["[Content_Types].xml"] = []byte(`<Types xmlns="` + wordContentTypeNS + `"><Default Extension="png" ContentType="image/png"/><Default Extension="` + extension + `" ContentType="image/jpeg"/></Types>`)
			out, err := patchWordPackage(syntheticWordPackage(t, parts), wordPackagePlan{academic: true})
			if err == nil || out != nil {
				t.Fatal("conflicting Default declarations produced a document")
			}
		})
	}
}
