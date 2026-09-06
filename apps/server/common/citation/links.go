package citation

import (
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

var (
	doiPattern         = regexp.MustCompile(`(?i)^10\.[0-9]{4,9}/\S+$`)
	digitsPattern      = regexp.MustCompile(`^[0-9]+$`)
	orderedListPattern = regexp.MustCompile(`^[0-9]{1,9}[.)](?:[ \t]|$)`)
)

var linkOrder = map[string]int{
	"Article":        0,
	"PubMed":         1,
	"PubMed Central": 2,
	"CAS":            3,
	"ADS":            4,
	"Google Scholar": 5,
}

func citationLinks(source Source, imported []Link) []Link {
	candidates := make([]Link, 0, len(imported)+4)
	if href := doiURL(source.DI); href != "" {
		candidates = append(candidates, Link{Label: "Article", Href: href})
	} else if href := doiURLFromResolver(source.DL); href != "" {
		candidates = append(candidates, Link{Label: "Article", Href: href})
	} else if href := safeHTTPURL(source.DL); href != "" {
		candidates = append(candidates, Link{Label: "Article", Href: href})
	}
	if href := pubMedURL(source.PM); href != "" {
		candidates = append(candidates, Link{Label: "PubMed", Href: href})
	}
	if title := decodedTitle(source); title != "" {
		query := url.Values{"q": []string{title}}.Encode()
		candidates = append(candidates, Link{Label: "Google Scholar", Href: "https://scholar.google.com/scholar?" + query})
	}
	candidates = append(candidates, imported...)

	ordered := make([][]Link, len(linkOrder))
	seen := make(map[string]struct{}, len(candidates))
	seenLabels := make(map[string]struct{}, len(linkOrder))
	for _, candidate := range candidates {
		href := safeHTTPURL(candidate.Href)
		if href == "" {
			continue
		}
		label := classifyLink(candidate.Label, href)
		position, known := linkOrder[label]
		if !known {
			continue
		}
		if _, duplicate := seenLabels[label]; duplicate {
			continue
		}
		if _, duplicate := seen[href]; duplicate {
			continue
		}
		seen[href] = struct{}{}
		seenLabels[label] = struct{}{}
		ordered[position] = append(ordered[position], Link{Label: label, Href: href})
	}

	links := make([]Link, 0, len(seen))
	for _, group := range ordered {
		links = append(links, group...)
	}
	return links
}

func decodedTitle(source Source) string {
	return strings.TrimSpace(PlainText(importCitation(selectedTitle(source))))
}

func doiURL(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" || hasControl(value) {
		return ""
	}
	if parsed := doiURLFromResolver(value); parsed != "" {
		return parsed
	}
	if strings.HasPrefix(strings.ToLower(value), "doi:") {
		value = strings.TrimSpace(value[len("doi:"):])
	}
	if decoded, err := url.PathUnescape(value); err == nil {
		value = decoded
	}
	if !doiPattern.MatchString(value) || hasControl(value) {
		return ""
	}
	return (&url.URL{Scheme: "https", Host: "doi.org", Path: "/" + value}).String()
}

func doiURLFromResolver(raw string) string {
	value := safeHTTPURL(raw)
	if value == "" {
		return ""
	}
	parsed, err := url.Parse(value)
	if err != nil || !isDOIHost(parsed.Hostname()) {
		return ""
	}
	doi := strings.TrimPrefix(parsed.Path, "/")
	if !doiPattern.MatchString(doi) || hasControl(doi) {
		return ""
	}
	return (&url.URL{Scheme: "https", Host: "doi.org", Path: "/" + doi}).String()
}

func pubMedURL(raw string) string {
	value := strings.TrimSpace(raw)
	if digitsPattern.MatchString(value) {
		return "https://pubmed.ncbi.nlm.nih.gov/" + value + "/"
	}
	normalized := safeHTTPURL(value)
	if normalized == "" {
		return ""
	}
	parsed, err := url.Parse(normalized)
	if err != nil || !isPubMedURL(parsed) {
		return ""
	}
	for _, part := range strings.Split(strings.Trim(parsed.Path, "/"), "/") {
		if digitsPattern.MatchString(part) {
			return "https://pubmed.ncbi.nlm.nih.gov/" + part + "/"
		}
	}
	return ""
}

