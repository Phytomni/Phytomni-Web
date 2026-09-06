package citation

import (
	"strings"
	"unicode/utf8"
)

func Format(source Source) Presentation {
	imported := importCitation(source.Formatted)

	var presentation Presentation
	if formatReady(source) {
		presentation = formatStructured(source)
		transferTitleEmphasis(&presentation, source, imported)
	} else if strings.TrimSpace(PlainText(imported)) != "" {
		presentation = imported
	} else {
		presentation = formatStructured(source)
	}

	presentation.Links = citationLinks(source, imported.Links)
	return presentation
}

func formatReady(source Source) bool {
	title := strings.TrimSpace(source.TI)
	if title == "" {
		title = strings.TrimSpace(source.Title)
	}
	return strings.TrimSpace(source.AU) != "" && title != "" &&
		strings.TrimSpace(source.SO) != "" && strings.TrimSpace(source.PY) != "" &&
		strings.TrimSpace(source.VL) != "" &&
		(strings.TrimSpace(source.BP) != "" || strings.TrimSpace(source.AR) != "")
}

func formatStructured(source Source) Presentation {
	presentation := Presentation{Runs: []Run{}, Links: []Link{}}
	authors := formatAuthors(source.AU)
	title := selectedTitle(source)
	titlePresentation := importCitation(title)
	title = strings.TrimSpace(PlainText(titlePresentation))
	journal := strings.TrimSpace(source.SO)
	volume := strings.TrimSpace(source.VL)
	locator := formatLocator(source.BP, source.EP, source.AR)
	year := strings.TrimSpace(source.PY)
	hasPublication := journal != "" || volume != "" || locator != ""

	if authors == "" && title == "" && !hasPublication && year == "" {
		presentation.Runs = append(presentation.Runs, Run{Text: "Reference details unavailable."})
		return presentation
	}

	appendRun(&presentation, Run{Text: authors})
	if authors != "" && (title != "" || hasPublication || year != "") {
		appendRun(&presentation, Run{Text: " "})
	}

	if title != "" {
		for _, run := range trimRuns(titlePresentation.Runs) {
			appendRun(&presentation, run)
		}
		if !endsWithSentencePunctuation(title) {
			appendRun(&presentation, Run{Text: "."})
		}
		if hasPublication || year != "" {
			appendRun(&presentation, Run{Text: " "})
		}
	}

	appendRun(&presentation, Run{Text: journal, Italic: journal != ""})
	if volume != "" {
		if journal != "" {
			appendRun(&presentation, Run{Text: " "})
		}
		appendRun(&presentation, Run{Text: volume, Bold: true})
	}
	if locator != "" {
		if journal != "" || volume != "" {
			appendRun(&presentation, Run{Text: ", "})
		}
		appendRun(&presentation, Run{Text: locator})
	}
	if year != "" {
		if hasPublication {
			appendRun(&presentation, Run{Text: " "})
		}
		appendRun(&presentation, Run{Text: "(" + year + ")"})
	}

	if !endsWithSentencePunctuation(PlainText(presentation)) {
		appendRun(&presentation, Run{Text: "."})
	}
	return presentation
}

func selectedTitle(source Source) string {
	if title := strings.TrimSpace(source.TI); title != "" {
		return title
	}
	return strings.TrimSpace(source.Title)
}

func trimRuns(runs []Run) []Run {
	trimmed := make([]Run, len(runs))
	copy(trimmed, runs)
	for len(trimmed) > 0 {
		trimmed[0].Text = strings.TrimLeft(trimmed[0].Text, " \t\r\n")
		if trimmed[0].Text != "" {
			break
		}
		trimmed = trimmed[1:]
	}
	for len(trimmed) > 0 {
		last := len(trimmed) - 1
		trimmed[last].Text = strings.TrimRight(trimmed[last].Text, " \t\r\n")
		if trimmed[last].Text != "" {
			break
		}
		trimmed = trimmed[:last]
	}
	return trimmed
}

func transferTitleEmphasis(presentation *Presentation, source Source, imported Presentation) {
	title := strings.TrimSpace(PlainText(importCitation(selectedTitle(source))))
	if title == "" {
		return
	}
	importedText := PlainText(imported)
	start := strings.Index(importedText, title)
	if start < 0 || strings.Contains(importedText[start+len(title):], title) {
		return
	}
	titleRuns := sliceRuns(imported.Runs, start, start+len(title))
	styled := false
	for _, run := range titleRuns {
		styled = styled || run.Bold || run.Italic
	}
	if !styled {
		return
	}

	authors := formatAuthors(source.AU)
	structuredStart := len(authors)
	if authors != "" {
		structuredStart++
	}
	presentation.Runs = replaceRunRange(presentation.Runs, structuredStart, structuredStart+len(title), titleRuns)
}

func sliceRuns(runs []Run, start, end int) []Run {
	var out []Run
	offset := 0
	for _, run := range runs {
		runEnd := offset + len(run.Text)
		if runEnd > start && offset < end {
			from := max(start-offset, 0)
			to := min(end-offset, len(run.Text))
			appendRunToSlice(&out, Run{Text: run.Text[from:to], Bold: run.Bold, Italic: run.Italic})
		}
		offset = runEnd
	}
	return out
}

func replaceRunRange(runs []Run, start, end int, replacement []Run) []Run {
	out := sliceRuns(runs, 0, start)
	for _, run := range replacement {
		appendRunToSlice(&out, run)
	}
	total := len(PlainText(Presentation{Runs: runs}))
	for _, run := range sliceRuns(runs, end, total) {
		appendRunToSlice(&out, run)
	}
	return out
}

func appendRunToSlice(runs *[]Run, run Run) {
	if run.Text == "" {
		return
	}
	last := len(*runs) - 1
	if last >= 0 && (*runs)[last].Bold == run.Bold && (*runs)[last].Italic == run.Italic {
		(*runs)[last].Text += run.Text
		return
	}
	*runs = append(*runs, run)
}

func PlainText(p Presentation) string {
	var out strings.Builder
	for _, run := range p.Runs {
		out.WriteString(run.Text)
	}
	return out.String()
}

func appendRun(presentation *Presentation, run Run) {
	appendRunToSlice(&presentation.Runs, run)
}

func formatLocator(rawBeginning, rawEnding, rawArticle string) string {
	beginning := strings.TrimSpace(rawBeginning)
	ending := strings.TrimSpace(rawEnding)
	article := strings.TrimSpace(rawArticle)

	if beginning != "" {
		if ending != "" && ending != "+" && ending != beginning {
			return beginning + "–" + ending
		}
		return beginning
	}
	if ending != "" && ending != "+" {
		return ending
	}
	return article
}

func endsWithSentencePunctuation(text string) bool {
	trimmed := strings.TrimSpace(text)
	for trimmed != "" {
		r, size := utf8.DecodeLastRuneInString(trimmed)
		switch r {
		case '.', '!', '?', '。', '！', '？', '…':
			return true
		case '\'', '"', '’', '”', ')', ']', '}':
			trimmed = strings.TrimSpace(trimmed[:len(trimmed)-size])
		default:
			return false
		}
	}
	return false
}
