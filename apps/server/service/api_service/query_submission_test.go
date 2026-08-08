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
	"sync"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

func v1SubmissionServer(
	t *testing.T,
	handler func(http.ResponseWriter, *http.Request),
) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(handler))
	t.Cleanup(server.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true, ExpertEnabled: true,
		StreamEnabled: true, MultiturnV1Enabled: true, TimeoutSeconds: 2,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })
	return server
}

func distinctQueryAttachmentRefs(count int) []rxBot.AssetAttachmentRef {
	refs := make([]rxBot.AssetAttachmentRef, count)
	for index := range refs {
		refs[index].AssetID = fmt.Sprintf("file_%03d", index)
	}
	return refs
}

const (
	longResearchPaperMarker = "Synthetic paper abstract: rice root development evidence."
	longResearchPathMarker  = "scrubbed-bucket/synthetic-study/late/reads.fastq.gz"
)

type gatedResearchCatalogReader struct {
	started  chan struct{}
	release  chan struct{}
	startOne sync.Once
	calls    atomic.Int64
}

func (reader *gatedResearchCatalogReader) GetAgents(ctx context.Context) (*rxBot.AgentsListResponse, error) {
	reader.calls.Add(1)
	reader.startOne.Do(func() { close(reader.started) })
	select {
	case <-reader.release:
		return validResearchCapabilityCatalog(), nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func syntheticLongResearchQuery(t *testing.T) string {
	t.Helper()
	prefix := "\n\t  " + longResearchPaperMarker + "  \n"
	suffix := "\n" + longResearchPathMarker
	fillerCount := rxBot.DefaultMaxUserQueryChars - utf8.RuneCountInString(prefix) - utf8.RuneCountInString(suffix)
	if fillerCount < 1 {
		t.Fatal("synthetic Research markers exceed the query boundary")
	}
	query := prefix + strings.Repeat("\u7A3B", fillerCount) + suffix
	if got := utf8.RuneCountInString(query); got != rxBot.DefaultMaxUserQueryChars {
		t.Fatalf("synthetic query code points = %d, want %d", got, rxBot.DefaultMaxUserQueryChars)
	}
	return query
}

func seedResearchReplacementTarget(t *testing.T, gdb *gorm.DB) model.QuestionAgentLog {
	t.Helper()
	baseInput := QueryInput{
		Query: "stale Analyst query", Mode: "expert", Tool: "AnalystAgent",
		ClientTurnID: "stale-analyst-client-turn", Surface: QuerySurfaceChat,
	}
	baseTarget := v1SubmissionTarget{
		dialogueID: "98989898-9898-4989-8989-989898989898",
		mode:       "expert", operation: "append",
	}
	raw, err := marshalPersistedProjectionWithContext(
		BotRunProjection{
			RunID: "run-stale-analyst", Agent: "analyst",
			Status: statusSucceeded, ReportRevision: 0,
		},
		&persistedConversationContext{
			ClientTurnID:       baseInput.ClientTurnID,
			RequestFingerprint: submissionRequestFingerprint(baseInput, baseTarget, false),
			ModeLockState:      "locked",
		},
	)
	if err != nil {
		t.Fatalf("encode replacement target projection: %v", err)
	}
	row := model.QuestionAgentLog{
		DialogueId:        baseTarget.dialogueID,
		UserName:          "alice",
		Query:             baseInput.Query,
		Answer:            "stale Analyst answer",
		ToolName:          baseInput.Tool,
		Status:            statusSucceeded,
		Mode:              "expert",
		BotRunId:          "run-stale-analyst",
		BotProjectionJSON: raw,
		BotReportRevision: 0,
		ReactionType:      "0",
		CollectType:       "0",
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatalf("seed Research replacement target: %v", err)
	}
	return row
}

func TestLongResearchV1CurrentMessageBoundary(t *testing.T) {
	previousConfig := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{MaxQueryChars: rxBot.DefaultMaxUserQueryChars}
	t.Cleanup(func() { rxBot.BotConfig = previousConfig })

	query := syntheticLongResearchQuery(t)
	if err := validateV1CurrentMessage(query); err != nil {
		t.Fatalf("exact Research boundary rejected: %v", err)
	}
	if !errors.Is(validateV1CurrentMessage(query+"\u7A3B"), ErrInvalidChatRouting) {
		t.Fatal("Research query above the configured V1 boundary was accepted")
	}
}

func TestV1AllocationAcceptsWorstCaseJSONEscapingForAppendAndReplace(t *testing.T) {
	gdb := setupExpertTestDB(t)
	previousConfig := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		MaxQueryChars:      rxBot.HardMaxUserQueryChars,
		MultiturnV1Enabled: true,
	}
	t.Cleanup(func() { rxBot.BotConfig = previousConfig })

	query := strings.Repeat("<", rxBot.HardMaxUserQueryChars)
	dialogueID := "77777777-7777-4777-8777-777777777777"
	service := NewService()
	appendSubmission, err := service.allocateV1Submission(
		context.Background(),
		"alice",
		QueryInput{
			Query: query, Mode: "instant", ClientTurnID: "escape-append-1",
		},
		v1SubmissionTarget{
			dialogueID: dialogueID,
			mode:       "instant",
			operation:  "append",
		},
		AgentPermissionResolution{AllowedTools: []string{"ChatAgent"}},
		false,
	)
	if err != nil {
		t.Fatalf("allocate hard-limit append: %v", err)
	}
	if appendSubmission.row.Query != query {
		t.Fatal("hard-limit append query was not persisted exactly")
	}
	if err := gdb.Model(&model.QuestionAgentLog{}).
		Where("id = ?", appendSubmission.row.Id).
		Update("status", statusSucceeded).Error; err != nil {
		t.Fatalf("accept append row for replacement: %v", err)
	}

	replaceSubmission, err := service.allocateV1Submission(
		context.Background(),
		"alice",
		QueryInput{
			Query: query, Mode: "instant", ClientTurnID: "escape-replace-1",
			RefreshId: appendSubmission.row.Id,
		},
		v1SubmissionTarget{
			dialogueID: dialogueID,
			mode:       "instant",
			operation:  "replace",
		},
		AgentPermissionResolution{AllowedTools: []string{"ChatAgent"}},
		false,
	)
	if err != nil {
		t.Fatalf("allocate hard-limit replacement: %v", err)
	}
	private, err := LoadBotConversationContext(
		context.Background(),
		"alice",
		replaceSubmission.row.Id,
	)
	if err != nil {
		t.Fatalf("load hard-limit replacement: %v", err)
	}
	if private.Replacement == nil || private.Replacement.Query != query ||
		private.Replacement.RequestFingerprint == "" ||
		private.Replacement.RequestFingerprint != replaceSubmission.requestFingerprint {
		t.Fatal("hard-limit replacement did not persist its exact bounded query and request fingerprint")
	}
}

func TestQuerySubmissionAttachmentRefsUseManagedLimit(t *testing.T) {
	refs := distinctQueryAttachmentRefs(64)
	got, err := validateQueryAttachments(refs)
	if err != nil {
		t.Fatalf("64 refs rejected: %v", err)
	}
	if len(got) != 64 || got[0].AssetID != "file_000" || got[63].AssetID != "file_063" {
		t.Fatalf("refs lost order: first=%q last=%q len=%d", got[0].AssetID, got[63].AssetID, len(got))
	}
	got[0].AssetID = "file_mutated"
	if refs[0].AssetID != "file_000" {
		t.Fatal("query attachment validation returned an aliased slice")
	}
	if got, err := validateQueryAttachments(distinctQueryAttachmentRefs(65)); err == nil || got != nil {
		t.Fatalf("65 refs accepted as %#v, err=%v", got, err)
	}
}

func TestQueryStreamRetainsDefaultAttachmentLimit(t *testing.T) {
	_, err := NewService().QueryStream(
		context.Background(),
		"stream@example.com",
		QueryInput{
			Query:       "stream query",
			Mode:        "instant",
			Tool:        "ChatAgent",
			Surface:     QuerySurfaceChat,
			Attachments: distinctQueryAttachmentRefs(65),
		},
		nil,
		nil,
	)
	if !errors.Is(err, ErrInvalidQueryAttachments) {
		t.Fatalf("QueryStream error=%v, want ErrInvalidQueryAttachments", err)
	}
}

func TestQuerySubmissionPersistsBeforeBotAndUsesStableTurnIdentity(t *testing.T) {
	gdb := setupExpertTestDB(t)
	rawQuery := "\n\t  Rice root atlas   reproduction \n" + strings.Repeat("x", 500)
	var (
		mu       sync.Mutex
		calls    int
		captured rxBot.ChatCompletionRequest
	)
	v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		calls++
		var count int64
		if err := gdb.Model(&model.QuestionAgentLog{}).
			Where("status = ?", "SUBMITTING").
			Count(&count).Error; err != nil {
			t.Errorf("count submitting rows: %v", err)
		}
		if count != 1 {
			t.Errorf("submitting rows before Bot = %d, want 1", count)
		}
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Errorf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chat-1","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"ok"}}],"formatted":{"answer":"ok"}}`))
	})

	input := QueryInput{
		Query: rawQuery, Mode: "instant", Tool: "DataAgent",
		ClientTurnID: "stable-turn-1",
	}
	first, err := NewService().Query(context.Background(), "alice", input)
	if err != nil {
		t.Fatalf("first Query: %v", err)
	}
	second, err := NewService().Query(context.Background(), "alice", input)
	if err != nil {
		t.Fatalf("retry Query: %v", err)
	}
	if first.Id != second.Id || first.DialogueId != second.DialogueId {
		t.Fatalf("retry identity changed: first=%+v second=%+v", first, second)
	}
	if calls != 1 {
		t.Fatalf("Bot calls = %d, want 1", calls)
	}
	if captured.Conversation == nil {
		t.Fatal("missing V1 conversation envelope")
	}
	if captured.Conversation.TurnID != "1" || captured.Conversation.LedgerCursor != 1 {
		t.Fatalf("turn identity = %q/%d, want 1/1",
			captured.Conversation.TurnID,
			captured.Conversation.LedgerCursor,
		)
	}
	if captured.Conversation.Mode != "instant" ||
		captured.Conversation.RequestedAgentID == nil ||
		*captured.Conversation.RequestedAgentID != "ChatAgent" {
		t.Fatalf("instant routing was not locked: %#v", captured.Conversation)
	}
	var row model.QuestionAgentLog
	if err := gdb.First(&row, first.Id).Error; err != nil {
		t.Fatal(err)
	}
	if row.Query != rawQuery {
		t.Fatal("submission changed the stored raw query")
	}
	if row.TitleQuery != "Rice root atlas reproduction" {
		t.Fatalf("stored title = %q", row.TitleQuery)
	}
	private, err := LoadBotConversationContext(context.Background(), "alice", row.Id)
	if err != nil {
		t.Fatal(err)
	}
	if private.ClientTurnID != input.ClientTurnID {
		t.Fatalf("stored client turn = %q, want %q", private.ClientTurnID, input.ClientTurnID)
	}
}

func seedFingerprintParent(t *testing.T, gdb *gorm.DB, dialogueID, query string) model.QuestionAgentLog {
	t.Helper()
	row := model.QuestionAgentLog{
		DialogueId: dialogueID, UserName: "alice", Query: query,
		Answer: "accepted parent", ToolName: "ChatAgent", Status: statusSucceeded,
		Mode: "instant", BotReportRevision: -1,
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatalf("seed fingerprint parent: %v", err)
	}
	return row
}

func TestOwnerSubmissionFingerprintRejectsBehaviorMutation(t *testing.T) {
	for _, tc := range []struct {
		name       string
		initial    QueryInput
		mutate     func(QueryInput, model.QuestionAgentLog, model.QuestionAgentLog) QueryInput
		wantExact  bool
		seedParent bool
	}{
		{
			name: "append parent N to zero", seedParent: true,
			mutate: func(in QueryInput, _, _ model.QuestionAgentLog) QueryInput { in.Id = 0; return in },
		},
		{
			name: "append parent N to other", seedParent: true,
			mutate: func(in QueryInput, _, other model.QuestionAgentLog) QueryInput { in.Id = other.Id; return in },
		},
		{
			name:   "append parent zero to N",
			mutate: func(in QueryInput, parent, _ model.QuestionAgentLog) QueryInput { in.Id = parent.Id; return in },
		},
		{
			name:    "forced Knowledge to Review",
			initial: QueryInput{Mode: "expert", Tool: "KnowledgeAgent"},
			mutate:  func(in QueryInput, _, _ model.QuestionAgentLog) QueryInput { in.Tool = "ReviewAgent"; return in },
		},
		{
			name:    "forced Knowledge to autonomous",
			initial: QueryInput{Mode: "expert", Tool: "KnowledgeAgent"},
			mutate:  func(in QueryInput, _, _ model.QuestionAgentLog) QueryInput { in.Tool = ""; return in },
		},
		{
			name:    "V0 history mutation",
			initial: QueryInput{History: `[{"role":"user","content":"accepted history"}]`},
			mutate: func(in QueryInput, _, _ model.QuestionAgentLog) QueryInput {
				in.History = `[{"role":"user","content":"changed history"}]`
				return in
			},
		},
		{
			name: "ordered attachment mutation",
			initial: QueryInput{Attachments: []rxBot.AssetAttachmentRef{
				{AssetID: "file_order_a"},
				{AssetID: "file_order_b"},
			}},
			mutate: func(in QueryInput, _, _ model.QuestionAgentLog) QueryInput {
				in.Attachments = []rxBot.AssetAttachmentRef{
					{AssetID: "file_order_b"},
					{AssetID: "file_order_a"},
				}
				return in
			},
		},
		{
			name: "exact controls reuse", seedParent: true, wantExact: true,
			mutate: func(in QueryInput, _, _ model.QuestionAgentLog) QueryInput { return in },
		},
		{
			name: "canonical empty controls reuse", wantExact: true,
			mutate: func(in QueryInput, _, _ model.QuestionAgentLog) QueryInput {
				in.History = "[]"
				in.InteropMode = "off"
				in.InteropTargets = []string{}
				in.Attachments = []rxBot.AssetAttachmentRef{}
				in.ArtifactIDs = []string{}
				return in
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			parent := seedFingerprintParent(t, gdb, "fingerprint-parent-a", "parent A")
			other := seedFingerprintParent(t, gdb, "fingerprint-parent-b", "parent B")
			var botCalls atomic.Int64
			v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
				botCalls.Add(1)
				if r.URL.Path != "/v1/chat/completions" {
					t.Errorf("Bot path=%q, want chat completions", r.URL.Path)
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"id":"run-fingerprint","object":"chat.completion","choices":[{"message":{"role":"assistant","content":"fingerprinted"}}]}`))
			})
			rxBot.BotConfig.MultiturnV1Enabled = false
			input := tc.initial
			input.Query = "fingerprint request"
			input.ClientTurnID = "fingerprint-" + strings.ReplaceAll(tc.name, " ", "-")
			input.Surface = QuerySurfaceChat
			if input.Mode == "" {
				input.Mode = "instant"
			}
			if tc.seedParent {
				input.Id = parent.Id
			}
			service := NewService()
			first, err := service.Query(context.Background(), "alice", input)
			if err != nil {
				t.Fatalf("initial Query: %v", err)
			}
			retryInput := tc.mutate(input, parent, other)
			retry, retryErr := service.Query(context.Background(), "alice", retryInput)
			if tc.wantExact {
				if retryErr != nil || retry == nil || retry.Id != first.Id {
					t.Fatalf("exact retry=%+v error=%v, want row %d", retry, retryErr, first.Id)
				}
			} else if retry != nil || !errors.Is(retryErr, ErrDuplicateClientTurn) {
				t.Fatalf("mutated retry=%+v error=%v, want ErrDuplicateClientTurn", retry, retryErr)
			}
			if botCalls.Load() != 1 {
				t.Fatalf("Bot calls=%d, want 1", botCalls.Load())
			}
			var rows int64
			if err := gdb.Model(&model.QuestionAgentLog{}).Count(&rows).Error; err != nil || rows != 3 {
				t.Fatalf("rows=%d error=%v, want two parents plus one submission", rows, err)
			}
		})
	}
}

