package bot

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

// ShapeAnswer rewrites a Bot reply into the JSON-string-in-answer contract
// the Web app's JSON.parse(answer) expects, keyed by agent slug. cited families
// (knowledge/review/deep_genome) become {content, doc_list}; data becomes
// {headers, rows} with positional rows; chat/analyst (and any unknown slug)
// pass through as a plain string. answerText is the display answer already
// sourced from the right Bot field. It never panics: any decode/encode trouble
// degrades to answerText (or an empty table).
func ShapeAnswer(slug string, answerText string, f *Formatted) string {
	switch slug {
	case "knowledge", "review", "deep_genome", "brief_gene":
		return citedAnswer(answerText, f)
	case "data":
		return tableAnswer(f)
	default:
		return answerText
	}
}

// ChatAnswerText returns the display answer for a chat-family completion.
// Default-mode chat/completions moves the normalized answer into
// choices[0].message.content and drops formatted.answer, so prefer the choice
// content; fall back to formatted.answer (present only in debug mode).
func ChatAnswerText(resp *ChatCompletionResponse) string {
	if resp == nil {
		return ""
	}
	if len(resp.Choices) > 0 && resp.Choices[0].Message.Content != "" {
		return resp.Choices[0].Message.Content
	}
	return resp.Formatted.Answer
}

// citedAnswer emits {"content": answerText, "doc_list": [{"title": ..., <bibliographic>}]}.
// Bot references always carry {file_id, title}; on a bibliographic-library hit they additionally
// carry au/ti/so/vl/bp/ep/py/di/dl/pm (any may be absent; pm may be null). title is always written
// (empty title falls back to file_id) so the Web app's title row + the document_format consumers
// stay safe; the additional fields are written only when non-empty so unenriched docs stay title-only.
func citedAnswer(answerText string, f *Formatted) string {
	docList := []map[string]interface{}{}
	if f != nil && len(f.References) > 0 {
		var refs []struct {
			FileID json.RawMessage `json:"file_id"`
			Title  string          `json:"title"`
			Au     string          `json:"au"`
			Ti     string          `json:"ti"`
			So     string          `json:"so"`
			Vl     string          `json:"vl"`
			Bp     string          `json:"bp"`
			Ep     string          `json:"ep"`
			Py     string          `json:"py"`
			Di     string          `json:"di"`
			Dl     string          `json:"dl"`
			Pm     *string         `json:"pm"`
		}
		if err := json.Unmarshal(f.References, &refs); err == nil {
			for _, r := range refs {
				title := r.Title
				if title == "" && len(r.FileID) > 0 {
					title = string(unquote(r.FileID))
				}
				el := map[string]interface{}{"title": title}
				putIfSet(el, "au", r.Au)
				putIfSet(el, "ti", r.Ti)
				putIfSet(el, "so", r.So)
				putIfSet(el, "vl", r.Vl)
				putIfSet(el, "bp", r.Bp)
				putIfSet(el, "ep", r.Ep)
				putIfSet(el, "py", r.Py)
				putIfSet(el, "di", r.Di)
				putIfSet(el, "dl", r.Dl)
				if r.Pm != nil && *r.Pm != "" {
					el["pm"] = *r.Pm
				}
				docList = append(docList, el)
			}
		}
	}
	out, err := json.Marshal(map[string]interface{}{"content": answerText, "doc_list": docList})
	if err != nil {
		return answerText
	}
	return string(out)
}

// putIfSet writes key=value into el only when value is non-empty, keeping unenriched
// reference elements title-only.
func putIfSet(el map[string]interface{}, key, value string) {
	if value != "" {
		el[key] = value
	}
}

