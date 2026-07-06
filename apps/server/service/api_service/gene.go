package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path"
	"path/filepath"

	"phytomni-server/common/document_format"
	rxBot "phytomni-server/external/bot"
	rxLog "phytomni-server/log"
	"phytomni-server/middleware"
	"phytomni-server/model"
	"phytomni-server/utils"
	"strings"
	"time"

	"github.com/spf13/viper"
)

// gene-example OBS/obsfs layout: md/<GENE>_result.md and img/<GENE>/<file>.
// geneImageURLPrefix is the browser-facing path served by the GeneImage handler.
const (
	geneObsSubMd       = "md/"
	geneObsSubImg      = "img/"
	geneRelayRoot      = "gene-examples/"
	geneImageURLPrefix = "/api/v1/gene-images/"
)

// geneObsfsDir returns the configured obsfs mount root if it is a readable
// directory, else "" (→ caller uses the relay fallback).
func geneObsfsDir() string {
	p := viper.GetString("gene_obsfs_path")
	if p == "" {
		return ""
	}
	if info, err := os.Stat(p); err != nil || !info.IsDir() {
		return ""
	}
	return p
}

func (ps *Service) GeneList(ctx context.Context, current, size int) ([]*model.GeneExample, int64, int, error) {
	return ps.GeneSearch(ctx, current, size, "")
}

func (ps *Service) GeneSearch(ctx context.Context, current, size int, title string) ([]*model.GeneExample, int64, int, error) {
	// Normalize pagination params: a missing `current`/`size` defaults to 0,
	// which makes the totalPages (total+size-1)/size expression
	// integer-divide-by-zero panic. Fall back to sane defaults — the browser
	// always sends current=1&size=10; this guards bare probes.
	if size <= 0 {
		size = 10
	}
	if current <= 0 {
		current = 1
	}
	allData, err := ps.fetchGeneFiles(ctx, title)
	if err != nil {
		return nil, 0, 0, err
	}

	total := int64(len(allData))
	if total == 0 {
		return []*model.GeneExample{}, 0, 0, nil
	}

	totalPages := int((total + int64(size) - 1) / int64(size))

	start := (current - 1) * size
	if start < 0 {
		start = 0
	}
	end := start + size

	if start > int(total) {
		start = int(total)
	}
	if end > int(total) {
		end = int(total)
	}

	return allData[start:end], total, totalPages, nil
}

func (ps *Service) fetchGeneFiles(ctx context.Context, title string) ([]*model.GeneExample, error) {
	var names []string
	if mount := geneObsfsDir(); mount != "" {
		entries, err := os.ReadDir(filepath.Join(mount, geneObsSubMd))
		if err != nil {
			return nil, err
		}
		for _, entry := range entries {
			if !entry.IsDir() {
				names = append(names, entry.Name())
			}
		}
	} else {
		keys, err := listObsKeysCached(ctx, rxBot.NewClient(), geneRelayRoot+geneObsSubMd, true)
		if err != nil {
			return nil, friendlyRelayErr(err)
		}
		for _, key := range keys {
			names = append(names, path.Base(key))
		}
	}

	var list []*model.GeneExample
	for _, name := range names {
		item := parseGeneFile(name)
		if item == nil {
			continue
		}
		if title != "" {
			if !strings.Contains(item.SpeciesCode, title) && !strings.Contains(item.GeneId, title) {
				continue
			}
		}
		list = append(list, item)
	}
	return list, nil
}

func parseGeneFile(filename string) *model.GeneExample {
	if !strings.HasSuffix(filename, "_result.md") {
		return nil
	}

	var speciesCode string
	if strings.HasPrefix(filename, "AT") {
		speciesCode = "Ath"
	} else if strings.HasPrefix(filename, "GLYMA") {
		speciesCode = "Gma"
	} else if strings.HasPrefix(filename, "Os") {
		speciesCode = "Osa"
	} else if strings.HasPrefix(filename, "Traes") {
		speciesCode = "tae"
	} else if strings.HasPrefix(filename, "Zm") {
		speciesCode = "zma"
	} else {
		return nil
	}

	geneId := strings.TrimSuffix(filename, "_result.md")

	return &model.GeneExample{
		FileName:    filename,
		SpeciesCode: speciesCode,
		GeneId:      geneId,
		// Id, CreatedAt, UpdatedAt, Content, DeleteAt are intentionally omitted.
	}
}
func (ps *Service) GeneDetails(ctx context.Context, fileName string) (*model.GeneExample, error) {
	// See fetchGeneFiles — gene_file_path is always defaulted in
	// initConfig, so the empty-string Windows fallback that used to
	// live here is no longer needed.
	path := viper.GetString("gene_file_path")

	fullPath := fmt.Sprintf("%s/%s", path, fileName)

	// Prevent path traversal: reject filenames containing "..", "/", or "\".
	if strings.Contains(fileName, "..") || strings.Contains(fileName, "/") || strings.Contains(fileName, "\\") {
		return nil, errors.New("invalid filename")
	}

	content, err := os.ReadFile(fullPath)
	if err != nil {
		return nil, err
	}

	item := parseGeneFile(fileName)
	if item == nil {
		return nil, errors.New("invalid gene file format")
	}
	item.Content = string(content)

	return item, nil
}

func (ps *Service) GeneDetailsStorage(ctx context.Context, fileName, content, speciesCode, geneId string) error {
	safeName, err := utils.CleanUploadFilename(fileName)
	if err != nil {
		return err
	}
	gene := &model.GeneExample{
		FileName:    safeName,
		Content:     content,
		SpeciesCode: speciesCode,
		GeneId:      geneId,
		CreatedAt:   time.Time{},
	}
	return model.DB(ctx).Model(&model.GeneExample{}).Create(gene).Error
}