func TestV1ArtifactMutationConflictsWithAcceptedClientTurn(t *testing.T) {
	gdb := setupExpertTestDB(t)
	const dialogueID = "67676767-6767-4676-8676-676767676767"
	seedV1ConversationRoot(t, gdb, "alice", dialogueID)
	private, err := LoadBotConversationContext(context.Background(), "alice", 1)
	if err != nil {
		t.Fatal(err)
	}
	private.ArtifactRefs = append(private.ArtifactRefs, rxBot.ArtifactRefV1{
		ArtifactID: "entity-artifact-2", DisplayName: "second-results.csv",
	})
	if err := SaveBotConversationContext(context.Background(), "alice", 1, private); err != nil {
		t.Fatal(err)
	}
	var chatCalls atomic.Int64
	v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/chat/completions":
			chatCalls.Add(1)
			var request rxBot.ChatCompletionRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Errorf("decode V1 artifact request: %v", err)
				return
			}
			stage := rxBot.ContextStageMetadata{
				SchemaVersion: 1, TurnID: request.Conversation.TurnID,
				SelectedAgentID: "ChatAgent", RouteSource: "instant_lock", RouteReasonCode: "INSTANT_LOCK",
				BaseBusinessContextVersion:     request.Conversation.BaseBusinessContextVersion,
				ProposedBusinessContextVersion: request.Conversation.BaseBusinessContextVersion + 1,
				LastAppliedLedgerCursor:        request.Conversation.LedgerCursor,
			}
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"id": "run-artifact-fingerprint", "object": "chat.completion",
				"choices":              []map[string]interface{}{{"message": map[string]string{"role": "assistant", "content": "ok"}}},
				"conversation_context": stage,
			})
		case "/v1/conversation-context/settle":
			_ = json.NewEncoder(w).Encode(rxBot.ContextMutationResponse{SchemaVersion: 1, State: "committed", ContextVersion: 2})
		default:
			http.NotFound(w, r)
		}
	})
	input := QueryInput{
		Query: "artifact fingerprint", Id: 1, Mode: "instant",
		ClientTurnID: "artifact-fingerprint-key", ArtifactIDs: []string{v1ConversationArtifactID},
		Surface: QuerySurfaceChat,
	}
	first, err := NewService().Query(context.Background(), "alice", input)
	if err != nil {
		t.Fatalf("initial artifact Query: %v", err)
	}
	changed := input
	changed.ArtifactIDs = []string{"entity-artifact-2"}
	if retry, err := NewService().Query(context.Background(), "alice", changed); retry != nil || !errors.Is(err, ErrDuplicateClientTurn) {
		t.Fatalf("artifact mutation retry=%+v error=%v, want duplicate", retry, err)
	}
	if chatCalls.Load() != 1 {
		t.Fatalf("Bot calls=%d, want 1", chatCalls.Load())
	}
	var rows int64
	if err := gdb.Model(&model.QuestionAgentLog{}).Count(&rows).Error; err != nil || rows != 2 {
		t.Fatalf("rows=%d error=%v, want root plus one submission", rows, err)
	}
	if first.Id == 0 {
		t.Fatal("initial artifact submission has no durable id")
	}
}

func TestOwnerSubmissionFingerprintRejectsResolverMutation(t *testing.T) {
	gdb := setupExpertTestDB(t)
	var botCalls atomic.Int64
	v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
		botCalls.Add(1)
		if r.URL.Path != "/v1/agents/design/runs" {
			t.Errorf("Bot path=%q, want Design run", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"id":"run-resolver-fingerprint","object":"agent.run","agent":"design","status":"running","task_ids":[],"result":{}}`))
	})
	rxBot.BotConfig.MultiturnV1Enabled = false
	rxBot.BotConfig.DesignEnabled = true
	input := QueryInput{
		Query: "design a guide", Tool: "DigitalDesignAgent", Mode: "expert",
		Surface: QuerySurfaceChat, ClientTurnID: "resolver-fingerprint-key",
		GeneID: "AT1G01010", SpeciesCode: "ath",
	}
	service := NewService()
	first, err := service.Query(context.Background(), "alice", input)
	if err != nil {
		t.Fatalf("initial Design Query: %v", err)
	}
	changed := input
	changed.GeneID = "AT2G02020"
	if retry, err := service.Query(context.Background(), "alice", changed); retry != nil || !errors.Is(err, ErrDuplicateClientTurn) {
		t.Fatalf("resolver mutation retry=%+v error=%v, want ErrDuplicateClientTurn", retry, err)
	}
	if botCalls.Load() != 1 {
		t.Fatalf("Bot calls=%d, want 1", botCalls.Load())
	}
	var rows int64
	if err := gdb.Model(&model.QuestionAgentLog{}).Count(&rows).Error; err != nil || rows != 1 {
		t.Fatalf("rows=%d error=%v, want 1", rows, err)
	}
	if first.Id == 0 {
		t.Fatal("initial resolver submission has no durable id")
	}
}

func TestLongResearchSubmissionPreservesRawQueryAndDuplicateClientTurn(t *testing.T) {
	gdb := setupExpertTestDB(t)
	rawQuery := syntheticLongResearchQuery(t)
	var calls int
	v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/v1/agents/research/runs" {
			t.Errorf("Bot path = %q, want Research run", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"id":"run-long-research","object":"agent.run","agent":"research","status":"running","task_ids":["child-long-research"],"result":{}}`))
	})
	rxBot.BotConfig.ResearchEnabled = true
	service := &Service{
		catalogReader: staticResearchCatalogReader{response: validResearchCapabilityCatalog()},
	}
	input := QueryInput{
		Query:        rawQuery,
		Mode:         "expert",
		Tool:         "InSilicoResearchAgent",
		ClientTurnID: "long-research-turn-1",
	}

	first, err := service.Query(context.Background(), "alice", input)
	if err != nil {
		t.Fatalf("first long Research submission: %v", err)
	}
	second, err := service.Query(context.Background(), "alice", input)
	if err != nil {
		t.Fatalf("duplicate long Research submission: %v", err)
	}
	if first.Id != second.Id || first.BotRunID != second.BotRunID || first.BotRunID != "run-long-research" {
		t.Fatalf("duplicate identity changed: rows=%d/%d same_run=%t", first.Id, second.Id, first.BotRunID == second.BotRunID)
	}
	if calls != 1 {
		t.Fatalf("Bot submissions = %d, want 1", calls)
	}

	var row model.QuestionAgentLog
	if err := gdb.First(&row, first.Id).Error; err != nil {
		t.Fatalf("read long Research row: %v", err)
	}
	if row.Query != rawQuery {
		t.Fatal("persisted query differs from the authored Research query")
	}
	if row.TitleQuery != longResearchPaperMarker || utf8.RuneCountInString(row.TitleQuery) > 160 {
		t.Fatalf("stored title is not the bounded first meaningful line: code_points=%d", utf8.RuneCountInString(row.TitleQuery))
	}
	if strings.Contains(row.TitleQuery, longResearchPathMarker) {
		t.Fatal("stored title retained the late path-like marker")
	}
	var count int64
	if err := gdb.Model(&model.QuestionAgentLog{}).Count(&count).Error; err != nil {
		t.Fatalf("count long Research rows: %v", err)
	}
	if count != 1 {
		t.Fatalf("persisted rows = %d, want 1", count)
	}
}

func TestDedicatedResearchSubmissionReusesClientTurnRowAndRun(t *testing.T) {
	gdb := setupExpertTestDB(t)
	var (
		calls    int
		captured rxBot.AgentRunRequest
	)
	v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/v1/agents/research/runs" {
			t.Errorf("Bot path = %q, want Research run", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Errorf("decode dedicated Research request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"id":"run-dedicated-research","object":"agent.run","agent":"research","status":"running","task_ids":["child-dedicated-research"],"result":{}}`))
	})
	rxBot.BotConfig.ResearchEnabled = true
	service := &Service{
		catalogReader: staticResearchCatalogReader{response: validResearchCapabilityCatalog()},
	}
	input := QueryInput{
		Query:        "Reproduce the submitted paper",
		Mode:         "instant",
		Tool:         "InSilicoResearchAgent",
		ClientTurnID: "dedicated-research-turn-1",
		Surface:      QuerySurfaceAgentProduct,
		Attachments:  []rxBot.AssetAttachmentRef{{AssetID: "file_dedicated_research"}},
	}

	first, err := service.Query(context.Background(), "alice", input)
	if err != nil {
		t.Fatalf("first dedicated Research submission: %v", err)
	}
	second, err := service.Query(context.Background(), "alice", input)
	if err != nil {
		t.Fatalf("duplicate dedicated Research submission: %v", err)
	}
	if first.Id != second.Id || first.BotRunID != second.BotRunID || first.BotRunID != "run-dedicated-research" {
		t.Fatalf("duplicate identity changed: first=%+v second=%+v", first, second)
	}
	if calls != 1 {
		t.Fatalf("Bot submissions = %d, want 1", calls)
	}
	if captured.Conversation == nil ||
		captured.Conversation.TurnID != "1" ||
		captured.Conversation.CurrentMessage.Content != input.Query ||
		captured.Conversation.RequestedAgentID == nil ||
		*captured.Conversation.RequestedAgentID != input.Tool {
		t.Fatalf("dedicated Research conversation metadata = %#v", captured.Conversation)
	}
	var row model.QuestionAgentLog
	if err := gdb.First(&row, first.Id).Error; err != nil {
		t.Fatalf("read dedicated Research row: %v", err)
	}
	if row.Query != input.Query || row.ToolName != input.Tool || row.Mode != "instant" {
		t.Fatalf("stored dedicated Research row = %#v", row)
	}
}

func TestDedicatedResearchSubmissionReusesClientTurnWithoutConversationV1(t *testing.T) {
	gdb := setupExpertTestDB(t)
	var (
		calls    int
		captured rxBot.AgentRunRequest
	)
	v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Errorf("decode dedicated Research request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"id":"run-research-no-conversation-v1","object":"agent.run","agent":"research","status":"running","task_ids":["child-research-no-conversation-v1"],"result":{}}`))
	})
	rxBot.BotConfig.ResearchEnabled = true
	rxBot.BotConfig.MultiturnV1Enabled = false
	service := &Service{
		catalogReader: staticResearchCatalogReader{response: validResearchCapabilityCatalog()},
	}
	input := QueryInput{
		Query:        "Reproduce the submitted paper without conversation V1",
		Mode:         "instant",
		Tool:         "InSilicoResearchAgent",
		ClientTurnID: "dedicated-research-no-conversation-v1",
		Surface:      QuerySurfaceAgentProduct,
		Attachments:  []rxBot.AssetAttachmentRef{{AssetID: "file_research_no_conversation_v1"}},
	}

	first, err := service.Query(context.Background(), "alice", input)
	if err != nil {
		t.Fatalf("first dedicated Research submission: %v", err)
	}
	second, err := service.Query(context.Background(), "alice", input)
	if err != nil {
		t.Fatalf("duplicate dedicated Research submission: %v", err)
	}
	if first.Id != second.Id || first.BotRunID != second.BotRunID || first.BotRunID != "run-research-no-conversation-v1" {
		t.Fatalf("duplicate identity changed: first=%+v second=%+v", first, second)
	}
	if calls != 1 {
		t.Fatalf("Bot submissions = %d, want 1", calls)
	}
	if captured.Conversation != nil {
		t.Fatalf("conversation V1 leaked while disabled: %#v", captured.Conversation)
	}
	var count int64
	if err := gdb.Model(&model.QuestionAgentLog{}).Count(&count).Error; err != nil {
		t.Fatalf("count dedicated Research rows: %v", err)
	}
	if count != 1 {
		t.Fatalf("persisted rows = %d, want 1", count)
	}
}