// tableAnswer emits {"headers": [...], "rows": [[...]]}. The table lives in
// Bot's formatted.tabular; rows are normalized to positional arrays aligned to
// headers (the Web app indexes row[i] by header position). A missing or
// undecodable tabular still yields valid JSON, because the Web app's Data history
// branch has no try/catch and must never throw.
func tableAnswer(f *Formatted) string {
	headers := []string{}
	rows := [][]interface{}{}
	if f != nil && len(f.Tabular) > 0 {
		var tab struct {
			Headers []string        `json:"headers"`
			Rows    json.RawMessage `json:"rows"`
		}
		if err := json.Unmarshal(f.Tabular, &tab); err == nil {
			if tab.Headers != nil {
				headers = tab.Headers
			}
			rows = normalizeRows(tab.Rows, headers)
		}
	}
	out, err := json.Marshal(map[string]interface{}{"headers": headers, "rows": rows})
	if err != nil {
		return `{"headers":[],"rows":[]}`
	}
	return string(out)
}

// normalizeRows coerces Bot's tabular rows into positional arrays. Rows that
// are already arrays pass through; object rows are projected by header order
// (best-effort; the live Bot row shape is confirmed at activation). Anything
// undecodable yields an empty slice.
func normalizeRows(raw json.RawMessage, headers []string) [][]interface{} {
	rows := [][]interface{}{}
	if len(raw) == 0 {
		return rows
	}
	var asArrays [][]interface{}
	if err := json.Unmarshal(raw, &asArrays); err == nil {
		return asArrays
	}
	var asObjects []map[string]interface{}
	if err := json.Unmarshal(raw, &asObjects); err == nil {
		for _, obj := range asObjects {
			row := make([]interface{}, len(headers))
			for i, h := range headers {
				row[i] = obj[h]
			}
			rows = append(rows, row)
		}
	}
	return rows
}

// ParseRunFormatted lifts the formatted envelope out of a RunRecord.Result
// ({formatted, raw}, with raw stripped in default mode) so the read paths
// reshape Bot content the same way the live dispatch does, instead of using
// the flat RunRecord.Answer. ok is false when result carries no formatted
// block (e.g. a still-running run).
func ParseRunFormatted(raw json.RawMessage) (*Formatted, string, bool) {
	if len(raw) == 0 {
		return nil, "", false
	}
	var env struct {
		Formatted *Formatted `json:"formatted"`
	}
	if err := json.Unmarshal(raw, &env); err != nil || env.Formatted == nil {
		return nil, "", false
	}
	return env.Formatted, env.Formatted.Answer, true
}

// ParseRunFinalReport lifts result.final_report out of a RunRecord.Result.
// Bot's deep_genome poll path persists the assembled markdown report there
// (the terminal run aggregate carries no formatted envelope), so the read
// paths and the freshness cron fall back to it when ParseRunFormatted finds no
// formatted block. ok is false when the field is absent or empty.
func ParseRunFinalReport(raw json.RawMessage) (string, bool) {
	if len(raw) == 0 {
		return "", false
	}
	var env struct {
		FinalReport string `json:"final_report"`
	}
	if err := json.Unmarshal(raw, &env); err != nil || env.FinalReport == "" {
		return "", false
	}
	return env.FinalReport, true
}

// ParseRunArtifacts lifts result.artifacts[] out of a RunRecord.Result. Each
// entry is one finished sub-task's outputs ({task_id, output_dir, paths}). It
// returns the non-empty output_dirs (the first becomes the representative
// gallery prefix written into download_path) and the flattened object paths
// across all tasks (the full multi-directory set). ok is false when there are
// no artifacts. A sub-task with an empty paths slice (best-effort OBS glob) is
// tolerated. No image filtering here — the gallery handler owns the .png filter.
func ParseRunArtifacts(raw json.RawMessage) (dirs []string, paths []string, ok bool) {
	if len(raw) == 0 {
		return nil, nil, false
	}
	var env struct {
		Artifacts []struct {
			OutputDir string   `json:"output_dir"`
			Paths     []string `json:"paths"`
		} `json:"artifacts"`
	}
	if err := json.Unmarshal(raw, &env); err != nil || len(env.Artifacts) == 0 {
		return nil, nil, false
	}
	for _, a := range env.Artifacts {
		if a.OutputDir != "" {
			dirs = append(dirs, a.OutputDir)
		}
		paths = append(paths, a.Paths...)
	}
	return dirs, paths, true
}

