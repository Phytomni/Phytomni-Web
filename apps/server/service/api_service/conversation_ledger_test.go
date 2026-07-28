package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"

	rxBot "phytomni-server/external/bot"

	"gorm.io/gorm"
)

const ledgerTestDialogueID = "11111111-1111-4111-8111-111111111111"

func TestConversationLedgerOwnershipReturnsUniformNotFound(t *testing.T) {
	gdb := setupTestDB(t)
	seedConversationLedgerRow(t, gdb, ledgerTestRow{
		ID: 10, DialogueID: ledgerTestDialogueID, Owner: "alice", Status: statusSucceeded,
	})

	_, crossOwnerErr := BuildConversationLedger(context.Background(), "bob", ledgerTestDialogueID)
	_, absentErr := BuildConversationLedger(
		context.Background(),
		"bob",
		"22222222-2222-4222-8222-222222222222",
	)
	if !errors.Is(crossOwnerErr, ErrConversationLedgerNotFound) {
		t.Fatalf("cross-owner error = %v, want ledger not found", crossOwnerErr)
	}
	if !errors.Is(absentErr, ErrConversationLedgerNotFound) {
		t.Fatalf("absent error = %v, want ledger not found", absentErr)
	}
	if crossOwnerErr.Error() != absentErr.Error() {
		t.Fatalf("ownership oracle differs: cross-owner=%q absent=%q", crossOwnerErr, absentErr)
	}
}

func TestConversationLedgerDeletedRootIsInaccessibleWithLiveChildren(t *testing.T) {
	gdb := setupTestDB(t)
	deletedAt := time.Date(2026, 7, 27, 8, 0, 0, 0, time.UTC)
	seedConversationLedgerRow(t, gdb, ledgerTestRow{
		ID: 20, DialogueID: ledgerTestDialogueID, Owner: "alice",
		Status: statusSucceeded, DeleteAt: &deletedAt,
	})
	seedConversationLedgerRow(t, gdb, ledgerTestRow{
		ID: 21, ParentID: 20, DialogueID: ledgerTestDialogueID,
		Owner: "alice", Status: statusSucceeded,
	})

	_, err := BuildConversationLedger(context.Background(), "alice", ledgerTestDialogueID)
	if !errors.Is(err, ErrConversationLedgerNotFound) {
		t.Fatalf("deleted root error = %v, want ledger not found", err)
	}
}

func TestConversationLedgerOrdersRowsAndBuildsAcceptedHistory(t *testing.T) {
	gdb := setupTestDB(t)
	seedConversationLedgerRow(t, gdb, ledgerTestRow{
		ID: 30, DialogueID: ledgerTestDialogueID, Owner: "alice",
		Query: "root question", Answer: "root raw answer", Status: statusSucceeded,
		Summary: "root bounded summary",
	})
	for _, row := range []ledgerTestRow{
		{
			ID: 36, ParentID: 30, DialogueID: ledgerTestDialogueID, Owner: "alice",
			Query: "current question", Answer: "must not replay", Status: "SUBMITTING",
		},
		{
			ID: 35, ParentID: 30, DialogueID: ledgerTestDialogueID, Owner: "alice",
			Query: "input question", Answer: "input answer", Status: "INPUT_REQUIRED",
			Summary: "input summary",
		},
		{
			ID: 32, ParentID: 30, DialogueID: ledgerTestDialogueID, Owner: "alice",
			Query: "successful question", Answer: "full private answer", Status: statusSucceeded,
			Summary: "Bot controlled summary",
		},
		{
			ID: 34, ParentID: 30, DialogueID: ledgerTestDialogueID, Owner: "alice",
			Query: "running question", Answer: "running answer", Status: "RUNNING",
			Summary: "running summary",
		},
		{
			ID: 33, ParentID: 30, DialogueID: ledgerTestDialogueID, Owner: "alice",
			Query: "failed question", Answer: "failed answer", Status: "FAILED",
			Summary: "failed summary",
		},
		{
			ID: 31, ParentID: 30, DialogueID: ledgerTestDialogueID, Owner: "alice",
			Query: "legacy successful question", Answer: "legacy full answer", Status: statusSucceeded,
		},
	} {
		seedConversationLedgerRow(t, gdb, row)
	}

	ledger, err := BuildConversationLedger(context.Background(), "alice", ledgerTestDialogueID)
	if err != nil {
		t.Fatal(err)
	}
	var rowIDs []int64
	for _, row := range ledger.rows {
		rowIDs = append(rowIDs, row.ID)
	}
	if got, want := fmt.Sprint(rowIDs), "[30 31 32 33 34 35 36]"; got != want {
		t.Fatalf("row order = %s, want %s", got, want)
	}

	history := ledger.HistoryBefore(36)
	wantHistory := []rxBot.LedgerEntryV1{
		{TurnID: "30", Role: "user", Content: "root question"},
		{TurnID: "30", Role: "assistant", Summary: "root bounded summary"},
		{TurnID: "31", Role: "user", Content: "legacy successful question"},
		{TurnID: "32", Role: "user", Content: "successful question"},
		{TurnID: "32", Role: "assistant", Summary: "Bot controlled summary"},
	}
	if got, want := mustJSON(t, history), mustJSON(t, wantHistory); got != want {
		t.Fatalf("history = %s, want %s", got, want)
	}
	encoded := mustJSON(t, history)
	for _, forbidden := range []string{
		"root raw answer",
		"legacy full answer",
		"full private answer",
		"failed question",
		"running question",
		"input question",
		"current question",
		"must not replay",
	} {
		if strings.Contains(encoded, forbidden) {
			t.Fatalf("history contains excluded content %q: %s", forbidden, encoded)
		}
	}
}

