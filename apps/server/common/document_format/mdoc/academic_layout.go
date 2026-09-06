package mdoc

const (
	academicPageWidthMM        = 210
	academicPageHeightMM       = 297
	academicPageMarginMM       = 25
	academicPageOrientation    = "P"
	academicPageColumns        = 1
	academicReferenceHangingMM = 7.5

	academicTableFontSizePt    = 10
	academicTableLineMultiple  = 1.2
	academicCitationFontSizePt = 8
	academicCitationRisePt     = 3
	academicFooterFontSizePt   = 9

	academicCodePDFFamily  = "Courier"
	academicCodeDOCXFamily = "Courier New"
	academicCodeFontSizePt = 9
	academicCodeJustified  = false
)

type paragraphLayout struct {
	sizePt, lineMultiple, beforePt, afterPt float64
	firstIndentMM, hangingMM                float64
	alignment                               tableAlignment
	justified, bold, keepNext               bool
}

func academicLayout(role reportRole) paragraphLayout {
	switch role {
	case roleTitle:
		return paragraphLayout{
			sizePt: 16, lineMultiple: 1, afterPt: 12,
			alignment: alignCenter, bold: true, keepNext: true,
		}
	case roleSection:
		return paragraphLayout{
			sizePt: 14, lineMultiple: 1, beforePt: 12, afterPt: 6,
			alignment: alignLeft, bold: true, keepNext: true,
		}
	case roleSubsection:
		return paragraphLayout{
			sizePt: 12, lineMultiple: 1, beforePt: 9, afterPt: 4,
			alignment: alignLeft, bold: true, keepNext: true,
		}
	case roleLead:
		return paragraphLayout{
			sizePt: 12, lineMultiple: 1.5, afterPt: 6,
			alignment: alignLeft, justified: true,
		}
	case roleReference:
		return paragraphLayout{
			sizePt: 12, lineMultiple: 1.5, afterPt: 6,
			hangingMM: academicReferenceHangingMM, alignment: alignLeft, justified: true,
		}
	case roleReferenceLinks:
		// A reference and its link row form one group. Writers suppress the
		// entry's trailing gap when links follow and apply this gap once after
		// the links, aligning them with academicReferenceHangingMM.
		return paragraphLayout{
			sizePt: 10, lineMultiple: 1, afterPt: 6,
			alignment: alignLeft,
		}
	case roleCaption:
		return paragraphLayout{
			sizePt: 10, lineMultiple: academicTableLineMultiple,
			alignment: alignLeft,
		}
	default:
		return paragraphLayout{
			sizePt: 12, lineMultiple: 1.5, afterPt: 6,
			firstIndentMM: 7.5, alignment: alignLeft, justified: true,
		}
	}
}