func safeHTTPURL(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" || strings.ContainsAny(value, `\"<>`) || strings.IndexFunc(value, unicode.IsSpace) >= 0 || hasControl(value) {
		return ""
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Opaque != "" || parsed.User != nil || parsed.Hostname() == "" ||
		hasControl(parsed.Path) || hasEncodedControl(parsed.RawQuery, url.QueryUnescape) || hasControl(parsed.Fragment) {
		return ""
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return ""
	}
	parsed.Host = strings.ToLower(parsed.Host)
	return parsed.String()
}

func hasControl(value string) bool {
	for _, character := range value {
		if unicode.IsControl(character) {
			return true
		}
	}
	return false
}

func hasEncodedControl(value string, decode func(string) (string, error)) bool {
	decoded, err := decode(value)
	return err != nil || hasControl(decoded)
}

func classifyLink(_ string, href string) string {
	parsed, _ := url.Parse(href)
	host := strings.ToLower(parsed.Hostname())
	path := strings.ToLower(parsed.Path)

	switch {
	case isDOIHost(host):
		return "Article"
	case isPubMedCentralURL(host, path):
		return "PubMed Central"
	case isPubMedURL(parsed):
		return "PubMed"
	case host == "scholar.google.com":
		return "Google Scholar"
	case strings.HasSuffix(host, ".cas.org") || host == "cas.org":
		return "CAS"
	case strings.HasSuffix(host, ".adsabs.harvard.edu") || host == "adsabs.harvard.edu":
		return "ADS"
	default:
		return "Article"
	}
}

func isDOIHost(host string) bool {
	host = strings.ToLower(host)
	return host == "doi.org" || host == "dx.doi.org"
}

func isPubMedCentralURL(host, path string) bool {
	return host == "pmc.ncbi.nlm.nih.gov" ||
		((host == "ncbi.nlm.nih.gov" || host == "www.ncbi.nlm.nih.gov") && strings.HasPrefix(path, "/pmc/"))
}

func isPubMedURL(parsed *url.URL) bool {
	if parsed == nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	path := strings.ToLower(parsed.Path)
	return host == "pubmed.ncbi.nlm.nih.gov" ||
		((host == "ncbi.nlm.nih.gov" || host == "www.ncbi.nlm.nih.gov") && strings.HasPrefix(path, "/pubmed/"))
}

func Markdown(presentation Presentation) string {
	var out strings.Builder
	escaper := markdownEscaper{lineStart: true}
	coalesced := make([]Run, 0, len(presentation.Runs))
	for _, run := range presentation.Runs {
		appendRunToSlice(&coalesced, run)
	}
	var fragments []markdownFragment
	for _, run := range coalesced {
		appendMarkdownRun(&fragments, &escaper, run)
	}
	for index := range fragments {
		fragment := &fragments[index]
		if fragment.marker == "" {
			continue
		}
		// Flanking uses source characters before entity decoding. Encode outside
		// letters where punctuation would prevent an emphasis delimiter opening.
		for _, side := range []int{-1, 1} {
			adjacent := index + side
			if adjacent < 0 || adjacent >= len(fragments) || fragments[adjacent].marker != "" {
				continue
			}
			neighbor := &fragments[adjacent]
			chars, content := []rune(neighbor.text), []rune(fragment.text)
			offset, inside := 0, len(content)-1
			if side < 0 {
				offset, inside = len(chars)-1, 0
			}
			underscore := fragment.marker[0] == '_'
			if markdownOrdinary(chars[offset]) && (!markdownOrdinary(content[inside]) || underscore) {
				neighbor.text = string(chars[:offset]) + markdownEntity(chars[offset]) + string(chars[offset+1:])
				// Underscores also forbid letter-to-letter intraword edges.
				if underscore && markdownOrdinary(content[inside]) {
					fragment.text = string(content[:inside]) + markdownEntity(content[inside]) + string(content[inside+1:])
				}
			}
		}
	}
	for _, fragment := range fragments {
		out.WriteString(fragment.marker + fragment.text + fragment.marker)
	}

	links := citationLinks(Source{}, presentation.Links)
	if len(links) > 0 {
		out.WriteString("\n\n")
		for index, link := range links {
			if index > 0 {
				out.WriteString(" · ")
			}
			out.WriteString("[" + escapeMarkdownText(link.Label) + "](<" + strings.ReplaceAll(link.Href, "&", "&amp;") + ">)")
		}
	}
	return out.String()
}