func TestForcedChatResearchRequiresClientTurnWithoutConversationV1(t *testing.T) {
	gdb := setupExpertTestDB(t)
	var calls int
	v1SubmissionServer(t, func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"id":"unexpected-run","object":"agent.run","agent":"research","status":"running","task_ids":[],"result":{}}`))
	})
	rxBot.BotConfig.ResearchEnabled = true
	rxBot.BotConfig.MultiturnV1Enabled = false
	service := &Service{
		catalogReader: staticResearchCatalogReader{response: validResearchCapabilityCatalog()},
	}

	_, err := service.Query(context.Background(), "alice", QueryInput{
		Query:   "Reproduce the submitted paper",
		Mode:    "expert",
		Tool:    "InSilicoResearchAgent",
		Surface: QuerySurfaceChat,
	})
	if !errors.Is(err, ErrInvalidClientTurnID) {
		t.Fatalf("missing client turn error = %v, want ErrInvalidClientTurnID", err)
	}
	if calls != 0 {
		t.Fatalf("Bot submissions = %d, want 0", calls)
	}
	var count int64
	if err := gdb.Model(&model.QuestionAgentLog{}).Count(&count).Error; err != nil {
		t.Fatalf("count forced Research rows: %v", err)
	}
	if count != 0 {
		t.Fatalf("persisted rows = %d, want 0", count)
	}
}

func TestForcedChatResearchSubmissionUsesOwnerAllocation(t *testing.T) {
	for _, tc := range []struct {
		name             string
		conversationV1   bool
		wantConversation bool
	}{
		{name: "default config", conversationV1: false, wantConversation: false},
		{name: "conversation V1", conversationV1: true, wantConversation: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			var (
				calls    int
				captured rxBot.AgentRunRequest
			)
			v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.URL.Path != "/v1/agents/research/runs" {
					t.Errorf("Bot path = %q, want Research run", r.URL.Path)
				}
				if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
					t.Errorf("decode forced Research request: %v", err)
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusAccepted)
				_, _ = w.Write([]byte(`{"id":"run-forced-research","object":"agent.run","agent":"research","status":"running","task_ids":["child-forced-research"],"result":{}}`))
			})
			rxBot.BotConfig.ResearchEnabled = true
			rxBot.BotConfig.MultiturnV1Enabled = tc.conversationV1
			service := &Service{
				catalogReader: staticResearchCatalogReader{response: validResearchCapabilityCatalog()},
			}
			input := QueryInput{
				Query:        "Reproduce the submitted paper from Chat Expert",
				Mode:         "expert",
				Tool:         "InSilicoResearchAgent",
				ClientTurnID: "forced-research-owner-turn",
				Surface:      QuerySurfaceChat,
			}

			first, err := service.Query(context.Background(), "alice", input)
			if err != nil {
				t.Fatalf("first forced Research submission: %v", err)
			}
			retry, err := service.Query(context.Background(), "alice", input)
			if err != nil {
				t.Fatalf("same fingerprint retry: %v", err)
			}
			if retry.Id != first.Id || retry.BotRunID != first.BotRunID {
				t.Fatalf("retry identity changed: first=%+v retry=%+v", first, retry)
			}
			if calls != 1 {
				t.Fatalf("Bot submissions after retry = %d, want 1", calls)
			}
			if got := captured.Conversation != nil; got != tc.wantConversation {
				t.Fatalf("conversation envelope present = %v, want %v", got, tc.wantConversation)
			}

			conflict := input
			conflict.Query = "Reproduce a different paper from Chat Expert"
			if _, err := service.Query(context.Background(), "alice", conflict); !errors.Is(err, ErrDuplicateClientTurn) {
				t.Fatalf("conflicting fingerprint error = %v, want ErrDuplicateClientTurn", err)
			}
			if calls != 1 {
				t.Fatalf("Bot submissions after conflict = %d, want 1", calls)
			}

			otherOwner, err := service.Query(context.Background(), "bob@example.com", input)
			if err != nil {
				t.Fatalf("other owner submission: %v", err)
			}
			if otherOwner.Id == first.Id {
				t.Fatalf("owner-scoped client turn reused row %d", first.Id)
			}
			if calls != 2 {
				t.Fatalf("Bot submissions after other owner = %d, want 2", calls)
			}
			var count int64
			if err := gdb.Model(&model.QuestionAgentLog{}).Count(&count).Error; err != nil {
				t.Fatalf("count forced Research rows: %v", err)
			}
			if count != 2 {
				t.Fatalf("persisted rows = %d, want 2", count)
			}
		})
	}
}

func TestForcedChatResearchClientTurnUsesRequestedInteropFingerprint(t *testing.T) {
	for _, tc := range []struct {
		name              string
		inputMode         string
		inputTargets      []string
		mutateRetry       func(*QueryInput)
		wantConflict      bool
		wantStoredMode    string
		wantStoredTargets []string
	}{
		{
			name:              "same requested controls retry",
			inputMode:         "auto",
			inputTargets:      []string{"mcp-peer"},
			wantStoredMode:    "auto",
			wantStoredTargets: []string{"mcp-peer"},
		},
		{
			name:           "requested mode conflict",
			inputMode:      "off",
			mutateRetry:    func(in *QueryInput) { in.InteropMode = "auto" },
			wantConflict:   true,
			wantStoredMode: "off",
		},
		{
			name:              "requested targets conflict",
			inputMode:         "auto",
			inputTargets:      []string{"mcp-peer"},
			mutateRetry:       func(in *QueryInput) { in.InteropTargets = []string{"mcp-other"} },
			wantConflict:      true,
			wantStoredMode:    "auto",
			wantStoredTargets: []string{"mcp-peer"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setupExpertTestDB(t)
			h := newInteropDelegationServer(t, http.StatusServiceUnavailable, "unavailable")
			h.configure(t)
			rxBot.BotConfig.ExpertEnabled = true
			rxBot.BotConfig.MultiturnV1Enabled = false
			service := &Service{
				catalogReader: staticResearchCatalogReader{response: validResearchCapabilityCatalog()},
			}
			input := QueryInput{
				Query:          "Reproduce with requested interop controls",
				Mode:           "expert",
				Tool:           "InSilicoResearchAgent",
				ClientTurnID:   "forced-research-interop-" + strings.ReplaceAll(tc.name, " ", "-"),
				Surface:        QuerySurfaceChat,
				InteropMode:    tc.inputMode,
				InteropTargets: append([]string(nil), tc.inputTargets...),
			}

			first, err := service.Query(context.Background(), "alice", input)
			if err != nil {
				t.Fatalf("first forced Research submission: %v", err)
			}
			private, err := LoadBotConversationContext(context.Background(), "alice", first.Id)
			if err != nil {
				t.Fatalf("load forced Research fingerprint: %v", err)
			}
			if private.InteropMode != tc.wantStoredMode ||
				!reflect.DeepEqual(private.InteropTargets, tc.wantStoredTargets) {
				t.Fatalf("stored requested controls = %q/%#v, want %q/%#v",
					private.InteropMode, private.InteropTargets,
					tc.wantStoredMode, tc.wantStoredTargets,
				)
			}
			args := h.arguments()
			if args["interop_mode"] != "off" {
				t.Fatalf("Bot effective interop_mode = %#v, want off", args["interop_mode"])
			}
			if targets, ok := args["interop_targets"].([]interface{}); !ok || len(targets) != 0 {
				t.Fatalf("Bot effective interop_targets = %#v, want empty", args["interop_targets"])
			}

			retryInput := input
			retryInput.InteropTargets = append([]string(nil), input.InteropTargets...)
			if tc.mutateRetry != nil {
				tc.mutateRetry(&retryInput)
			}
			retry, err := service.Query(context.Background(), "alice", retryInput)
			if tc.wantConflict {
				if retry != nil || !errors.Is(err, ErrDuplicateClientTurn) {
					t.Fatalf("changed requested controls result=%+v error=%v, want ErrDuplicateClientTurn", retry, err)
				}
			} else {
				if err != nil {
					t.Fatalf("same requested controls retry: %v", err)
				}
				if retry.Id != first.Id || retry.BotRunID != first.BotRunID {
					t.Fatalf("same requested controls changed identity: first=%+v retry=%+v", first, retry)
				}
			}
			if got := h.submissionHits.Load(); got != 1 {
				t.Fatalf("Research submissions = %d, want 1", got)
			}
		})
	}
}

func TestAcceptedResearchRetryBypassesLiveInteropDiscovery(t *testing.T) {
	for _, tc := range []struct {
		name    string
		mode    string
		surface QuerySurface
	}{
		{name: "forced Chat Expert", mode: "expert", surface: QuerySurfaceChat},
		{name: "dedicated product", mode: "instant", surface: QuerySurfaceAgentProduct},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			var (
				discoveryFails  atomic.Bool
				discoveryCalls  atomic.Int64
				submissionCalls atomic.Int64
			)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch {
				case r.Method == http.MethodGet && r.URL.Path == "/v1/interop/capabilities":
					discoveryCalls.Add(1)
					if discoveryFails.Load() {
						w.WriteHeader(http.StatusServiceUnavailable)
						return
					}
					_, _ = w.Write([]byte(`{"object":"list","data":[{"target_id":"mcp-peer","kind":"mcp","status":"available"}],"errors":[]}`))
				case r.Method == http.MethodPost && r.URL.Path == "/v1/agents/research/runs":
					submissionCalls.Add(1)
					var request rxBot.AgentRunRequest
					if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
						t.Errorf("decode Research submission: %v", err)
						return
					}
					if request.Arguments["interop_mode"] != "required" ||
						!reflect.DeepEqual(request.Arguments["interop_targets"], []interface{}{"mcp-peer"}) {
						t.Errorf("Bot effective controls = %#v/%#v, want required/[mcp-peer]",
							request.Arguments["interop_mode"], request.Arguments["interop_targets"])
					}
					w.WriteHeader(http.StatusAccepted)
					_, _ = w.Write([]byte(`{"id":"run-accepted-research","object":"agent.run","agent":"research","status":"running","task_ids":["child-accepted-research"],"result":{}}`))
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			previous := rxBot.BotConfig
			rxBot.BotConfig = &rxBot.Config{
				BaseURL: server.URL, ProxyEnabled: true, ExpertEnabled: true,
				ResearchEnabled: true, InteropEnabled: true,
				MultiturnV1Enabled: false, TimeoutSeconds: 2,
			}
			t.Cleanup(func() { rxBot.BotConfig = previous })
			service := &Service{
				catalogReader: staticResearchCatalogReader{response: validResearchCapabilityCatalog()},
			}
			input := QueryInput{
				Query:          "Reproduce with required evidence",
				Mode:           tc.mode,
				Tool:           "InSilicoResearchAgent",
				ClientTurnID:   "accepted-research-discovery-" + strings.ReplaceAll(tc.name, " ", "-"),
				Surface:        tc.surface,
				InteropMode:    "required",
				InteropTargets: []string{"mcp-peer"},
			}

			first, err := service.Query(context.Background(), "alice", input)
			if err != nil {
				t.Fatalf("first accepted Research submission: %v", err)
			}
			if discoveryCalls.Load() != 1 || submissionCalls.Load() != 1 {
				t.Fatalf("first calls discovery/submission = %d/%d, want 1/1",
					discoveryCalls.Load(), submissionCalls.Load())
			}

			discoveryFails.Store(true)
			retry, err := service.Query(context.Background(), "alice", input)
			if err != nil {
				t.Fatalf("accepted retry consulted failed discovery: %v", err)
			}
			if retry.Id != first.Id || retry.BotRunID != first.BotRunID {
				t.Fatalf("accepted retry changed identity: first=%+v retry=%+v", first, retry)
			}
			if discoveryCalls.Load() != 1 || submissionCalls.Load() != 1 {
				t.Fatalf("retry calls discovery/submission = %d/%d, want 1/1",
					discoveryCalls.Load(), submissionCalls.Load())
			}

			conflict := input
			conflict.InteropTargets = []string{"mcp-other"}
			if _, err := service.Query(context.Background(), "alice", conflict); !errors.Is(err, ErrDuplicateClientTurn) {
				t.Fatalf("changed fingerprint error = %v, want ErrDuplicateClientTurn", err)
			}
			if discoveryCalls.Load() != 1 || submissionCalls.Load() != 1 {
				t.Fatalf("conflict calls discovery/submission = %d/%d, want 1/1",
					discoveryCalls.Load(), submissionCalls.Load())
			}

			newKey := input
			newKey.ClientTurnID += "-new"
			failed, err := service.Query(context.Background(), "alice", newKey)
			if !errors.Is(err, ErrInteropRequired) || failed == nil || failed.Status != "FAILED" {
				t.Fatalf("new-key discovery failure result=%+v error=%v, want FAILED/ErrInteropRequired", failed, err)
			}
			if discoveryCalls.Load() != 2 || submissionCalls.Load() != 1 {
				t.Fatalf("new-key calls discovery/submission = %d/%d, want 2/1",
					discoveryCalls.Load(), submissionCalls.Load())
			}
			var rows int64
			if err := gdb.Model(&model.QuestionAgentLog{}).Count(&rows).Error; err != nil {
				t.Fatalf("count Research rows: %v", err)
			}
			if rows != 1 {
				t.Fatalf("rows after new-key pre-dispatch failure = %d, want 1", rows)
			}
		})
	}
}

func TestAcceptedResearchRetryBypassesLiveCapabilityAndLimitDrift(t *testing.T) {
	for _, surface := range []struct {
		name    string
		mode    string
		surface QuerySurface
	}{
		{name: "forced Chat Expert", mode: "expert", surface: QuerySurfaceChat},
		{name: "dedicated product", mode: "instant", surface: QuerySurfaceAgentProduct},
	} {
		for _, drift := range []struct {
			name          string
			response      func() *rxBot.AgentsListResponse
			wantNewKeyErr error
		}{
			{
				name:          "catalog becomes incompatible",
				response:      func() *rxBot.AgentsListResponse { return &rxBot.AgentsListResponse{} },
				wantNewKeyErr: ErrResearchInputIncompatible,
			},
			{
				name: "advertised query limit shrinks",
				response: func() *rxBot.AgentsListResponse {
					return researchCatalogWithLimits(4, rxBot.DefaultMaxAssetAttachmentRefs)
				},
				wantNewKeyErr: ErrInvalidChatRouting,
			},
		} {
			t.Run(surface.name+"/"+drift.name, func(t *testing.T) {
				gdb := setupExpertTestDB(t)
				var runCalls atomic.Int64
				v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path != "/v1/agents/research/runs" {
						t.Errorf("Bot path = %q, want Research run", r.URL.Path)
					}
					runCalls.Add(1)
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusAccepted)
					_, _ = w.Write([]byte(`{"id":"run-capability-drift","object":"agent.run","agent":"research","status":"running","task_ids":[],"result":{}}`))
				})
				rxBot.BotConfig.ResearchEnabled = true
				rxBot.BotConfig.MultiturnV1Enabled = false
				reader := &countingResearchCatalogReader{
					response: researchCatalogWithLimits(32, rxBot.DefaultMaxAssetAttachmentRefs),
				}
				service := &Service{catalogReader: reader}
				input := QueryInput{
					Query: "12345678",
					Mode:  surface.mode,
					Tool:  "InSilicoResearchAgent",
					ClientTurnID: "accepted-capability-drift-" +
						strings.ReplaceAll(surface.name+"-"+drift.name, " ", "-"),
					Surface: surface.surface,
				}

				first, err := service.Query(context.Background(), "alice", input)
				if err != nil {
					t.Fatalf("first accepted Research submission: %v", err)
				}
				if reader.calls != 1 || runCalls.Load() != 1 {
					t.Fatalf("first catalog/run calls = %d/%d, want 1/1", reader.calls, runCalls.Load())
				}

				reader.response = drift.response()
				retry, err := service.Query(context.Background(), "alice", input)
				if err != nil {
					t.Fatalf("accepted retry observed live capability drift: %v", err)
				}
				if retry.Id != first.Id || retry.BotRunID != first.BotRunID {
					t.Fatalf("accepted retry changed identity: first=%+v retry=%+v", first, retry)
				}
				if reader.calls != 1 || runCalls.Load() != 1 {
					t.Fatalf("retry catalog/run calls = %d/%d, want 1/1", reader.calls, runCalls.Load())
				}

				conflict := input
				conflict.Query = "changed payload"
				if _, err := service.Query(context.Background(), "alice", conflict); !errors.Is(err, ErrDuplicateClientTurn) {
					t.Fatalf("changed fingerprint error = %v, want ErrDuplicateClientTurn", err)
				}
				if reader.calls != 1 || runCalls.Load() != 1 {
					t.Fatalf("conflict catalog/run calls = %d/%d, want 1/1", reader.calls, runCalls.Load())
				}

				newKey := input
				newKey.ClientTurnID += "-new"
				if _, err := service.Query(context.Background(), "alice", newKey); !errors.Is(err, drift.wantNewKeyErr) {
					t.Fatalf("new-key error = %v, want %v", err, drift.wantNewKeyErr)
				}
				if reader.calls != 2 || runCalls.Load() != 1 {
					t.Fatalf("new-key catalog/run calls = %d/%d, want 2/1", reader.calls, runCalls.Load())
				}
				var rows int64
				if err := gdb.Model(&model.QuestionAgentLog{}).Count(&rows).Error; err != nil {
					t.Fatalf("count Research rows: %v", err)
				}
				if rows != 1 {
					t.Fatalf("rows after drift retry/new key = %d, want 1", rows)
				}
			})
		}
	}
}

func TestResearchDiscoveryFailureRechecksConcurrentAcceptedTurn(t *testing.T) {
	gdb := setupExpertTestDB(t)
	const clientTurnID = "research-discovery-allocation-race"
	projection, err := marshalPersistedProjectionWithContext(
		BotRunProjection{ReportRevision: -1},
		&persistedConversationContext{
			ClientTurnID:   clientTurnID,
			ModeLockState:  "locked",
			InteropMode:    "required",
			InteropTargets: []string{"mcp-peer"},
		},
	)
	if err != nil {
		t.Fatalf("build concurrent Research projection: %v", err)
	}
	var (
		discoveryCalls  atomic.Int64
		submissionCalls atomic.Int64
		seedOnce        sync.Once
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/interop/capabilities":
			discoveryCalls.Add(1)
			seedOnce.Do(func() {
				if err := gdb.Create(&model.QuestionAgentLog{
					DialogueId:        "dialogue-concurrent-research",
					UserName:          "alice",
					Query:             "Reuse a concurrently accepted Research turn",
					ToolName:          "InSilicoResearchAgent",
					Status:            "RUNNING",
					Mode:              "expert",
					BotRunId:          "run-concurrent-research",
					BotProjectionJSON: projection,
					BotReportRevision: -1,
					ReactionType:      "0",
					CollectType:       "0",
				}).Error; err != nil {
					t.Errorf("seed concurrent accepted Research row: %v", err)
				}
			})
			w.WriteHeader(http.StatusServiceUnavailable)
		case r.Method == http.MethodPost && r.URL.Path == "/v1/agents/research/runs":
			submissionCalls.Add(1)
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"run-unexpected-race","object":"agent.run","agent":"research","status":"running","task_ids":[],"result":{}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true, ExpertEnabled: true,
		ResearchEnabled: true, InteropEnabled: true,
		MultiturnV1Enabled: false, TimeoutSeconds: 2,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })
	service := &Service{
		catalogReader: staticResearchCatalogReader{response: validResearchCapabilityCatalog()},
	}

	out, err := service.Query(context.Background(), "alice", QueryInput{
		Query:          "Reuse a concurrently accepted Research turn",
		Mode:           "expert",
		Tool:           "InSilicoResearchAgent",
		ClientTurnID:   clientTurnID,
		Surface:        QuerySurfaceChat,
		InteropMode:    "required",
		InteropTargets: []string{"mcp-peer"},
	})
	if err != nil {
		t.Fatalf("Research retry after discovery/allocation race: %v", err)
	}
	if out.BotRunID != "run-concurrent-research" || out.Status != "RUNNING" {
		t.Fatalf("concurrent accepted Research result = %+v", out)
	}
	if discoveryCalls.Load() != 1 || submissionCalls.Load() != 0 {
		t.Fatalf("race calls discovery/submission = %d/%d, want 1/0",
			discoveryCalls.Load(), submissionCalls.Load())
	}
}

func TestResearchClientTurnCannotCrossIntoNonResearchRouting(t *testing.T) {
	for _, tc := range []struct {
		name           string
		conversationV1 bool
		initialMode    string
		initialSurface QuerySurface
		retryMode      string
		retryTool      string
	}{
		{
			name:           "forced Research to instant Chat with default config",
			initialMode:    "expert",
			initialSurface: QuerySurfaceChat,
			retryMode:      "instant",
		},
		{
			name:           "forced Research to forced Analyst with default config",
			initialMode:    "expert",
			initialSurface: QuerySurfaceChat,
			retryMode:      "expert",
			retryTool:      "AnalystAgent",
		},
		{
			name:           "dedicated Research to instant Chat with default config",
			initialMode:    "instant",
			initialSurface: QuerySurfaceAgentProduct,
			retryMode:      "instant",
		},
		{
			name:           "forced Research to forced Analyst with conversation V1",
			conversationV1: true,
			initialMode:    "expert",
			initialSurface: QuerySurfaceChat,
			retryMode:      "expert",
			retryTool:      "AnalystAgent",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			var botCalls atomic.Int64
			v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
				botCalls.Add(1)
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/v1/agents/research/runs":
					w.WriteHeader(http.StatusAccepted)
					_, _ = w.Write([]byte(`{"id":"run-research-domain","object":"agent.run","agent":"research","status":"running","task_ids":["child-research-domain"],"result":{}}`))
				case "/v1/agents/analyst/runs":
					w.WriteHeader(http.StatusAccepted)
					_, _ = w.Write([]byte(`{"id":"run-unexpected-analyst","object":"agent.run","agent":"analyst","status":"running","task_ids":[],"result":{}}`))
				case "/v1/chat/completions":
					_, _ = w.Write([]byte(`{"id":"chat-unexpected","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"unexpected"}}],"formatted":{"answer":"unexpected"}}`))
				default:
					http.NotFound(w, r)
				}
			})
			rxBot.BotConfig.ResearchEnabled = true
			rxBot.BotConfig.AnalystEnabled = true
			rxBot.BotConfig.MultiturnV1Enabled = tc.conversationV1
			service := &Service{
				catalogReader: staticResearchCatalogReader{response: validResearchCapabilityCatalog()},
			}
			input := QueryInput{
				Query:        "Preserve the Research idempotency domain",
				Mode:         tc.initialMode,
				Tool:         "InSilicoResearchAgent",
				ClientTurnID: "research-domain-" + strings.ReplaceAll(tc.name, " ", "-"),
				Surface:      tc.initialSurface,
			}

			first, err := service.Query(context.Background(), "alice", input)
			if err != nil {
				t.Fatalf("first Research submission: %v", err)
			}
			if first.ToolName != "InSilicoResearchAgent" || botCalls.Load() != 1 {
				t.Fatalf("first Research result=%+v calls=%d, want Research/1", first, botCalls.Load())
			}

			retryInput := input
			retryInput.Mode = tc.retryMode
			retryInput.Tool = tc.retryTool
			retryInput.Surface = QuerySurfaceChat
			retry, err := service.Query(context.Background(), "alice", retryInput)
			if retry != nil || !errors.Is(err, ErrDuplicateClientTurn) {
				t.Errorf("cross-domain retry result=%+v error=%v, want ErrDuplicateClientTurn", retry, err)
			}
			if got := botCalls.Load(); got != 1 {
				t.Errorf("Bot calls after cross-domain retry = %d, want 1", got)
			}
			var rows int64
			if err := gdb.Model(&model.QuestionAgentLog{}).Count(&rows).Error; err != nil {
				t.Fatalf("count Research-domain rows: %v", err)
			}
			if rows != 1 {
				t.Errorf("rows after cross-domain retry = %d, want 1", rows)
			}
		})
	}
}

