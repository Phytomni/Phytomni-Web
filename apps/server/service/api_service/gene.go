package api_service

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"

	"phytomni-server/common/document_format"
	rxBot "phytomni-server/external/bot"
	rxLog "phytomni-server/log"
	"phytomni-server/middleware"
	"phytomni-server/model"
	"phytomni-server/utils"
	"strings"

	"github.com/spf13/viper"
	"gorm.io/gorm"
)

// gene-example OBS/obsfs layout: md/<GENE>_result.md and img/<GENE>/<file>.
const (
	geneObsSubMd  = "md/"
	geneRelayRoot = "gene-examples/"

	maxConversationArtifactLinks     = 50
	maxConversationArtifactNameBytes = 255
	maxConversationArtifactURLBytes  = 2 << 10
)

type ConversationArtifactLink struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Kind        string `json:"kind"`
	DownloadURL string `json:"download_url"`
}

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
	safeName, err := utils.CleanUploadFilename(fileName)
	if err != nil {
		return nil, err
	}

	item := parseGeneFile(safeName)
	if item == nil {
		return nil, errors.New("invalid gene file format")
	}

	var content []byte
	if mount := geneObsfsDir(); mount != "" {
		content, err = os.ReadFile(filepath.Join(mount, geneObsSubMd, safeName))
		if err != nil {
			return nil, err
		}
	} else {
		rc, _, rerr := rxBot.NewClient().GetObsObjectStream(ctx, geneRelayRoot+geneObsSubMd+safeName)
		if rerr != nil {
			return nil, friendlyRelayErr(rerr)
		}
		defer rc.Close()
		content, err = io.ReadAll(rc)
		if err != nil {
			return nil, err
		}
	}

	// The md already carries /api/v1/gene-images/<GENE>/<file> URLs, which the
	// frontend pipeline passes through untouched — no backend image rewrite.
	item.Content = string(content)
	return item, nil
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

func validateDownloadArtifactPath(obsPath string) error {
	if rxBot.ValidateProjectionOBSPath(obsPath) != nil {
		return errors.New("invalid obs artifact path")
	}
	return nil
}

// artifactPathWithinPrefix checks containment after validating absolute OBS
// references or a relative key returned by Bot's relay. Relative keys are
// canonicalized only for the in-memory ownership check; the original key is
// retained by callers for signing and relay/object requests.
func artifactPathWithinPrefix(prefix, candidate string) bool {
	if !isSafeObsPrefix(prefix) {
		return false
	}
	if rxBot.ValidateProjectionOBSPath(candidate) != nil {
		if !isSafeRelayObjectKey(candidate) {
			return false
		}
		candidate = canonicalRelayObjectPath(prefix, candidate)
		if candidate == "" {
			return false
		}
	}
	return artifactAbsolutePathWithinPrefix(prefix, candidate)
}

func artifactAbsolutePathWithinPrefix(prefix, candidate string) bool {
	if strings.HasPrefix(prefix, "/obs/") && strings.HasPrefix(candidate, "/obs/") {
		return candidate == prefix || strings.HasPrefix(candidate, prefix+"/")
	}
	prefixURL, err := url.Parse(prefix)
	if err != nil || prefixURL.Scheme != "obs" {
		return false
	}
	candidateURL, err := url.Parse(candidate)
	if err != nil || candidateURL.Scheme != "obs" || candidateURL.Host != prefixURL.Host {
		return false
	}
	return candidateURL.Path == prefixURL.Path || strings.HasPrefix(candidateURL.Path, strings.TrimSuffix(prefixURL.Path, "/")+"/")
}