// BoundedRunProgress is the public counter subset accepted from a Bot run.
// Unknown/provider-specific progress fields are intentionally ignored.
type BoundedRunProgress struct {
	Completed       int64
	Total           int64
	Failed          int64
	Pending         int64
	BriefGeneStatus string
}

const (
	// These limits keep progress and report projections small enough for a Web
	// row while leaving ample room for the release's normal analysis fan-out.
	MaxProjectionProgressCounter = int64(1_000_000_000)
	MaxProjectionReportLength    = 1 << 20
	MaxProjectionArtifactCount   = 64
	MaxProjectionArtifactPaths   = 256
	MaxProjectionArtifactPathLen = 512
)

// ParseRunProgress strictly decodes the bounded progress counters used by the
// Web projection. A missing/null progress object is a valid zero projection;
// negative, over-cap, or structurally malformed counters are rejected.
func ParseRunProgress(raw json.RawMessage) (BoundedRunProgress, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return BoundedRunProgress{}, nil
	}
	var payload struct {
		Completed       *int64 `json:"completed"`
		CompletedCount  *int64 `json:"completed_count"`
		Total           *int64 `json:"total"`
		TotalCount      *int64 `json:"total_count"`
		Failed          *int64 `json:"failed"`
		FailedCount     *int64 `json:"failed_count"`
		Pending         *int64 `json:"pending"`
		PendingCount    *int64 `json:"pending_count"`
		BriefGeneStatus string `json:"brief_gene_status"`
	}
	if err := json.Unmarshal(trimmed, &payload); err != nil {
		return BoundedRunProgress{}, fmt.Errorf("progress must be an object with integer counters: %w", err)
	}
	progress := BoundedRunProgress{
		Completed:       chooseProgressCounter(payload.Completed, payload.CompletedCount),
		Total:           chooseProgressCounter(payload.Total, payload.TotalCount),
		Failed:          chooseProgressCounter(payload.Failed, payload.FailedCount),
		Pending:         chooseProgressCounter(payload.Pending, payload.PendingCount),
		BriefGeneStatus: strings.TrimSpace(payload.BriefGeneStatus),
	}
	for name, value := range map[string]int64{
		"completed": progress.Completed,
		"total":     progress.Total,
		"failed":    progress.Failed,
		"pending":   progress.Pending,
	} {
		if value < 0 {
			return BoundedRunProgress{}, fmt.Errorf("progress %s is negative", name)
		}
		if value > MaxProjectionProgressCounter {
			return BoundedRunProgress{}, fmt.Errorf("progress %s exceeds %d", name, MaxProjectionProgressCounter)
		}
	}
	if progress.Total > 0 && progress.Completed > progress.Total {
		return BoundedRunProgress{}, fmt.Errorf("progress completed exceeds total")
	}
	if len([]rune(progress.BriefGeneStatus)) > MaxProjectionFailureField {
		return BoundedRunProgress{}, fmt.Errorf("brief_gene_status exceeds %d characters", MaxProjectionFailureField)
	}
	return progress, nil
}

// DecodeProjectionProgress is the explicit decoder-named alias used by
// service callers that treat progress as a projection boundary.
func DecodeProjectionProgress(raw json.RawMessage) (BoundedRunProgress, error) {
	return ParseRunProgress(raw)
}

func chooseProgressCounter(primary, fallback *int64) int64 {
	if primary != nil {
		return *primary
	}
	if fallback != nil {
		return *fallback
	}
	return 0
}

// BoundedRunArtifact is one output directory and its validated OBS paths.
// Task ids and provider metadata are deliberately not represented.
type BoundedRunArtifact struct {
	OutputDir string
	Paths     []string
}