func TestConversationLedgerAuthorizesOpaqueArtifactsWithoutPaths(t *testing.T) {
	gdb := setupTestDB(t)
	seedConversationLedgerRow(t, gdb, ledgerTestRow{
		ID: 40, DialogueID: ledgerTestDialogueID, Owner: "alice",
		Query: "root", Answer: "raw", Status: statusSucceeded,
		DownloadPath: "obs://private-bucket/alice/run-40",
		ArtifactRefs: []rxBot.ArtifactRefV1{
			{ArtifactID: "artifact-40", DisplayName: "result.csv"},
			{ArtifactID: "artifact-41", DisplayName: "review.pdf"},
		},
	})
	seedConversationLedgerRow(t, gdb, ledgerTestRow{
		ID: 41, ParentID: 40, DialogueID: ledgerTestDialogueID, Owner: "alice",
		Query: "failed", Status: "FAILED",
		ArtifactRefs: []rxBot.ArtifactRefV1{
			{ArtifactID: "failed-artifact", DisplayName: "failed.csv"},
		},
	})

	ledger, err := BuildConversationLedger(context.Background(), "alice", ledgerTestDialogueID)
	if err != nil {
		t.Fatal(err)
	}
	refs, err := ledger.AuthorizeArtifactIDs([]string{"artifact-41", "artifact-40"})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := mustJSON(t, refs), `[{"artifact_id":"artifact-41","display_name":"review.pdf"},{"artifact_id":"artifact-40","display_name":"result.csv"}]`; got != want {
		t.Fatalf("artifact refs = %s, want %s", got, want)
	}
	if strings.Contains(mustJSON(t, refs), "obs://") {
		t.Fatalf("authorized refs expose storage path: %s", mustJSON(t, refs))
	}

	for _, artifactID := range []string{"failed-artifact", "foreign-artifact", "obs://private-bucket/alice/run-40"} {
		refs, err = ledger.AuthorizeArtifactIDs([]string{"artifact-40", artifactID})
		if !errors.Is(err, ErrConversationArtifactOwnership) {
			t.Fatalf("artifact %q error = %v, want ownership error", artifactID, err)
		}
		if refs != nil {
			t.Fatalf("artifact %q returned partial refs: %#v", artifactID, refs)
		}
	}
}