// isSafeRelayObjectKey validates the relative keys returned by Bot's OBS
// listing relay. These keys deliberately remain relative when signed and sent
// back to /v1/relay/obs/object; this helper only proves they are safe to bind
// to the owner-scoped bucket/run prefix.
func isSafeRelayObjectKey(value string) bool {
	if value == "" || value != strings.TrimSpace(value) || len([]rune(value)) > rxBot.MaxProjectionArtifactPathLen {
		return false
	}
	if strings.HasPrefix(value, "/") || strings.ContainsAny(value, "\\?#:%") || strings.ContainsAny(value, "\x00\r\n\t ") {
		return false
	}
	for _, segment := range strings.Split(value, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return false
		}
	}
	return true
}

func canonicalRelayObjectPath(prefix, relativeKey string) string {
	if !isSafeRelayObjectKey(relativeKey) {
		return ""
	}
	if strings.HasPrefix(prefix, "/obs/") {
		segments := strings.Split(prefix, "/")
		if len(segments) < 3 || segments[2] == "" {
			return ""
		}
		return "/obs/" + segments[2] + "/" + relativeKey
	}
	parsed, err := url.Parse(prefix)
	if err != nil || parsed.Scheme != "obs" || parsed.Host == "" {
		return ""
	}
	return "obs://" + parsed.Host + "/" + relativeKey
}

