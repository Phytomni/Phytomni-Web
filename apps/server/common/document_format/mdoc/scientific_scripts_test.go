package mdoc

import "testing"

type wantInline struct {
	text     string
	vertical verticalPosition
}

func assertInlineRuns(t *testing.T, got []inline, want []wantInline) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("run count = %d, want %d; got=%v", len(got), len(want), got)
	}
	for i := range want {
		if got[i].text != want[i].text || got[i].style.vertical != want[i].vertical {
			t.Fatalf("run[%d] = {%q %q}, want {%q %q}", i, got[i].text, got[i].style.vertical, want[i].text, want[i].vertical)
		}
	}
}

func TestNormalizeScientificDocumentMapsUnicodeScripts(t *testing.T) {
	doc := Document{blocks: []block{{kind: blockParagraph, inlines: []inline{{text: "GA₂₀ and 10⁻⁶"}}}}}
	got := normalizeScientificDocument(doc)
	runs := got.blocks[0].inlines
	assertInlineRuns(t, runs, []wantInline{
		{text: "GA", vertical: verticalBaseline},
		{text: "20", vertical: verticalSubscript},
		{text: " and 10", vertical: verticalBaseline},
		{text: "-6", vertical: verticalSuperscript},
	})
}

func TestNormalizeScientificDocumentPreservesExplicitRunsAndCode(t *testing.T) {
	doc := Document{blocks: []block{{kind: blockParagraph, inlines: []inline{
		{text: "<sup>2</sup>", style: style{vertical: verticalSuperscript}},
		{text: "x₂", style: style{code: true}},
	}}}}
	got := normalizeScientificDocument(doc)
	if got.blocks[0].inlines[0].style.vertical != verticalSuperscript {
		t.Fatal("explicit vertical style changed")
	}
	if got.blocks[0].inlines[1].text != "x₂" {
		t.Fatal("code span was normalized")
	}
}

func TestNormalizeScientificDocumentMapsEveryApprovedScript(t *testing.T) {
	cases := []struct {
		name     string
		source   string
		wantText string
		vertical verticalPosition
	}{
		{"sup-0", "⁰", "0", verticalSuperscript},
		{"sup-1", "¹", "1", verticalSuperscript},
		{"sup-2", "²", "2", verticalSuperscript},
		{"sup-3", "³", "3", verticalSuperscript},
		{"sup-4", "⁴", "4", verticalSuperscript},
		{"sup-5", "⁵", "5", verticalSuperscript},
		{"sup-6", "⁶", "6", verticalSuperscript},
		{"sup-7", "⁷", "7", verticalSuperscript},
		{"sup-8", "⁸", "8", verticalSuperscript},
		{"sup-9", "⁹", "9", verticalSuperscript},
		{"sup-plus", "⁺", "+", verticalSuperscript},
		{"sup-minus", "⁻", "-", verticalSuperscript},
		{"sup-eq", "⁼", "=", verticalSuperscript},
		{"sup-lparen", "⁽", "(", verticalSuperscript},
		{"sup-rparen", "⁾", ")", verticalSuperscript},
		{"sub-0", "₀", "0", verticalSubscript},
		{"sub-1", "₁", "1", verticalSubscript},
		{"sub-2", "₂", "2", verticalSubscript},
		{"sub-3", "₃", "3", verticalSubscript},
		{"sub-4", "₄", "4", verticalSubscript},
		{"sub-5", "₅", "5", verticalSubscript},
		{"sub-6", "₆", "6", verticalSubscript},
		{"sub-7", "₇", "7", verticalSubscript},
		{"sub-8", "₈", "8", verticalSubscript},
		{"sub-9", "₉", "9", verticalSubscript},
		{"sub-plus", "₊", "+", verticalSubscript},
		{"sub-minus", "₋", "-", verticalSubscript},
		{"sub-eq", "₌", "=", verticalSubscript},
		{"sub-lparen", "₍", "(", verticalSubscript},
		{"sub-rparen", "₎", ")", verticalSubscript},
		{"all-superscript", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾", "0123456789+-=()", verticalSuperscript},
		{"all-subscript", "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎", "0123456789+-=()", verticalSubscript},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			doc := Document{blocks: []block{{kind: blockParagraph, inlines: []inline{{text: tc.source}}}}}
			got := normalizeScientificDocument(doc)
			assertInlineRuns(t, got.blocks[0].inlines, []wantInline{
				{text: tc.wantText, vertical: tc.vertical},
			})
		})
	}
}

func TestNormalizeScientificDocumentSplitsMixedBaselineAndScripts(t *testing.T) {
	doc := Document{blocks: []block{{kind: blockParagraph, inlines: []inline{{text: "x⁰₁₂y⁺⁻z₍₎"}}}}}
	got := normalizeScientificDocument(doc)
	assertInlineRuns(t, got.blocks[0].inlines, []wantInline{
		{text: "x", vertical: verticalBaseline},
		{text: "0", vertical: verticalSuperscript},
		{text: "12", vertical: verticalSubscript},
		{text: "y", vertical: verticalBaseline},
		{text: "+-", vertical: verticalSuperscript},
		{text: "z", vertical: verticalBaseline},
		{text: "()", vertical: verticalSubscript},
	})
}