func TestConversationLedgerFingerprintIsCanonicalAndSensitive(t *testing.T) {
	gdb := setupTestDB(t)
	baseTime := time.Date(2026, 7, 27, 9, 10, 11, 123456000, time.UTC)
	seedConversationLedgerRow(t, gdb, ledgerTestRow{
		ID: 50, DialogueID: ledgerTestDialogueID, Owner: "alice",
		Query: "secret query", Answer: "secret answer", ToolName: "ChatAgent",
		Mode: "instant", Status: statusSucceeded, ReportRevision: 3, UpdatedAt: baseTime,
		Summary: "summary excluded from fingerprint",
	})

	first, err := BuildConversationLedger(context.Background(), "alice", ledgerTestDialogueID)
	if err != nil {
		t.Fatal(err)
	}
	second, err := BuildConversationLedger(context.Background(), "alice", ledgerTestDialogueID)
	if err != nil {
		t.Fatal(err)
	}
	if first.Version != second.Version {
		t.Fatalf("same ledger hashes differ: %q != %q", first.Version, second.Version)
	}
	if len(first.Version) != 64 {
		t.Fatalf("ledger version length = %d, want 64", len(first.Version))
	}
	fingerprintRows := first.fingerprintRows()
	if got, want := fingerprintRows[0].QuerySHA256, "ec842c9fd97835e4c5c9632ef102952d0028db84e97188528d45d72b1c776389"; got != want {
		t.Fatalf("query SHA-256 = %q, want %q", got, want)
	}
	if got, want := fingerprintRows[0].AnswerSHA256, "b7ed233c6cc811e62e79cd8a628e6dabd99ef8e09eba9f68fc95d7aa99eabd7c"; got != want {
		t.Fatalf("answer SHA-256 = %q, want %q", got, want)
	}
	if got, want := fingerprintRows[0].UpdatedAtUTC, "2026-07-27T09:10:11.123456Z"; got != want {
		t.Fatalf("updated_at_utc = %q, want %q", got, want)
	}

	canonical, err := json.Marshal(fingerprintRows)
	if err != nil {
		t.Fatal(err)
	}
	for _, plaintext := range []string{
		"secret query",
		"secret answer",
		"summary excluded from fingerprint",
		"conversation_context",
		"bot_projection_json",
	} {
		if strings.Contains(string(canonical), plaintext) {
			t.Fatalf("canonical fingerprint exposes %q: %s", plaintext, canonical)
		}
	}
	var fields []map[string]interface{}
	if err := json.Unmarshal(canonical, &fields); err != nil {
		t.Fatal(err)
	}
	wantKeys := []string{
		"answer_sha256", "id", "mode", "parent_id", "query_sha256",
		"report_revision", "status", "tool_name", "updated_at_utc",
	}
	if got := sortedMapKeys(fields[0]); fmt.Sprint(got) != fmt.Sprint(wantKeys) {
		t.Fatalf("fingerprint keys = %v, want %v", got, wantKeys)
	}

	mutations := []struct {
		name  string
		query string
		args  []interface{}
	}{
		{name: "query", query: "UPDATE question_agent_logs SET query = ? WHERE id = 50", args: []interface{}{"changed query"}},
		{name: "answer", query: "UPDATE question_agent_logs SET answer = ? WHERE id = 50", args: []interface{}{"changed answer"}},
		{name: "status", query: "UPDATE question_agent_logs SET status = ? WHERE id = 50", args: []interface{}{"FAILED"}},
		{name: "revision", query: "UPDATE question_agent_logs SET bot_report_revision = ? WHERE id = 50", args: []interface{}{int64(4)}},
		{
			name:  "replacement timestamp",
			query: "UPDATE question_agent_logs SET updated_at = ? WHERE id = 50",
			args:  []interface{}{baseTime.Add(time.Second)},
		},
	}
	for _, mutation := range mutations {
		t.Run(mutation.name, func(t *testing.T) {
			tx := gdb.Begin()
			if tx.Error != nil {
				t.Fatal(tx.Error)
			}
			if err := tx.Exec(mutation.query, mutation.args...).Error; err != nil {
				_ = tx.Rollback()
				t.Fatal(err)
			}
			withMutation, err := buildConversationLedgerWithDB(
				context.Background(), tx, "alice", ledgerTestDialogueID,
			)
			_ = tx.Rollback()
			if err != nil {
				t.Fatal(err)
			}
			if withMutation.Version == first.Version {
				t.Fatalf("%s did not change fingerprint %q", mutation.name, first.Version)
			}
		})
	}
}

