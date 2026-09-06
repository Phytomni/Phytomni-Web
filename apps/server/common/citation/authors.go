package citation

import (
	"strings"
	"unicode"
)

func formatAuthors(raw string) string {
	parts := strings.Split(raw, ";")
	authors := make([]string, 0, len(parts))
	for _, part := range parts {
		if author := formatAuthor(part); author != "" {
			authors = append(authors, author)
		}
	}

	switch len(authors) {
	case 0:
		return ""
	case 1:
		return authors[0]
	case 2:
		return authors[0] + " & " + authors[1]
	case 3, 4, 5:
		return strings.Join(authors[:len(authors)-1], ", ") + " & " + authors[len(authors)-1]
	default:
		return authors[0] + " et al."
	}
}

func formatAuthor(raw string) string {
	author := strings.TrimSpace(raw)
	family, initials, ok := strings.Cut(author, ",")
	if !ok {
		return author
	}

	family = strings.TrimSpace(family)
	initials = strings.TrimSpace(initials)
	if family == "" || initials == "" {
		return author
	}

	return family + ", " + punctuateInitials(initials)
}

func punctuateInitials(initials string) string {
	for _, r := range initials {
		if !unicode.IsUpper(r) {
			return initials
		}
	}

	var out strings.Builder
	for i, r := range []rune(initials) {
		if i > 0 {
			out.WriteByte(' ')
		}
		out.WriteRune(r)
		out.WriteByte('.')
	}
	return out.String()
}
