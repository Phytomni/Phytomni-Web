package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"phytomni-server/common/citation"
)

const (
	maxMaterialExcerptBytes = 64 << 10
	maxMaterialTotalBytes   = 4 << 20
)

type materialFixture struct {
	ReferenceIndex int      `json:"referenceIndex"`
	Excerpt        string   `json:"excerpt"`
	ResourceIDs    []string `json:"resourceIds"`
}

func generateMaterials(citationSource, source []byte) ([]byte, error) {
	var citations map[string]fixtureCase
	if !utf8.Valid(citationSource) || json.Unmarshal(citationSource, &citations) != nil {
		return nil, errors.New("invalid citation fixture source")
	}
	fixture, exists := citations["deep_genome"]
	if !exists {
		return nil, errors.New("deep genome source bibliography is required for material generation")
	}
	references, err := citation.DecodeRows(fixture.References)
	if err != nil || len(references) == 0 {
		return nil, errors.New("deep genome source bibliography is required for material generation")
	}
	var materials struct {
		DocList []struct {
			Title   *string `json:"title"`
			Content *string `json:"content"`
		} `json:"doc_list"`
	}
	if !utf8.Valid(source) || json.Unmarshal(source, &materials) != nil || materials.DocList == nil {
		return nil, errors.New("invalid deep genome material source")
	}
	if len(materials.DocList) != len(references) {
		return nil, errors.New("deep genome material positions do not match the source bibliography")
	}
	generated := make([]materialFixture, 0, len(references))
	totalBytes := 0
	for index, material := range materials.DocList {
		if material.Title == nil || material.Content == nil {
			return nil, fmt.Errorf("deep genome material position %d is missing title or content", index+1)
		}
		title := *material.Title
		if strings.HasSuffix(strings.ToLower(title), ".pdf") {
			title = title[:len(title)-4]
		}
		if title != references[index].Source.Title {
			return nil, fmt.Errorf("deep genome material position %d does not match the source bibliography", index+1)
		}
		size := len(*material.Content)
		if size > maxMaterialExcerptBytes {
			return nil, fmt.Errorf("deep genome material position %d exceeds the excerpt byte limit", index+1)
		}
		totalBytes += size
		if totalBytes > maxMaterialTotalBytes {
			return nil, errors.New("deep genome material projection exceeds the total excerpt byte limit")
		}
		generated = append(generated, materialFixture{
			ReferenceIndex: index + 1,
			Excerpt:        *material.Content,
			ResourceIDs:    []string{},
		})
	}
	artifact, err := json.MarshalIndent(generated, "", "  ")
	if err != nil {
		return nil, errors.New("encode deep genome material artifact")
	}
	return append(artifact, '\n'), nil
}
