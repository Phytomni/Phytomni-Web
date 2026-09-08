package api_service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/text"
	"phytomni-server/common"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/utils"
)

var (
	ErrGeneResourceInvalid     = errors.New("invalid gene resource")
	ErrGeneResourceNotFound    = errors.New("gene resource not found")
	ErrGeneResourceUnavailable = errors.New("gene resource unavailable")
	ErrGeneResourceTooLarge    = errors.New("gene resource exceeds the size limit")
	ErrGeneResourceContent     = errors.New("invalid gene resource content")
	geneCuratedID              = regexp.MustCompile(`^(?:AT|GLYMA|Os|Traes|Zm)[A-Za-z0-9.-]*$`)
	genePNGFileSuffix          = regexp.MustCompile(`^[A-Za-z0-9._-]+\.png$`)
	geneResourceID             = regexp.MustCompile(`^gene-[0-9a-f]{64}$`)
)

// Match the Bot relay's curated image grammar without opening other object types.
func isCuratedGenePNG(gene, file string) bool {
	return geneCuratedID.MatchString(gene) && strings.HasPrefix(file, gene+"_") &&
		genePNGFileSuffix.MatchString(strings.TrimPrefix(file, gene+"_"))
}

func registerGeneResources(report *common.GeneDetailResponse) {
	source := []byte(report.Content)
	document := goldmark.DefaultParser().Parse(text.NewReader(source))
	seen := make(map[string]bool)
	_ = ast.Walk(document, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		var href string
		switch item := node.(type) {
		case *ast.Image:
			href = string(item.Destination)
		case *ast.Link:
			href = string(item.Destination)
		default:
			return ast.WalkContinue, nil
		}
		prefix := geneImageHrefPrefix + report.GeneId + "/"
		if !strings.HasPrefix(href, prefix) || seen[href] {
			return ast.WalkContinue, nil
		}
		file := strings.TrimPrefix(href, prefix)
		if !isCuratedGenePNG(report.GeneId, file) {
			return ast.WalkContinue, nil
		}
		seen[href] = true
		identity := report.FileName + "\x00" + report.GeneId + "\x00" + report.ReportRevision + "\x00" + href
		report.Resources = append(report.Resources, common.GeneReportResource{
			ID: fmt.Sprintf("gene-%x", sha256.Sum256([]byte(identity))), Name: file,
			Kind: "image", MarkdownHref: href, DisplayURL: href,
		})
		return ast.WalkContinue, nil
	})
}

type GeneResourceFile struct {
	Data      []byte
	Name      string
	MediaType string
}

// GeneResource resolves only the current report's server-registered identity.
// The caller's authentication and first-login checks are owned by its route.
func (ps *Service) GeneResource(ctx context.Context, fileName, resourceID string) (*GeneResourceFile, error) {
	if !geneResourceID.MatchString(resourceID) {
		return nil, ErrGeneResourceNotFound
	}
	bundle, err := loadGeneReportBundle(ctx, fileName)
	if err != nil {
		return nil, err
	}
	if resource, exists := bundle.registered[resourceID]; exists {
		key := strings.TrimPrefix(resource.ObjectKey, geneRelayRoot)
		reader, size, err := bundle.source.open(ctx, path.Dir(key), path.Base(key), true)
		if err != nil {
			return nil, err
		}
		defer reader.Close()
		data, err := readGeneResourceBytes(ctx, reader, size, maxGeneReportTextBytes)
		if err != nil {
			return nil, err
		}
		if int64(len(data)) != resource.SizeBytes || fmt.Sprintf("%x", sha256.Sum256(data)) != resource.SHA256 {
			return nil, ErrGeneManifestConflict
		}
		if resource.Kind == "image" {
			if http.DetectContentType(data) != "image/png" {
				return nil, ErrGeneMaterialContent
			}
		} else if !validGeneMaterialText(data) || resource.Kind == "cif" && !validGeneCIF(data) {
			return nil, ErrGeneMaterialContent
		}
		return &GeneResourceFile{Data: data, Name: resource.Name, MediaType: resource.MediaType}, nil
	}
	report := bundle.report
	for _, resource := range report.Resources {
		if resource.ID == resourceID {
			data, mediaType, err := readGeneImage(ctx, bundle.source, report.GeneId, resource.Name)
			if err != nil {
				return nil, err
			}
			return &GeneResourceFile{Data: data, Name: resource.Name, MediaType: mediaType}, nil
		}
	}
	return nil, ErrGeneResourceNotFound
}

// GeneImage reads mounted safe raster images; only the verified PNG grammar
// can use the Bot relay when a readable mount is not configured.
func (ps *Service) GeneImage(ctx context.Context, gene, file string) ([]byte, string, error) {
	return readGeneImage(ctx, geneObjectSource{mount: geneObsfsDir()}, gene, file)
}

func readGeneImage(ctx context.Context, source geneObjectSource, gene, file string) ([]byte, string, error) {
	if strings.Contains(gene, "%") || strings.Contains(file, "%") {
		return nil, "", ErrGeneResourceInvalid
	}
	if _, err := utils.CleanUploadFilename(gene); err != nil {
		return nil, "", ErrGeneResourceInvalid
	}
	if _, err := utils.CleanUploadFilename(file); err != nil {
		return nil, "", ErrGeneResourceInvalid
	}
	mediaType := geneRasterMediaType(file)
	if mediaType == "" {
		return nil, "", ErrGeneResourceInvalid
	}
	reader, size, err := source.open(ctx, path.Join("img", gene), file, isCuratedGenePNG(gene, file))
	if err != nil {
		return nil, "", err
	}
	defer reader.Close()
	data, err := readGeneResourceBytes(ctx, reader, size, documentImageMaxBytes)
	if err != nil {
		return nil, "", err
	}
	if http.DetectContentType(data) != mediaType {
		return nil, "", ErrGeneResourceContent
	}
	return data, mediaType, nil
}

