package api_service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/text"
	"phytomni-server/common"
	"phytomni-server/common/citation"
	"phytomni-server/model"
)

const (
	// This read/render bound is separate from biological upload limits.
	maxGeneReportTextBytes = 8 << 20
	// Match the shared explicit numeric citation grammar, which accepts 1..999.
	maxGeneReferenceIndex = 999
	geneDocTitlesMarker   = "--- DOC TITLES ---"
)

var (
	errGeneReportUnavailable = errors.New("gene report unavailable")
	errGeneReportTooLarge    = errors.New("gene report exceeds the text limit")
	errGeneReportText        = errors.New("invalid gene report text")
	errGeneReportReferences  = errors.New("invalid gene report references")
	geneDocTitleRow          = regexp.MustCompile(`^([0-9]+)\.[ \t]*(.*)$`)
	geneMarkdownReferenceRow = regexp.MustCompile(`^\[([0-9]+)\](?:[ \t]+(.*))?$`)
	geneHTMLDocument         = regexp.MustCompile(`(?i)^(?:<!doctype[\t\n\r ]+html\b|<(?:html|head|body)(?:[\t\n\r >]))`)
)

func readGeneReportText(ctx context.Context, reader io.Reader, size int64) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if size > maxGeneReportTextBytes {
		return nil, errGeneReportTooLarge
	}
	content, err := io.ReadAll(io.LimitReader(reader, maxGeneReportTextBytes+1))
	if ctxErr := ctx.Err(); ctxErr != nil {
		return nil, ctxErr
	}
	if err != nil {
		return nil, errGeneReportUnavailable
	}
	if len(content) > maxGeneReportTextBytes {
		return nil, errGeneReportTooLarge
	}
	trimmed := bytes.TrimSpace(bytes.TrimPrefix(bytes.TrimSpace(content), []byte("\xef\xbb\xbf")))
	if len(trimmed) == 0 || !utf8.Valid(content) || bytes.IndexByte(content, 0) >= 0 || geneHTMLDocument.Match(trimmed) {
		return nil, errGeneReportText
	}
	return content, nil
}

func buildGeneReport(item *model.GeneExample, source []byte) (*common.GeneDetailResponse, error) {
	boundary, rowsStart, rowPattern := geneReferencesBoundary(source)
	body := source
	rows := []map[string]string{}
	if boundary >= 0 {
		body = source[:boundary]
		declared := make(map[int]string)
		maxIndex := 0
		for _, line := range strings.Split(string(source[rowsStart:]), "\n") {
			line = strings.TrimSuffix(line, "\r")
			if strings.TrimSpace(line) == "" {
				continue
			}
			match := rowPattern.FindStringSubmatch(line)
			if match == nil {
				return nil, errGeneReportReferences
			}
			index, err := strconv.Atoi(match[1])
			if err != nil || index < 1 || index > maxGeneReferenceIndex {
				return nil, errGeneReportReferences
			}
			if _, duplicate := declared[index]; duplicate {
				return nil, errGeneReportReferences
			}
			declared[index] = strings.TrimSpace(match[2])
			if index > maxIndex {
				maxIndex = index
			}
		}
		// Expand only after every declared index has passed the shared bound.
		rows = make([]map[string]string, maxIndex)
		for i := range rows {
			rows[i] = map[string]string{"title": declared[i+1]}
		}
	}
	raw, err := json.Marshal(rows)
	if err != nil {
		return nil, errGeneReportReferences
	}
	references, err := citation.NormalizeRows(raw)
	if err != nil {
		return nil, errGeneReportReferences
	}
	report := &common.GeneDetailResponse{
		Id: item.Id, FileName: item.FileName, GeneId: item.GeneId, SpeciesCode: item.SpeciesCode,
		Content: string(body), References: references,
		Resources: []common.GeneReportResource{}, ReferenceMaterials: []common.GeneReferenceMaterial{},
		ReportRevision: fmt.Sprintf("%x", sha256.Sum256(source)),
	}
	registerGeneResources(report)
	return report, nil
}

// Only a top-level report marker or reference heading owns the bibliography. Goldmark
// excludes fenced/indented code, HTML blocks, quotes and nested list contents.
func geneReferencesBoundary(source []byte) (boundary, rowsStart int, rowPattern *regexp.Regexp) {
	document := goldmark.DefaultParser().Parse(text.NewReader(source))
	for node := document.FirstChild(); node != nil; node = node.NextSibling() {
		if heading, ok := node.(*ast.Heading); ok && heading.Level == 2 && heading.Lines().Len() == 1 {
			segment := heading.Lines().At(0)
			lineStart := bytes.LastIndexByte(source[:segment.Start], '\n') + 1
			if string(bytes.TrimSpace(source[lineStart:segment.Start])) != "##" {
				continue
			}
			switch strings.TrimSpace(string(segment.Value(source))) {
			case "Reference", "Reference:", "References", "References:":
				rowsStart := len(source)
				if newline := bytes.IndexByte(source[segment.Start:], '\n'); newline >= 0 {
					rowsStart = segment.Start + newline + 1
				}
				return lineStart, rowsStart, geneMarkdownReferenceRow
			}
		}
		paragraph, ok := node.(*ast.Paragraph)
		if !ok {
			continue
		}
		for i := 0; i < paragraph.Lines().Len(); i++ {
			segment := paragraph.Lines().At(i)
			lineStart := bytes.LastIndexByte(source[:segment.Start], '\n') + 1
			line := bytes.TrimSuffix(source[lineStart:segment.Stop], []byte("\n"))
			line = bytes.TrimSuffix(line, []byte("\r"))
			if string(line) == geneDocTitlesMarker && !geneMarkerIsInlineOwned(paragraph, lineStart) {
				return lineStart, lineStart + len(geneDocTitlesMarker), geneDocTitleRow
			}
		}
	}
	return -1, -1, nil
}

func geneMarkerIsInlineOwned(paragraph ast.Node, offset int) bool {
	owned := false
	_ = ast.Walk(paragraph, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch node.(type) {
		case *ast.CodeSpan, *ast.Link, *ast.Image, *ast.RawHTML:
			_ = ast.Walk(node, func(child ast.Node, entering bool) (ast.WalkStatus, error) {
				if !entering {
					return ast.WalkContinue, nil
				}
				switch inline := child.(type) {
				case *ast.Text:
					owned = owned || offset >= inline.Segment.Start && offset < inline.Segment.Stop
				case *ast.RawHTML:
					for i := 0; i < inline.Segments.Len(); i++ {
						segment := inline.Segments.At(i)
						owned = owned || offset >= segment.Start && offset < segment.Stop
					}
				}
				return ast.WalkContinue, nil
			})
			return ast.WalkSkipChildren, nil
		}
		return ast.WalkContinue, nil
	})
	return owned
}
