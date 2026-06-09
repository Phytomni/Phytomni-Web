package bot

import (
	"encoding/json"
	"testing"
)

func TestShapeAnswer_Cited(t *testing.T) {
	f := &Formatted{References: json.RawMessage(`[{"file_id":"f1","title":"Doc A"},{"file_id":42,"title":""}]`)}
	got := ShapeAnswer("knowledge", "body [1]", f)
	var parsed struct {
		Content string                   `json:"content"`
		DocList []map[string]interface{} `json:"doc_list"`
	}
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("not valid JSON: %v (%s)", err, got)
	}
	if parsed.Content != "body [1]" {
		t.Errorf("content = %q", parsed.Content)
	}
	if len(parsed.DocList) != 2 {
		t.Fatalf("doc_list len = %d", len(parsed.DocList))
	}
	if parsed.DocList[0]["title"] != "Doc A" {
		t.Errorf("doc[0].title = %v", parsed.DocList[0]["title"])
	}
	if parsed.DocList[1]["title"] != "42" { // empty title falls back to file_id
		t.Errorf("doc[1].title fallback = %v", parsed.DocList[1]["title"])
	}
}

func TestShapeAnswer_CitedEmptyRefs(t *testing.T) {
	got := ShapeAnswer("review", "md", &Formatted{})
	var parsed struct {
		Content string        `json:"content"`
		DocList []interface{} `json:"doc_list"`
	}
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("not valid JSON: %v", err)
	}
	if parsed.Content != "md" || parsed.DocList == nil || len(parsed.DocList) != 0 {
		t.Errorf("got %s", got)
	}
}

func TestShapeAnswer_DataPositional(t *testing.T) {
	f := &Formatted{Tabular: json.RawMessage(`{"headers":["gene","len"],"rows":[["g1",100],["g2",200]]}`)}
	got := ShapeAnswer("data", "2 rows x 2 columns", f)
	var parsed struct {
		Headers []string        `json:"headers"`
		Rows    [][]interface{} `json:"rows"`
	}
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("not valid JSON: %v", err)
	}
	if len(parsed.Headers) != 2 || len(parsed.Rows) != 2 || parsed.Rows[0][0] != "g1" {
		t.Errorf("got %s", got)
	}
}

func TestShapeAnswer_DataObjectRows(t *testing.T) {
	f := &Formatted{Tabular: json.RawMessage(`{"headers":["gene","len"],"rows":[{"gene":"g1","len":100}]}`)}
	got := ShapeAnswer("data", "1 row x 2 columns", f)
	var parsed struct {
		Rows [][]interface{} `json:"rows"`
	}
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("not valid JSON: %v", err)
	}
	if len(parsed.Rows) != 1 || parsed.Rows[0][0] != "g1" {
		t.Errorf("object rows not projected positionally: %s", got)
	}
}

func TestShapeAnswer_DataEmptyTabular(t *testing.T) {
	got := ShapeAnswer("data", "0 rows", &Formatted{})
	var parsed struct {
		Headers []string        `json:"headers"`
		Rows    [][]interface{} `json:"rows"`
	}
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("data must always emit valid JSON, got %q: %v", got, err)
	}
	if parsed.Headers == nil || parsed.Rows == nil {
		t.Errorf("expected empty arrays not null: %s", got)
	}
}

func TestShapeAnswer_Plain(t *testing.T) {
	if got := ShapeAnswer("chat", "hello", &Formatted{}); got != "hello" {
		t.Errorf("chat passthrough = %q", got)
	}
	if got := ShapeAnswer("analyst", "任务创建成功：x", nil); got != "任务创建成功：x" {
		t.Errorf("analyst passthrough = %q", got)
	}
}

func TestChatAnswerText(t *testing.T) {
	withChoice := &ChatCompletionResponse{
		Choices:   []Choice{{Message: ChatMessage{Role: "assistant", Content: "from content"}}},
		Formatted: Formatted{Answer: ""},
	}
	if got := ChatAnswerText(withChoice); got != "from content" {
		t.Errorf("expected message.content, got %q", got)
	}
	debugMode := &ChatCompletionResponse{Formatted: Formatted{Answer: "from formatted"}}
	if got := ChatAnswerText(debugMode); got != "from formatted" {
		t.Errorf("expected formatted.answer fallback, got %q", got)
	}
	if got := ChatAnswerText(nil); got != "" {
		t.Errorf("nil resp = %q", got)
	}
}

func TestParseRunFormatted(t *testing.T) {
	raw := json.RawMessage(`{"formatted":{"answer":"md","references":[{"file_id":"f1","title":"T"}]}}`)
	f, ans, ok := ParseRunFormatted(raw)
	if !ok || f == nil || ans != "md" {
		t.Fatalf("ok=%v ans=%q", ok, ans)
	}
	if _, _, ok := ParseRunFormatted(json.RawMessage(`{"raw":"x"}`)); ok {
		t.Error("expected ok=false when no formatted")
	}
	if _, _, ok := ParseRunFormatted(nil); ok {
		t.Error("expected ok=false for nil")
	}
}