func readGeneResourceBytes(ctx context.Context, reader io.Reader, size, limit int64) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if size > limit {
		return nil, ErrGeneResourceTooLarge
	}
	data, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if ctxErr := ctx.Err(); ctxErr != nil {
		return nil, ctxErr
	}
	if err != nil {
		return nil, ErrGeneResourceUnavailable
	}
	if int64(len(data)) > limit {
		return nil, ErrGeneResourceTooLarge
	}
	return data, nil
}

func validGeneMaterialText(data []byte) bool {
	if len(data) == 0 || !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return false
	}
	trimmed := bytes.TrimSpace(bytes.TrimPrefix(bytes.TrimSpace(data), []byte("\xef\xbb\xbf")))
	return len(trimmed) > 0 && http.DetectContentType(trimmed) != "text/html; charset=utf-8"
}

func validGeneCIF(data []byte) bool {
	text := strings.TrimPrefix(strings.TrimSpace(string(data)), "\ufeff")
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		return strings.HasPrefix(line, "data_") && strings.TrimSpace(strings.TrimPrefix(line, "data_")) != ""
	}
	return false
}

func geneRasterMediaType(file string) string {
	switch strings.ToLower(path.Ext(file)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	default:
		return ""
	}
}

// One captured lane is shared by report, manifest, and resource reads. Missing
// mounted data is never permission to consult a different relay source.
type geneObjectSource struct{ mount string }

func (source geneObjectSource) open(ctx context.Context, directory, file string, allowRelay bool) (io.ReadCloser, int64, error) {
	if err := ctx.Err(); err != nil {
		return nil, 0, err
	}
	if mount := source.mount; mount != "" {
		root, err := filepath.EvalSymlinks(mount)
		if err != nil {
			return nil, 0, geneObjectReadError(ctx, err)
		}
		root, err = filepath.Abs(root)
		if err != nil {
			return nil, 0, ErrGeneResourceUnavailable
		}
		base := filepath.Join(root, filepath.FromSlash(directory))
		if directory == "manifests" {
			// A present unsafe manifest is not an optional missing manifest.
			for _, candidate := range []string{base, filepath.Join(base, file)} {
				info, err := os.Lstat(candidate)
				if err != nil {
					return nil, 0, geneObjectReadError(ctx, err)
				}
				if info.Mode()&os.ModeSymlink != 0 || candidate == base && !info.IsDir() || candidate != base && !info.Mode().IsRegular() {
					return nil, 0, ErrGeneManifestConflict
				}
			}
		}
		resolvedBase, err := filepath.EvalSymlinks(base)
		if err != nil {
			return nil, 0, geneObjectReadError(ctx, err)
		}
		// Directory aliases must not turn one gene's root into another gene's.
		if resolvedBase != base {
			return nil, 0, ErrGeneResourceNotFound
		}
		full, err := utils.SafeJoinUploadPath(base, file)
		if err != nil {
			return nil, 0, ErrGeneResourceInvalid
		}
		resolved, err := filepath.EvalSymlinks(full)
		if err != nil {
			return nil, 0, geneObjectReadError(ctx, err)
		}
		if strings.HasPrefix(directory, "materials/") && resolved != full {
			return nil, 0, ErrGeneResourceNotFound
		}
		relative, err := filepath.Rel(base, resolved)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
			return nil, 0, ErrGeneResourceNotFound
		}
		info, err := os.Stat(resolved)
		if err != nil {
			return nil, 0, geneObjectReadError(ctx, err)
		}
		if !info.Mode().IsRegular() {
			return nil, 0, ErrGeneResourceNotFound
		}
		reader, err := os.Open(resolved)
		if err != nil {
			return nil, 0, geneObjectReadError(ctx, err)
		}
		openedInfo, err := reader.Stat()
		if err != nil || !os.SameFile(info, openedInfo) {
			_ = reader.Close()
			return nil, 0, ErrGeneResourceUnavailable
		}
		return reader, openedInfo.Size(), nil
	}
	if !allowRelay {
		return nil, 0, ErrGeneResourceNotFound
	}
	reader, size, err := rxBot.NewClient().GetObsObjectStream(ctx, geneRelayRoot+directory+"/"+file)
	if err != nil {
		return nil, 0, geneObjectReadError(ctx, err)
	}
	return reader, size, nil
}

func geneObjectReadError(ctx context.Context, err error) error {
	if ctxErr := ctx.Err(); ctxErr != nil {
		return ctxErr
	}
	var upstream *rxBot.APIError
	if errors.Is(err, os.ErrNotExist) || errors.As(err, &upstream) && upstream.Status == http.StatusNotFound {
		return ErrGeneResourceNotFound
	}
	if upstream != nil {
		switch upstream.Status {
		case http.StatusConflict:
			return ErrGeneManifestConflict
		case http.StatusRequestEntityTooLarge:
			return ErrGeneResourceTooLarge
		case http.StatusUnprocessableEntity:
			return ErrGeneMaterialContent
		}
	}
	return ErrGeneResourceUnavailable
}
