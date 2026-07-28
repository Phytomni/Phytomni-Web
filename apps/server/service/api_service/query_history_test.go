package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"

	"gorm.io/gorm"
)

func TestParseHistoryRejectsMalformedJSON(t *testing.T) {
	if got := parseHistory(`[{"role":"user"`); got != nil {
		t.Fatalf("malformed history = %#v, want nil", got)
	}
}

func TestParseHistoryDropsOversizedContent(t *testing.T) {
	raw, err := json.Marshal([]rxBot.ChatMessage{
		{Role: "user", Content: strings.Repeat("x", 32*1024+1)},
		{Role: "assistant", Content: "bounded"},
	})
	if err != nil {
		t.Fatalf("marshal history: %v", err)
	}

	want := []rxBot.ChatMessage{{Role: "assistant", Content: "bounded"}}
	if got := parseHistory(string(raw)); !reflect.DeepEqual(got, want) {
		t.Fatalf("bounded history = %#v, want %#v", got, want)
	}
}

func TestParseHistoryBoundsRolesAndContent(t *testing.T) {
	input := make([]map[string]string, 0, 25)
	input = append(input, map[string]string{"role": "system", "content": "untrusted system role"})
	for i := 0; i < 24; i++ {
		role := "user"
		if i%2 == 1 {
			role = "assistant"
		}
		input = append(input, map[string]string{"role": role, "content": fmt.Sprintf("turn-%02d", i)})
	}
	raw, err := json.Marshal(input)
	if err != nil {
		t.Fatalf("marshal history: %v", err)
	}

	got := parseHistory(string(raw))
	if len(got) != 20 {
		t.Fatalf("history length = %d, want 20", len(got))
	}
	for _, message := range got {
		if message.Role != "user" && message.Role != "assistant" {
			t.Fatalf("untrusted history role survived: %#v", message)
		}
		if message.Content == "" {
			t.Fatal("empty history content survived")
		}
	}
	if got[len(got)-1].Content != "turn-23" {
		t.Fatalf("history tail = %q, want turn-23", got[len(got)-1].Content)
	}
}

func TestQueryForwardsBoundedHistoryBeforeCurrentTurn(t *testing.T) {
	setupExpertTestDB(t)
	var captured rxBot.ChatCompletionRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Errorf("decode chat request: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"c-history","run_id":"run-history","choices":[{"message":{"role":"assistant","content":"answer"}}]}`))
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	history := `[{"role":"user","content":"first"},{"role":"assistant","content":"prior answer"}]`
	_, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "follow up", History: history, Mode: "instant",
	})
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	want := []rxBot.ChatMessage{
		{Role: "user", Content: "first"},
		{Role: "assistant", Content: "prior answer"},
		{Role: "user", Content: "follow up"},
	}
	if !reflect.DeepEqual(captured.Messages, want) {
		t.Fatalf("messages = %#v, want %#v", captured.Messages, want)
	}
}

func TestQueryStreamForwardsHistoryBeforeCurrentTurn(t *testing.T) {
	setupStreamTestDB(t)
	var captured rxBot.ChatCompletionRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Errorf("decode stream request: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("event: RunStarted\ndata: {\"type\":\"RunStarted\",\"run_id\":\"run-history-stream\"}\n\n" +
			"event: TextMessageContent\ndata: {\"type\":\"TextMessageContent\",\"delta\":\"answer\"}\n\n" +
			"event: RunFinished\ndata: {\"type\":\"RunFinished\",\"run_id\":\"run-history-stream\"}\n\n"))
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, StreamEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	_, err := NewService().QueryStream(context.Background(), "alice", QueryInput{
		Query: "follow up", History: `[{"role":"assistant","content":"prior"}]`, Mode: "instant",
	}, nil, nil)
	if err != nil {
		t.Fatalf("QueryStream: %v", err)
	}
	if len(captured.Messages) != 2 || captured.Messages[0].Content != "prior" || captured.Messages[1].Content != "follow up" {
		t.Fatalf("stream messages = %#v", captured.Messages)
	}
}