// findObsKeyBySuffix returns the first key (case-insensitive) in the Bot-relayed
// listing that matches the given suffix.
func findObsKeyBySuffix(keys []string, suffix string) string {
	for _, k := range keys {
		if strings.HasSuffix(strings.ToLower(k), suffix) {
			return k
		}
	}
	return ""
}

// friendlyRelayErr translates a Bot relay rejection for an out-of-prefix or
// out-of-bucket path (characteristic of pre-cutover legacy download_paths) into
// a user-readable message; all other errors pass through unchanged.
func friendlyRelayErr(err error) error {
	if rxBot.IsLegacyPathErr(err) {
		return errors.New("this result file is pre-cutover historical data and is no longer available for download")
	}
	return err
}

// relayDownloadURL issues a short-lived token URL pointing at this service's
// streaming download endpoint for the given OBS key. The browser side
// (window.open / <img src>) cannot carry an Authorization header, so auth
// falls back to the query token; the relative path is proxied back to this
// service via the frontend /api/v1 proxy.
func relayDownloadURL(obsKey string) (string, error) {
	token, err := middleware.GenerateDownloadToken(obsKey, middleware.DownloadTokenTTL)
	if err != nil {
		return "", err
	}
	return "/api/v1/downloads/relay-file?t=" + url.QueryEscape(token), nil
}

func (ps *Service) DownloadAnalystAgentObsFile(ctx context.Context, username, obsPath string) (string, error) {
	var questionAgentLog model.QuestionAgentLog
	if result := model.DB(ctx).Model(&model.QuestionAgentLog{}).Where("user_name = ? and download_path = ? and delete_at IS NULL", username, obsPath).
		First(&questionAgentLog).RowsAffected; result == 0 {
		return "", errors.New("no matching obs path data found")
	}

	client := rxBot.NewClient()
	keys, err := listObsKeysCached(ctx, client, obsPath, questionAgentLog.Status == statusSucceeded)
	if err != nil {
		return "", friendlyRelayErr(err)
	}
	zipKey := findObsKeyBySuffix(keys, ".zip")
	if zipKey == "" {
		return "", errors.New("no zip file found in the specified directory")
	}
	return relayDownloadURL(zipKey)
}

func (ps *Service) DownloadAnalystAgentObsImages(ctx context.Context, username, obsPath string) ([]string, error) {
	// Ownership check + read the image paths written by the reconciler
	// (populated by the completed-state reconcile pass after cutover).
	var row model.QuestionAgentLog
	if result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Where("user_name = ? and download_path = ? and delete_at IS NULL", username, obsPath).
		First(&row).RowsAffected; result == 0 {
		return nil, errors.New("no matching obs path data found")
	}

	var keys []string
	if row.ImagePaths != "" {
		if err := json.Unmarshal([]byte(row.ImagePaths), &keys); err != nil {
			// Non-empty but invalid JSON: DB corruption or Bot contract drift.
			// Warn and fall back to enumeration (keep the endpoint usable);
			// do not silently treat the corrupt state as a legacy empty row.
			rxLog.Sugar().Warnw("image_paths invalid JSON, falling back to OBS prefix enumeration", "download_path", obsPath, "err", err)
			keys = nil
		}
	}
	if len(keys) == 0 {
		// Legacy row or empty image_paths: fall back to prefix enumeration (preserves current behaviour).
		var err error
		client := rxBot.NewClient()
		keys, err = listObsKeysCached(ctx, client, obsPath, row.Status == statusSucceeded)
		if err != nil {
			return nil, friendlyRelayErr(err)
		}
	}

	// Containment anchor = run root (path.Dir(download_path)). The writer stores
	// only dirs[0] in download_path, but image_paths can span multiple sibling
	// output_dirs within the same run — so the anchor cannot be download_path
	// itself (that would incorrectly reject sibling images); use its parent dir.
	// The download token signs any key without a prefix binding, so this loop is
	// the sole authorization gate for each object; out-of-bounds paths are dropped.
	anchor := path.Dir(obsPath)
	var imageUrls []string
	for _, k := range keys {
		if !strings.HasSuffix(strings.ToLower(k), ".png") {
			continue
		}
		if anchor != "" && anchor != "." && !strings.HasPrefix(k, anchor+"/") {
			// Out-of-bounds path: skip + warn (fail-safe: drop suspicious, serve the rest, keep observable).
			rxLog.Sugar().Warnw("image path escapes run root, skipping signing", "key", k, "anchor", anchor)
			continue
		}
		u, err := relayDownloadURL(k)
		if err != nil {
			// Skip individual signing failures (preserves prior "skip bad file" behaviour); warn for observability.
			rxLog.Sugar().Warnw("image signing failed, skipping", "key", k, "err", err)
			continue
		}
		imageUrls = append(imageUrls, u)
	}

	if len(imageUrls) == 0 {
		return nil, errors.New("no png image file found in the specified directory")
	}

	return imageUrls, nil
}

func (ps *Service) DownloadObsRenderingFile(ctx context.Context, id int, format string) ([]byte, string, error) {

	var questionAgentLog *model.QuestionAgentLog
	db := model.DB(ctx).Model(&model.QuestionAgentLog{})

	if err := db.Where("id = ?", id).First(&questionAgentLog).Error; err != nil {
		return nil, "", err
	}
	agent, err := document_format.NewAgent(questionAgentLog.ToolName)
	if err != nil {
		return nil, "", err
	}

	return agent.Download(format, questionAgentLog.Answer)
}
