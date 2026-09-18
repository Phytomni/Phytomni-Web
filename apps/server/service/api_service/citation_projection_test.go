package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"

	"phytomni-server/common/citation"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

const citationAnswerFixture = `{"content":"body [1]","extra":{"keep":true},"doc_list":[{"title":"T","ar":"e123","formatted_citation":"Rich *citation*."},null]}`

func reviewedCitationFixture(t *testing.T) (string, json.RawMessage, json.RawMessage) {
	return citationContractFixture(t, "cited-contract")
}

func citationContractFixture(t *testing.T, name string) (string, json.RawMessage, json.RawMessage) {
	t.Helper()
	data, err := os.ReadFile("../../common/document_format/testdata/" + name + ".json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Content    string
		References json.RawMessage
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	canonical, err := os.ReadFile("../../../web/tests/fixtures/" + name + ".generated.json")
	if err != nil {
		t.Fatal(err)
	}
	return fixture.Content, fixture.References, canonical
}

func reviewedAnswerFixture(t *testing.T) string {
	t.Helper()
	content, refs, _ := reviewedCitationFixture(t)
	data, err := json.Marshal(map[string]any{"content": content, "doc_list": refs, "extra": json.RawMessage(`{"keep":9007199254740993}`)})
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func assertReviewedAnswer(t *testing.T, answer string) {
	assertContractAnswer(t, answer, "cited-contract")
}

func scientificAnswerFixture(t *testing.T) string {
	t.Helper()
	content, refs, _ := citationContractFixture(t, "scientific-formatting-contract")
	data, err := json.Marshal(map[string]any{"content": content, "doc_list": refs, "extra": json.RawMessage(`{"keep":9007199254740993}`)})
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func assertContractAnswer(t *testing.T, answer, name string) {
	t.Helper()
	content, _, canonical := citationContractFixture(t, name)
	var got struct {
		Content string
		DocList json.RawMessage `json:"doc_list"`
	}
	if err := json.Unmarshal([]byte(answer), &got); err != nil {
		t.Fatal(err)
	}
	var rows, want any
	if err := json.Unmarshal(got.DocList, &rows); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(canonical, &want); err != nil {
		t.Fatal(err)
	}
	if got.Content != content || !reflect.DeepEqual(rows, want) {
		t.Fatalf("reviewed source/presentation drift: %s", answer)
	}
}

func reviewedCitationFrames(t *testing.T) (string, string) {
	t.Helper()
	content, refs, _ := reviewedCitationFixture(t)
	text, err := json.Marshal(map[string]any{"type": "TextMessageContent", "delta": content})
	if err != nil {
		t.Fatal(err)
	}
	references, err := json.Marshal(map[string]any{"type": "Custom", "name": "phyto.references", "value": map[string]any{"doc_list": refs}})
	if err != nil {
		t.Fatal(err)
	}
	return "event: TextMessageContent\ndata: " + string(text) + "\n", "event: Custom\ndata: " + string(references) + "\n"
}

func TestCitationProjectionReadSeparatesOwnedBodyWithoutSaving(t *testing.T) {
	gdb := setupTestDB(t)
	old := rxBot.BotConfig
	rxBot.BotConfig = nil
	t.Cleanup(func() { rxBot.BotConfig = old })
	source := `{"content":"Evidence [1].\n\n## References\n\n1. A plant study\n","extra":9007199254740993,"doc_list":[{"title":"A plant study"}]}`
	row := model.QuestionAgentLog{Id: 1, UserName: "alice", DialogueId: "dlg", ToolName: "ReviewAgent", Answer: source, Status: "SUCCEEDED", TaskId: "task"}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	service := NewService()
	for _, mode := range []HistoryReadMode{HistoryReadModeLegacy, HistoryReadModeDual, HistoryReadModeProjection} {
		result, err := service.AnswerCheckWithMode(context.Background(), "alice", "dlg", mode)
		if err != nil || len(result.Rows) != 1 {
			t.Fatalf("history %v", err)
		}
		var got struct {
			Content string
			Extra   json.RawMessage
		}
		if err = json.Unmarshal([]byte(result.Rows[0].Answer), &got); err != nil {
			t.Fatal(err)
		}
		if got.Content != "Evidence [1].\n\n" || string(got.Extra) != "9007199254740993" {
			t.Fatalf("projection %s", result.Rows[0].Answer)
		}
	}
	info, err := service.AsyncTaskInfo(context.Background(), 1, "alice")
	if err != nil {
		t.Fatal(err)
	}
	var got struct{ Content string }
	if err = json.Unmarshal([]byte(info.Answer), &got); err != nil || got.Content != "Evidence [1].\n\n" {
		t.Fatalf("async %s %v", info.Answer, err)
	}
	_, stored := readStatusAnswer(t, gdb, 1)
	if stored != source {
		t.Fatal("read mutated source report")
	}
}

func assertCitationProjection(t *testing.T, answer string) {
	t.Helper()
	var shape struct {
		Content string            `json:"content"`
		DocList []json.RawMessage `json:"doc_list"`
		Extra   json.RawMessage   `json:"extra"`
	}
	if err := json.Unmarshal([]byte(answer), &shape); err == nil && strings.HasPrefix(shape.Content, "# Scientific formatting validation:") {
		assertContractAnswer(t, answer, "scientific-formatting-contract")
		if string(shape.Extra) != `{"keep":9007199254740993}` {
			t.Fatal("unrelated scientific envelope metadata changed")
		}
		return
	}
	if err := json.Unmarshal([]byte(answer), &shape); err == nil && len(shape.DocList) == 8 {
		assertReviewedAnswer(t, answer)
		if string(shape.Extra) != `{"keep":9007199254740993}` {
			t.Fatal("unrelated reviewed envelope metadata changed")
		}
		return
	}
	var envelope struct {
		Content string `json:"content"`
		DocList []struct {
			AR        string                `json:"ar"`
			Formatted string                `json:"formatted_citation"`
			Citation  citation.Presentation `json:"citation"`
		} `json:"doc_list"`
	}
	if err := json.Unmarshal([]byte(answer), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Content != "body [1]" || len(envelope.DocList) != 2 {
		t.Fatalf("projection: %s", answer)
	}
	if envelope.DocList[0].AR != "e123" || envelope.DocList[0].Formatted != "Rich *citation*." || citation.PlainText(envelope.DocList[0].Citation) != "Rich citation." || citation.PlainText(envelope.DocList[1].Citation) != "Reference details unavailable." {
		t.Fatalf("references: %s", answer)
	}
}

func TestCitationProjectionReadCopies(t *testing.T) {
	for _, source := range []string{citationAnswerFixture, reviewedAnswerFixture(t), scientificAnswerFixture(t)} {
		for _, tool := range []string{"KnowledgeAgent", "ReviewAgent", "BriefGeneAgent", "DeepGenomeAgent"} {
			t.Run(tool, func(t *testing.T) {
				gdb := setupTestDB(t)
				old := rxBot.BotConfig
				rxBot.BotConfig = nil
				t.Cleanup(func() { rxBot.BotConfig = old })
				row := model.QuestionAgentLog{Id: 1, UserName: "alice", DialogueId: "dlg", ToolName: tool, Answer: source, Status: "SUCCEEDED", TaskId: "task", CollectType: "1"}
				if err := gdb.Create(&row).Error; err != nil {
					t.Fatal(err)
				}
				ps := NewService()
				collected, err := ps.QueryCollectList(context.Background(), "alice")
				if err != nil || len(collected) != 1 || collected[0].DialogueId != "dlg" {
					t.Fatalf("collection selection: %v %v", collected, err)
				}
				foreign, err := ps.QueryCollectList(context.Background(), "bob")
				if err != nil || len(foreign) != 0 {
					t.Fatal("foreign collection visible")
				}
				for _, mode := range []HistoryReadMode{HistoryReadModeLegacy, HistoryReadModeDual, HistoryReadModeProjection} {
					result, err := ps.AnswerCheckWithMode(context.Background(), "alice", collected[0].DialogueId, mode)
					if err != nil || len(result.Rows) != 1 {
						t.Fatalf("history: %+v %v", result, err)
					}
					assertCitationProjection(t, result.Rows[0].Answer)
					other, err := ps.AnswerCheckWithMode(context.Background(), "bob", "dlg", mode)
					if err != nil || len(other.Rows) != 0 {
						t.Fatal("foreign history visible")
					}
				}
				info, err := ps.AsyncTaskInfo(context.Background(), 1, "alice")
				if err != nil {
					t.Fatal(err)
				}
				assertCitationProjection(t, info.Answer)
				if _, err := ps.AsyncTaskInfo(context.Background(), 1, "bob"); err == nil {
					t.Fatal("foreign task visible")
				}
				list, _, _, err := ps.AsyncTaskList(context.Background(), "alice", 1, 10)
				if err != nil || len(list) != 1 {
					t.Fatalf("list: %v", err)
				}
				assertCitationProjection(t, list[0].Answer)
				_, stored := readStatusAnswer(t, gdb, 1)
				if stored != source {
					t.Fatal("read rewrote source")
				}
			})
		}
	}
}

func TestCitationProjectionMatchingReview(t *testing.T) {
	gdb := setupTestDB(t)
	old := rxBot.BotConfig
	rxBot.BotConfig = nil
	t.Cleanup(func() { rxBot.BotConfig = old })
	row := model.QuestionAgentLog{Id: 1, UserName: "alice", DialogueId: "dlg", ToolName: "ReviewAgent", Answer: citationAnswerFixture, Status: "SUCCEEDED", BotRunId: "run"}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	if err := saveBotRunProjectionForTest(context.Background(), "alice", 1, BotRunProjection{RunID: "run", Agent: "review", Status: "SUCCEEDED", FinalReport: "body [1]", ReportRevision: 1}); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []HistoryReadMode{HistoryReadModeLegacy, HistoryReadModeProjection} {
		result, err := NewService().AnswerCheckWithMode(context.Background(), "alice", "dlg", mode)
		if err != nil {
			t.Fatal(err)
		}
		assertCitationProjection(t, result.Rows[0].Answer)
	}
	_, stored := readStatusAnswer(t, gdb, 1)
	if stored != citationAnswerFixture {
		t.Fatal("projection read rewrote source")
	}
}

func TestCitationProjectionScientificMatchingReview(t *testing.T) {
	gdb := setupTestDB(t)
	old := rxBot.BotConfig
	rxBot.BotConfig = nil
	t.Cleanup(func() { rxBot.BotConfig = old })
	source := scientificAnswerFixture(t)
	content, _, _ := citationContractFixture(t, "scientific-formatting-contract")
	row := model.QuestionAgentLog{Id: 1, UserName: "alice", DialogueId: "dlg", ToolName: "ReviewAgent", Answer: source, Status: "SUCCEEDED", BotRunId: "run"}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	if err := saveBotRunProjectionForTest(context.Background(), "alice", 1, BotRunProjection{RunID: "run", Agent: "review", Status: "SUCCEEDED", FinalReport: content, ReportRevision: 1}); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []HistoryReadMode{HistoryReadModeLegacy, HistoryReadModeDual, HistoryReadModeProjection} {
		result, err := NewService().AnswerCheckWithMode(context.Background(), "alice", "dlg", mode)
		if err != nil || len(result.Rows) != 1 {
			t.Fatalf("scientific history rows: %v", err)
		}
		assertCitationProjection(t, result.Rows[0].Answer)
	}
	_, stored := readStatusAnswer(t, gdb, 1)
	if stored != source {
		t.Fatal("scientific projection read rewrote source")
	}
}

func TestCitationProjectionPersistedBodySplitRetainsRows(t *testing.T) {
	const (
		report = "# Report\n\nBody [1].\n\n## References\n\n1. A plant study\n"
		body   = "# Report\n\nBody [1].\n\n"
	)
	references := json.RawMessage(`[{"title":"A plant study","dl":"https://example.org/article"}]`)
	for _, agent := range []struct {
		slug string
		tool string
	}{
		{slug: "knowledge", tool: "KnowledgeAgent"},
		{slug: "review", tool: "ReviewAgent"},
		{slug: "brief_gene", tool: "BriefGeneAgent"},
		{slug: "deep_genome", tool: "DeepGenomeAgent"},
	} {
		for _, mode := range []HistoryReadMode{HistoryReadModeLegacy, HistoryReadModeProjection, HistoryReadModeDual} {
			for _, source := range []string{"split-completion", "unsplit-source"} {
				t.Run(agent.slug+"/"+string(mode)+"/"+source, func(t *testing.T) {
					gdb := setupTestDB(t)
					old := rxBot.BotConfig
					rxBot.BotConfig = nil
					t.Cleanup(func() { rxBot.BotConfig = old })

					answer, err := rxBot.ShapeAnswer(agent.slug, report, &rxBot.Formatted{References: references})
					if err != nil {
						t.Fatalf("shape completion: %v", err)
					}
					if source == "unsplit-source" {
						raw, err := json.Marshal(struct {
							Content string          `json:"content"`
							DocList json.RawMessage `json:"doc_list"`
						}{Content: report, DocList: references})
						if err != nil {
							t.Fatalf("marshal unsplit source: %v", err)
						}
						answer = string(raw)
					}
					projection := BotRunProjection{
						RunID:          "run-body-split",
						Agent:          agent.slug,
						Status:         "SUCCEEDED",
						ReportRevision: 3,
						FinalReport:    report,
					}
					encoded, err := marshalPersistedProjection(projection)
					if err != nil {
						t.Fatalf("marshal projection: %v", err)
					}
					if err := gdb.Exec(`INSERT INTO question_agent_logs
					(id, dialogue_id, f_id, user_name, query, answer, tool_name, bot_run_id, bot_projection_json, bot_report_revision, status, created_at) VALUES
					(130, 'dlg-body-split', 0, 'alice', 'q', ?, ?, 'run-body-split', ?, 3, 'RUNNING', '2026-01-01 00:00:00')`, answer, agent.tool, encoded).Error; err != nil {
						t.Fatalf("seed: %v", err)
					}

					result, err := NewService().AnswerCheckWithMode(context.Background(), "alice", "dlg-body-split", mode)
					if err != nil || len(result.Rows) != 1 {
						t.Fatalf("history result=%#v err=%v", result, err)
					}
					var got struct {
						Content string `json:"content"`
						DocList []struct {
							Title        string                `json:"title"`
							Presentation citation.Presentation `json:"citation"`
						} `json:"doc_list"`
					}
					if err := json.Unmarshal([]byte(result.Rows[0].Answer), &got); err != nil {
						t.Fatalf("decode history answer: %v", err)
					}
					if got.Content != body || len(got.DocList) != 1 || got.DocList[0].Title != "A plant study" ||
						len(got.DocList[0].Presentation.Links) != 2 || got.DocList[0].Presentation.Links[0].Href != "https://example.org/article" {
						t.Fatalf("history lost split body/references: %#v", got)
					}
					_, stored := readStatusAnswer(t, gdb, 130)
					if stored != answer {
						t.Fatal("history projection rewrote durable answer")
					}
				})
			}
		}
	}
}

func TestCitationProjectionPersistedBodySplitRequiresEquivalentIdentity(t *testing.T) {
	const report = "Body [1].\n\n## References\n\n1. A plant study\n"
	references := json.RawMessage(`[{"title":"A plant study"}]`)
	answer, err := rxBot.ShapeAnswer("review", report, &rxBot.Formatted{References: references})
	if err != nil {
		t.Fatal(err)
	}
	base := model.QuestionAgentLog{
		Answer:            answer,
		ToolName:          "ReviewAgent",
		BotRunId:          "run-owned",
		BotReportRevision: 5,
		Status:            "RUNNING",
	}

	for _, tc := range []struct {
		name       string
		row        model.QuestionAgentLog
		projection BotRunProjection
	}{
		{
			name: "different report",
			row:  base,
			projection: BotRunProjection{RunID: "run-owned", Agent: "review", ReportRevision: 5,
				FinalReport: "Different report"},
		},
		{
			name: "different run",
			row:  base,
			projection: BotRunProjection{RunID: "run-other", Agent: "review", ReportRevision: 5,
				FinalReport: report},
		},
		{
			name: "different revision",
			row:  base,
			projection: BotRunProjection{RunID: "run-owned", Agent: "review", ReportRevision: 6,
				FinalReport: report},
		},
		{
			name: "ambiguous authored bibliography",
			row:  base,
			projection: BotRunProjection{RunID: "run-owned", Agent: "review", ReportRevision: 5,
				FinalReport: "Body [1].\n\n## References\n\n1. Different authored content\n"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.row
			applied, err := applyBotProjectionToHistoryRow(&got, tc.projection)
			if err != nil || !applied {
				t.Fatalf("projection applied=%v err=%v", applied, err)
			}
			var shaped struct {
				Content string            `json:"content"`
				DocList []json.RawMessage `json:"doc_list"`
			}
			if err := json.Unmarshal([]byte(got.Answer), &shaped); err != nil {
				t.Fatal(err)
			}
			if len(shaped.DocList) != 0 || shaped.Content != tc.projection.FinalReport {
				t.Fatalf("non-equivalent projection retained rows: %#v", shaped)
			}
		})
	}

	malformed := base
	malformed.Answer = `{"content":"Body [1].\n\n","doc_list":{"bad":"private-source"}}`
	before := malformed
	applied, err := applyBotProjectionToHistoryRow(&malformed, BotRunProjection{
		RunID: "run-owned", Agent: "review", ReportRevision: 5, FinalReport: report,
	})
	if applied || !errors.Is(err, citation.ErrInvalidReferences) || malformed != before {
		t.Fatalf("malformed durable rows applied=%v err=%v row=%#v", applied, err, malformed)
	}
}

func TestCitationProjectionStoredReplay(t *testing.T) {
	for _, raw := range []string{citationAnswerFixture, reviewedAnswerFixture(t), scientificAnswerFixture(t), `{"doc_list":{"bad":"private-source"}}`} {
		t.Run(raw, func(t *testing.T) {
			gdb := setupTestDB(t)
			row := model.QuestionAgentLog{Id: 1, UserName: "alice", ToolName: "ReviewAgent", Answer: raw, Status: "SUCCEEDED"}
			if err := gdb.Create(&row).Error; err != nil {
				t.Fatal(err)
			}
			out, err := NewService().queryDataFromStoredRowWithDB(context.Background(), gdb, "alice", row)
			if raw != `{"doc_list":{"bad":"private-source"}}` {
				if err != nil {
					t.Fatal(err)
				}
				assertCitationProjection(t, out.Answer)
			} else if !errors.Is(err, citation.ErrInvalidReferences) {
				t.Fatalf("replay error: %v", err)
			}
			replacement := &persistedConversationReplacement{TerminalResult: &persistedReplacementTerminalResult{ToolName: "ReviewAgent", Answer: raw, Status: "CANCELLED"}}
			out, err = queryDataFromReplacementTerminal(row, replacement)
			if raw != `{"doc_list":{"bad":"private-source"}}` {
				if err != nil {
					t.Fatal(err)
				}
				assertCitationProjection(t, out.Answer)
				if out.Status != "CANCELLED" {
					t.Fatal("terminal status changed")
				}
			} else if !errors.Is(err, citation.ErrInvalidReferences) {
				t.Fatalf("terminal replay error: %v", err)
			}
			if replacement.TerminalResult.Answer != raw {
				t.Fatal("terminal replay changed source")
			}
			_, stored := readStatusAnswer(t, gdb, 1)
			if stored != raw || row.Answer != raw {
				t.Fatal("replay changed source")
			}
		})
	}
}

func TestCitationProjectionMalformedReadAndPersistence(t *testing.T) {
	gdb := setupTestDB(t)
	old := rxBot.BotConfig
	rxBot.BotConfig = nil
	t.Cleanup(func() { rxBot.BotConfig = old })
	raw := `{"content":"body","doc_list":{"bad":"private-source"}}`
	row := model.QuestionAgentLog{Id: 1, UserName: "alice", DialogueId: "dlg", ToolName: "ReviewAgent", Answer: raw, Status: "RUNNING", BotRunId: "run"}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	ps := NewService()
	for _, mode := range []HistoryReadMode{HistoryReadModeLegacy, HistoryReadModeDual, HistoryReadModeProjection} {
		_, err := ps.AnswerCheckWithMode(context.Background(), "alice", "dlg", mode)
		if !errors.Is(err, citation.ErrInvalidReferences) || err.Error() != "invalid reference payload" {
			t.Fatalf("history error: %v", err)
		}
	}
	if _, err := ps.AsyncTaskInfo(context.Background(), 1, "alice"); !errors.Is(err, citation.ErrInvalidReferences) {
		t.Fatalf("info error: %v", err)
	}
	if _, _, _, err := ps.AsyncTaskList(context.Background(), "alice", 1, 10); !errors.Is(err, citation.ErrInvalidReferences) {
		t.Fatalf("list error: %v", err)
	}
	rec := &rxBot.RunRecord{RunID: "run", Agent: "review", Status: "succeeded", Result: json.RawMessage(`{"formatted":{"answer":"body","references":{"bad":"private-source"}}}`)}
	if err := applyBotRunRecordForTest(context.Background(), &row, rec); !errors.Is(err, citation.ErrInvalidReferences) || err.Error() != "invalid reference payload" {
		t.Fatalf("persistence error: %v", err)
	}
	status, answer := readStatusAnswer(t, gdb, 1)
	if status != "RUNNING" || answer != raw {
		t.Fatal("malformed success saved")
	}
	var stored model.QuestionAgentLog
	if err := gdb.First(&stored, 1).Error; err != nil {
		t.Fatal(err)
	}
	if stored.BotProjectionJSON != "" {
		t.Fatal("malformed successful projection saved")
	}
	for _, tool := range []string{"ChatAgent", "DataAgent", "BriefReviewAgent", "review"} {
		if got, err := normalizeCitationAnswerForTool(tool, raw); err != nil || got != raw {
			t.Fatalf("unrelated agent changed: %s %v", tool, err)
		}
	}
}

func TestCitationProjectionBotOverlayMalformedRoot(t *testing.T) {
	for _, slug := range []string{"knowledge", "review", "brief_gene", "deep_genome"} {
		t.Run(slug, func(t *testing.T) {
			gdb := setupTestDB(t)
			row := model.QuestionAgentLog{Id: 1, UserName: "alice", DialogueId: "dlg", ToolName: slugToToolName[slug], Answer: "prior answer", Status: "RUNNING", BotRunId: "run"}
			if err := gdb.Create(&row).Error; err != nil {
				t.Fatal(err)
			}
			result := json.RawMessage(`{"formatted":{"answer":"body","references":{"bad":"private-source"}}}`)
			rec := rxBot.RunRecord{RunID: "run", Agent: slug, Status: "succeeded", Result: result}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{"object": "list", "data": []rxBot.RunRecord{rec}})
			}))
			t.Cleanup(server.Close)
			old := rxBot.BotConfig
			rxBot.BotConfig = &rxBot.Config{BaseURL: server.URL, ProxyEnabled: true, TimeoutSeconds: 5}
			t.Cleanup(func() { rxBot.BotConfig = old })
			_, err := NewService().AnswerCheckWithMode(context.Background(), "alice", "dlg", HistoryReadModeLegacy)
			if !errors.Is(err, citation.ErrInvalidReferences) || err.Error() != "invalid reference payload" {
				t.Fatalf("overlay error: %v", err)
			}
			status, answer := readStatusAnswer(t, gdb, 1)
			if status != "RUNNING" || answer != "prior answer" {
				t.Fatal("history overlay wrote source")
			}
			projection := BotRunProjection{RunID: "run", Agent: slug, Status: "SUCCEEDED", FinalReport: "body"}
			copy := row
			applied, err := applyBotProjectionToHistoryRowWithFormatted(&copy, projection, &rxBot.Formatted{References: json.RawMessage(`{"bad":true}`)})
			if applied || !errors.Is(err, citation.ErrInvalidReferences) || copy.Status != "RUNNING" || copy.Answer != row.Answer {
				t.Fatalf("corrupt success projection: %+v %v", copy, err)
			}
		})
	}
}