func TestConversationLedgerFingerprintExcludesContextMetadata(t *testing.T) {
	gdb := setupTestDB(t)
	seedConversationLedgerRow(t, gdb, ledgerTestRow{
		ID: 60, DialogueID: ledgerTestDialogueID, Owner: "alice",
		Query: "question", Answer: "answer", Status: statusSucceeded,
		Summary: "first summary",
		ArtifactRefs: []rxBot.ArtifactRefV1{
			{ArtifactID: "artifact-60", DisplayName: "first.csv"},
		},
	})
	before, err := BuildConversationLedger(context.Background(), "alice", ledgerTestDialogueID)
	if err != nil {
		t.Fatal(err)
	}

	replacement := persistedConversationContext{
		ClientTurnID:     "turn-replacement",
		AssistantSummary: "replacement summary",
		ArtifactRefs: []rxBot.ArtifactRefV1{
			{ArtifactID: "artifact-61", DisplayName: "replacement.csv"},
		},
	}
	raw, err := marshalPersistedProjectionWithContext(BotRunProjection{
		ReportRevision: 0,
	}, &replacement)
	if err != nil {
		t.Fatal(err)
	}
	if err := gdb.Exec(
		"UPDATE question_agent_logs SET bot_projection_json = ? WHERE id = 60",
		raw,
	).Error; err != nil {
		t.Fatal(err)
	}
	after, err := BuildConversationLedger(context.Background(), "alice", ledgerTestDialogueID)
	if err != nil {
		t.Fatal(err)
	}
	if before.Version != after.Version {
		t.Fatalf("context metadata changed fingerprint: before=%q after=%q", before.Version, after.Version)
	}
	if got := after.HistoryBefore(61); len(got) != 2 || got[1].Summary != "replacement summary" {
		t.Fatalf("updated context not available to history: %#v", got)
	}
}

type ledgerTestRow struct {
	ID             int64
	ParentID       int64
	DialogueID     string
	Owner          string
	Query          string
	Answer         string
	ToolName       string
	Mode           string
	Status         string
	ReportRevision int64
	UpdatedAt      time.Time
	DeleteAt       *time.Time
	DownloadPath   string
	Summary        string
	ArtifactRefs   []rxBot.ArtifactRefV1
}

func seedConversationLedgerRow(t *testing.T, gdb *gorm.DB, row ledgerTestRow) {
	t.Helper()
	if row.DialogueID == "" {
		row.DialogueID = ledgerTestDialogueID
	}
	if row.Owner == "" {
		row.Owner = "alice"
	}
	if row.ToolName == "" {
		row.ToolName = "ChatAgent"
	}
	if row.Mode == "" {
		row.Mode = "instant"
	}
	if row.UpdatedAt.IsZero() {
		row.UpdatedAt = time.Date(2026, 7, 27, 8, 0, int(row.ID%60), 0, time.UTC)
	}
	var privateContext *persistedConversationContext
	if row.Summary != "" || len(row.ArtifactRefs) > 0 {
		privateContext = &persistedConversationContext{
			AssistantSummary: row.Summary,
			ArtifactRefs:     append([]rxBot.ArtifactRefV1(nil), row.ArtifactRefs...),
		}
	}
	projectionJSON, err := marshalPersistedProjectionWithContext(BotRunProjection{
		ReportRevision: row.ReportRevision,
		Artifacts: ProjectionArtifacts{
			Paths: []string{row.DownloadPath},
		},
	}, privateContext)
	if err != nil {
		t.Fatalf("marshal projection: %v", err)
	}
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, query, answer, tool_name, mode, status,
		 bot_projection_json, bot_report_revision, download_path, created_at, updated_at, delete_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		row.ID,
		row.DialogueID,
		row.ParentID,
		row.Owner,
		row.Query,
		row.Answer,
		row.ToolName,
		row.Mode,
		row.Status,
		projectionJSON,
		row.ReportRevision,
		row.DownloadPath,
		row.UpdatedAt,
		row.UpdatedAt,
		row.DeleteAt,
	).Error; err != nil {
		t.Fatalf("seed ledger row %d: %v", row.ID, err)
	}
}

func mustJSON(t *testing.T, value interface{}) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}

func sortedMapKeys(value map[string]interface{}) []string {
	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