func TestResearchOwnerAllocationModeLockTracksConversationV1(t *testing.T) {
	for _, tc := range []struct {
		name           string
		conversationV1 bool
		wantConflict   bool
	}{
		{name: "default config preserves legacy append", wantConflict: false},
		{name: "conversation V1 enforces mode lock", conversationV1: true, wantConflict: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			if err := gdb.Exec(`INSERT INTO question_agent_logs
				(id, dialogue_id, f_id, user_name, query, tool_name, mode, status)
				VALUES (91, ?, 0, 'alice', 'legacy root', 'ChatAgent', 'instant', 'SUCCEEDED')`,
				ledgerTestDialogueID,
			).Error; err != nil {
				t.Fatalf("seed Instant root: %v", err)
			}
			var (
				botCalls          atomic.Int64
				hadConversationV1 atomic.Bool
			)
			v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
				botCalls.Add(1)
				var request rxBot.AgentRunRequest
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Errorf("decode Research append: %v", err)
				}
				hadConversationV1.Store(request.Conversation != nil)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusAccepted)
				_, _ = w.Write([]byte(`{"id":"run-research-legacy-append","object":"agent.run","agent":"research","status":"running","task_ids":[],"result":{}}`))
			})
			rxBot.BotConfig.ResearchEnabled = true
			rxBot.BotConfig.MultiturnV1Enabled = tc.conversationV1
			service := &Service{
				catalogReader: staticResearchCatalogReader{response: validResearchCapabilityCatalog()},
			}

			out, err := service.Query(context.Background(), "alice", QueryInput{
				Query:        "Append Research to the legacy Instant conversation",
				Id:           91,
				Mode:         "expert",
				Tool:         "InSilicoResearchAgent",
				ClientTurnID: "research-legacy-mode-lock",
				Surface:      QuerySurfaceChat,
			})
			if tc.wantConflict {
				if out != nil || !errors.Is(err, ErrConversationModeConflict) {
					t.Fatalf("conversation V1 result=%+v error=%v, want mode conflict", out, err)
				}
				if got := botCalls.Load(); got != 0 {
					t.Fatalf("conversation V1 conflict Bot calls = %d, want 0", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("default-config Research append: %v", err)
			}
			if out.DialogueId != ledgerTestDialogueID || botCalls.Load() != 1 {
				t.Fatalf("default-config append result=%+v calls=%d", out, botCalls.Load())
			}
			if hadConversationV1.Load() {
				t.Fatal("default-config Research append unexpectedly sent a conversation envelope")
			}
			var row model.QuestionAgentLog
			if err := gdb.First(&row, out.Id).Error; err != nil {
				t.Fatalf("read Research append row: %v", err)
			}
			if row.FId != 91 || row.Mode != "expert" {
				t.Fatalf("Research append parent/mode = %d/%q, want 91/expert", row.FId, row.Mode)
			}
		})
	}
}

func TestResearchSubmissionAmbiguousRetryFailsClosedWithoutRedispatch(t *testing.T) {
	for _, tc := range []struct {
		name    string
		mode    string
		surface QuerySurface
	}{
		{name: "dedicated product", mode: "instant", surface: QuerySurfaceAgentProduct},
		{name: "forced Chat Expert", mode: "expert", surface: QuerySurfaceChat},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			var (
				mu    sync.Mutex
				calls int
			)
			v1SubmissionServer(t, func(w http.ResponseWriter, _ *http.Request) {
				mu.Lock()
				defer mu.Unlock()
				calls++
				if calls == 1 {
					hijacker, ok := w.(http.Hijacker)
					if !ok {
						t.Error("test server does not support connection hijacking")
						return
					}
					conn, _, err := hijacker.Hijack()
					if err != nil {
						t.Errorf("hijack ambiguous response: %v", err)
						return
					}
					_ = conn.Close()
					return
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusAccepted)
				_, _ = w.Write([]byte(`{"id":"run-duplicate-after-lease","object":"agent.run","agent":"research","status":"running","task_ids":[],"result":{}}`))
			})
			rxBot.BotConfig.ResearchEnabled = true
			rxBot.BotConfig.AnalystEnabled = true
			rxBot.BotConfig.MultiturnV1Enabled = false
			service := &Service{
				catalogReader: staticResearchCatalogReader{response: validResearchCapabilityCatalog()},
			}
			input := QueryInput{
				Query:        "Reproduce the paper once",
				Mode:         tc.mode,
				Tool:         "InSilicoResearchAgent",
				ClientTurnID: "research-ambiguous-" + strings.ReplaceAll(tc.name, " ", "-"),
				Surface:      tc.surface,
			}

			if _, err := service.Query(context.Background(), "alice", input); err == nil {
				t.Fatal("ambiguous first response unexpectedly succeeded")
			}
			var row model.QuestionAgentLog
			if err := gdb.Where("user_name = ?", "alice").First(&row).Error; err != nil {
				t.Fatalf("read ambiguous Research row: %v", err)
			}
			if row.Status != "SUBMITTING" || row.BotRunId != "" {
				t.Fatalf("ambiguous row status/run = %q/%q, want SUBMITTING/blank", row.Status, row.BotRunId)
			}
			private, err := LoadBotConversationContext(context.Background(), "alice", row.Id)
			if err != nil {
				t.Fatalf("load ambiguous Research key: %v", err)
			}
			if private.ClientTurnID != input.ClientTurnID {
				t.Fatalf("retained client turn = %q, want %q", private.ClientTurnID, input.ClientTurnID)
			}
			staleAt := time.Now().Add(-turnSubmissionLease - time.Second)
			if err := gdb.Model(&model.QuestionAgentLog{}).
				Where("id = ?", row.Id).
				Updates(map[string]interface{}{"updated_at": staleAt}).Error; err != nil {
				t.Fatalf("age ambiguous Research row: %v", err)
			}

			conflict := input
			conflict.Query = "Reproduce a different paper"
			if _, err := service.Query(context.Background(), "alice", conflict); !errors.Is(err, ErrDuplicateClientTurn) {
				t.Fatalf("ambiguous-row conflict error = %v, want ErrDuplicateClientTurn", err)
			}
			retry, err := service.Query(context.Background(), "alice", input)
			if !errors.Is(err, ErrClientTurnSubmissionPending) {
				t.Fatalf("pending retry error = %v, want ErrClientTurnSubmissionPending", err)
			}
			if retry == nil || retry.Id != row.Id || retry.DialogueId != row.DialogueId ||
				retry.Status != "SUBMITTING" || retry.BotRunID != "" {
				t.Fatalf("pending retry identity = %+v, want durable row %d/%q", retry, row.Id, row.DialogueId)
			}
			again, err := service.Query(context.Background(), "alice", input)
			if !errors.Is(err, ErrClientTurnSubmissionPending) || again == nil ||
				again.Id != retry.Id || again.DialogueId != retry.DialogueId || again.BotRunID != retry.BotRunID {
				t.Fatalf("repeated pending retry=%+v error=%v, want identity %+v", again, err, retry)
			}
			if err := gdb.First(&row, row.Id).Error; err != nil {
				t.Fatalf("reload ambiguous Research row: %v", err)
			}
			if row.Status != "SUBMITTING" || row.BotRunId != "" {
				t.Fatalf("retry mutated row status/run = %q/%q", row.Status, row.BotRunId)
			}
			mu.Lock()
			defer mu.Unlock()
			if calls != 1 {
				t.Fatalf("Bot submissions after stale retry = %d, want 1", calls)
			}
		})
	}
}