func TestCitationProjectionBlockingError(t *testing.T) {
	runID := "run"
	formatted := &rxBot.Formatted{Answer: "body", References: json.RawMessage(`{"bad":"private-source"}`)}
	projection, err := DecodeAgentRunSubmission(rxBot.AgentRunResponse{
		RunID:  &runID,
		Agent:  "knowledge",
		Status: "succeeded",
		Result: rxBot.AgentRunResult{Formatted: formatted},
	})
	if err != nil {
		t.Fatal(err)
	}
	row := model.QuestionAgentLog{BotRunId: runID, ToolName: "KnowledgeAgent", Status: "RUNNING", Answer: "prior answer"}
	applied, err := applyBotProjectionToHistoryRowWithFormatted(&row, projection, formatted)
	if applied || !errors.Is(err, citation.ErrInvalidReferences) || err.Error() != "invalid reference payload" {
		t.Fatalf("blocking result: applied=%v row=%+v err=%v", applied, row, err)
	}
	if row.Status != "RUNNING" || row.Answer != "prior answer" {
		t.Fatal("corrupt blocking success mutated history")
	}
}

func TestCitationProjectionEmptyReport(t *testing.T) {
	for _, slug := range []string{"knowledge", "review", "brief_gene", "deep_genome", "chat", "data"} {
		for _, body := range []struct{ name, text string }{{"empty", ""}, {"whitespace", " \n\t "}} {
			for _, references := range []struct {
				name    string
				raw     json.RawMessage
				invalid bool
			}{
				{"malformed", json.RawMessage(`{"bad":"private-source"}`), true},
				{"valid", json.RawMessage(`[{"title":"T"},null,12]`), false},
				{"absent", nil, false},
				{"null", json.RawMessage("null"), false},
			} {
				for _, boundary := range []string{"reconcile", "overlay"} {
					t.Run(slug+"/"+body.name+"/"+references.name+"/"+boundary, func(t *testing.T) {
						gdb := setupTestDB(t)
						row := model.QuestionAgentLog{Id: 1, UserName: "alice", DialogueId: "dlg", ToolName: slugToToolName[slug], Answer: "prior answer", Status: "RUNNING", BotRunId: "run"}
						if err := gdb.Create(&row).Error; err != nil {
							t.Fatal(err)
						}
						formatted := &rxBot.Formatted{Answer: body.text, References: references.raw}
						source := map[string]any{"answer": body.text}
						if references.raw != nil {
							source["references"] = references.raw
						}
						result, err := json.Marshal(map[string]any{"formatted": source})
						if err != nil {
							t.Fatal(err)
						}
						rec := rxBot.RunRecord{RunID: "run", Agent: slug, Status: "succeeded", Result: result}
						wantInvalid := references.invalid && slug != "chat" && slug != "data"
						if boundary == "reconcile" {
							err = applyBotRunRecordForTest(context.Background(), &row, &rec)
							terminal := model.QuestionAgentLog{BotRunId: "run", ToolName: row.ToolName}
							terminalApplied, terminalErr := applyBotProjectionToHistoryRowWithFormatted(
								&terminal,
								BotRunProjection{RunID: "run", Agent: slug, Status: "CANCELLED", FinalReport: body.text},
								formatted,
							)
							if wantInvalid {
								if terminalApplied || !errors.Is(terminalErr, citation.ErrInvalidReferences) {
									t.Errorf("malformed terminal references accepted: %v", terminalErr)
								}
							} else if !terminalApplied || terminalErr != nil || terminal.Answer != "" || terminal.Status != "CANCELLED" {
								t.Fatalf("valid empty terminal behavior changed: %+v %v", terminal, terminalErr)
							}
						} else {
							server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								w.Header().Set("Content-Type", "application/json")
								_ = json.NewEncoder(w).Encode(map[string]any{"object": "list", "data": []rxBot.RunRecord{rec}})
							}))
							t.Cleanup(server.Close)
							old := rxBot.BotConfig
							rxBot.BotConfig = &rxBot.Config{BaseURL: server.URL, ProxyEnabled: true, TimeoutSeconds: 5}
							t.Cleanup(func() { rxBot.BotConfig = old })
							var history HistoryReadResult
							history, err = NewService().AnswerCheckWithMode(context.Background(), "alice", "dlg", HistoryReadModeLegacy)
							if !wantInvalid && (len(history.Rows) != 1 || history.Rows[0].Answer != "prior answer" || history.Rows[0].Status != "SUCCEEDED") {
								t.Fatalf("valid empty overlay changed behavior: %+v %v", history, err)
							}
							if wantInvalid && len(history.Rows) > 0 {
								t.Error("malformed successful history returned")
							}
							copy := row
							applied, applyErr := applyBotProjectionToHistoryRowWithFormatted(&copy, BotRunProjection{RunID: "run", Agent: slug, Status: "SUCCEEDED", FinalReport: body.text}, formatted)
							if wantInvalid && (applied || !errors.Is(applyErr, citation.ErrInvalidReferences) || copy.Status != "RUNNING" || copy.Answer != row.Answer) {
								t.Errorf("malformed overlay applied: applied=%v status=%s error=%v", applied, copy.Status, applyErr)
							}
						}
						if wantInvalid {
							if !errors.Is(err, citation.ErrInvalidReferences) || err.Error() != "invalid reference payload" {
								t.Errorf("missing generic root error: %v", err)
							}
						} else if err != nil {
							t.Fatalf("valid or unrelated source rejected: %v", err)
						}
						var stored model.QuestionAgentLog
						if err := gdb.First(&stored, 1).Error; err != nil {
							t.Fatal(err)
						}
						if stored.Answer != "prior answer" {
							t.Error("empty source replaced stored answer")
						}
						if wantInvalid || boundary == "overlay" {
							if stored.Status != "RUNNING" || stored.BotProjectionJSON != "" {
								t.Errorf("unexpected successful write: status=%s projection=%s", stored.Status, stored.BotProjectionJSON)
							}
						} else if stored.Status != "SUCCEEDED" || stored.BotProjectionJSON == "" {
							t.Errorf("valid empty reconciliation changed behavior: status=%s projection=%s", stored.Status, stored.BotProjectionJSON)
						}
					})
				}
			}
		}
	}
}
