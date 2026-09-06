package mdoc

import "testing"

func TestAcademicParagraphLayouts(t *testing.T) {
	tests := []struct {
		name string
		role reportRole
		want paragraphLayout
	}{
		{
			name: "default prose",
			role: roleDefault,
			want: paragraphLayout{
				sizePt: 12, lineMultiple: 1.5, afterPt: 6,
				firstIndentMM: 7.5, alignment: alignLeft, justified: true,
			},
		},
		{
			name: "main title",
			role: roleTitle,
			want: paragraphLayout{
				sizePt: 16, lineMultiple: 1, afterPt: 12,
				alignment: alignCenter, bold: true, keepNext: true,
			},
		},
		{
			name: "section heading",
			role: roleSection,
			want: paragraphLayout{
				sizePt: 14, lineMultiple: 1, beforePt: 12, afterPt: 6,
				alignment: alignLeft, bold: true, keepNext: true,
			},
		},
		{
			name: "subsection heading",
			role: roleSubsection,
			want: paragraphLayout{
				sizePt: 12, lineMultiple: 1, beforePt: 9, afterPt: 4,
				alignment: alignLeft, bold: true, keepNext: true,
			},
		},
		{
			name: "body",
			role: roleBody,
			want: paragraphLayout{
				sizePt: 12, lineMultiple: 1.5, afterPt: 6,
				firstIndentMM: 7.5, alignment: alignLeft, justified: true,
			},
		},
		{
			name: "lead paragraph",
			role: roleLead,
			want: paragraphLayout{
				sizePt: 12, lineMultiple: 1.5, afterPt: 6,
				alignment: alignLeft, justified: true,
			},
		},
		{
			name: "bibliography entry",
			role: roleReference,
			want: paragraphLayout{
				sizePt: 12, lineMultiple: 1.5, afterPt: 6,
				hangingMM: 7.5, alignment: alignLeft, justified: true,
			},
		},
		{
			name: "reference links",
			role: roleReferenceLinks,
			want: paragraphLayout{
				sizePt: 10, lineMultiple: 1, afterPt: 6,
				alignment: alignLeft,
			},
		},
		{
			name: "table caption",
			role: roleCaption,
			want: paragraphLayout{
				sizePt: 10, lineMultiple: 1.2, alignment: alignLeft,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := academicLayout(tt.role); got != tt.want {
				t.Fatalf("academicLayout(%d) = %+v, want %+v", tt.role, got, tt.want)
			}
		})
	}
}

func TestAcademicPageAndSpecializedTypography(t *testing.T) {
	if academicPageWidthMM != 210 || academicPageHeightMM != 297 || academicPageMarginMM != 25 || academicPageOrientation != "P" || academicPageColumns != 1 {
		t.Fatalf("wrong A4 geometry: width=%v height=%v margin=%v orientation=%q columns=%v", academicPageWidthMM, academicPageHeightMM, academicPageMarginMM, academicPageOrientation, academicPageColumns)
	}
	if academicTableFontSizePt != 10 || academicTableLineMultiple != 1.2 {
		t.Fatalf("wrong table typography: size=%v line=%v", academicTableFontSizePt, academicTableLineMultiple)
	}
	if academicCitationFontSizePt != 8 || academicCitationRisePt != 3 {
		t.Fatalf("wrong citation typography: size=%v rise=%v", academicCitationFontSizePt, academicCitationRisePt)
	}
	if academicFooterFontSizePt != 9 {
		t.Fatalf("wrong footer size: %v", academicFooterFontSizePt)
	}
	if academicReferenceHangingMM != 7.5 {
		t.Fatalf("wrong shared reference hanging indent: %v", academicReferenceHangingMM)
	}
	if academicCodePDFFamily != "Courier" || academicCodeDOCXFamily != "Courier New" || academicCodeFontSizePt != 9 || academicCodeJustified {
		t.Fatalf("wrong code typography: pdf=%q docx=%q size=%v justified=%v", academicCodePDFFamily, academicCodeDOCXFamily, academicCodeFontSizePt, academicCodeJustified)
	}
}

func TestAcademicReferenceGroupSpacingInputs(t *testing.T) {
	entry := academicLayout(roleReference)
	links := academicLayout(roleReferenceLinks)
	if entry.afterPt != 6 || links.afterPt != 6 || academicReferenceHangingMM != 7.5 {
		t.Fatalf("wrong reference group contract: entry=%+v links=%+v hanging=%v", entry, links, academicReferenceHangingMM)
	}
	// When a link row follows, writers suppress entry.afterPt and apply
	// links.afterPt once; they align the row using academicReferenceHangingMM.
}