func TestAmbiguousResearchReplacementUsesReplacementIdentity(t *testing.T) {
	gdb := setupExpertTestDB(t)
	seed := seedResearchReplacementTarget(t, gdb)
	var (
		researchCalls atomic.Int64
		analystCalls  atomic.Int64
	)
	v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/agents/research/runs":
			researchCalls.Add(1)
			hijacker, ok := w.(http.Hijacker)
			if !ok {
				t.Error("test server does not support connection hijacking")
				return
			}
			conn, _, err := hijacker.Hijack()
			if err != nil {
				t.Errorf("hijack ambiguous replacement response: %v", err)
				return
			}
			_ = conn.Close()
		case "/v1/agents/analyst/runs":
			analystCalls.Add(1)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"run-unexpected-analyst-replacement","object":"agent.run","agent":"analyst","status":"running","task_ids":[],"result":{}}`))
		default:
			http.NotFound(w, r)
		}
	})
	rxBot.BotConfig.ResearchEnabled = true
	rxBot.BotConfig.AnalystEnabled = true
	rxBot.BotConfig.MultiturnV1Enabled = false
	reader := &countingResearchCatalogReader{response: validResearchCapabilityCatalog()}
	service := &Service{catalogReader: reader}
	input := QueryInput{
		Query: "replace stale Analyst result with Research", Mode: "expert",
		Tool: "InSilicoResearchAgent", ClientTurnID: "research-replacement-ambiguous",
		RefreshId: seed.Id, Surface: QuerySurfaceChat,
	}

	if out, err := service.Query(context.Background(), "alice", input); out != nil || err == nil {
		t.Fatalf("ambiguous replacement result=%+v error=%v, want transport error", out, err)
	}
	var stored model.QuestionAgentLog
	if err := gdb.First(&stored, seed.Id).Error; err != nil {
		t.Fatalf("read ambiguous replacement row: %v", err)
	}
	private, err := LoadBotConversationContext(context.Background(), "alice", seed.Id)
	if err != nil {
		t.Fatalf("load ambiguous replacement context: %v", err)
	}
	if stored.ToolName != "AnalystAgent" || stored.Status != statusSucceeded ||
		stored.BotRunId != "run-stale-analyst" || private.Replacement == nil ||
		private.Replacement.ClientTurnID != input.ClientTurnID ||
		private.Replacement.ToolName != input.Tool {
		t.Fatalf("ambiguous replacement public/private identity=%+v/%+v", stored, private.Replacement)
	}

	retry, err := service.Query(context.Background(), "alice", input)
	if !errors.Is(err, ErrClientTurnSubmissionPending) || retry == nil ||
		retry.Id != seed.Id || retry.DialogueId != seed.DialogueId ||
		retry.Status != "SUBMITTING" || retry.BotRunID != "" || retry.ToolName != input.Tool {
		t.Fatalf("exact ambiguous replacement retry=%+v error=%v, want pending", retry, err)
	}
	conflict := input
	conflict.Query = "replace with different Research payload"
	if out, err := service.Query(context.Background(), "alice", conflict); out != nil || !errors.Is(err, ErrDuplicateClientTurn) {
		t.Fatalf("changed replacement payload result=%+v error=%v, want duplicate", out, err)
	}
	changedTool := input
	changedTool.Tool = "AnalystAgent"
	if out, err := service.Query(context.Background(), "alice", changedTool); out != nil || !errors.Is(err, ErrDuplicateClientTurn) {
		t.Fatalf("changed replacement tool result=%+v error=%v, want duplicate", out, err)
	}
	baseInput := QueryInput{
		Query: seed.Query, Mode: seed.Mode, Tool: seed.ToolName,
		ClientTurnID: "stale-analyst-client-turn", Surface: QuerySurfaceChat,
	}
	baseRetry, err := service.Query(context.Background(), "alice", baseInput)
	if err != nil || baseRetry == nil || baseRetry.Id != seed.Id ||
		baseRetry.Answer != seed.Answer || baseRetry.BotRunID != seed.BotRunId ||
		baseRetry.Status != seed.Status {
		t.Fatalf("base-key retry=%+v error=%v, want accepted base row", baseRetry, err)
	}
	changedBase := baseInput
	changedBase.Query = "changed accepted base payload"
	if out, err := service.Query(context.Background(), "alice", changedBase); out != nil || !errors.Is(err, ErrDuplicateClientTurn) {
		t.Fatalf("changed base-key result=%+v error=%v, want duplicate", out, err)
	}
	if researchCalls.Load() != 1 || analystCalls.Load() != 0 {
		t.Fatalf("Bot Research/Analyst calls=%d/%d, want 1/0", researchCalls.Load(), analystCalls.Load())
	}
	if reader.calls != 1 {
		t.Fatalf("catalog calls after replacement retries=%d, want 1", reader.calls)
	}
	var rows int64
	if err := gdb.Model(&model.QuestionAgentLog{}).Count(&rows).Error; err != nil || rows != 1 {
		t.Fatalf("rows after dual-key retries=%d error=%v, want 1", rows, err)
	}
}

func TestAcceptedResearchReplacementStagesPrivateCandidate(t *testing.T) {
	gdb := setupExpertTestDB(t)
	seed := seedResearchReplacementTarget(t, gdb)
	var researchCalls atomic.Int64
	v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/agents/research/runs" {
			http.NotFound(w, r)
			return
		}
		researchCalls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"id":"run-accepted-research-replacement","object":"agent.run","agent":"research","status":"running","task_ids":[],"result":{}}`))
	})
	rxBot.BotConfig.ResearchEnabled = true
	rxBot.BotConfig.AnalystEnabled = true
	rxBot.BotConfig.MultiturnV1Enabled = false
	reader := &countingResearchCatalogReader{response: validResearchCapabilityCatalog()}
	service := &Service{catalogReader: reader}
	input := QueryInput{
		Query: "accepted Research replacement", Mode: "expert",
		Tool: "InSilicoResearchAgent", ClientTurnID: "research-replacement-accepted",
		RefreshId: seed.Id, Surface: QuerySurfaceChat,
	}

	first, err := service.Query(context.Background(), "alice", input)
	if err != nil {
		t.Fatalf("accepted Research replacement: %v", err)
	}
	if first.Id != seed.Id || first.BotRunID != "run-accepted-research-replacement" || first.Status != "RUNNING" {
		t.Fatalf("accepted replacement identity=%+v", first)
	}
	var stored model.QuestionAgentLog
	if err := gdb.First(&stored, seed.Id).Error; err != nil {
		t.Fatalf("read accepted replacement row: %v", err)
	}
	private, err := LoadBotConversationContext(context.Background(), "alice", seed.Id)
	if err != nil {
		t.Fatalf("load accepted replacement context: %v", err)
	}
	if stored.Query != seed.Query || stored.Answer != seed.Answer ||
		stored.ToolName != seed.ToolName || stored.Status != seed.Status ||
		stored.BotRunId != seed.BotRunId || private.ClientTurnID != "stale-analyst-client-turn" ||
		private.Replacement == nil || private.Replacement.ClientTurnID != input.ClientTurnID ||
		private.Replacement.Query != input.Query {
		t.Fatalf("accepted replacement changed public base or lost private candidate: public=%+v private=%+v", stored, private)
	}
	var raw struct {
		ConversationContext struct {
			Replacement struct {
				ActiveStatus   string `json:"active_status"`
				ActiveBotRunID string `json:"active_bot_run_id"`
			} `json:"replacement"`
		} `json:"conversation_context"`
	}
	if err := json.Unmarshal([]byte(stored.BotProjectionJSON), &raw); err != nil {
		t.Fatalf("decode accepted replacement private candidate: %v", err)
	}
	if raw.ConversationContext.Replacement.ActiveStatus != "RUNNING" ||
		raw.ConversationContext.Replacement.ActiveBotRunID != first.BotRunID {
		t.Fatalf("private active identity=%+v, want RUNNING/%s", raw.ConversationContext.Replacement, first.BotRunID)
	}

	retry, err := service.Query(context.Background(), "alice", input)
	if err != nil {
		t.Fatalf("accepted replacement retry: %v", err)
	}
	if retry.Id != first.Id || retry.BotRunID != first.BotRunID || retry.Status != first.Status {
		t.Fatalf("accepted replacement retry changed identity: first=%+v retry=%+v", first, retry)
	}
	base, err := service.Query(context.Background(), "alice", QueryInput{
		Query: seed.Query, Mode: seed.Mode, Tool: seed.ToolName,
		ClientTurnID: "stale-analyst-client-turn", Surface: QuerySurfaceChat,
	})
	if err != nil || base == nil || base.Id != seed.Id || base.Answer != seed.Answer ||
		base.BotRunID != seed.BotRunId || base.Status != seed.Status {
		t.Fatalf("base key during active replacement=%+v error=%v, want old accepted public row", base, err)
	}
	if researchCalls.Load() != 1 || reader.calls != 1 {
		t.Fatalf("accepted replacement Bot/catalog calls=%d/%d, want 1/1", researchCalls.Load(), reader.calls)
	}
}

func TestConcurrentBaseAndReplacementKeysShareOneRowAndDispatch(t *testing.T) {
	gdb := setupExpertTestDB(t)
	seed := seedResearchReplacementTarget(t, gdb)
	started := make(chan struct{})
	release := make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
	var researchCalls atomic.Int64
	v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/agents/research/runs" {
			t.Errorf("unexpected Bot path %q", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		if researchCalls.Add(1) == 1 {
			close(started)
		}
		<-release
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"id":"run-concurrent-replacement","object":"agent.run","agent":"research","status":"running","task_ids":[],"result":{}}`))
	})
	rxBot.BotConfig.ResearchEnabled = true
	rxBot.BotConfig.AnalystEnabled = true
	rxBot.BotConfig.MultiturnV1Enabled = false
	service := &Service{catalogReader: staticResearchCatalogReader{response: validResearchCapabilityCatalog()}}
	replacementInput := QueryInput{
		Query: "concurrent replacement", Mode: "expert",
		Tool: "InSilicoResearchAgent", ClientTurnID: "concurrent-replacement-key",
		RefreshId: seed.Id, Surface: QuerySurfaceChat,
	}
	replacementDone := make(chan struct {
		out *QueryData
		err error
	}, 1)
	go func() {
		out, err := service.Query(context.Background(), "alice", replacementInput)
		replacementDone <- struct {
			out *QueryData
			err error
		}{out: out, err: err}
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("replacement did not reach Bot")
	}
	baseDone := make(chan struct {
		out *QueryData
		err error
	}, 1)
	go func() {
		out, err := service.Query(context.Background(), "alice", QueryInput{
			Query: seed.Query, Mode: seed.Mode, Tool: seed.ToolName,
			ClientTurnID: "stale-analyst-client-turn", Surface: QuerySurfaceChat,
		})
		baseDone <- struct {
			out *QueryData
			err error
		}{out: out, err: err}
	}()
	select {
	case result := <-baseDone:
		if result.err != nil || result.out == nil || result.out.Id != seed.Id ||
			result.out.Answer != seed.Answer || result.out.BotRunID != seed.BotRunId {
			t.Fatalf("concurrent base retry=%+v error=%v, want accepted base", result.out, result.err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("base-key retry waited on replacement Bot I/O")
	}
	releaseOnce.Do(func() { close(release) })
	result := <-replacementDone
	if result.err != nil || result.out == nil || result.out.Id != seed.Id ||
		result.out.BotRunID != "run-concurrent-replacement" {
		t.Fatalf("replacement result=%+v error=%v", result.out, result.err)
	}
	if researchCalls.Load() != 1 {
		t.Fatalf("Research calls=%d, want 1", researchCalls.Load())
	}
	var rows int64
	if err := gdb.Model(&model.QuestionAgentLog{}).Count(&rows).Error; err != nil || rows != 1 {
		t.Fatalf("rows=%d error=%v, want 1", rows, err)
	}
}

func TestFindRecentClientTurnRejectsCrossRowBaseReplacementKeyCollision(t *testing.T) {
	gdb := setupExpertTestDB(t)
	firstRaw, err := marshalPersistedProjectionWithContext(
		BotRunProjection{Status: statusSucceeded, ReportRevision: -1},
		&persistedConversationContext{
			ClientTurnID: "collision-base-one",
			Replacement: &persistedConversationReplacement{
				ClientTurnID: "collision-shared-key", Query: "legacy replacement",
				ToolName: "ChatAgent", Mode: "instant",
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	secondRaw, err := marshalPersistedProjectionWithContext(
		BotRunProjection{Status: statusSucceeded, ReportRevision: -1},
		&persistedConversationContext{ClientTurnID: "collision-shared-key"},
	)
	if err != nil {
		t.Fatal(err)
	}
	for index, raw := range []string{firstRaw, secondRaw} {
		row := model.QuestionAgentLog{
			DialogueId: fmt.Sprintf("collision-dialogue-%d", index), UserName: "alice",
			Query: "accepted", Answer: "accepted", ToolName: "ChatAgent",
			Mode: "instant", Status: statusSucceeded,
			BotProjectionJSON: raw, BotReportRevision: -1,
		}
		if err := gdb.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	match, err := findRecentClientTurnWithDB(
		context.Background(),
		gdb,
		"alice",
		"collision-shared-key",
	)
	if match != nil || !errors.Is(err, ErrDuplicateClientTurn) {
		t.Fatalf("collision lookup=%+v error=%v, want ErrDuplicateClientTurn", match, err)
	}
}

func TestTerminalResearchReplacementPreservesAcceptedBaseAndOwnIdentity(t *testing.T) {
	for _, tc := range []struct {
		name       string
		wireStatus string
		wantStatus string
	}{
		{name: "failed", wireStatus: "failed", wantStatus: "FAILED"},
		{name: "cancelled", wireStatus: "cancelled", wantStatus: "CANCELLED"},
		{name: "canceled alias", wireStatus: "canceled", wantStatus: "CANCELLED"},
		{name: "timed out", wireStatus: "timed_out", wantStatus: "TIMED_OUT"},
		{name: "timeout alias", wireStatus: "timeout", wantStatus: "TIMED_OUT"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			seed := seedResearchReplacementTarget(t, gdb)
			var botCalls atomic.Int64
			v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/v1/agents/research/runs" {
					http.NotFound(w, r)
					return
				}
				botCalls.Add(1)
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]interface{}{
					"id": "run-terminal-replacement", "object": "agent.run",
					"agent": "research", "status": tc.wireStatus, "task_ids": []string{},
					"result": map[string]interface{}{
						"formatted": map[string]interface{}{
							"answer":              "replacement terminal outcome",
							"follow_up_questions": []string{"inspect inputs"},
						},
					},
				})
			})
			rxBot.BotConfig.ResearchEnabled = true
			rxBot.BotConfig.AnalystEnabled = true
			rxBot.BotConfig.MultiturnV1Enabled = false
			service := &Service{catalogReader: staticResearchCatalogReader{response: validResearchCapabilityCatalog()}}
			input := QueryInput{
				Query: "terminal Research replacement", Mode: "expert",
				Tool: "InSilicoResearchAgent", ClientTurnID: "terminal-replacement-" + strings.ReplaceAll(tc.name, " ", "-"),
				RefreshId: seed.Id, Surface: QuerySurfaceChat,
			}
			first, err := service.Query(context.Background(), "alice", input)
			if err != nil || first == nil || first.Status != tc.wantStatus || first.Id != seed.Id {
				t.Fatalf("terminal replacement=%+v error=%v, want status %q on row %d", first, err, tc.wantStatus, seed.Id)
			}
			var stored model.QuestionAgentLog
			if err := gdb.First(&stored, seed.Id).Error; err != nil {
				t.Fatal(err)
			}
			if stored.Query != seed.Query || stored.Answer != seed.Answer ||
				stored.ToolName != seed.ToolName || stored.Status != seed.Status ||
				stored.BotRunId != seed.BotRunId {
				t.Fatalf("terminal replacement overwrote accepted base: got=%+v want=%+v", stored, seed)
			}
			seedProjection, _, err := unmarshalPersistedProjectionWithContext(seed.BotProjectionJSON)
			if err != nil {
				t.Fatal(err)
			}
			storedProjection, storedPrivate, err := unmarshalPersistedProjectionWithContext(stored.BotProjectionJSON)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(storedProjection, seedProjection) || storedPrivate == nil ||
				storedPrivate.ClientTurnID != "stale-analyst-client-turn" ||
				storedPrivate.Replacement == nil || storedPrivate.Replacement.TerminalResult == nil {
				t.Fatalf("terminal replacement changed public projection or lost private identity: projection=%+v private=%+v", storedProjection, storedPrivate)
			}
			retry, err := service.Query(context.Background(), "alice", input)
			if err != nil || retry == nil || retry.Id != first.Id || retry.Status != first.Status ||
				retry.BotRunID != first.BotRunID || retry.Answer != first.Answer {
				t.Fatalf("terminal replacement retry=%+v error=%v, want %+v", retry, err, first)
			}
			baseInput := QueryInput{
				Query: seed.Query, Mode: seed.Mode, Tool: seed.ToolName,
				ClientTurnID: "stale-analyst-client-turn", Surface: QuerySurfaceChat,
			}
			base, err := service.Query(context.Background(), "alice", baseInput)
			if err != nil || base == nil || base.Answer != seed.Answer || base.BotRunID != seed.BotRunId {
				t.Fatalf("base retry after terminal replacement=%+v error=%v", base, err)
			}
			changed := input
			changed.Query = "changed terminal replacement"
			if out, err := service.Query(context.Background(), "alice", changed); out != nil || !errors.Is(err, ErrDuplicateClientTurn) {
				t.Fatalf("changed terminal replacement=%+v error=%v, want duplicate", out, err)
			}
			if botCalls.Load() != 1 {
				t.Fatalf("Bot calls=%d, want 1", botCalls.Load())
			}
			var rows int64
			if err := gdb.Model(&model.QuestionAgentLog{}).Count(&rows).Error; err != nil || rows != 1 {
				t.Fatalf("rows=%d error=%v, want 1", rows, err)
			}
		})
	}
}

func TestTerminalReplacementIdentityRetiresBeforeNewReplacement(t *testing.T) {
	gdb := setupExpertTestDB(t)
	seed := seedResearchReplacementTarget(t, gdb)
	var botCalls atomic.Int64
	v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/agents/research/runs" {
			http.NotFound(w, r)
			return
		}
		call := botCalls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		if call == 1 {
			_, _ = w.Write([]byte(`{"id":"run-terminal-before-next","object":"agent.run","agent":"research","status":"failed","task_ids":[],"result":{}}`))
			return
		}
		_, _ = w.Write([]byte(`{"id":"run-after-terminal","object":"agent.run","agent":"research","status":"running","task_ids":[],"result":{}}`))
	})
	rxBot.BotConfig.ResearchEnabled = true
	rxBot.BotConfig.AnalystEnabled = true
	rxBot.BotConfig.MultiturnV1Enabled = false
	service := &Service{catalogReader: staticResearchCatalogReader{response: validResearchCapabilityCatalog()}}
	terminalInput := QueryInput{
		Query: "terminal replacement before another attempt", Mode: "expert",
		Tool: "InSilicoResearchAgent", ClientTurnID: "terminal-before-next-key",
		RefreshId: seed.Id, Surface: QuerySurfaceChat,
	}
	terminal, err := service.Query(context.Background(), "alice", terminalInput)
	if err != nil || terminal == nil || terminal.Status != "FAILED" {
		t.Fatalf("terminal replacement=%+v error=%v", terminal, err)
	}

	nextInput := terminalInput
	nextInput.Query = "new replacement after terminal outcome"
	nextInput.ClientTurnID = "replacement-after-terminal-key"
	next, err := service.Query(context.Background(), "alice", nextInput)
	if err != nil || next == nil || next.Status != "RUNNING" || next.BotRunID != "run-after-terminal" {
		t.Fatalf("new replacement=%+v error=%v, want accepted RUNNING", next, err)
	}
	private, err := LoadBotConversationContext(context.Background(), "alice", seed.Id)
	if err != nil {
		t.Fatal(err)
	}
	if private.Replacement == nil || private.Replacement.ClientTurnID != nextInput.ClientTurnID ||
		len(private.RetiredIdentities) != 1 ||
		private.RetiredIdentities[0].ClientTurnID != terminalInput.ClientTurnID {
		t.Fatalf("replacement retirement state=%+v", private)
	}
	if out, err := service.Query(context.Background(), "alice", terminalInput); out != nil || !errors.Is(err, ErrDuplicateClientTurn) {
		t.Fatalf("retired terminal key=%+v error=%v, want duplicate", out, err)
	}
	retry, err := service.Query(context.Background(), "alice", nextInput)
	if err != nil || retry == nil || retry.Id != next.Id || retry.BotRunID != next.BotRunID {
		t.Fatalf("new replacement retry=%+v error=%v", retry, err)
	}
	if botCalls.Load() != 2 {
		t.Fatalf("Bot calls=%d, want exactly two distinct replacements", botCalls.Load())
	}
	var rows int64
	if err := gdb.Model(&model.QuestionAgentLog{}).Count(&rows).Error; err != nil || rows != 1 {
		t.Fatalf("rows=%d error=%v, want one", rows, err)
	}
}

func TestKeyedV0ReservationNeverPersistsConversationV1Lifecycle(t *testing.T) {
	for _, tc := range []struct {
		name       string
		response   string
		wantStatus string
		wantError  bool
	}{
		{name: "ambiguous", response: "ambiguous", wantStatus: "SUBMITTING", wantError: true},
		{name: "definite failure", response: "definite", wantStatus: "FAILED", wantError: true},
		{name: "settled", response: "settled", wantStatus: "SUCCEEDED"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			v1SubmissionServer(t, func(w http.ResponseWriter, _ *http.Request) {
				switch tc.response {
				case "ambiguous":
					hijacker, ok := w.(http.Hijacker)
					if !ok {
						t.Error("test writer cannot hijack")
						return
					}
					conn, _, err := hijacker.Hijack()
					if err != nil {
						t.Errorf("hijack V0 response: %v", err)
						return
					}
					_ = conn.Close()
				case "definite":
					http.Error(w, `{"error":{"code":"invalid_request","message":"rejected","retryable":false}}`, http.StatusBadRequest)
				default:
					w.Header().Set("Content-Type", "application/json")
					_, _ = w.Write([]byte(`{"id":"run-v0-private","object":"chat.completion","choices":[{"message":{"role":"assistant","content":"settled"}}]}`))
				}
			})
			rxBot.BotConfig.MultiturnV1Enabled = false
			clientTurnID := "v0-private-" + strings.ReplaceAll(tc.name, " ", "-")
			out, err := NewService().Query(context.Background(), "alice", QueryInput{
				Query: "V0 private state", Mode: "instant", ClientTurnID: clientTurnID,
				Surface: QuerySurfaceChat,
			})
			if (err != nil) != tc.wantError {
				t.Fatalf("Query result=%+v error=%v, wantError=%v", out, err, tc.wantError)
			}
			var rows []model.QuestionAgentLog
			if err := gdb.Find(&rows).Error; err != nil || len(rows) != 1 {
				t.Fatalf("rows=%d error=%v, want 1", len(rows), err)
			}
			if rows[0].Status != tc.wantStatus {
				t.Fatalf("row status=%q, want %q", rows[0].Status, tc.wantStatus)
			}
			private, err := LoadBotConversationContext(context.Background(), "alice", rows[0].Id)
			if err != nil {
				t.Fatal(err)
			}
			if private.ClientTurnID != clientTurnID || private.ModeLockState != "" ||
				private.SettlementState != "" || private.Stage != nil ||
				private.SettlementLedgerHash != "" || private.RebuildLedgerVersion != "" ||
				private.RebuildLedgerCursor != 0 || private.AssistantSummary != "" ||
				len(private.ArtifactRefs) != 0 {
				t.Fatalf("keyed V0 leaked V1 private lifecycle: %+v", private)
			}
		})
	}
}

func TestDedicatedResearchClientTurnRejectsChangedInteropFingerprint(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*QueryInput)
	}{
		{name: "mode", mutate: func(in *QueryInput) {
			in.InteropMode = "off"
			in.InteropTargets = nil
		}},
		{name: "target", mutate: func(in *QueryInput) {
			in.InteropTargets = []string{"mcp-other"}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setupExpertTestDB(t)
			h := newInteropDelegationServer(
				t,
				http.StatusOK,
				`{"object":"list","data":[{"target_id":"mcp-peer","kind":"mcp"},{"target_id":"mcp-other","kind":"mcp"}],"errors":[]}`,
			)
			h.configure(t)
			rxBot.BotConfig.MultiturnV1Enabled = false
			service := &Service{
				catalogReader: staticResearchCatalogReader{response: validResearchCapabilityCatalog()},
			}
			input := QueryInput{
				Query:          "Reproduce with delegated evidence",
				Mode:           "instant",
				Tool:           "InSilicoResearchAgent",
				ClientTurnID:   "dedicated-research-interop-" + tc.name,
				Surface:        QuerySurfaceAgentProduct,
				InteropMode:    "auto",
				InteropTargets: []string{"mcp-peer"},
			}
			first, err := service.Query(context.Background(), "alice", input)
			if err != nil {
				t.Fatalf("first dedicated Research submission: %v", err)
			}
			retry, err := service.Query(context.Background(), "alice", input)
			if err != nil {
				t.Fatalf("same interop fingerprint retry: %v", err)
			}
			if retry.Id != first.Id || retry.BotRunID != first.BotRunID {
				t.Fatalf("same interop retry identity changed: first=%+v retry=%+v", first, retry)
			}
			conflict := input
			tc.mutate(&conflict)
			if _, err := service.Query(context.Background(), "alice", conflict); !errors.Is(err, ErrDuplicateClientTurn) {
				t.Fatalf("changed interop fingerprint error=%v, want ErrDuplicateClientTurn", err)
			}
			if got := h.submissionHits.Load(); got != 1 {
				t.Fatalf("Research submissions = %d, want 1", got)
			}
		})
	}
}

func TestDedicatedResearchClientTurnNormalizesOffInteropFingerprint(t *testing.T) {
	setupExpertTestDB(t)
	var calls int
	v1SubmissionServer(t, func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"id":"run-research-off","object":"agent.run","agent":"research","status":"running","task_ids":[],"result":{}}`))
	})
	rxBot.BotConfig.ResearchEnabled = true
	rxBot.BotConfig.MultiturnV1Enabled = false
	service := &Service{
		catalogReader: staticResearchCatalogReader{response: validResearchCapabilityCatalog()},
	}
	input := QueryInput{
		Query:        "Reproduce without delegation",
		Mode:         "instant",
		Tool:         "InSilicoResearchAgent",
		ClientTurnID: "dedicated-research-normalized-off",
		Surface:      QuerySurfaceAgentProduct,
	}
	first, err := service.Query(context.Background(), "alice", input)
	if err != nil {
		t.Fatalf("implicit off Research submission: %v", err)
	}
	retryInput := input
	retryInput.InteropMode = "off"
	retryInput.InteropTargets = []string{"mcp-peer"}
	retry, err := service.Query(context.Background(), "alice", retryInput)
	if err != nil {
		t.Fatalf("explicit off Research retry: %v", err)
	}
	if retry.Id != first.Id || retry.BotRunID != first.BotRunID {
		t.Fatalf("normalized off retry identity changed: first=%+v retry=%+v", first, retry)
	}
	if calls != 1 {
		t.Fatalf("Research submissions = %d, want 1", calls)
	}
}

