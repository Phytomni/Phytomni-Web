package bot

import "encoding/json"

// ShapeAnswer rewrites a Bot reply into the JSON-string-in-answer contract
// chat-ai's JSON.parse(answer) expects, keyed by agent slug. cited families
// (knowledge/review/deep_genome) become {content, doc_list}; data becomes
// {headers, rows} with positional rows; chat/analyst (and any unknown slug)
// pass through as a plain string. answerText is the display answer already
// sourced from the right Bot field. It never panics: any decode/encode trouble
// degrades to answerText (or an empty table).
func ShapeAnswer(slug string, answerText string, f *Formatted) string {
	switch slug {
	case "knowledge", "review", "deep_genome":
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

// citedAnswer emits {"content": answerText, "doc_list": [{"title": ...}]}.
// Bot references carry only {file_id, title}; an empty title falls back to the
// file_id so chat-ai's `v-if="doc.title"` branch still renders the row.
func citedAnswer(answerText string, f *Formatted) string {
	docList := []map[string]interface{}{}
	if f != nil && len(f.References) > 0 {
		var refs []struct {
			FileID json.RawMessage `json:"file_id"`
			Title  string          `json:"title"`
		}
		if err := json.Unmarshal(f.References, &refs); err == nil {
			for _, r := range refs {
				title := r.Title
				if title == "" && len(r.FileID) > 0 {
					title = string(unquote(r.FileID))
				}
				docList = append(docList, map[string]interface{}{"title": title})
			}
		}
	}
	out, err := json.Marshal(map[string]interface{}{"content": answerText, "doc_list": docList})
	if err != nil {
		return answerText
	}
	return string(out)
}

// tableAnswer emits {"headers": [...], "rows": [[...]]}. The table lives in
// Bot's formatted.tabular; rows are normalized to positional arrays aligned to
// headers (chat-ai indexes row[i] by header position). A missing or
// undecodable tabular still yields valid JSON, because chat-ai's Data history
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

// unquote strips surrounding quotes from a JSON-encoded scalar so a string
// file_id renders without quotes when used as a title fallback.
func unquote(b json.RawMessage) []byte {
	if len(b) >= 2 && b[0] == '"' && b[len(b)-1] == '"' {
		return b[1 : len(b)-1]
	}
	return b
}