type markdownFragment struct {
	text, marker string
}

func markdownOrdinary(character rune) bool {
	return !unicode.IsSpace(character) && !unicode.IsPunct(character) && !unicode.IsSymbol(character)
}

func markdownEntity(character rune) string {
	return "&#" + strconv.Itoa(int(character)) + ";"
}

func appendMarkdownRun(fragments *[]markdownFragment, escaper *markdownEscaper, run Run) {
	appendText := func(text string, strength int) {
		if text == "" {
			return
		}
		delimiter := "*"
		if count := len(*fragments); count > 0 && strings.HasPrefix((*fragments)[count-1].marker, "*") {
			delimiter = "_"
		}
		*fragments = append(*fragments, markdownFragment{escaper.escape(text), strings.Repeat(delimiter, strength)})
	}
	if !run.Bold && !run.Italic {
		appendText(run.Text, 0)
		return
	}
	strength := 1
	if run.Bold {
		strength = 2
		if run.Italic {
			strength = 3
		}
	}
	// Emphasis cannot cross paragraph boundaries; reopen on each content line.
	for index, line := range strings.Split(run.Text, "\n") {
		if index > 0 {
			appendText("\n", 0)
		}
		core := strings.TrimSpace(line)
		if core == "" {
			appendText(line, 0)
			continue
		}
		start := strings.Index(line, core)
		appendText(line[:start], 0)
		appendText(core, strength)
		appendText(line[start+len(core):], 0)
	}
}

func escapeMarkdownText(value string) string {
	escaper := markdownEscaper{lineStart: true}
	return escaper.escape(value)
}

type markdownEscaper struct {
	lineStart bool
}

func (escaper *markdownEscaper) escape(value string) string {
	var out strings.Builder
	for len(value) > 0 {
		line, rest, found := strings.Cut(value, "\n")
		out.WriteString(escapeMarkdownLine(line, escaper.lineStart))
		if line != "" {
			escaper.lineStart = false
		}
		if !found {
			break
		}
		out.WriteByte('\n')
		escaper.lineStart = true
		value = rest
	}
	return out.String()
}

func escapeMarkdownLine(line string, lineStart bool) string {
	if line == "" || !lineStart {
		return escapeMarkdownInline(line)
	}
	if line[0] == ' ' {
		return "&#32;" + escapeMarkdownInline(line[1:])
	}
	if line[0] == '\t' {
		return "&#9;" + escapeMarkdownInline(line[1:])
	}
	if match := orderedListPattern.FindString(line); match != "" {
		marker := len(match) - 1
		if match[marker] == ' ' || match[marker] == '\t' {
			marker--
		}
		return escapeMarkdownInline(line[:marker]) + `\` + escapeMarkdownInline(line[marker:])
	}
	switch line[0] {
	case '#', '>', '-', '+', '=', '~':
		return `\` + escapeMarkdownInline(line)
	default:
		return escapeMarkdownInline(line)
	}
}

func escapeMarkdownInline(value string) string {
	replacer := strings.NewReplacer(
		`\`, `\\`,
		"`", "\\`",
		"*", "\\*",
		"_", "\\_",
		"~", "\\~",
		"|", "\\|",
		"$", "\\$",
		"[", "\\[",
		"]", "\\]",
		"(", "\\(",
		")", "\\)",
		"<", "\\<",
		">", "\\>",
		"&", "\\&",
	)
	return replacer.Replace(value)
}