func TestDedicatedResearchClientTurnRejectsConflictingFingerprint(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*QueryInput)
	}{
		{name: "query", mutate: func(in *QueryInput) { in.Query = "Reproduce a different paper" }},
		{name: "attachment", mutate: func(in *QueryInput) {
			in.Attachments = []rxBot.AssetAttachmentRef{{AssetID: "file_different_research"}}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			var calls int
			v1SubmissionServer(t, func(w http.ResponseWriter, _ *http.Request) {
				calls++
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusAccepted)
				_, _ = w.Write([]byte(`{"id":"run-dedicated-conflict","object":"agent.run","agent":"research","status":"running","task_ids":["child-dedicated-conflict"],"result":{}}`))
			})
			rxBot.BotConfig.ResearchEnabled = true
			rxBot.BotConfig.MultiturnV1Enabled = false
			service := &Service{
				catalogReader: staticResearchCatalogReader{response: validResearchCapabilityCatalog()},
			}
			input := QueryInput{
				Query:        "Reproduce the submitted paper",
				Mode:         "instant",
				Tool:         "InSilicoResearchAgent",
				ClientTurnID: "dedicated-research-conflict-1",
				Surface:      QuerySurfaceAgentProduct,
				Attachments:  []rxBot.AssetAttachmentRef{{AssetID: "file_dedicated_research"}},
			}
			if _, err := service.Query(context.Background(), "alice", input); err != nil {
				t.Fatalf("first dedicated Research submission: %v", err)
			}
			conflict := input
			tc.mutate(&conflict)
			if _, err := service.Query(context.Background(), "alice", conflict); !errors.Is(err, ErrDuplicateClientTurn) {
				t.Fatalf("conflicting dedicated Research submission error=%v, want ErrDuplicateClientTurn", err)
			}
			if calls != 1 {
				t.Fatalf("Bot submissions = %d, want 1", calls)
			}
			var count int64
			if err := gdb.Model(&model.QuestionAgentLog{}).Count(&count).Error; err != nil {
				t.Fatalf("count dedicated Research rows: %v", err)
			}
			if count != 1 {
				t.Fatalf("persisted rows = %d, want 1", count)
			}
		})
	}
}

func TestQuerySubmissionBoundsLegacyBlockingConversationTitle(t *testing.T) {
	gdb := setupExpertTestDB(t)
	var hit string
	botRouter(t, &hit)
	rawQuery := strings.Repeat("\u7A3B", 161) + "\nignored"

	out, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: rawQuery, Mode: "instant",
	})
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	var row model.QuestionAgentLog
	if err := gdb.First(&row, out.Id).Error; err != nil {
		t.Fatal(err)
	}
	if row.Query != rawQuery {
		t.Fatal("blocking submission changed the stored raw query")
	}
	if row.TitleQuery != strings.Repeat("\u7A3B", 160) {
		t.Fatalf("stored title has %d code points, want 160", len([]rune(row.TitleQuery)))
	}
}

func TestQuerySubmissionBoundsLegacyStreamConversationTitle(t *testing.T) {
	gdb := setupStreamTestDB(t)
	sseChatServer(t)
	rawQuery := "\n  streamed   title  \n" + strings.Repeat("x", 500)

	out, err := NewService().QueryStream(context.Background(), "alice@example.com", QueryInput{
		Query: rawQuery, Mode: "instant",
	}, nil, nil)
	if err != nil {
		t.Fatalf("QueryStream: %v", err)
	}
	var row model.QuestionAgentLog
	if err := gdb.First(&row, out.Id).Error; err != nil {
		t.Fatal(err)
	}
	if row.Query != rawQuery {
		t.Fatal("stream submission changed the stored raw query")
	}
	if row.TitleQuery != "streamed title" {
		t.Fatalf("stored title = %q", row.TitleQuery)
	}
}

func TestQuerySubmissionDuplicateConflictFailsClosed(t *testing.T) {
	setupExpertTestDB(t)
	var calls int
	v1SubmissionServer(t, func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chat-1","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"ok"}}],"formatted":{"answer":"ok"}}`))
	})
	service := NewService()
	if _, err := service.Query(context.Background(), "alice", QueryInput{
		Query: "first", Mode: "instant", ClientTurnID: "duplicate-turn-1",
	}); err != nil {
		t.Fatal(err)
	}
	_, err := service.Query(context.Background(), "alice", QueryInput{
		Query: "changed", Mode: "instant", ClientTurnID: "duplicate-turn-1",
	})
	if !errors.Is(err, ErrDuplicateClientTurn) {
		t.Fatalf("duplicate mismatch error = %v", err)
	}
	if calls != 1 {
		t.Fatalf("Bot calls = %d, want 1", calls)
	}
}

func TestQuerySubmissionConcurrentDuplicateReturnsPendingWithoutRedispatch(t *testing.T) {
	gdb := setupExpertTestDB(t)
	started := make(chan struct{})
	release := make(chan struct{})
	var startOnce sync.Once
	var botCalls atomic.Int64
	v1SubmissionServer(t, func(w http.ResponseWriter, _ *http.Request) {
		botCalls.Add(1)
		startOnce.Do(func() { close(started) })
		<-release
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chat-1","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"ok"}}],"formatted":{"answer":"ok"}}`))
	})
	t.Cleanup(func() {
		select {
		case <-release:
		default:
			close(release)
		}
	})
	type result struct {
		out *QueryData
		err error
	}
	firstDone := make(chan result, 1)
	go func() {
		out, err := NewService().Query(context.Background(), "alice", QueryInput{
			Query: "same", Mode: "instant", ClientTurnID: "concurrent-turn-1",
		})
		firstDone <- result{out: out, err: err}
	}()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("first submission did not reach Bot")
	}
	second, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "same", Mode: "instant", ClientTurnID: "concurrent-turn-1",
	})
	if !errors.Is(err, ErrClientTurnSubmissionPending) || second == nil ||
		second.Id == 0 || second.DialogueId == "" || second.Status != "SUBMITTING" {
		t.Fatalf("in-flight exact retry=%+v error=%v, want typed pending", second, err)
	}
	close(release)
	first := <-firstDone
	if first.err != nil || first.out == nil || first.out.Id == 0 {
		t.Fatalf("first submission=%+v error=%v", first.out, first.err)
	}
	if second.Id != first.out.Id || second.DialogueId != first.out.DialogueId || second.BotRunID != first.out.BotRunID {
		t.Fatalf("winner/loser identity mismatch: winner=%+v loser=%+v", first.out, second)
	}
	var count int64
	if err := gdb.Model(&model.QuestionAgentLog{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("row count = %d, want 1", count)
	}
	if botCalls.Load() != 1 {
		t.Fatalf("Bot calls = %d, want 1", botCalls.Load())
	}
}

