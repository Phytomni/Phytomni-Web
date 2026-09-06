package mdoc

import (
	"errors"
	"math"
	"unicode"
	"unicode/utf8"
)

type pdfFragment struct {
	text           string
	style          style
	sizePt, risePt float64
	href           string
	target         int
}
type pdfPlacedFragment struct {
	fragment     pdfFragment
	xMM, widthMM float64
}
type pdfMeasuredLine struct {
	fragments []pdfPlacedFragment
	widthMM   float64
	last      bool
}
type pdfMeasure func(text string, st style, sizePt float64) float64

var errPDFLayout = errors.New("academic PDF text cannot fit printable geometry")

func finitePDFWidth(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= 0 }

// Tokens span style boundaries, but each constituent fragment retains its owner.
// Newlines are zero-width fragments: concatenation remains exactly lossless.
func pdfTokens(runs []pdfFragment) [][]pdfFragment {
	var tokens [][]pdfFragment
	previous := -1
	for _, run := range runs {
		start := 0
		flush := func(end int, kind int) {
			if start == end {
				return
			}
			f := run
			f.text = run.text[start:end]
			if kind != previous || kind == 2 {
				tokens = append(tokens, nil)
			}
			tokens[len(tokens)-1] = append(tokens[len(tokens)-1], f)
			previous = kind
			start = end
		}
		kind := -1
		for pos, r := range run.text {
			next := 0
			if unicode.IsSpace(r) {
				next = 1
			}
			if r == '\n' {
				next = 2
			}
			if kind != -1 && (kind != next || kind == 2) {
				flush(pos, kind)
			}
			kind = next
		}
		if kind != -1 {
			flush(len(run.text), kind)
		}
	}
	return tokens
}

func wrapPDFRuns(runs []pdfFragment, firstWidthMM, nextWidthMM float64, measure pdfMeasure) ([]pdfMeasuredLine, error) {
	if !finitePDFWidth(firstWidthMM) || firstWidthMM == 0 || !finitePDFWidth(nextWidthMM) || nextWidthMM == 0 || measure == nil {
		return nil, errPDFLayout
	}
	var lines []pdfMeasuredLine
	line := pdfMeasuredLine{}
	limit := firstWidthMM
	flush := func(last bool) {
		line.last = last
		lines = append(lines, line)
		line = pdfMeasuredLine{}
		limit = nextWidthMM
	}
	width := func(f pdfFragment) float64 {
		if f.text == "\n" {
			return 0
		}
		return measure(f.text, f.style, f.sizePt)
	}
	appendFragment := func(f pdfFragment, w float64) {
		line.fragments = append(line.fragments, pdfPlacedFragment{f, line.widthMM, w})
		line.widthMM += w
	}
	for _, token := range pdfTokens(runs) {
		if token[0].text == "\n" {
			appendFragment(token[0], 0)
			flush(true)
			continue
		}
		total := 0.0
		for _, f := range token {
			w := width(f)
			if !finitePDFWidth(w) {
				return nil, errPDFLayout
			}
			total += w
		}
		if total > limit-line.widthMM+1e-9 && len(line.fragments) > 0 {
			flush(false)
		}
		if total <= limit+1e-9 {
			for _, f := range token {
				appendFragment(f, width(f))
			}
			continue
		}
		for _, f := range token {
			chars := []rune(f.text)
			for len(chars) > 0 {
				lo, hi := 0, 1
				// Bound each search by the line capacity rather than repeatedly
				// measuring the entire remaining tail of a very long token.
				for hi < len(chars) {
					part := f
					part.text = string(chars[:hi])
					w := width(part)
					if !finitePDFWidth(w) {
						return nil, errPDFLayout
					}
					if w > limit-line.widthMM+1e-9 {
						break
					}
					lo = hi
					hi = min(2*hi, len(chars))
				}
				for lo < hi {
					mid := (lo + hi + 1) / 2
					part := f
					part.text = string(chars[:mid])
					w := width(part)
					if !finitePDFWidth(w) {
						return nil, errPDFLayout
					}
					if w <= limit-line.widthMM+1e-9 {
						lo = mid
					} else {
						hi = mid - 1
					}
				}
				if lo == 0 {
					if len(line.fragments) == 0 {
						return nil, errPDFLayout
					}
					flush(false)
					continue
				}
				part := f
				part.text = string(chars[:lo])
				appendFragment(part, width(part))
				chars = chars[lo:]
				if len(chars) > 0 {
					flush(false)
				}
			}
		}
	}
	if len(line.fragments) > 0 || len(lines) == 0 || lines[len(lines)-1].last {
		flush(true)
	} else {
		lines[len(lines)-1].last = true
	}
	return lines, nil
}

// Expand only inter-word whitespace. Text and hit regions use these exact offsets;
// PDF Tw is intentionally never used for multibyte Text operations.
func justifyPDFLine(line pdfMeasuredLine, available float64) pdfMeasuredLine {
	if line.last || line.widthMM >= available {
		return line
	}
	first, last := -1, -1
	for i, p := range line.fragments {
		for _, r := range p.fragment.text {
			if !unicode.IsSpace(r) {
				if first < 0 {
					first = i
				}
				last = i
				break
			}
		}
	}
	gaps := 0
	for i, p := range line.fragments {
		if i > first && i < last && !p.fragment.style.code && pdfSpace(p.fragment.text) {
			gaps++
		}
	}
	if gaps == 0 {
		return line
	}
	extra := (available - line.widthMM) / float64(gaps)
	x := 0.0
	line.fragments = append([]pdfPlacedFragment(nil), line.fragments...)
	for i := range line.fragments {
		p := &line.fragments[i]
		p.xMM = x
		if i > first && i < last && !p.fragment.style.code && pdfSpace(p.fragment.text) {
			p.widthMM += extra
		}
		x += p.widthMM
	}
	line.widthMM = x
	return line
}

func pdfSpace(s string) bool {
	if s == "" || !utf8.ValidString(s) {
		return false
	}
	for _, r := range s {
		if !unicode.IsSpace(r) {
			return false
		}
	}
	return true
}
