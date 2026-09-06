package mdoc

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func citationMarks(blocks []block) []*citationMark {
	var marks []*citationMark
	var visit func([]block)
	visit = func(bs []block) {
		for _, b := range bs {
			for _, in := range b.inlines {
				if in.citation != nil {
					marks = append(marks, in.citation)
				}
			}
			for _, row := range b.rows {
				for _, cell := range row {
					for _, in := range cell {
						if in.citation != nil {
							marks = append(marks, in.citation)
						}
					}
				}
			}
			visit(b.children)
			for _, item := range b.items {
				visit(item)
			}
		}
	}
	visit(blocks)
	return marks
}

func TestNumericCitationSharedGrammar(t *testing.T) {
	raw, err := os.ReadFile("../testdata/citation-grammar.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name     string
		Source   string
		Displays []string
		Indices  [][]int
		Links    []struct {
			Label string
			Href  string
		}
	}
	if err = json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, f := range fixtures {
		t.Run(f.Name, func(t *testing.T) {
			doc, err := BuildCited(f.Source, nil, Options{})
			if err != nil {
				t.Fatal(err)
			}
			marks := citationMarks(doc.blocks)
			displays := []string{}
			indices := [][]int{}
			for _, m := range marks {
				displays = append(displays, m.text)
				indices = append(indices, m.indices)
				if m.active {
					t.Fatal("empty targets active")
				}
			}
			if !reflect.DeepEqual(displays, f.Displays) || !reflect.DeepEqual(indices, f.Indices) {
				t.Fatalf("got %v %v want %v %v", displays, indices, f.Displays, f.Indices)
			}
			for _, link := range f.Links {
				found := false
				for _, b := range doc.blocks {
					for _, in := range b.inlines {
						if in.text == link.Label && in.href == link.Href {
							found = true
						}
					}
				}
				if !found {
					t.Fatalf("link lost: %+v", link)
				}
			}
		})
	}
}

func TestNumericCitationActivationAndOrdinaryParser(t *testing.T) {
	rows := citedRows(t, `[{"title":"First"},null]`)
	doc, _ := BuildCited("Evidence [1,2] [2-3] [999].", rows, Options{})
	marks := citationMarks(doc.blocks)
	if len(marks) != 3 || !marks[0].active || marks[1].active || marks[2].active {
		t.Fatalf("invalid target activation: %#v", marks)
	}
	blocks, _ := parse("Evidence [1,2].", Options{})
	if len(citationMarks(blocks)) != 0 {
		t.Fatal("ordinary parser changed")
	}
}