func TestConcurrentResearchAndLegacyChatAtomicallyClaimClientTurn(t *testing.T) {
	gdb := setupExpertTestDB(t)
	var (
		chatCalls     atomic.Int64
		researchCalls atomic.Int64
	)
	server := v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/chat/completions":
			chatCalls.Add(1)
			_, _ = w.Write([]byte(`{"id":"chat-atomic-claim","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"ok"}}],"formatted":{"answer":"ok"}}`))
		case "/v1/agents/research/runs":
			researchCalls.Add(1)
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"run-unexpected-research-claim","object":"agent.run","agent":"research","status":"running","task_ids":[],"result":{}}`))
		default:
			http.NotFound(w, r)
		}
	})
	_ = server
	rxBot.BotConfig.ResearchEnabled = true
	rxBot.BotConfig.MultiturnV1Enabled = false
	reader := &gatedResearchCatalogReader{
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	service := &Service{catalogReader: reader}
	const clientTurnID = "atomic-research-chat-first-use"
	type queryResult struct {
		out *QueryData
		err error
	}
	researchDone := make(chan queryResult, 1)
	go func() {
		out, err := service.Query(context.Background(), "alice", QueryInput{
			Query: "Research waits on live capability discovery", Mode: "expert",
			Tool: "InSilicoResearchAgent", ClientTurnID: clientTurnID,
			Surface: QuerySurfaceChat,
		})
		researchDone <- queryResult{out: out, err: err}
	}()

	select {
	case <-reader.started:
	case <-time.After(2 * time.Second):
		t.Fatal("Research request did not reach the catalog gate")
	}
	chatOut, err := service.Query(context.Background(), "alice", QueryInput{
		Query: "Legacy Instant wins the durable key", Mode: "instant",
		ClientTurnID: clientTurnID, Surface: QuerySurfaceChat,
	})
	if err != nil {
		close(reader.release)
		t.Fatalf("Instant claimant: %v", err)
	}
	close(reader.release)
	var research queryResult
	select {
	case research = <-researchDone:
	case <-time.After(2 * time.Second):
		t.Fatal("Research claimant did not finish after catalog release")
	}
	if research.out != nil || !errors.Is(research.err, ErrDuplicateClientTurn) {
		t.Fatalf("Research claimant result=%+v error=%v, want ErrDuplicateClientTurn", research.out, research.err)
	}
	if chatOut.Id == 0 || chatCalls.Load() != 1 || researchCalls.Load() != 0 {
		t.Fatalf("winner/id and Bot chat/research calls=%d/%d/%d, want nonzero/1/0",
			chatOut.Id, chatCalls.Load(), researchCalls.Load())
	}
	if reader.calls.Load() != 1 {
		t.Fatalf("catalog calls=%d, want 1", reader.calls.Load())
	}
	var rows int64
	if err := gdb.Model(&model.QuestionAgentLog{}).Count(&rows).Error; err != nil {
		t.Fatalf("count atomic-claim rows: %v", err)
	}
	if rows != 1 {
		t.Fatalf("atomic-claim rows=%d, want 1", rows)
	}
}

func TestClientTurnReservationLockIsReleasedBeforeBotDispatch(t *testing.T) {
	gdb := setupExpertTestDB(t)
	botStarted := make(chan struct{})
	releaseBot := make(chan struct{})
	var startOnce sync.Once
	var botCalls atomic.Int64
	v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		botCalls.Add(1)
		startOnce.Do(func() { close(botStarted) })
		<-releaseBot
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chat-unlocked-dispatch","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"ok"}}],"formatted":{"answer":"ok"}}`))
	})
	rxBot.BotConfig.MultiturnV1Enabled = false
	service := NewService()
	const clientTurnID = "reservation-released-before-bot"
	type result struct {
		out *QueryData
		err error
	}
	firstDone := make(chan result, 1)
	go func() {
		out, err := service.Query(context.Background(), "alice", QueryInput{
			Query: "first claimant reaches Bot", Mode: "instant",
			ClientTurnID: clientTurnID, Surface: QuerySurfaceChat,
		})
		firstDone <- result{out: out, err: err}
	}()
	select {
	case <-botStarted:
	case <-time.After(2 * time.Second):
		close(releaseBot)
		t.Fatal("first claimant did not reach Bot")
	}

	conflictDone := make(chan error, 1)
	go func() {
		_, err := service.Query(context.Background(), "alice", QueryInput{
			Query: "changed claimant must conflict", Mode: "instant",
			ClientTurnID: clientTurnID, Surface: QuerySurfaceChat,
		})
		conflictDone <- err
	}()
	select {
	case err := <-conflictDone:
		if !errors.Is(err, ErrDuplicateClientTurn) {
			close(releaseBot)
			t.Fatalf("concurrent conflict error=%v, want ErrDuplicateClientTurn", err)
		}
	case <-time.After(500 * time.Millisecond):
		close(releaseBot)
		t.Fatal("client-turn reservation remained locked across Bot dispatch")
	}
	close(releaseBot)
	first := <-firstDone
	if first.err != nil || first.out == nil || first.out.Id == 0 {
		t.Fatalf("first claimant result=%+v error=%v", first.out, first.err)
	}
	if botCalls.Load() != 1 {
		t.Fatalf("Bot calls=%d, want 1", botCalls.Load())
	}
	var rows int64
	if err := gdb.Model(&model.QuestionAgentLog{}).Count(&rows).Error; err != nil {
		t.Fatalf("count unlocked reservation rows: %v", err)
	}
	if rows != 1 {
		t.Fatalf("unlocked reservation rows=%d, want 1", rows)
	}
}

func TestKeyedV0ReplacementReservationPreservesAcceptedConversationV1Lifecycle(t *testing.T) {
	gdb := setupExpertTestDB(t)
	seed := seedResearchReplacementTarget(t, gdb)
	private, err := LoadBotConversationContext(context.Background(), "alice", seed.Id)
	if err != nil {
		t.Fatal(err)
	}
	private.Stage = validContextStageMetadata()
	private.SettlementState = conversationSettlementAcked
	private.SettlementLedgerHash = strings.Repeat("a", 64)
	private.RebuildLedgerVersion = strings.Repeat("b", 64)
	private.RebuildLedgerCursor = seed.Id
	private.AssistantSummary = "legacy typed summary"
	private.ArtifactRefs = []rxBot.ArtifactRefV1{{
		ArtifactID: "legacy-artifact", DisplayName: "legacy.csv",
	}}
	if err := SaveBotConversationContext(context.Background(), "alice", seed.Id, private); err != nil {
		t.Fatal(err)
	}
	input := QueryInput{
		Query: "V0 replacement", Mode: "expert", Tool: "InSilicoResearchAgent",
		ClientTurnID: "v0-replacement-private-state", RefreshId: seed.Id,
		Surface: QuerySurfaceChat, InteropMode: "off",
	}
	target := v1SubmissionTarget{
		dialogueID: seed.DialogueId, parentID: seed.FId,
		mode: "expert", operation: "replace",
	}
	if _, err := NewService().allocateOwnerSubmissionWithDB(
		context.Background(),
		gdb,
		"alice",
		input,
		target,
		AgentPermissionResolution{AllowedTools: []string{"InSilicoResearchAgent"}},
		false,
		false,
	); err != nil {
		t.Fatalf("allocate V0 replacement: %v", err)
	}
	stored, err := LoadBotConversationContext(context.Background(), "alice", seed.Id)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Replacement == nil || stored.Replacement.ClientTurnID != input.ClientTurnID {
		t.Fatalf("V0 replacement identity=%+v", stored.Replacement)
	}
	if stored.ModeLockState != private.ModeLockState || !reflect.DeepEqual(stored.Stage, private.Stage) ||
		stored.SettlementState != private.SettlementState ||
		stored.SettlementLedgerHash != private.SettlementLedgerHash ||
		stored.RebuildLedgerVersion != private.RebuildLedgerVersion ||
		stored.RebuildLedgerCursor != private.RebuildLedgerCursor ||
		stored.AssistantSummary != private.AssistantSummary ||
		!reflect.DeepEqual(stored.ArtifactRefs, private.ArtifactRefs) {
		t.Fatalf("active V0 replacement changed accepted V1 lifecycle: before=%+v after=%+v", private, stored)
	}
}

func TestResearchReservationWinsBeforeInstantAndDoesNotHoldBotLock(t *testing.T) {
	gdb := setupExpertTestDB(t)
	botStarted := make(chan struct{})
	releaseBot := make(chan struct{})
	var startOnce sync.Once
	var researchCalls atomic.Int64
	v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/agents/research/runs" {
			http.NotFound(w, r)
			return
		}
		researchCalls.Add(1)
		startOnce.Do(func() { close(botStarted) })
		<-releaseBot
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"id":"run-research-reservation-winner","object":"agent.run","agent":"research","status":"running","task_ids":[],"result":{}}`))
	})
	rxBot.BotConfig.ResearchEnabled = true
	rxBot.BotConfig.MultiturnV1Enabled = false
	service := &Service{catalogReader: staticResearchCatalogReader{response: validResearchCapabilityCatalog()}}
	const clientTurnID = "research-reserves-before-instant"
	type result struct {
		out *QueryData
		err error
	}
	researchDone := make(chan result, 1)
	go func() {
		out, err := service.Query(context.Background(), "alice", QueryInput{
			Query: "Research owns the durable key", Mode: "expert",
			Tool: "InSilicoResearchAgent", ClientTurnID: clientTurnID,
			Surface: QuerySurfaceChat,
		})
		researchDone <- result{out: out, err: err}
	}()
	select {
	case <-botStarted:
	case <-time.After(2 * time.Second):
		close(releaseBot)
		t.Fatal("Research did not reach Bot after reserving its row")
	}

	instantDone := make(chan error, 1)
	go func() {
		_, err := service.Query(context.Background(), "alice", QueryInput{
			Query: "Instant must conflict", Mode: "instant",
			ClientTurnID: clientTurnID, Surface: QuerySurfaceChat,
		})
		instantDone <- err
	}()
	select {
	case err := <-instantDone:
		if !errors.Is(err, ErrDuplicateClientTurn) {
			close(releaseBot)
			t.Fatalf("Instant conflict error=%v, want ErrDuplicateClientTurn", err)
		}
	case <-time.After(500 * time.Millisecond):
		close(releaseBot)
		t.Fatal("Research held the owner-key lock across Bot dispatch")
	}
	close(releaseBot)
	research := <-researchDone
	if research.err != nil || research.out == nil || research.out.Id == 0 {
		t.Fatalf("Research result=%+v error=%v", research.out, research.err)
	}
	if researchCalls.Load() != 1 {
		t.Fatalf("Research Bot calls=%d, want 1", researchCalls.Load())
	}
	var rows int64
	if err := gdb.Model(&model.QuestionAgentLog{}).Count(&rows).Error; err != nil || rows != 1 {
		t.Fatalf("rows=%d error=%v, want 1", rows, err)
	}
}

func setupConcurrentReplacementTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := "file:" + strings.ReplaceAll(t.Name(), "/", "-") + "?mode=memory&cache=shared"
	gdb, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open shared replacement sqlite: %v", err)
	}
	if sqlDB, err := gdb.DB(); err == nil {
		sqlDB.SetMaxOpenConns(4)
	}
	if err := gdb.Exec(`CREATE TABLE question_agent_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		dialogue_id TEXT, f_id INTEGER DEFAULT 0, server_id TEXT, bot_run_id TEXT,
		bot_projection_json TEXT, bot_report_revision INTEGER NOT NULL DEFAULT -1,
		user_name TEXT, query TEXT, title_query TEXT, answer TEXT,
		follow_up_questions TEXT, task_id TEXT, task_log TEXT, file_name TEXT,
		upload_path TEXT, download_path TEXT, image_paths TEXT, compute_resource TEXT,
		server_file_path TEXT, tool_name TEXT, status TEXT, log_status TEXT, mode TEXT,
		reaction_type TEXT, collect_type TEXT, created_at DATETIME, updated_at DATETIME, delete_at DATETIME
	)`).Error; err != nil {
		t.Fatalf("create shared replacement table: %v", err)
	}
	return gdb
}

func TestConcurrentReplacementCASLossReturnsDuplicateConflict(t *testing.T) {
	gdb := setupConcurrentReplacementTestDB(t)
	seed := seedResearchReplacementTarget(t, gdb)
	ready := make(chan struct{}, 2)
	release := make(chan struct{})
	var blocked atomic.Int64
	const callbackName = "test:round4-replacement-cas-barrier"
	if err := gdb.Callback().Query().After("gorm:query").Register(callbackName, func(tx *gorm.DB) {
		query := tx.Statement.SQL.String()
		if !strings.Contains(query, "status = ?") ||
			!strings.Contains(query, "question_agent_logs") || blocked.Add(1) > 2 {
			return
		}
		ready <- struct{}{}
		<-release
	}); err != nil {
		t.Fatalf("register replacement CAS barrier: %v", err)
	}
	t.Cleanup(func() { _ = gdb.Callback().Query().Remove(callbackName) })

	target := v1SubmissionTarget{
		dialogueID: seed.DialogueId, mode: "expert", operation: "replace",
	}
	type allocationResult struct{ err error }
	results := make(chan allocationResult, 2)
	for index := 0; index < 2; index++ {
		index := index
		go func() {
			_, err := NewService().allocateOwnerSubmissionWithDB(
				context.Background(), gdb, "alice",
				QueryInput{
					Query: fmt.Sprintf("replacement payload %d", index), Mode: "expert",
					Tool: "InSilicoResearchAgent", RefreshId: seed.Id,
					ClientTurnID: fmt.Sprintf("replacement-cas-%d", index), Surface: QuerySurfaceChat,
				},
				target, AgentPermissionResolution{}, false, false,
			)
			results <- allocationResult{err: err}
		}()
	}
	for index := 0; index < 2; index++ {
		select {
		case <-ready:
		case <-time.After(2 * time.Second):
			close(release)
			t.Fatal("replacement allocations did not reach the CAS barrier")
		}
	}
	close(release)
	var success, duplicate int
	for index := 0; index < 2; index++ {
		result := <-results
		switch {
		case result.err == nil:
			success++
		case errors.Is(result.err, ErrDuplicateClientTurn):
			duplicate++
		default:
			t.Fatalf("CAS loser error=%v, want ErrDuplicateClientTurn", result.err)
		}
	}
	if success != 1 || duplicate != 1 {
		t.Fatalf("replacement allocations success/duplicate=%d/%d, want 1/1", success, duplicate)
	}
	var rows int64
	if err := gdb.Model(&model.QuestionAgentLog{}).Count(&rows).Error; err != nil || rows != 1 {
		t.Fatalf("rows=%d error=%v, want 1", rows, err)
	}
}

func TestQuerySubmissionAttachmentReferencesReachBotAndPersist(t *testing.T) {
	gdb := setupExpertTestDB(t)
	var captured rxBot.ChatCompletionRequest
	v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("unexpected Bot path %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Errorf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chat-attachments","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"ok"}}],"formatted":{"answer":"ok"}}`))
	})

	refs := []rxBot.AssetAttachmentRef{{AssetID: "file_reads"}, {AssetID: "file_variants"}}
	out, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "with file", Mode: "instant", ClientTurnID: "upload-turn-1",
		Attachments: refs,
	})
	if err != nil {
		t.Fatalf("reference-only submission: %v", err)
	}
	if len(captured.Attachments) != len(refs) || captured.Attachments[0].AssetID != refs[0].AssetID ||
		captured.Attachments[1].AssetID != refs[1].AssetID {
		t.Fatalf("Bot attachments=%#v, want %#v", captured.Attachments, refs)
	}
	if captured.OwnerSubject != "alice" {
		t.Fatalf("Bot owner_subject=%q, want alice", captured.OwnerSubject)
	}
	var row model.QuestionAgentLog
	if err := gdb.First(&row, out.Id).Error; err != nil {
		t.Fatal(err)
	}
	if row.FileName != "" || row.UploadPath != "" {
		t.Fatalf("legacy upload columns were populated: file_name=%q upload_path=%q", row.FileName, row.UploadPath)
	}
	private, err := LoadBotConversationContext(context.Background(), "alice", row.Id)
	if err != nil {
		t.Fatal(err)
	}
	if len(private.InputAttachments) != len(refs) || private.InputAttachments[0].AssetID != refs[0].AssetID ||
		private.InputAttachments[1].AssetID != refs[1].AssetID {
		t.Fatalf("stored attachments=%#v, want %#v", private.InputAttachments, refs)
	}
}

