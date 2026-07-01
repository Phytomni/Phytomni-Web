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

func TestShapeAnswer_CitedEnriched(t *testing.T) {
	refs := `[
		{"file_id":"f1","title":"Doc A","au":"Murai, M. et al","ti":"Pleiotropic effect","so":"PLANT BREEDING","vl":"122","bp":"410","ep":"415","py":"2003","di":"10.1/x","dl":"http://dx.doi.org/10.1/x","pm":null},
		{"file_id":"f2","title":"Doc B"}
	]`
	f := &Formatted{References: json.RawMessage(refs)}
	got := ShapeAnswer("knowledge", "body [1][2]", f)

	var parsed struct {
		Content string                   `json:"content"`
		DocList []map[string]interface{} `json:"doc_list"`
	}
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("not valid JSON: %v (%s)", err, got)
	}
	if len(parsed.DocList) != 2 {
		t.Fatalf("doc_list len = %d", len(parsed.DocList))
	}
	// enriched element carries the bibliographic keys
	if parsed.DocList[0]["title"] != "Doc A" {
		t.Errorf("doc[0].title = %v", parsed.DocList[0]["title"])
	}
	if parsed.DocList[0]["au"] != "Murai, M. et al" {
		t.Errorf("doc[0].au = %v", parsed.DocList[0]["au"])
	}
	if parsed.DocList[0]["so"] != "PLANT BREEDING" {
		t.Errorf("doc[0].so = %v", parsed.DocList[0]["so"])
	}
	// pm was JSON null -> the key must be absent (not written)
	if _, ok := parsed.DocList[0]["pm"]; ok {
		t.Errorf("doc[0].pm should be absent for null, got %v", parsed.DocList[0]["pm"])
	}
	// title-only element stays title-only (no enriched keys leak in)
	if parsed.DocList[1]["title"] != "Doc B" {
		t.Errorf("doc[1].title = %v", parsed.DocList[1]["title"])
	}
	if _, ok := parsed.DocList[1]["au"]; ok {
		t.Errorf("doc[1] should be title-only, au present = %v", parsed.DocList[1]["au"])
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

func TestShapeAnswer_BriefGeneCited(t *testing.T) {
	f := &Formatted{References: json.RawMessage(`[{"file_id":"f1","title":"Brief A"}]`)}
	got := ShapeAnswer("brief_gene", "summary [1]", f)
	var parsed struct {
		Content string                   `json:"content"`
		DocList []map[string]interface{} `json:"doc_list"`
	}
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("brief_gene should reshape to cited JSON: %v (%s)", err, got)
	}
	if parsed.Content != "summary [1]" {
		t.Errorf("content = %q", parsed.Content)
	}
	if len(parsed.DocList) != 1 || parsed.DocList[0]["title"] != "Brief A" {
		t.Errorf("doc_list = %v", parsed.DocList)
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
	if got := ShapeAnswer("analyst", "Task created: x", nil); got != "Task created: x" {
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

func TestParseRunFinalReport(t *testing.T) {
	report := "deep genome report body"
	raw := json.RawMessage(`{"final_report":"deep genome report body","task_results":[]}`)
	got, ok := ParseRunFinalReport(raw)
	if !ok || got != report {
		t.Fatalf("ok=%v got=%q", ok, got)
	}
	if _, ok := ParseRunFinalReport(json.RawMessage(`{"task_results":[]}`)); ok {
		t.Error("expected ok=false when final_report absent")
	}
	if _, ok := ParseRunFinalReport(json.RawMessage(`{"final_report":""}`)); ok {
		t.Error("expected ok=false for empty final_report")
	}
	if _, ok := ParseRunFinalReport(json.RawMessage(`not json`)); ok {
		t.Error("expected ok=false for malformed JSON")
	}
	if _, ok := ParseRunFinalReport(nil); ok {
		t.Error("expected ok=false for nil")
	}
}

// deep_genome reshapes its final_report through the cited family (f == nil),
// yielding {content, doc_list: []} — the JSON the Web app's DeepGenomeResultViewer parses.
func TestShapeAnswer_DeepGenomeFinalReport(t *testing.T) {
	got := ShapeAnswer("deep_genome", "report md", nil)
	var parsed struct {
		Content string        `json:"content"`
		DocList []interface{} `json:"doc_list"`
	}
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("not valid JSON: %v (%s)", err, got)
	}
	if parsed.Content != "report md" {
		t.Errorf("content = %q", parsed.Content)
	}
	if parsed.DocList == nil || len(parsed.DocList) != 0 {
		t.Errorf("expected empty doc_list array, got %s", got)
	}
}

func TestParseRunArtifacts(t *testing.T) {
	raw := json.RawMessage(`{"artifacts":[
		{"task_id":"t1","output_dir":"/obs/p/r1","paths":["/obs/p/r1/a.png","/obs/p/r1/t.csv"]},
		{"task_id":"t2","output_dir":"/obs/p/r2","paths":["/obs/p/r2/b.png"]}
	]}`)
	dirs, paths, ok := ParseRunArtifacts(raw)
	if !ok {
		t.Fatal("expected ok=true")
	}
	if len(dirs) != 2 || dirs[0] != "/obs/p/r1" || dirs[1] != "/obs/p/r2" {
		t.Errorf("dirs = %v", dirs)
	}
	if len(paths) != 3 || paths[0] != "/obs/p/r1/a.png" || paths[2] != "/obs/p/r2/b.png" {
		t.Errorf("paths = %v", paths)
	}
}

func TestParseRunArtifacts_EmptyPathsTask(t *testing.T) {
	// a task whose OBS glob failed contributes its dir but no paths
	raw := json.RawMessage(`{"artifacts":[{"task_id":"t1","output_dir":"/obs/p/r1","paths":[]}]}`)
	dirs, paths, ok := ParseRunArtifacts(raw)
	if !ok || len(dirs) != 1 || dirs[0] != "/obs/p/r1" {
		t.Errorf("dirs=%v ok=%v", dirs, ok)
	}
	if len(paths) != 0 {
		t.Errorf("expected no paths, got %v", paths)
	}
}

func TestParseRunArtifacts_NoneOrMalformed(t *testing.T) {
	if _, _, ok := ParseRunArtifacts(json.RawMessage(`{"final_report":"x"}`)); ok {
		t.Error("expected ok=false when no artifacts key")
	}
	if _, _, ok := ParseRunArtifacts(json.RawMessage(`{"artifacts":[]}`)); ok {
		t.Error("expected ok=false for empty artifacts array")
	}
	if _, _, ok := ParseRunArtifacts(json.RawMessage(`not json`)); ok {
		t.Error("expected ok=false for malformed JSON")
	}
	if _, _, ok := ParseRunArtifacts(nil); ok {
		t.Error("expected ok=false for nil")
	}
}