// ParseRunProjectionArtifacts strictly decodes terminal artifact outputs. It
// accepts OBS URI references and the legacy /obs/ mount form, rejects remote
// URLs/traversal/control characters, and permits an empty path list when the
// provider's best-effort glob found no files.
func ParseRunProjectionArtifacts(raw json.RawMessage) ([]BoundedRunArtifact, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return nil, nil
	}
	type artifactEntry struct {
		OutputDir string   `json:"output_dir"`
		Paths     []string `json:"paths"`
	}
	var entries []artifactEntry
	if err := json.Unmarshal(trimmed, &entries); err != nil {
		var payload struct {
			Artifacts []artifactEntry `json:"artifacts"`
		}
		if objectErr := json.Unmarshal(trimmed, &payload); objectErr != nil {
			return nil, fmt.Errorf("artifacts must be an array or object: %w", err)
		}
		entries = payload.Artifacts
	}
	if len(entries) > MaxProjectionArtifactCount {
		return nil, fmt.Errorf("artifact count exceeds %d", MaxProjectionArtifactCount)
	}
	artifacts := make([]BoundedRunArtifact, 0, len(entries))
	totalPaths := 0
	for index, item := range entries {
		dir := strings.TrimSpace(item.OutputDir)
		if dir != "" {
			if err := validateProjectionOBSPath(dir); err != nil {
				return nil, fmt.Errorf("artifact %d output_dir: %w", index, err)
			}
		}
		paths := make([]string, 0, len(item.Paths))
		for pathIndex, path := range item.Paths {
			path = strings.TrimSpace(path)
			if err := validateProjectionOBSPath(path); err != nil {
				return nil, fmt.Errorf("artifact %d path %d: %w", index, pathIndex, err)
			}
			paths = append(paths, path)
		}
		totalPaths += len(paths)
		if totalPaths > MaxProjectionArtifactPaths {
			return nil, fmt.Errorf("artifact path count exceeds %d", MaxProjectionArtifactPaths)
		}
		if dir == "" && len(paths) > 0 {
			return nil, fmt.Errorf("artifact %d has paths without output_dir", index)
		}
		artifacts = append(artifacts, BoundedRunArtifact{OutputDir: dir, Paths: paths})
	}
	return artifacts, nil
}

// DecodeProjectionArtifacts is the explicit decoder-named alias for the strict
// terminal artifact helper.
func DecodeProjectionArtifacts(raw json.RawMessage) ([]BoundedRunArtifact, error) {
	return ParseRunProjectionArtifacts(raw)
}

func validateProjectionOBSPath(value string) error {
	if value == "" {
		return fmt.Errorf("path is empty")
	}
	if len([]rune(value)) > MaxProjectionArtifactPathLen {
		return fmt.Errorf("path exceeds %d characters", MaxProjectionArtifactPathLen)
	}
	for _, r := range value {
		if r == 0 || r == '\n' || r == '\r' || r == '\t' || r == ' ' {
			return fmt.Errorf("path contains whitespace or control characters")
		}
	}
	if strings.HasPrefix(value, "/obs/") {
		if strings.Contains(value, "../") || strings.HasSuffix(value, "/..") {
			return fmt.Errorf("path traversal is not allowed")
		}
		return nil
	}
	u, err := url.Parse(value)
	if err != nil || u.Scheme != "obs" || u.Host == "" || u.Path == "" || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("path is not an OBS reference")
	}
	if strings.Contains(u.Path, "../") || strings.HasSuffix(u.Path, "/..") {
		return fmt.Errorf("path traversal is not allowed")
	}
	return nil
}

// unquote strips surrounding quotes from a JSON-encoded scalar so a string
// file_id renders without quotes when used as a title fallback.
func unquote(b json.RawMessage) []byte {
	if len(b) >= 2 && b[0] == '"' && b[len(b)-1] == '"' {
		return b[1 : len(b)-1]
	}
	return b
}