func TestQuerySubmissionDefiniteBotFailuresSettleFailed(t *testing.T) {
	tests := []struct {
		name     string
		mode     string
		path     string
		status   int
		response string
		wantErr  error
	}{
		{
			name:     "chat API rejection",
			mode:     "instant",
			path:     "/v1/chat/completions",
			status:   http.StatusBadRequest,
			response: `{"error":{"code":"invalid_request","message":"bad request"}}`,
		},
		{
			name:     "chat malformed response",
			mode:     "instant",
			path:     "/v1/chat/completions",
			status:   http.StatusOK,
			response: `{"id":`,
		},
		{
			name:     "expert malformed response",
			mode:     "expert",
			path:     "/v1/query/route",
			status:   http.StatusOK,
			response: `{"id":"run-bad","agent":`,
			wantErr:  ErrExpertRouteContract,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != tc.path {
					t.Errorf("Bot path = %s, want %s", r.URL.Path, tc.path)
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.response))
			})

			_, err := NewService().Query(context.Background(), "alice", QueryInput{
				Query:        "definite failure",
				Mode:         tc.mode,
				ClientTurnID: "definite-" + strings.ReplaceAll(tc.name, " ", "-"),
			})
			if err == nil {
				t.Fatal("expected Bot failure")
			}
			if tc.wantErr != nil && !errors.Is(err, tc.wantErr) {
				t.Fatalf("error = %v, want %v", err, tc.wantErr)
			}
			var row model.QuestionAgentLog
			if err := gdb.First(&row).Error; err != nil {
				t.Fatal(err)
			}
			if row.Status != "FAILED" {
				t.Fatalf("status = %q, want FAILED", row.Status)
			}
		})
	}
}

func TestMySQLTurnWaitSecondsUsesBoundedAllocationBudget(t *testing.T) {
	tests := []struct {
		timeout time.Duration
		want    int
	}{
		{timeout: 0, want: 1},
		{timeout: 500 * time.Millisecond, want: 1},
		{timeout: time.Second, want: 1},
		{timeout: 31 * time.Second, want: maxMySQLTurnWaitSeconds},
	}
	for _, tc := range tests {
		if got := mysqlTurnWaitSeconds(tc.timeout); got != tc.want {
			t.Fatalf("mysqlTurnWaitSeconds(%s) = %d, want %d", tc.timeout, got, tc.want)
		}
	}
}

func TestQuerySubmissionUncertainTransportRetainsSubmitting(t *testing.T) {
	gdb := setupExpertTestDB(t)
	server := v1SubmissionServer(t, func(http.ResponseWriter, *http.Request) {})
	server.Close()

	_, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "retry me", Mode: "instant", ClientTurnID: "transport-turn-1",
	})
	if err == nil {
		t.Fatal("expected transport error")
	}
	var row model.QuestionAgentLog
	if err := gdb.First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != "SUBMITTING" {
		t.Fatalf("status = %q, want SUBMITTING", row.Status)
	}
}

func TestQuerySubmissionRejectsInvalidAttachmentReferencesBeforeAllocation(t *testing.T) {
	gdb := setupExpertTestDB(t)
	v1SubmissionServer(t, func(http.ResponseWriter, *http.Request) {
		t.Fatal("Bot must not be called")
	})

	for _, tc := range []struct {
		name string
		refs []rxBot.AssetAttachmentRef
	}{
		{name: "bad prefix", refs: []rxBot.AssetAttachmentRef{{AssetID: "asset_secret"}}},
		{name: "empty suffix", refs: []rxBot.AssetAttachmentRef{{AssetID: "file_"}}},
		{name: "duplicate", refs: []rxBot.AssetAttachmentRef{{AssetID: "file_same"}, {AssetID: "file_same"}}},
		{name: "too many", refs: distinctQueryAttachmentRefs(65)},
	} {
		_, err := NewService().Query(context.Background(), "alice", QueryInput{
			Query: "unsafe", Mode: "instant", ClientTurnID: "unsafe-attachment-" + tc.name,
			Attachments: tc.refs,
		})
		if !errors.Is(err, ErrInvalidQueryAttachments) {
			t.Fatalf("%s error = %v, want invalid attachments", tc.name, err)
		}
	}
	var count int64
	if err := gdb.Model(&model.QuestionAgentLog{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("allocated rows = %d, want 0", count)
	}
}

func TestQuerySubmissionResearchMissingRunIDBeforePersistence(t *testing.T) {
	tests := []struct {
		name     string
		tool     string
		wantPath string
	}{
		{name: "dedicated Research", tool: "InSilicoResearchAgent", wantPath: "/v1/agents/research/runs"},
		{name: "autonomous Expert selects Research", wantPath: "/v1/query/route"},
	}

	for index, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			var calls int
			v1SubmissionServer(t, func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.URL.Path != tt.wantPath {
					t.Errorf("Bot path = %q, want %q", r.URL.Path, tt.wantPath)
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"object":"agent.run","agent":"research","status":"running","task_ids":["child-research"],"result":{}}`))
			})
			rxBot.BotConfig.ResearchEnabled = true
			service := &Service{
				catalogReader: staticResearchCatalogReader{
					response: validResearchCapabilityCatalog(),
				},
			}

			out, err := service.Query(context.Background(), "alice", QueryInput{
				Query: "resolve Research inputs", Mode: "expert", Tool: tt.tool,
				ClientTurnID: fmt.Sprintf("research-run-id-%d", index),
			})
			if !errors.Is(err, ErrMissingBotRunID) {
				t.Fatalf("error = %v, want ErrMissingBotRunID", err)
			}
			if out != nil {
				t.Fatalf("missing run identity returned output: %+v", out)
			}
			if calls != 1 {
				t.Fatalf("Bot calls = %d, want 1", calls)
			}

			var pollableRows int64
			if err := gdb.Model(&model.QuestionAgentLog{}).
				Where("status IN ? OR COALESCE(bot_run_id, '') != ''", []string{"SUBMITTING", "RUNNING"}).
				Count(&pollableRows).Error; err != nil {
				t.Fatalf("count pollable question rows: %v", err)
			}
			if pollableRows != 0 {
				t.Fatalf("missing Research run identity persisted %d pollable row(s)", pollableRows)
			}
		})
	}
}

func TestStaleSubmittingClientTurnNeverRedispatchesAfterAllowlistDrift(t *testing.T) {
	gdb := setupExpertTestDB(t)
	seedExpertPermissionUser(t, gdb, "drift@example.com", "drift-role")
	seedExpertPermissionTool(t, gdb, "drift-role", "ChatAgent", 701)
	input := QueryInput{
		Query: "same accepted client turn", Mode: "instant",
		ClientTurnID: "stale-submitting-no-redispatch", Surface: QuerySurfaceChat,
	}
	target := v1SubmissionTarget{
		dialogueID: "67676767-6767-4676-8676-676767676767",
		mode:       "instant",
		operation:  "append",
	}
	raw, err := marshalPersistedProjectionWithContext(
		BotRunProjection{ReportRevision: -1},
		&persistedConversationContext{
			ClientTurnID:       input.ClientTurnID,
			RequestFingerprint: submissionRequestFingerprint(input, target, false),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	row := model.QuestionAgentLog{
		DialogueId: target.dialogueID, UserName: "drift@example.com",
		Query: input.Query, ToolName: "ChatAgent", Mode: "instant",
		Status: "SUBMITTING", BotProjectionJSON: raw, BotReportRevision: -1,
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	if err := gdb.Model(&row).Update("updated_at", time.Now().Add(-turnSubmissionLease-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	var botCalls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		botCalls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"unexpected-stale-replay","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"must not run"}}]}`))
	}))
	t.Cleanup(server.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true, TimeoutSeconds: 2,
		MultiturnV1Enabled: false,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	out, err := NewService().Query(context.Background(), "drift@example.com", input)
	if !errors.Is(err, ErrClientTurnSubmissionPending) || out == nil ||
		out.Id != row.Id || out.DialogueId != row.DialogueId || out.Status != "SUBMITTING" {
		t.Fatalf("stale keyed retry=%+v error=%v, want typed pending", out, err)
	}
	if botCalls.Load() != 0 {
		t.Fatalf("stale keyed retry Bot calls=%d, want 0 after execution allowlist drift", botCalls.Load())
	}
}

func TestLegacyClientTurnAmbiguityFailsClosed(t *testing.T) {
	row := model.QuestionAgentLog{
		Id: 81, DialogueId: "legacy-dialogue", FId: 0,
		Query: "legacy exact query", ToolName: "ChatAgent",
		Mode: "instant", Status: statusSucceeded,
	}
	private := &persistedConversationContext{ClientTurnID: "legacy-client-turn"}
	baseInput := QueryInput{
		Query: row.Query, Mode: "instant", Tool: "ChatAgent",
		ClientTurnID: private.ClientTurnID, Surface: QuerySurfaceChat,
	}
	baseTarget := v1SubmissionTarget{
		dialogueID: row.DialogueId, parentID: 0,
		mode: "instant", operation: "append",
	}
	if err := validateDuplicateSubmission(
		row, private, clientTurnIdentityBase, baseInput, baseTarget, false,
	); err != nil {
		t.Fatalf("simple legacy exact retry rejected: %v", err)
	}

	tests := []struct {
		name           string
		mutate         func(*QueryInput, *v1SubmissionTarget)
		conversationV1 bool
	}{
		{
			name: "V0 history cannot be reconstructed",
			mutate: func(in *QueryInput, _ *v1SubmissionTarget) {
				in.History = `[{"role":"user","content":"earlier behavior-changing context"}]`
			},
		},
		{
			name: "V1 artifact authorization cannot be reconstructed",
			mutate: func(in *QueryInput, target *v1SubmissionTarget) {
				in.ArtifactIDs = []string{"artifact-new"}
				target.artifacts = []rxBot.ArtifactRefV1{{ArtifactID: "artifact-new", DisplayName: "new.csv"}}
			},
			conversationV1: true,
		},
		{
			name: "resolver arguments cannot be reconstructed",
			mutate: func(in *QueryInput, _ *v1SubmissionTarget) {
				in.GeneID = "Os01g0100100"
				in.ToID = "RAP"
				in.SpeciesCode = "oryza_sativa"
			},
		},
		{
			name: "surface cannot change from Chat to product",
			mutate: func(in *QueryInput, _ *v1SubmissionTarget) {
				in.Surface = QuerySurfaceAgentProduct
			},
		},
		{
			name: "base identity cannot be reinterpreted as replacement",
			mutate: func(in *QueryInput, target *v1SubmissionTarget) {
				in.RefreshId = row.Id
				target.operation = "replace"
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			in := baseInput
			target := baseTarget
			tc.mutate(&in, &target)
			if err := validateDuplicateSubmission(
				row, private, clientTurnIdentityBase, in, target, tc.conversationV1,
			); !errors.Is(err, ErrDuplicateClientTurn) {
				t.Fatalf("legacy ambiguous retry error=%v, want ErrDuplicateClientTurn", err)
			}
		})
	}
}

func TestRetiredClientTurnAliasesFailClosedAndRemainLookupVisible(t *testing.T) {
	gdb := setupExpertTestDB(t)
	retired := []map[string]string{
		{"client_turn_id": "retired-base-one", "request_fingerprint": strings.Repeat("a", 64)},
		{"client_turn_id": "retired-base-two", "request_fingerprint": strings.Repeat("b", 64)},
		{"client_turn_id": "retired-base-three", "request_fingerprint": strings.Repeat("c", 64)},
	}
	encoded, err := json.Marshal(map[string]interface{}{
		"report_revision": -1,
		"conversation_context": map[string]interface{}{
			"client_turn_id":      "current-replacement-key",
			"request_fingerprint": strings.Repeat("d", 64),
			"retired_identities":  retired,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	row := model.QuestionAgentLog{
		DialogueId: "retired-dialogue", UserName: "alice",
		Query: "current query", Answer: "current answer",
		ToolName: "ChatAgent", Mode: "instant", Status: statusSucceeded,
		BotProjectionJSON: string(encoded), BotReportRevision: -1,
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	for _, alias := range retired {
		for _, query := range []string{"historical exact query", "changed retired payload"} {
			input := QueryInput{
				Query: query, Mode: "instant", Tool: "ChatAgent",
				ClientTurnID: alias["client_turn_id"], Surface: QuerySurfaceChat,
			}
			_, err := NewService().resolveExistingV1SubmissionWithDB(
				context.Background(), gdb, "alice", input,
				v1SubmissionTarget{
					dialogueID: row.DialogueId, mode: "instant", operation: "append",
				},
				false,
			)
			if !errors.Is(err, ErrDuplicateClientTurn) {
				t.Fatalf("retired key %q query %q error=%v, want ErrDuplicateClientTurn", alias["client_turn_id"], query, err)
			}
		}
	}
}

func TestRetiredClientTurnCapacityRejectsNewReplacementBeforeDispatch(t *testing.T) {
	const retiredCapacity = 8
	gdb := setupExpertTestDB(t)
	retired := make([]map[string]string, retiredCapacity)
	for index := range retired {
		retired[index] = map[string]string{
			"client_turn_id":      fmt.Sprintf("retired-capacity-%d", index),
			"request_fingerprint": strings.Repeat(fmt.Sprintf("%x", index+1), 64)[:64],
		}
	}
	encoded, err := json.Marshal(map[string]interface{}{
		"report_revision": -1,
		"conversation_context": map[string]interface{}{
			"client_turn_id":      "capacity-current-key",
			"request_fingerprint": strings.Repeat("f", 64),
			"retired_identities":  retired,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	row := model.QuestionAgentLog{
		DialogueId: "capacity-dialogue", UserName: "alice",
		Query: "capacity accepted", Answer: "capacity accepted answer",
		ToolName: "InSilicoResearchAgent", Mode: "expert", Status: statusSucceeded,
		BotProjectionJSON: string(encoded), BotReportRevision: -1,
	}
	if err := gdb.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	input := QueryInput{
		Query: "replacement beyond retired capacity", Mode: "expert",
		Tool: "InSilicoResearchAgent", ClientTurnID: "capacity-next-key",
		RefreshId: row.Id, Surface: QuerySurfaceChat,
	}
	_, err = NewService().allocateOwnerSubmissionWithDB(
		context.Background(), gdb, "alice", input,
		v1SubmissionTarget{
			dialogueID: row.DialogueId, mode: "expert", operation: "replace",
		},
		AgentPermissionResolution{AllowedTools: []string{"InSilicoResearchAgent"}},
		false,
		false,
	)
	if !errors.Is(err, ErrDuplicateClientTurn) {
		t.Fatalf("replacement beyond retired capacity error=%v, want ErrDuplicateClientTurn", err)
	}
	var rows int64
	if countErr := gdb.Model(&model.QuestionAgentLog{}).Count(&rows).Error; countErr != nil || rows != 1 {
		t.Fatalf("capacity rejection rows=%d error=%v, want 1", rows, countErr)
	}
}

func TestOversizedPrivateReplacementTerminalAnswerIsOmittedNotTruncated(t *testing.T) {
	answer := `{"payload":"` + strings.Repeat("界", maxPersistedReplacementAnswerBytes) + `"}`
	terminal := replacementTerminalResult(&QueryData{
		ToolName: "InSilicoResearchAgent", Status: "FAILED",
		BotRunID: "run-terminal-oversize", Answer: answer,
		FollowUpQuestions: strings.Repeat("x", maxPersistedReplacementFollowUpBytes+1),
	})
	if terminal == nil {
		t.Fatal("terminal result is nil")
	}
	if terminal.Answer != "" {
		t.Fatalf("oversized private terminal answer bytes=%d, want safe omission", len(terminal.Answer))
	}
	if terminal.FollowUpQuestions != "" {
		t.Fatalf("oversized invalid private follow-up persisted %d bytes", len(terminal.FollowUpQuestions))
	}
}
