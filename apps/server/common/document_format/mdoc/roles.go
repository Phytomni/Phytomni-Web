package mdoc

import (
	"github.com/yuin/goldmark/ast"
	"strings"
)

type reportRole uint8

const (
	roleDefault reportRole = iota
	roleTitle
	roleSection
	roleSubsection
	roleBody
	roleLead
	roleReference
	roleReferenceLinks
	roleCaption
)

type tableAlignment uint8

const (
	alignLeft tableAlignment = iota
	alignCenter
	alignRight
)

func sectionLabel(label string) string {
	return strings.ToLower(strings.TrimSpace(strings.TrimRight(strings.TrimSpace(label), ":：")))
}

func titleLabel(text string) (string, int) {
	for _, prefix := range []string{"Title:", "标题：", "标题:"} {
		if strings.HasPrefix(text, prefix) {
			return strings.TrimSpace(text[len(prefix):]), len(prefix)
		}
	}
	return text, 0
}

func standardSection(text string) bool {
	switch sectionLabel(text) {
	case "abstract", "introduction", "reference", "references", "摘要", "引言", "绪论", "参考文献":
		return true
	}
	return false
}

func hasMainTitle(blocks []block) bool {
	if len(blocks) == 0 || blocks[0].kind != blockHeading {
		return false
	}
	label := plainText(blocks[0].inlines)
	title, prefix := titleLabel(label)
	if strings.TrimSpace(title) == "" || standardSection(title) {
		return false
	}
	if prefix > 0 || blocks[0].level == 1 {
		return true
	}
	for _, b := range blocks[1:] {
		if b.kind == blockHeading {
			return b.level <= blocks[0].level
		}
	}
	return false
}

// Keep the title decision tied to its source node. Collected IR can omit raw
// HTML blocks, but a later heading is not the first nonempty source block.
func selectedTitle(tree ast.Node, blocks []block) *ast.Heading {
	heading, ok := tree.FirstChild().(*ast.Heading)
	if !ok || !hasMainTitle(blocks) {
		return nil
	}
	return heading
}

func assignRoles(blocks []block, title bool) {
	sectionLevel := 7
	for i, b := range blocks {
		if b.kind == blockHeading && !(i == 0 && title) && b.level < sectionLevel {
			sectionLevel = b.level
		}
	}
	lead, abstract := false, false
	for i := range blocks {
		b := &blocks[i]
		switch b.kind {
		case blockHeading:
			b.role = roleSubsection
			if b.level == sectionLevel {
				b.role = roleSection
			}
			if i == 0 && title {
				b.role = roleTitle
				_, prefix := titleLabel(plainText(b.inlines))
				// Remove the explicit label across styled runs without flattening the title.
				for j := range b.inlines {
					if prefix >= len(b.inlines[j].text) {
						prefix -= len(b.inlines[j].text)
						b.inlines[j].text = ""
					} else {
						b.inlines[j].text = strings.TrimLeft(b.inlines[j].text[prefix:], " \t")
						break
					}
				}
			}
			label := sectionLabel(plainText(b.inlines))
			abstract = label == "abstract" || label == "摘要"
			lead = true
		case blockParagraph:
			b.role = roleBody
			if lead || abstract {
				b.role = roleLead
			}
			lead = false
		default:
			lead = false
		}
	}
}