func TestContextRebuildUsesAcceptedOwnerScopedSummariesOnly(t *testing.T) {
	gdb := setupExpertTestDB(t)
	dialogueID := "11111111-1111-4111-8111-111111111111"
	stage := validContextStageMetadata()
	stage.TurnID = "1"
	stage.BaseBusinessContextVersion = 0
	stage.ProposedBusinessContextVersion = 1
	stage.LastAppliedLedgerCursor = 1
	rootContext := persistedConversationContext{
		ClientTurnID:     "root-turn",
		Stage:            stage,
		SettlementState:  conversationSettlementAcked,
		AssistantSummary: "Bot summary only",
		ArtifactRefs: []rxBot.ArtifactRefV1{{
			ArtifactID: "artifact-root", DisplayName: "root.csv",
		}},
	}
	rootRaw, err := marshalPersistedProjectionWithContext(
		BotRunProjection{ReportRevision: -1}, &rootContext,
	)
	if err != nil {
		t.Fatal(err)
	}
	rows := []model.QuestionAgentLog{
		{
			Id: 1, DialogueId: dialogueID, UserName: "alice",
			Query: "root question", Answer: "raw private root answer",
			Status: statusSucceeded, Mode: "instant", ToolName: "ChatAgent",
			BotProjectionJSON: rootRaw, BotReportRevision: -1,
		},
		{
			Id: 2, DialogueId: dialogueID, FId: 1, UserName: "alice",
			Query: "failed question", Answer: "failed answer",
			Status: "FAILED", Mode: "instant", ToolName: "ChatAgent",
			BotReportRevision: -1,
		},
		{
			Id: 3, DialogueId: dialogueID, FId: 1, UserName: "alice",
			Query: "current pre-dispatch", Answer: "must be excluded",
			Status: "SUBMITTING", Mode: "instant", ToolName: "ChatAgent",
			BotReportRevision: -1,
		},
	}
	for index := range rows {
		if err := gdb.Create(&rows[index]).Error; err != nil {
			t.Fatal(err)
		}
	}

	ledger, err := BuildConversationLedger(context.Background(), "alice", dialogueID)
	if err != nil {
		t.Fatal(err)
	}
	rebuild, err := ledger.RebuildBefore(3)
	if err != nil {
		t.Fatal(err)
	}
	if rebuild.Cursor != 1 || len(rebuild.History) != 2 ||
		rebuild.History[0].Content != "root question" ||
		rebuild.History[1].Summary != "Bot summary only" ||
		len(rebuild.ArtifactRefs) != 1 ||
		rebuild.ArtifactRefs[0].ArtifactID != "artifact-root" {
		t.Fatalf("rebuild snapshot = %#v", rebuild)
	}
	encoded, err := json.Marshal(rebuild)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{
		"raw private root answer", "failed question", "failed answer",
		"current pre-dispatch", "must be excluded",
	} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("rebuild contains %q: %s", forbidden, encoded)
		}
	}
	if _, err := ledger.AuthorizeArtifactIDs([]string{"artifact-other"}); !errors.Is(err, ErrConversationArtifactOwnership) {
		t.Fatalf("unauthorized artifact error = %v", err)
	}
	if _, err := BuildConversationLedger(context.Background(), "bob", dialogueID); !errors.Is(err, ErrConversationLedgerNotFound) {
		t.Fatalf("cross-owner rebuild error = %v", err)
	}
}

func TestHistoryRootDeleteBlocksResolveDialogueAndRefresh(t *testing.T) {
	gdb := setupExpertTestDB(t)
	dialogueID := "22222222-2222-4222-8222-222222222222"
	root := model.QuestionAgentLog{
		DialogueId: dialogueID, UserName: "alice", Query: "deleted root",
		Status: statusSucceeded, Mode: "instant", ToolName: "ChatAgent",
		BotReportRevision: -1,
	}
	if err := gdb.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	if err := gdb.Model(&model.QuestionAgentLog{}).
		Where("id = ?", root.Id).
		Update("delete_at", "2026-07-29 00:00:00").Error; err != nil {
		t.Fatal(err)
	}
	child := model.QuestionAgentLog{
		DialogueId: dialogueID, FId: root.Id, UserName: "alice",
		Query: "live child", Status: statusSucceeded, Mode: "instant",
		ToolName: "ChatAgent", BotReportRevision: -1,
	}
	if err := gdb.Create(&child).Error; err != nil {
		t.Fatal(err)
	}

	service := NewService()
	for _, input := range []QueryInput{
		{Id: root.Id},
		{RefreshId: child.Id},
	} {
		if _, _, err := service.resolveDialogue(context.Background(), "alice", input); !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Fatalf("resolve deleted root input=%#v error=%v", input, err)
		}
	}
}