func TestNormalizeScientificDocumentWalksTableCells(t *testing.T) {
	doc := Document{blocks: []block{{
		kind: blockTable,
		rows: [][][]inline{
			{
				{{text: "GA₂₀"}},
				{{text: "10⁻⁶"}},
			},
		},
	}}}
	got := normalizeScientificDocument(doc)
	assertInlineRuns(t, got.blocks[0].rows[0][0], []wantInline{
		{text: "GA", vertical: verticalBaseline},
		{text: "20", vertical: verticalSubscript},
	})
	assertInlineRuns(t, got.blocks[0].rows[0][1], []wantInline{
		{text: "10", vertical: verticalBaseline},
		{text: "-6", vertical: verticalSuperscript},
	})
}

func TestNormalizeScientificDocumentWalksListChildren(t *testing.T) {
	doc := Document{blocks: []block{{
		kind: blockList,
		items: [][]block{
			{{kind: blockParagraph, inlines: []inline{{text: "GA₁"}}}},
			{{kind: blockParagraph, inlines: []inline{{text: "10⁻⁶"}}}},
		},
	}}}
	got := normalizeScientificDocument(doc)
	assertInlineRuns(t, got.blocks[0].items[0][0].inlines, []wantInline{
		{text: "GA", vertical: verticalBaseline},
		{text: "1", vertical: verticalSubscript},
	})
	assertInlineRuns(t, got.blocks[0].items[1][0].inlines, []wantInline{
		{text: "10", vertical: verticalBaseline},
		{text: "-6", vertical: verticalSuperscript},
	})
}

func TestNormalizeScientificDocumentWalksNestedBlockQuotes(t *testing.T) {
	doc := Document{blocks: []block{{
		kind: blockQuote,
		children: []block{{
			kind: blockQuote,
			children: []block{{
				kind:    blockParagraph,
				inlines: []inline{{text: "GA₂₀ and 10⁻⁶"}},
			}},
		}},
	}}}
	got := normalizeScientificDocument(doc)
	assertInlineRuns(t, got.blocks[0].children[0].children[0].inlines, []wantInline{
		{text: "GA", vertical: verticalBaseline},
		{text: "20", vertical: verticalSubscript},
		{text: " and 10", vertical: verticalBaseline},
		{text: "-6", vertical: verticalSuperscript},
	})
}

func TestNormalizeScientificDocumentDoesNotMutateInput(t *testing.T) {
	img := &Image{Bytes: []byte{1, 2, 3}, MIME: "image/png"}
	cite := &citationMark{text: "1", indices: []int{1, 2}, active: true}
	doc := Document{blocks: []block{
		{
			kind:           blockParagraph,
			role:           roleBody,
			referenceIndex: 3,
			inlines: []inline{{
				kind:     inlineText,
				text:     "GA₂₀",
				href:     "https://example.org",
				style:    style{bold: true, italic: true, strike: true},
				image:    img,
				citation: cite,
			}},
		},
		{
			kind:       blockTable,
			alignments: []tableAlignment{alignLeft, alignRight},
			rows:       [][][]inline{{{{text: "10⁻⁶"}}}},
		},
		{
			kind:    blockList,
			level:   2,
			ordered: true,
			items:   [][]block{{{kind: blockParagraph, inlines: []inline{{text: "GA₁"}}}}},
		},
		{
			kind:     blockQuote,
			children: []block{{kind: blockParagraph, inlines: []inline{{text: "x₂"}}}},
		},
		{kind: blockCode, code: "x₂"},
	}}

	got := normalizeScientificDocument(doc)

	runs := got.blocks[0].inlines
	assertInlineRuns(t, runs, []wantInline{
		{text: "GA", vertical: verticalBaseline},
		{text: "20", vertical: verticalSubscript},
	})
	for i, run := range runs {
		if !run.style.bold || !run.style.italic || !run.style.strike || run.href != "https://example.org" || run.citation == nil || run.image == nil || run.kind != inlineText {
			t.Fatalf("metadata lost on run %d: %+v", i, run)
		}
	}

	if doc.blocks[0].inlines[0].text != "GA₂₀" || len(doc.blocks[0].inlines) != 1 {
		t.Fatal("input paragraph mutated")
	}
	if doc.blocks[1].rows[0][0][0].text != "10⁻⁶" {
		t.Fatal("input table mutated")
	}
	if doc.blocks[2].items[0][0].inlines[0].text != "GA₁" {
		t.Fatal("input list mutated")
	}
	if doc.blocks[3].children[0].inlines[0].text != "x₂" {
		t.Fatal("input quote mutated")
	}
	if doc.blocks[4].code != "x₂" {
		t.Fatal("input code mutated")
	}
	if cite.indices[0] != 1 || img.Bytes[0] != 1 {
		t.Fatal("input pointers mutated")
	}

	got.blocks[0].inlines[0].text = "mutated"
	got.blocks[0].inlines[0].citation.indices[0] = 99
	got.blocks[0].inlines[0].image.Bytes[0] = 9
	got.blocks[1].alignments[0] = alignCenter
	got.blocks = append(got.blocks, block{})
	if doc.blocks[0].inlines[0].text != "GA₂₀" || doc.blocks[0].inlines[0].citation.indices[0] != 1 || doc.blocks[0].inlines[0].image.Bytes[0] != 1 {
		t.Fatal("output aliases input")
	}
	if doc.blocks[1].alignments[0] != alignLeft {
		t.Fatal("output alignments alias input")
	}
	if len(doc.blocks) != 5 {
		t.Fatal("output blocks alias input")
	}
}
