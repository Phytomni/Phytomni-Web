package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"phytomni-server/common/document_format/mdoc"
	rxBot "phytomni-server/external/bot"
	rxLog "phytomni-server/log"
	"phytomni-server/model"
	"phytomni-server/utils"
)

const (
	documentImageFetchTimeout = 10 * time.Second
	documentImageMaxBytes     = 8 << 20
)

var geneImageHrefPrefix = "/api/v1/gene-images/"

type documentImageKind int

const (
	documentImageNone documentImageKind = iota
	documentImageGene
	documentImageOBS
)

type resolvedDocumentImage struct {
	kind documentImageKind
	gene string
	file string
	obs  string
}

type documentObjectReader interface {
	ReadOBS(ctx context.Context, path string) ([]byte, error)
	ReadGeneImage(ctx context.Context, gene, file string) ([]byte, error)
}

type liveDocumentObjectReader struct{}

func (liveDocumentObjectReader) ReadOBS(ctx context.Context, path string) ([]byte, error) {
	rc, _, err := rxBot.NewClient().GetObsObjectStream(ctx, path)
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return readDocumentImageBytes(rc)
}

func (liveDocumentObjectReader) ReadGeneImage(_ context.Context, gene, file string) ([]byte, error) {
	mount := geneObsfsDir()
	if mount == "" {
		return nil, errors.New("gene image mount unavailable")
	}
	base := filepath.Join(mount, "img", gene)
	full, err := utils.SafeJoinUploadPath(base, file)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(full)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return readDocumentImageBytes(f)
}

func readDocumentImageBytes(r io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, documentImageMaxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) == 0 || len(data) > documentImageMaxBytes {
		return nil, errors.New("image exceeds size limit")
	}
	return data, nil
}

func newDocumentImageFetcher(ctx context.Context, row *model.QuestionAgentLog) mdoc.ImageFetcher {
	return newDocumentImageFetcherWithReader(ctx, row, liveDocumentObjectReader{})
}

func newDocumentImageFetcherWithReader(ctx context.Context, row *model.QuestionAgentLog, reader documentObjectReader) mdoc.ImageFetcher {
	allow, runRoot := documentImageAllowlist(row)
	return func(href string) (*mdoc.Image, error) {
		resolved, ok := resolveDocumentImageHref(href, allow, runRoot)
		if !ok {
			return nil, nil
		}
		fetchCtx, cancel := context.WithTimeout(ctx, documentImageFetchTimeout)
		defer cancel()
		var (
			data []byte
			err  error
		)
		switch resolved.kind {
		case documentImageGene:
			data, err = reader.ReadGeneImage(fetchCtx, resolved.gene, resolved.file)
		case documentImageOBS:
			data, err = reader.ReadOBS(fetchCtx, resolved.obs)
		default:
			return nil, nil
		}
		if err != nil {
			rxLog.Sugar().Warnw("document image skipped", "reason", "fetch_failed")
			return nil, nil
		}
		return &mdoc.Image{Bytes: data}, nil
	}
}

func documentImageAllowlist(row *model.QuestionAgentLog) (paths []string, runRoot string) {
	if row == nil {
		return nil, ""
	}
	if row.DownloadPath != "" && rxBot.ValidateProjectionOBSPath(row.DownloadPath) == nil {
		runRoot = artifactRunRoot(row.DownloadPath)
	}
	if strings.TrimSpace(row.ImagePaths) == "" {
		return nil, runRoot
	}
	var raw []string
	if err := json.Unmarshal([]byte(row.ImagePaths), &raw); err != nil {
		rxLog.Sugar().Warnw("document image_paths invalid JSON, ignoring", "reason", "invalid_json")
		return nil, runRoot
	}
	for _, item := range raw {
		if rxBot.ValidateProjectionOBSPath(item) != nil && !isSafeRelayObjectKey(item) {
			continue
		}
		if runRoot != "" && !artifactPathWithinPrefix(runRoot, item) {
			continue
		}
		paths = append(paths, item)
	}
	return paths, runRoot
}

func resolveDocumentImageHref(href string, allow []string, runRoot string) (resolvedDocumentImage, bool) {
	href = strings.TrimSpace(href)
	if href == "" || strings.ContainsAny(href, " \t\r\n") {
		return resolvedDocumentImage{}, false
	}
	lower := strings.ToLower(href)
	switch {
	case strings.HasPrefix(lower, "http://"),
		strings.HasPrefix(lower, "https://"),
		strings.HasPrefix(lower, "data:"),
		strings.HasPrefix(lower, "javascript:"),
		strings.HasPrefix(lower, "file:"),
		strings.HasPrefix(lower, "//"):
		return resolvedDocumentImage{}, false
	}
	if strings.HasPrefix(href, geneImageHrefPrefix) {
		return resolveGeneImageHref(href)
	}
	if dest, ok := matchAllowlistedOBS(href, allow, runRoot); ok {
		return resolvedDocumentImage{kind: documentImageOBS, obs: dest}, true
	}
	return resolvedDocumentImage{}, false
}

func resolveGeneImageHref(href string) (resolvedDocumentImage, bool) {
	rest := strings.TrimPrefix(href, geneImageHrefPrefix)
	parts := strings.Split(rest, "/")
	if len(parts) != 2 {
		return resolvedDocumentImage{}, false
	}
	gene, err := utils.CleanUploadFilename(parts[0])
	if err != nil {
		return resolvedDocumentImage{}, false
	}
	file, err := utils.CleanUploadFilename(parts[1])
	if err != nil {
		return resolvedDocumentImage{}, false
	}
	switch strings.ToLower(path.Ext(file)) {
	case ".png", ".jpg", ".jpeg", ".gif":
	default:
		return resolvedDocumentImage{}, false
	}
	return resolvedDocumentImage{kind: documentImageGene, gene: gene, file: file}, true
}

func matchAllowlistedOBS(href string, allow []string, runRoot string) (string, bool) {
	if rxBot.ValidateProjectionOBSPath(href) == nil {
		if containsOBS(allow, href) {
			return href, true
		}
		if runRoot != "" && artifactPathWithinPrefix(runRoot, href) {
			return href, true
		}
		return "", false
	}
	rel := strings.TrimPrefix(href, "./")
	if rel == "" || rel == "." || strings.Contains(rel, "\\") {
		return "", false
	}
	base := path.Base(rel)
	if base == "" || base == "." || base == "/" {
		return "", false
	}
	for _, item := range allow {
		if item == rel || strings.HasSuffix(item, "/"+rel) || path.Base(item) == base {
			return item, true
		}
	}
	return "", false
}

func containsOBS(allow []string, href string) bool {
	hrefKey := canonicalOBSKey(href)
	if hrefKey == "" {
		return false
	}
	for _, item := range allow {
		if canonicalOBSKey(item) == hrefKey {
			return true
		}
	}
	return false
}

func canonicalOBSKey(value string) string {
	if strings.HasPrefix(value, "/obs/") {
		return strings.TrimPrefix(value, "/obs/")
	}
	if strings.HasPrefix(value, "obs://") {
		return strings.TrimPrefix(value, "obs://")
	}
	if isSafeRelayObjectKey(value) {
		return value
	}
	return ""
}