// isSafeObsPrefix accepts a validated object path's parent directory. A run
// may live directly below the bucket, so the parent can be /obs/<bucket> (or
// obs://<bucket>) even though that bucket root is not itself an object path.
func isSafeObsPrefix(value string) bool {
	if value == "" || value != strings.TrimSpace(value) {
		return false
	}
	if strings.HasPrefix(value, "/obs/") {
		segments := strings.Split(value, "/")
		if len(segments) < 3 || segments[2] == "" {
			return false
		}
		for _, segment := range segments[2:] {
			if segment == "" || segment == "." || segment == ".." || strings.ContainsAny(segment, "?#:%") {
				return false
			}
		}
		return true
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "obs" || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || strings.ContainsAny(parsed.Host, "?#:") {
		return false
	}
	if parsed.Path != "" && parsed.Path != "/" {
		for _, segment := range strings.Split(strings.TrimPrefix(parsed.Path, "/"), "/") {
			if segment == "" || segment == "." || segment == ".." || strings.ContainsAny(segment, "?#:%\\ \t\r\n\x00") {
				return false
			}
		}
	}
	return true
}

func artifactRunRoot(obsPath string) string {
	if strings.HasPrefix(obsPath, "/obs/") {
		if len(strings.Split(strings.TrimPrefix(obsPath, "/obs/"), "/")) == 2 {
			return obsPath
		}
		return path.Dir(obsPath)
	}
	parsed, err := url.Parse(obsPath)
	if err != nil || parsed.Scheme != "obs" || parsed.Host == "" {
		return ""
	}
	if len(strings.Split(strings.TrimPrefix(parsed.Path, "/"), "/")) == 1 {
		return obsPath
	}
	root := path.Dir(parsed.Path)
	if root == "." || root == "/" {
		return "obs://" + parsed.Host + strings.TrimSuffix(root, "/")
	}
	return "obs://" + parsed.Host + root
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
	return "/api/v1/downloads/relay-file?token=" + url.QueryEscape(token), nil
}

func conversationArtifactKind(name string) string {
	switch strings.ToLower(path.Ext(name)) {
	case ".pdf", ".md", ".doc", ".docx", ".html", ".htm":
		return "report"
	case ".csv", ".tsv", ".xls", ".xlsx", ".parquet":
		return "table"
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp":
		return "image"
	case ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz":
		return "archive"
	default:
		return "file"
	}
}

func conversationArtifactID(rowID int64, artifactPath string) string {
	sum := sha256.Sum256([]byte(strconv.FormatInt(rowID, 10) + "\x00" + artifactPath))
	return fmt.Sprintf("%x", sum[:])
}

// conversationArtifactLinks signs only paths stored on the authenticated,
// successful message row. The returned DTO never contains the OBS reference.
func (ps *Service) conversationArtifactLinks(
	ctx context.Context,
	username string,
	dialogueID string,
	rowID int64,
) ([]ConversationArtifactLink, error) {
	var row model.QuestionAgentLog
	result := model.DB(ctx).Model(&model.QuestionAgentLog{}).
		Select("id, user_name, dialogue_id, status, bot_projection_json, bot_report_revision").
		Where(
			"id = ? AND user_name = ? AND dialogue_id = ? AND delete_at IS NULL AND UPPER(status) = ?",
			rowID,
			username,
			dialogueID,
			statusSucceeded,
		).
		Take(&row)
	if errors.Is(result.Error, gorm.ErrRecordNotFound) || result.RowsAffected == 0 {
		return nil, ErrConversationArtifactOwnership
	}
	if result.Error != nil {
		return nil, result.Error
	}

	projection, err := LoadBotRunProjection(ctx, username, rowID)
	if err != nil {
		return nil, err
	}
	links := make([]ConversationArtifactLink, 0)
	seen := make(map[string]struct{})
	for _, artifactPath := range projection.Artifacts.Paths {
		if len(links) == maxConversationArtifactLinks {
			break
		}
		if _, duplicate := seen[artifactPath]; duplicate {
			continue
		}
		if rxBot.ValidateProjectionOBSPath(artifactPath) != nil {
			return nil, ErrConversationArtifactOwnership
		}
		name := path.Base(artifactPath)
		if name == "." || name == "/" || name == "" ||
			len([]byte(name)) > maxConversationArtifactNameBytes {
			return nil, ErrConversationArtifactOwnership
		}
		downloadURL, err := relayDownloadURL(artifactPath)
		if err != nil {
			return nil, err
		}
		if len([]byte(downloadURL)) > maxConversationArtifactURLBytes {
			return nil, ErrConversationArtifactOwnership
		}
		links = append(links, ConversationArtifactLink{
			ID:          conversationArtifactID(rowID, artifactPath),
			Name:        name,
			Kind:        conversationArtifactKind(name),
			DownloadURL: downloadURL,
		})
		seen[artifactPath] = struct{}{}
	}
	return links, nil
}

func (ps *Service) DownloadAnalystAgentObsFile(ctx context.Context, username, obsPath string) (string, error) {
	if err := validateDownloadArtifactPath(obsPath); err != nil {
		return "", err
	}
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
	zipKey := ""
	for _, candidate := range keys {
		if !strings.HasSuffix(strings.ToLower(candidate), ".zip") || !artifactPathWithinPrefix(obsPath, candidate) {
			continue
		}
		zipKey = candidate
		break
	}
	if zipKey == "" {
		return "", errors.New("no zip file found in the specified directory")
	}
	return relayDownloadURL(zipKey)
}

func (ps *Service) DownloadAnalystAgentObsImages(ctx context.Context, username, obsPath string) ([]string, error) {
	if err := validateDownloadArtifactPath(obsPath); err != nil {
		return nil, err
	}
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
			rxLog.Sugar().Warnw("image_paths invalid JSON, falling back to OBS prefix enumeration", "artifact_kind", "images", "reason", "invalid_json")
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
	anchor := artifactRunRoot(obsPath)
	var imageUrls []string
	for index, k := range keys {
		if !strings.HasSuffix(strings.ToLower(k), ".png") {
			continue
		}
		if !artifactPathWithinPrefix(anchor, k) {
			// Out-of-bounds path: skip + warn (fail-safe: drop suspicious, serve the rest, keep observable).
			rxLog.Sugar().Warnw("image path escapes run root, skipping signing", "artifact_index", index, "reason", "outside_owner_run")
			continue
		}
		u, err := relayDownloadURL(k)
		if err != nil {
			// Skip individual signing failures (preserves prior "skip bad file" behaviour); warn for observability.
			rxLog.Sugar().Warnw("image signing failed, skipping", "artifact_index", index, "reason", "signing_failed")
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
