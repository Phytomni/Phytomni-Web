package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"phytomni-server/db"
	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
	"phytomni-server/utils"
)

// setupExpertTestDB opens an in-memory SQLite with the columns Query writes,
// INCLUDING the new `mode` column. Pinned to 1 conn (write-then-read stability).
func setupExpertTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if sqlDB, err := gdb.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	if err := gdb.Exec(`CREATE TABLE question_agent_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		dialogue_id TEXT, f_id INTEGER DEFAULT 0, server_id TEXT, bot_run_id TEXT, bot_projection_json TEXT, bot_report_revision INTEGER NOT NULL DEFAULT -1,
		user_name TEXT, query TEXT, title_query TEXT, answer TEXT,
		follow_up_questions TEXT, task_id TEXT, task_log TEXT, file_name TEXT,
		upload_path TEXT, download_path TEXT, image_paths TEXT, compute_resource TEXT,
		server_file_path TEXT, tool_name TEXT, status TEXT, log_status TEXT, mode TEXT,
		reaction_type TEXT, collect_type TEXT, created_at DATETIME, updated_at DATETIME, delete_at DATETIME
	)`).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	if err := gdb.Exec(`CREATE TABLE users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT,
		code TEXT
	)`).Error; err != nil {
		t.Fatalf("create users table: %v", err)
	}
	for _, statement := range []string{
		`CREATE TABLE tool_names (id INTEGER PRIMARY KEY, tool_name TEXT NOT NULL)`,
		`CREATE TABLE user_tool_names (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, tool_id TEXT NOT NULL)`,
	} {
		if err := gdb.Exec(statement).Error; err != nil {
			t.Fatalf("create permission table: %v", err)
		}
	}
	// These synthetic callers represent administrator fixtures used by the
	// shared blocking and streaming allowed-path tests; production authorization
	// still resolves the real JWT operator from the Web users table.
	for _, email := range []string{
		"alice",
		"dan",
		"alice@x.com",
		"task27-expert@example.com",
		"alice@example.com",
		"ready@example.com",
		"broken@example.com",
		"cancel@example.com",
		"action@example.com",
		"bob@example.com",
		"eve@example.com",
		"carol@example.com",
		"compat@example.com",
		"task27-stream@example.com",
		"task27-error@example.com",
		"gate@example.com",
		"network@example.com",
		"dan@example.com",
		"erin@example.com",
	} {
		if err := gdb.Exec(`INSERT INTO users (email, code) VALUES (?, 'admin')`, email).Error; err != nil {
			t.Fatalf("seed expert user %s: %v", email, err)
		}
	}
	db.Set("phytomni-server", gdb)
	return gdb
}

func seedExpertPermissionUser(t *testing.T, gdb *gorm.DB, email, code string) {
	t.Helper()
	if err := gdb.Exec(`INSERT INTO users (email, code) VALUES (?, ?)`, email, code).Error; err != nil {
		t.Fatalf("seed permission user %s: %v", email, err)
	}
}

func seedExpertPermissionTool(t *testing.T, gdb *gorm.DB, code, tool string, id int) {
	t.Helper()
	if err := gdb.Exec(`INSERT INTO tool_names (id, tool_name) VALUES (?, ?)`, id, tool).Error; err != nil {
		t.Fatalf("seed permission tool %s: %v", tool, err)
	}
	if err := gdb.Exec(`INSERT INTO user_tool_names (code, tool_id) VALUES (?, ?)`, code, id).Error; err != nil {
		t.Fatalf("seed permission grant %s/%s: %v", code, tool, err)
	}
}

// botRouter returns an httptest Bot that records the hit path and answers the
// route + chat endpoints, so a test can assert which path Expert/Instant takes.
func botRouter(t *testing.T, hit *string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*hit = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/query/route":
			_, _ = w.Write([]byte(`{"id":"run-x","run_id":"run-x","object":"agent.run","agent":"knowledge","status":"succeeded","task_ids":[],"result":{"formatted":{"answer":"body","references":[{"file_id":"f1","title":"Doc A"}]}}}`))
		case "/v1/chat/completions":
			_, _ = w.Write([]byte(`{"id":"c1","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"hi"}}],"formatted":{"answer":"hi"}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, ExpertEnabled: true, TimeoutSeconds: 5,
		ResearchEnabled: true, DesignEnabled: true, NetworkEnabled: true,
	}
	t.Cleanup(func() { rxBot.BotConfig = nil })
}

type queryPermissionEffects struct {
	uploads           int
	botCalls          int
	dialogueQueries   int
	persistenceWrites int
}

func observeQueryPermissionEffects(t *testing.T, gdb *gorm.DB) *queryPermissionEffects {
	t.Helper()
	effects := &queryPermissionEffects{}
	const (
		queryCallback  = "task13_observe_dialogue_resolution"
		createCallback = "task13_observe_persistence_create"
		updateCallback = "task13_observe_persistence_update"
	)
	if err := gdb.Callback().Query().Before("gorm:query").Register(queryCallback, func(tx *gorm.DB) {
		if tx.Statement != nil && tx.Statement.Table == "question_agent_logs" {
			effects.dialogueQueries++
		}
	}); err != nil {
		t.Fatalf("register dialogue callback: %v", err)
	}
	if err := gdb.Callback().Create().Before("gorm:create").Register(createCallback, func(tx *gorm.DB) {
		if tx.Statement != nil && tx.Statement.Table == "question_agent_logs" {
			effects.persistenceWrites++
		}
	}); err != nil {
		t.Fatalf("register create callback: %v", err)
	}
	if err := gdb.Callback().Update().Before("gorm:update").Register(updateCallback, func(tx *gorm.DB) {
		if tx.Statement != nil && tx.Statement.Table == "question_agent_logs" {
			effects.persistenceWrites++
		}
	}); err != nil {
		t.Fatalf("register update callback: %v", err)
	}
	return effects
}

func (effects *queryPermissionEffects) assertNone(t *testing.T) {
	t.Helper()
	if effects.uploads != 0 || effects.botCalls != 0 || effects.dialogueQueries != 0 || effects.persistenceWrites != 0 {
		t.Fatalf("permission failure side effects = %+v, want all zero", effects)
	}
}

func permissionRouteServer(t *testing.T, effects *queryPermissionEffects, captured *rxBot.RouteQueryRequest) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		effects.botCalls++
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/files":
			effects.uploads++
			_, _ = w.Write([]byte(`{"id":"file-task13","path":"obs://task13/file"}`))
		case "/v1/query/route":
			if captured != nil {
				if err := json.NewDecoder(r.Body).Decode(captured); err != nil {
					t.Errorf("decode route request: %v", err)
				}
			}
			_, _ = w.Write([]byte(`{"id":"run-task13","run_id":"run-task13","object":"agent.run","agent":"data","status":"succeeded","task_ids":[],"result":{"formatted":{"answer":"ok","references":[]}}}`))
		case "/v1/chat/completions":
			_, _ = w.Write([]byte(`{"id":"chat-task13","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"ok"}}],"formatted":{"answer":"ok"}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, ExpertEnabled: true, TimeoutSeconds: 5,
		ResearchEnabled: true, DesignEnabled: true, NetworkEnabled: true,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })
}

// TestQuery_ExpertRoutesToRouteEndpoint is the slug-gate regression lock:
// mode=expert (flag ON) MUST hit /v1/query/route, never /v1/chat/completions
// (the SlugFor("")->"chat" collapse). Reshapes by the resolved slug and
// persists mode="expert".
func TestQuery_ExpertRoutesToRouteEndpoint(t *testing.T) {
	gdb := setupExpertTestDB(t)
	var hit string
	botRouter(t, &hit)

	out, err := NewService().Query(context.Background(), "alice", QueryInput{Query: "q", Mode: "expert"})
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	if hit != "/v1/query/route" {
		t.Fatalf("expert must hit /v1/query/route, hit %q (ChatAgent collapse?)", hit)
	}
	if out.ToolName != "KnowledgeAgent" {
		t.Errorf("expected resolved tool_name KnowledgeAgent, got %q", out.ToolName)
	}
	if !strings.Contains(out.Answer, "doc_list") || !strings.Contains(out.Answer, "Doc A") {
		t.Errorf("expert answer not reshaped by resolved slug: %q", out.Answer)
	}
	var mode string
	gdb.Raw(`SELECT COALESCE(mode,'') FROM question_agent_logs WHERE id=?`, out.Id).Row().Scan(&mode)
	if mode != "expert" {
		t.Errorf("expected persisted mode=expert, got %q", mode)
	}
}

// TestQueryExpertV1ForwardsOnlyValidatedPerTurnSelection locks that a forced
// agent under the v1 multiturn flag uses Bot's context-aware route and carries
// the server-owned selection through forced_tool.
func TestQueryExpertV1ForwardsOnlyValidatedPerTurnSelection(t *testing.T) {
	gdb := setupExpertTestDB(t)
	var dispatchPath string
	var captured rxBot.AgentRunRequest
	var settleCalls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/agents/data/runs":
			dispatchPath = r.URL.Path
			if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
				t.Errorf("decode agent request: %v", err)
				return
			}
			stage := rxBot.ContextStageMetadata{
				SchemaVersion:                  1,
				TurnID:                         captured.Conversation.TurnID,
				SelectedAgentID:                "DataAgent",
				RouteSource:                    "explicit_selection",
				RouteReasonCode:                "EXPLICIT_SELECTION",
				BaseBusinessContextVersion:     captured.Conversation.BaseBusinessContextVersion,
				ProposedBusinessContextVersion: captured.Conversation.BaseBusinessContextVersion + 1,
				LastAppliedLedgerCursor:        captured.Conversation.LedgerCursor,
			}
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"id": "run-v1-data", "run_id": "run-v1-data",
				"object": "agent.run", "agent": "data", "status": "succeeded",
				"task_ids":             []string{},
				"result":               map[string]interface{}{"formatted": map[string]interface{}{"answer": "ok"}},
				"conversation_context": stage,
			})
		case "/v1/conversation-context/settle":
			settleCalls++
			_ = json.NewEncoder(w).Encode(rxBot.ContextMutationResponse{
				SchemaVersion: 1, State: "committed", ContextVersion: 1,
			})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, ExpertEnabled: true, TimeoutSeconds: 5,
		MultiturnV1Enabled: true,
	}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	out, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query:        "compare datasets",
		Mode:         "expert",
		Tool:         "DataAgent",
		ClientTurnID: "expert-turn-1",
	})
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	if dispatchPath != "/v1/agents/data/runs" || settleCalls != 1 {
		t.Fatalf("forced DataAgent under v1 dispatch/settle = %q/%d", dispatchPath, settleCalls)
	}
	if captured.Conversation == nil || captured.Conversation.RequestedAgentID == nil ||
		*captured.Conversation.RequestedAgentID != "DataAgent" {
		t.Fatalf("requested agent = %#v", captured.Conversation)
	}
	if out.ToolName != "DataAgent" {
		t.Fatalf("tool_name = %q, want DataAgent", out.ToolName)
	}
	var rows int64
	if err := gdb.Model(&model.QuestionAgentLog{}).Count(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Fatalf("row count = %d, want 1", rows)
	}
}

// TestQuery_ExpertDisabledReturns503Sentinel: flag OFF -> ErrExpertDisabled, no Bot call.
func TestQuery_ExpertDisabledReturns503Sentinel(t *testing.T) {
	setupExpertTestDB(t)
	var hit string
	botRouter(t, &hit)
	rxBot.BotConfig.ExpertEnabled = false

	_, err := NewService().Query(context.Background(), "alice", QueryInput{Query: "q", Mode: "expert"})
	if !errors.Is(err, ErrExpertDisabled) {
		t.Fatalf("expected ErrExpertDisabled, got %v", err)
	}
	if hit != "" {
		t.Errorf("disabled Expert must not call Bot, hit %q", hit)
	}
}

func TestQuery_ExpertUsesServerOrderedAllowedTools(t *testing.T) {
	gdb := setupExpertTestDB(t)
	seedExpertPermissionUser(t, gdb, "partial@example.com", "partial")
	seedExpertPermissionTool(t, gdb, "partial", "AnalystAgent", 1)
	seedExpertPermissionTool(t, gdb, "partial", "ChatAgent", 2)
	seedExpertPermissionTool(t, gdb, "partial", "DataAgent", 3)
	effects := &queryPermissionEffects{}
	var captured rxBot.RouteQueryRequest
	permissionRouteServer(t, effects, &captured)

	if _, err := NewService().Query(context.Background(), "partial@example.com", QueryInput{Query: "q", Mode: "expert"}); err != nil {
		t.Fatalf("Query: %v", err)
	}
	want := []string{"ChatAgent", "DataAgent", "AnalystAgent"}
	if !reflect.DeepEqual(captured.AllowedTools, want) {
		t.Fatalf("allowed tools = %#v, want %#v", captured.AllowedTools, want)
	}
	if captured.ForcedTool != nil {
		t.Fatalf("autonomous Expert forced tool = %q, want nil", *captured.ForcedTool)
	}
}

// TestQuery_ExpertForwardsAllowedForcedTool locks the direct-dispatch contract:
// a forced non-chat agent (DataAgent) in Expert mode is permission-gated and
// then invoked directly on /v1/agents/{slug}/runs — never through the LLM router
// at /v1/query/route. Only autonomous Expert (no forced tool) uses the router.
func TestQuery_ExpertForwardsAllowedForcedTool(t *testing.T) {
	gdb := setupExpertTestDB(t)
	seedExpertPermissionUser(t, gdb, "forced@example.com", "forced")
	seedExpertPermissionTool(t, gdb, "forced", "AnalystAgent", 1)
	seedExpertPermissionTool(t, gdb, "forced", "ChatAgent", 2)
	seedExpertPermissionTool(t, gdb, "forced", "DataAgent", 3)
	var hit string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hit = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/agents/data/runs" {
			_, _ = w.Write([]byte(`{"id":"run-forced-data","object":"agent.run","agent":"data","status":"succeeded","task_ids":[],"result":{"formatted":{"answer":"ok"}}}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, ExpertEnabled: true, TimeoutSeconds: 5,
	}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	if _, err := NewService().Query(context.Background(), "forced@example.com", QueryInput{
		Query: "q", Mode: "expert", Tool: "DataAgent",
	}); err != nil {
		t.Fatalf("Query: %v", err)
	}
	if hit != "/v1/agents/data/runs" {
		t.Fatalf("forced DataAgent must dispatch directly to /v1/agents/data/runs, hit %q", hit)
	}
}

func TestQuery_InstantAllowsEffectiveChatAgent(t *testing.T) {
	gdb := setupExpertTestDB(t)
	seedExpertPermissionUser(t, gdb, "chat@example.com", "chat")
	seedExpertPermissionTool(t, gdb, "chat", "ChatAgent", 1)
	effects := &queryPermissionEffects{}
	permissionRouteServer(t, effects, nil)

	if _, err := NewService().Query(context.Background(), "chat@example.com", QueryInput{Query: "q", Mode: "instant"}); err != nil {
		t.Fatalf("Query: %v", err)
	}
	if effects.botCalls != 1 || effects.uploads != 0 {
		t.Fatalf("instant Chat effects = %+v, want one chat call and no upload", effects)
	}
}

func TestQuery_ExpertAllowsOneRemoteProductGrant(t *testing.T) {
	gdb := setupExpertTestDB(t)
	seedExpertPermissionUser(t, gdb, "research@example.com", "research-role")
	seedExpertPermissionTool(t, gdb, "research-role", "InSilicoResearchAgent", 1)
	expertRouteServer(t, `{"id":"run-research","object":"agent.run","agent":"research","status":"running","task_ids":["child-research"],"result":{}}`)
	rxBot.BotConfig.DesignEnabled = false
	rxBot.BotConfig.NetworkEnabled = false

	if _, err := NewService().Query(context.Background(), "research@example.com", QueryInput{Query: "q", Mode: "expert"}); err != nil {
		t.Fatalf("Query: %v", err)
	}
}

func TestQuery_ExpertAdminUsesEveryCurrentlyAvailableTool(t *testing.T) {
	setupExpertTestDB(t)
	effects := &queryPermissionEffects{}
	var captured rxBot.RouteQueryRequest
	permissionRouteServer(t, effects, &captured)
	rxBot.BotConfig.NetworkEnabled = false

	if _, err := NewService().Query(context.Background(), "alice", QueryInput{Query: "q", Mode: "expert"}); err != nil {
		t.Fatalf("Query: %v", err)
	}
	want := make([]string, 0, len(rxBot.CanonicalAgentDisplayOrder)-1)
	for _, tool := range rxBot.CanonicalAgentDisplayOrder {
		if tool != "GeneNetworkAgent" {
			want = append(want, tool)
		}
	}
	if !reflect.DeepEqual(captured.AllowedTools, want) {
		t.Fatalf("admin allowed tools = %#v, want %#v", captured.AllowedTools, want)
	}
}

func TestQuery_PermissionFailuresHaveNoSideEffects(t *testing.T) {
	tests := []struct {
		name      string
		username  string
		mode      string
		tool      string
		setup     func(t *testing.T, gdb *gorm.DB)
		configure func()
		assertErr func(t *testing.T, err error)
	}{
		{
			name:     "instant without ChatAgent",
			username: "no-chat@example.com",
			mode:     "instant",
			setup: func(t *testing.T, gdb *gorm.DB) {
				seedExpertPermissionUser(t, gdb, "no-chat@example.com", "no-chat")
				seedExpertPermissionTool(t, gdb, "no-chat", "DataAgent", 1)
			},
			assertErr: func(t *testing.T, err error) {
				if !errors.Is(err, ErrAgentToolForbidden) {
					t.Fatalf("error = %v, want ErrAgentToolForbidden", err)
				}
			},
		},
		{
			name:     "forced canonical but ungranted",
			username: "ungranted@example.com",
			mode:     "expert",
			tool:     "AnalystAgent",
			setup: func(t *testing.T, gdb *gorm.DB) {
				seedExpertPermissionUser(t, gdb, "ungranted@example.com", "ungranted")
				seedExpertPermissionTool(t, gdb, "ungranted", "DataAgent", 1)
			},
			assertErr: func(t *testing.T, err error) {
				if !errors.Is(err, ErrAgentToolForbidden) {
					t.Fatalf("error = %v, want ErrAgentToolForbidden", err)
				}
			},
		},
		{
			name:     "forced granted but disabled",
			username: "disabled-forced@example.com",
			mode:     "expert",
			tool:     "InSilicoResearchAgent",
			setup: func(t *testing.T, gdb *gorm.DB) {
				seedExpertPermissionUser(t, gdb, "disabled-forced@example.com", "disabled-forced")
				seedExpertPermissionTool(t, gdb, "disabled-forced", "InSilicoResearchAgent", 1)
			},
			configure: func() { rxBot.BotConfig.ResearchEnabled = false },
			assertErr: func(t *testing.T, err error) {
				if !errors.Is(err, ErrAgentToolsUnavailable) {
					t.Fatalf("error = %v, want ErrAgentToolsUnavailable", err)
				}
			},
		},
		{
			name:     "no grants",
			username: "empty@example.com",
			mode:     "expert",
			setup: func(t *testing.T, gdb *gorm.DB) {
				seedExpertPermissionUser(t, gdb, "empty@example.com", "empty")
			},
			assertErr: func(t *testing.T, err error) {
				if !errors.Is(err, ErrNoExecutableAgentTools) {
					t.Fatalf("error = %v, want ErrNoExecutableAgentTools", err)
				}
			},
		},
		{
			name:     "granted but all unavailable",
			username: "disabled@example.com",
			mode:     "expert",
			setup: func(t *testing.T, gdb *gorm.DB) {
				seedExpertPermissionUser(t, gdb, "disabled@example.com", "disabled")
				seedExpertPermissionTool(t, gdb, "disabled", "InSilicoResearchAgent", 1)
			},
			configure: func() { rxBot.BotConfig.ResearchEnabled = false },
			assertErr: func(t *testing.T, err error) {
				if !errors.Is(err, ErrAgentToolsUnavailable) {
					t.Fatalf("error = %v, want ErrAgentToolsUnavailable", err)
				}
			},
		},
		{
			name:     "missing user",
			username: "missing@example.com",
			mode:     "expert",
			assertErr: func(t *testing.T, err error) {
				if !errors.Is(err, ErrAgentPermissionUserNotFound) || !strings.Contains(err.Error(), "resolve agent permissions") {
					t.Fatalf("error = %v, want wrapped ErrAgentPermissionUserNotFound", err)
				}
			},
		},
		{
			name:     "permission database failure",
			username: "db-failure@example.com",
			mode:     "expert",
			setup: func(t *testing.T, gdb *gorm.DB) {
				seedExpertPermissionUser(t, gdb, "db-failure@example.com", "db-failure")
				if err := gdb.Exec(`DROP TABLE user_tool_names`).Error; err != nil {
					t.Fatalf("drop permission table: %v", err)
				}
			},
			assertErr: func(t *testing.T, err error) {
				if err == nil || errors.Is(err, ErrAgentPermissionUserNotFound) || !strings.Contains(err.Error(), "resolve agent permissions") {
					t.Fatalf("error = %v, want wrapped permission database failure", err)
				}
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			if tc.setup != nil {
				tc.setup(t, gdb)
			}
			effects := &queryPermissionEffects{}
			permissionRouteServer(t, effects, nil)
			if tc.configure != nil {
				tc.configure()
			}
			observeQueryPermissionEffects(t, gdb)

			_, err := NewService().Query(context.Background(), tc.username, QueryInput{
				Query: "permission check", Id: 77, Mode: tc.mode, Tool: tc.tool,
				Files: []QueryFile{{Filename: "permission.txt", Data: []byte("x")}},
			})
			tc.assertErr(t, err)
			effects.assertNone(t)
		})
	}
}

func TestQueryStream_PermissionFailuresHaveNoSideEffects(t *testing.T) {
	tests := []struct {
		name      string
		username  string
		setup     func(t *testing.T, gdb *gorm.DB)
		assertErr func(t *testing.T, err error)
	}{
		{
			name:     "instant without ChatAgent",
			username: "stream-no-chat@example.com",
			setup: func(t *testing.T, gdb *gorm.DB) {
				seedExpertPermissionUser(t, gdb, "stream-no-chat@example.com", "stream-no-chat")
				seedExpertPermissionTool(t, gdb, "stream-no-chat", "DataAgent", 1)
			},
			assertErr: func(t *testing.T, err error) {
				if !errors.Is(err, ErrAgentToolForbidden) {
					t.Fatalf("error = %v, want ErrAgentToolForbidden", err)
				}
			},
		},
		{
			name:     "missing user",
			username: "stream-missing@example.com",
			assertErr: func(t *testing.T, err error) {
				if !errors.Is(err, ErrAgentPermissionUserNotFound) || !strings.Contains(err.Error(), "resolve agent permissions") {
					t.Fatalf("error = %v, want wrapped ErrAgentPermissionUserNotFound", err)
				}
			},
		},
		{
			name:     "permission database failure",
			username: "stream-db-failure@example.com",
			setup: func(t *testing.T, gdb *gorm.DB) {
				seedExpertPermissionUser(t, gdb, "stream-db-failure@example.com", "stream-db-failure")
				if err := gdb.Exec(`DROP TABLE user_tool_names`).Error; err != nil {
					t.Fatalf("drop permission table: %v", err)
				}
			},
			assertErr: func(t *testing.T, err error) {
				if err == nil || errors.Is(err, ErrAgentPermissionUserNotFound) || !strings.Contains(err.Error(), "resolve agent permissions") {
					t.Fatalf("error = %v, want wrapped permission database failure", err)
				}
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			if tc.setup != nil {
				tc.setup(t, gdb)
			}
			effects := &queryPermissionEffects{}
			permissionRouteServer(t, effects, nil)
			rxBot.BotConfig.StreamEnabled = true
			observeQueryPermissionEffects(t, gdb)

			_, err := NewService().QueryStream(context.Background(), tc.username, QueryInput{
				Query: "permission check", Id: 77, Mode: "instant",
				Files: []QueryFile{{Filename: "permission.txt", Data: []byte("x")}},
			}, nil, nil)
			tc.assertErr(t, err)
			effects.assertNone(t)
		})
	}
}

func TestQueryStream_InvalidRoutingHasNoSideEffects(t *testing.T) {
	for _, tc := range []struct {
		name string
		mode string
		tool string
	}{
		{name: "instant non-ChatAgent", mode: "instant", tool: "AnalystAgent"},
		{name: "unknown mode", mode: "autonomous", tool: ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			effects := &queryPermissionEffects{}
			permissionRouteServer(t, effects, nil)
			observeQueryPermissionEffects(t, gdb)

			_, err := NewService().QueryStream(context.Background(), "alice", QueryInput{
				Query: "invalid routing", Id: 77, Mode: tc.mode, Tool: tc.tool,
				Files: []QueryFile{{Filename: "invalid.txt", Data: []byte("x")}},
			}, nil, nil)
			if !errors.Is(err, ErrInvalidChatRouting) {
				t.Fatalf("error = %v, want ErrInvalidChatRouting", err)
			}
			effects.assertNone(t)
			var rows int64
			if err := gdb.Model(&model.QuestionAgentLog{}).Count(&rows).Error; err != nil {
				t.Fatalf("count question rows: %v", err)
			}
			if rows != 0 {
				t.Fatalf("invalid routing created %d question rows, want zero", rows)
			}
		})
	}
}

// TestQuery_InstantUnchanged: mode=instant keeps the existing ChatAgent path.
func TestQuery_InstantUnchanged(t *testing.T) {
	setupExpertTestDB(t)
	var hit string
	botRouter(t, &hit)

	if _, err := NewService().Query(context.Background(), "alice", QueryInput{Query: "q", Mode: "instant"}); err != nil {
		t.Fatalf("Query: %v", err)
	}
	if hit != "/v1/chat/completions" {
		t.Errorf("instant must hit /v1/chat/completions, hit %q", hit)
	}
}

// TestQuery_RefreshClearsTaskColumns dynamically exercises the blocking Query
// path's RefreshId!=0 two-step UPDATE branch — the same branch QueryStream
// shares via persistQuestionLog. The streaming sibling test proves the shared
// helper clears the transitional task columns; this locks the blocking caller
// against a regression too (its byte-equivalence was otherwise only verified
// statically, since every other TestQuery_* uses the insert path).
func TestQuery_RefreshClearsTaskColumns(t *testing.T) {
	gdb := setupExpertTestDB(t)
	var hit string
	botRouter(t, &hit)

	// Seed a prior async-agent row with transitional task columns set.
	seed := model.QuestionAgentLog{
		DialogueId: "d1", UserName: "dan", Query: "old",
		ServerId: "srv-1", TaskId: "task-1", LogStatus: "RUNNING",
		ServerFilePath: "obs://old/path", Status: "RUNNING", Mode: "instant",
	}
	if err := gdb.Create(&seed).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	// Re-answer that turn via the blocking chat path (RefreshId points at it).
	out, err := NewService().Query(context.Background(), "dan",
		QueryInput{Query: "hi", RefreshId: seed.Id, Mode: "instant"})
	if err != nil {
		t.Fatalf("Query refresh: %v", err)
	}
	if out.Id != seed.Id {
		t.Fatalf("refresh must update in place: out.Id=%d, want %d", out.Id, seed.Id)
	}
	var serverID, taskID, logStatus, serverFilePath string
	row := gdb.Raw(`SELECT COALESCE(server_id,''), COALESCE(task_id,''), COALESCE(log_status,''), COALESCE(server_file_path,'') FROM question_agent_logs WHERE id=?`, seed.Id)
	if err := row.Row().Scan(&serverID, &taskID, &logStatus, &serverFilePath); err != nil {
		t.Fatalf("read task columns: %v", err)
	}
	if serverID != "" || taskID != "" || logStatus != "" || serverFilePath != "" {
		t.Fatalf("stale task columns not cleared: server_id=%q task_id=%q log_status=%q server_file_path=%q",
			serverID, taskID, logStatus, serverFilePath)
	}
}

// expertRouteServer returns an httptest Bot whose /v1/query/route answers with
// the supplied body, so a test can exercise the Expert RUNNING / dedup arms.
func expertRouteServer(t *testing.T, routeBody string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/query/route" {
			_, _ = w.Write([]byte(routeBody))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, ExpertEnabled: true, TimeoutSeconds: 5,
		ResearchEnabled: true, DesignEnabled: true, NetworkEnabled: true,
	}
	t.Cleanup(func() { rxBot.BotConfig = nil })
}

// agentRunServer returns an httptest Bot whose /v1/agents/{slug}/runs answers
// with the supplied body, so a test can exercise a forced agent dispatched
// directly (not through the LLM router at /v1/query/route). Any other path 404s
// so a mis-dispatch to the router surfaces as a hard test failure.
func agentRunServer(t *testing.T, slug, runBody string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/agents/"+slug+"/runs" {
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(runBody))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: srv.URL, ProxyEnabled: true, ExpertEnabled: true, TimeoutSeconds: 5,
		ResearchEnabled: true, DesignEnabled: true, NetworkEnabled: true,
	}
	t.Cleanup(func() { rxBot.BotConfig = nil })
}

// TestQuery_ExpertRunningArm covers the Expert async (non-"succeeded") arm: a
// "running" route response must persist Status=RUNNING with the run id and the
// task id from task_ids, and surface the task id in the answer.
func TestQuery_ExpertRunningArm(t *testing.T) {
	gdb := setupExpertTestDB(t)
	expertRouteServer(t, `{"id":"run-async","object":"agent.run","agent":"analyst","status":"running","task_ids":["task-async-1"],"result":{}}`)

	out, err := NewService().Query(context.Background(), "alice", QueryInput{Query: "q", Mode: "expert"})
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	if out.Status != "RUNNING" {
		t.Errorf("expected out.Status=RUNNING, got %q", out.Status)
	}
	if !strings.Contains(out.Answer, "task-async-1") {
		t.Errorf("expected answer to contain task-async-1, got %q", out.Answer)
	}
	var botRunID, taskID string
	gdb.Raw(`SELECT COALESCE(bot_run_id,''), COALESCE(task_id,'') FROM question_agent_logs WHERE id=?`, out.Id).
		Row().Scan(&botRunID, &taskID)
	if botRunID != "run-async" {
		t.Errorf("expected persisted bot_run_id=run-async, got %q", botRunID)
	}
	if taskID != "task-async-1" {
		t.Errorf("expected persisted task_id=task-async-1, got %q", taskID)
	}
}

// TestQuery_ExpertRunningArmDedupHit locks Finding C: a dedup-hit running
// response (task_ids empty, result.dedup_hit=true, result.task_id set) must
// resolve the task id from result.task_id. Without the DedupHit fallback the
// persisted task_id is "" and the row strands RUNNING forever.
func TestQuery_ExpertRunningArmDedupHit(t *testing.T) {
	gdb := setupExpertTestDB(t)
	expertRouteServer(t, `{"id":"run-dedup","object":"agent.run","agent":"analyst","status":"running","task_ids":[],"result":{"dedup_hit":true,"task_id":"dedup-77"}}`)

	out, err := NewService().Query(context.Background(), "alice", QueryInput{Query: "q", Mode: "expert"})
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	var taskID string
	gdb.Raw(`SELECT COALESCE(task_id,'') FROM question_agent_logs WHERE id=?`, out.Id).Row().Scan(&taskID)
	if taskID != "dedup-77" {
		t.Errorf("expected persisted task_id=dedup-77 (DedupHit fallback), got %q", taskID)
	}
}

// TestQuery_ExpertResolvedRemoteUsesCanonicalProjection: a forced remote agent
// (analyst) dispatched directly to /v1/agents/{slug}/runs persists a RUNNING row
// carrying the reconciliation join key (bot_run_id) plus the legacy compatibility
// fields, so the GA cron can later poll and settle it by bot_run_id. A non-interop
// async agent gets no projection row at submit time (the cron writes it on the
// first poll) — the row itself is the durable recovery anchor.
func TestQuery_ExpertResolvedRemoteUsesCanonicalProjection(t *testing.T) {
	gdb := setupExpertTestDB(t)
	agentRunServer(t, "analyst", `{"id":"run-expert-1","object":"agent.run","agent":"analyst","status":"running","task_ids":["child-1"],"result":{}}`)

	ctx := utils.WithRequestID(context.Background(), "web-request-1")
	out, err := NewService().Query(ctx, "alice", QueryInput{
		Query: "find a candidate gene", Tool: "AnalystAgent", Mode: "expert",
	})
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	if out.ToolName != "AnalystAgent" {
		t.Fatalf("tool_name=%q, want AnalystAgent", out.ToolName)
	}
	if out.BotRunID != "run-expert-1" || out.TaskId != "child-1" {
		t.Fatalf("identity mismatch: bot_run_id=%q task_id=%q", out.BotRunID, out.TaskId)
	}
	if out.Status != "RUNNING" || out.RequestID != "web-request-1" {
		t.Fatalf("lifecycle/correlation mismatch: status=%q request_id=%q", out.Status, out.RequestID)
	}

	// The persisted row is the reconciliation anchor: owner + bot_run_id join key +
	// RUNNING status + legacy compatibility fields (tool_name, task_id).
	var storedRunID, storedStatus, storedTool, storedTask string
	if err := gdb.Raw(`SELECT bot_run_id, status, tool_name, task_id FROM question_agent_logs WHERE id=? AND user_name='alice'`, out.Id).
		Row().Scan(&storedRunID, &storedStatus, &storedTool, &storedTask); err != nil {
		t.Fatalf("read persisted reconciliation fields: %v", err)
	}
	if storedRunID != "run-expert-1" || storedStatus != "RUNNING" {
		t.Fatalf("reconciliation key mismatch: bot_run_id=%q status=%q", storedRunID, storedStatus)
	}
	if storedTool != "AnalystAgent" || storedTask != "child-1" {
		t.Fatalf("legacy fields mismatch: tool=%q task=%q", storedTool, storedTask)
	}
}

func TestQuery_ExpertResolvedCanonicalRemoteSlugsKeepWebMappings(t *testing.T) {
	tests := []struct {
		name string
		slug string
		tool string
	}{
		{name: "deep genome", slug: "deep_genome", tool: "DeepGenomeAgent"},
		{name: "brief gene", slug: "brief_gene", tool: "BriefGeneAgent"},
		{name: "network", slug: "network", tool: "GeneNetworkAgent"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			expertRouteServer(t, `{"id":"run-`+tc.slug+`","object":"agent.run","agent":"`+tc.slug+`","status":"running","task_ids":["child-`+tc.slug+`"],"result":{}}`)

			out, err := NewService().Query(context.Background(), "alice", QueryInput{Query: "q", Mode: "expert"})
			if err != nil {
				t.Fatalf("Query: %v", err)
			}
			if out.ToolName != tc.tool || out.Status != "RUNNING" {
				t.Fatalf("output=%+v, want tool=%q status=RUNNING", out, tc.tool)
			}
			projection, err := LoadBotRunProjection(context.Background(), "alice", out.Id)
			if err != nil {
				t.Fatalf("LoadBotRunProjection: %v", err)
			}
			if projection.Agent != tc.slug || projection.RunID != "run-"+tc.slug {
				t.Fatalf("projection=%+v, want slug=%q run=%q", projection, tc.slug, "run-"+tc.slug)
			}
			var taskID string
			if err := gdb.Raw(`SELECT task_id FROM question_agent_logs WHERE id=?`, out.Id).Row().Scan(&taskID); err != nil {
				t.Fatalf("read task id: %v", err)
			}
			if taskID != "child-"+tc.slug {
				t.Fatalf("task_id=%q, want child-%s", taskID, tc.slug)
			}
		})
	}
}

func TestQuery_ExpertUnknownOrMalformedResolvedSlugFailsClosed(t *testing.T) {
	tests := []struct {
		name  string
		agent string
	}{
		{name: "unknown", agent: "made_up"},
		{name: "blank", agent: ""},
		{name: "surrounding whitespace", agent: " research "},
		{name: "malformed", agent: "research\n"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			agentJSON, err := json.Marshal(tc.agent)
			if err != nil {
				t.Fatalf("marshal test agent: %v", err)
			}
			expertRouteServer(t, `{"id":"completion-bad","run_id":"run-bad","object":"agent.run","agent":`+string(agentJSON)+`,"status":"running","task_ids":["child-bad"],"result":{}}`)

			out, err := NewService().Query(context.Background(), "alice", QueryInput{Query: "q", Mode: "expert"})
			if !errors.Is(err, ErrExpertRouteContract) {
				t.Fatalf("err=%v, want ErrExpertRouteContract", err)
			}
			if out != nil {
				t.Fatalf("unknown resolved slug returned output: %+v", out)
			}
			var count int64
			if err := gdb.Raw(`SELECT COUNT(*) FROM question_agent_logs`).Row().Scan(&count); err != nil {
				t.Fatalf("count rows: %v", err)
			}
			if count != 0 {
				t.Fatalf("unknown resolved slug wrote %d row(s)", count)
			}
		})
	}
}

func TestQuery_ExpertResolvedToolContractFailuresHaveNoRows(t *testing.T) {
	tests := []struct {
		name     string
		username string
		tool     string
		setup    func(t *testing.T, gdb *gorm.DB)
		body     string
	}{
		{
			name:     "outside allowlist",
			username: "outside-allowlist@example.com",
			setup: func(t *testing.T, gdb *gorm.DB) {
				seedExpertPermissionUser(t, gdb, "outside-allowlist@example.com", "outside-allowlist")
				seedExpertPermissionTool(t, gdb, "outside-allowlist", "DataAgent", 1)
			},
			body: `{"id":"run-outside","object":"agent.run","agent":"analyst","status":"running","task_ids":["child-outside"],"result":{}}`,
		},
		// NOTE: the former "forced mismatch" case (a forced tool the router
		// resolved to a different agent) is gone by construction: a forced tool no
		// longer reaches /v1/query/route — the gateway dispatches SlugFor(in.Tool)
		// directly, so there is no router resolution that could diverge from the
		// caller's selection. That guarantee is now structural, not a runtime check.
		{
			name:     "unknown agent",
			username: "alice",
			body:     `{"id":"run-unknown","object":"agent.run","agent":"missing","status":"running","task_ids":["child-unknown"],"result":{}}`,
		},
		{
			name:     "malformed envelope",
			username: "alice",
			body:     `{"id":"run-malformed","object":"agent.run","agent":"data","status":`,
		},
		{
			name:     "invalid projection status",
			username: "alice",
			body:     `{"id":"run-invalid-status","object":"agent.run","agent":"data","status":"unknown","task_ids":[],"result":{}}`,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			if tc.setup != nil {
				tc.setup(t, gdb)
			}
			expertRouteServer(t, tc.body)

			out, err := NewService().Query(context.Background(), tc.username, QueryInput{
				Query: "contract check", Mode: "expert", Tool: tc.tool,
			})
			if !errors.Is(err, ErrExpertRouteContract) {
				t.Fatalf("err=%v, want ErrExpertRouteContract", err)
			}
			if out != nil {
				t.Fatalf("contract failure returned output=%+v", out)
			}
			var rows int64
			if err := gdb.Model(&model.QuestionAgentLog{}).Count(&rows).Error; err != nil {
				t.Fatalf("count question rows: %v", err)
			}
			if rows != 0 {
				t.Fatalf("contract failure persisted %d question rows", rows)
			}
			var projections int64
			if err := gdb.Model(&model.QuestionAgentLog{}).
				Where("bot_projection_json IS NOT NULL AND bot_projection_json != ''").Count(&projections).Error; err != nil {
				t.Fatalf("count projections: %v", err)
			}
			if projections != 0 {
				t.Fatalf("contract failure persisted %d projections", projections)
			}
		})
	}
}

func TestQuery_ExpertMissingRunIdentityKeepsConflictSentinel(t *testing.T) {
	gdb := setupExpertTestDB(t)
	expertRouteServer(t, `{"object":"agent.run","agent":"data","status":"succeeded","task_ids":[],"result":{"formatted":{"answer":"ok"}}}`)

	out, err := NewService().Query(context.Background(), "alice", QueryInput{Query: "missing run", Mode: "expert"})
	if !errors.Is(err, ErrMissingBotRunID) {
		t.Fatalf("err=%v, want ErrMissingBotRunID", err)
	}
	if out != nil {
		t.Fatalf("missing run identity returned output=%+v", out)
	}
	var rows int64
	if err := gdb.Model(&model.QuestionAgentLog{}).Count(&rows).Error; err != nil {
		t.Fatalf("count question rows: %v", err)
	}
	if rows != 0 {
		t.Fatalf("missing run identity persisted %d question rows", rows)
	}
}

func TestQuery_ExpertDuplicateRouteKeysFailsBeforePersistence(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{
			name: "duplicate top-level agent",
			body: `{"id":"completion-duplicate","run_id":"run-duplicate","agent":"knowledge","agent":"research","status":"running","result":{}}`,
		},
		{
			name: "duplicate nested answer",
			body: `{"id":"completion-duplicate","run_id":"run-duplicate","agent":"knowledge","status":"succeeded","result":{"formatted":{"answer":"first","answer":"last"}}}`,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupExpertTestDB(t)
			expertRouteServer(t, tc.body)

			out, err := NewService().Query(context.Background(), "alice", QueryInput{Query: "q", Mode: "expert"})
			if err == nil {
				t.Fatalf("duplicate route response returned output=%+v", out)
			}
			if !errors.Is(err, ErrExpertRouteContract) {
				t.Fatalf("err=%v, want ErrExpertRouteContract", err)
			}
			var count int64
			if err := gdb.Raw(`SELECT COUNT(*) FROM question_agent_logs`).Row().Scan(&count); err != nil {
				t.Fatalf("count rows: %v", err)
			}
			if count != 0 {
				t.Fatalf("duplicate route response persisted %d row(s)", count)
			}
		})
	}
}

// TestExpertModeEnabled_TracksBotConfig pins the UI flag source: it mirrors
// BotConfig.ExpertEnabled (single source of truth) — false when BotConfig is
// nil OR the flag is off, true only when ExpertEnabled is true.
func TestExpertModeEnabled_TracksBotConfig(t *testing.T) {
	// Register cleanup before mutating the global so it runs even if a future
	// regression panics on the nil path (mirrors botRouter's t.Cleanup idiom).
	t.Cleanup(func() { rxBot.BotConfig = nil })

	rxBot.BotConfig = nil
	if NewService().ExpertModeEnabled() {
		t.Error("nil BotConfig must report ExpertModeEnabled=false")
	}
	rxBot.BotConfig = &rxBot.Config{ExpertEnabled: false}
	if NewService().ExpertModeEnabled() {
		t.Error("ExpertEnabled=false must report ExpertModeEnabled=false")
	}
	rxBot.BotConfig = &rxBot.Config{ExpertEnabled: true}
	if !NewService().ExpertModeEnabled() {
		t.Error("ExpertModeEnabled must be true when BotConfig.ExpertEnabled=true")
	}
}

// TestQueryExpertContextSelectionSettlement covers autonomous Expert and a
// forced Expert selection. The autonomous turn uses the router; the forced turn
// dispatches directly to the selected execution endpoint.
func TestQueryExpertContextSelectionSettlement(t *testing.T) {
	tests := []struct {
		name, requestedTool, selectedTool, selectedSlug, routeSource, expectedPath string
	}{
		{"router", "", "KnowledgeAgent", "knowledge", "router", "/v1/query/route"},
		{"forced", "KnowledgeAgent", "KnowledgeAgent", "knowledge", "explicit_selection", "/v1/chat/completions"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setupExpertTestDB(t)
			var captured rxBot.RouteQueryRequest
			var capturedChat rxBot.ChatCompletionRequest
			var settleCalls int
			var dispatchPath string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/v1/query/route":
					dispatchPath = r.URL.Path
					if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
						t.Errorf("decode route request: %v", err)
						return
					}
					stage := rxBot.ContextStageMetadata{
						SchemaVersion: 1, TurnID: captured.Conversation.TurnID,
						SelectedAgentID: test.selectedTool, RouteSource: test.routeSource,
						RouteReasonCode:                strings.ToUpper(test.routeSource),
						BaseBusinessContextVersion:     captured.Conversation.BaseBusinessContextVersion,
						ProposedBusinessContextVersion: captured.Conversation.BaseBusinessContextVersion + 1,
						LastAppliedLedgerCursor:        captured.Conversation.LedgerCursor,
					}
					_ = json.NewEncoder(w).Encode(map[string]interface{}{
						"id": "run-context", "run_id": "run-context",
						"object": "agent.run", "agent": test.selectedSlug,
						"status": "succeeded", "task_ids": []string{},
						"result": map[string]interface{}{"formatted": map[string]interface{}{
							"answer": "expert answer", "references": []interface{}{},
						}},
						"conversation_context": stage,
					})
				case "/v1/chat/completions":
					dispatchPath = r.URL.Path
					if err := json.NewDecoder(r.Body).Decode(&capturedChat); err != nil {
						t.Errorf("decode chat request: %v", err)
						return
					}
					stage := rxBot.ContextStageMetadata{
						SchemaVersion:                  1,
						TurnID:                         capturedChat.Conversation.TurnID,
						SelectedAgentID:                test.selectedTool,
						RouteSource:                    test.routeSource,
						RouteReasonCode:                "EXPLICIT_SELECTION",
						BaseBusinessContextVersion:     capturedChat.Conversation.BaseBusinessContextVersion,
						ProposedBusinessContextVersion: capturedChat.Conversation.BaseBusinessContextVersion + 1,
						LastAppliedLedgerCursor:        capturedChat.Conversation.LedgerCursor,
					}
					_ = json.NewEncoder(w).Encode(map[string]interface{}{
						"id": "run-context", "run_id": "run-context",
						"object": "chat.completion", "status": "succeeded",
						"choices": []interface{}{map[string]interface{}{
							"index":   0,
							"message": map[string]interface{}{"role": "assistant", "content": "expert answer"},
						}},
						"formatted":            map[string]interface{}{"answer": "expert answer"},
						"conversation_context": stage,
					})
				case "/v1/conversation-context/settle":
					settleCalls++
					_ = json.NewEncoder(w).Encode(rxBot.ContextMutationResponse{
						SchemaVersion: 1, State: "committed", ContextVersion: 1,
					})
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			previous := rxBot.BotConfig
			rxBot.BotConfig = &rxBot.Config{
				BaseURL: server.URL, ProxyEnabled: true, ExpertEnabled: true,
				MultiturnV1Enabled: true, TimeoutSeconds: 2,
				ResearchEnabled: true, DesignEnabled: true, NetworkEnabled: true,
			}
			t.Cleanup(func() { rxBot.BotConfig = previous })

			out, err := NewService().Query(context.Background(), "alice", QueryInput{
				Query: "route this", History: `[{"role":"user","content":"browser poison"}]`,
				Mode: "expert", Tool: test.requestedTool,
				ClientTurnID: "expert-context-" + test.name,
			})
			if err != nil {
				t.Fatalf("Query: %v", err)
			}
			if out.Status != "SUCCEEDED" || out.ToolName != test.selectedTool ||
				dispatchPath != test.expectedPath || settleCalls != 1 {
				t.Fatalf("result=%#v settle calls=%d", out, settleCalls)
			}
			if test.requestedTool == "" {
				if len(captured.History) != 0 || captured.Conversation == nil {
					t.Fatalf("route request leaked browser history: %#v", captured)
				}
				if captured.ForcedTool != nil ||
					!reflect.DeepEqual(captured.Conversation.AllowedAgentIDs, captured.AllowedTools) {
					t.Fatalf("router constraints=%#v", captured)
				}
			} else if capturedChat.Conversation == nil ||
				capturedChat.Conversation.RequestedAgentID == nil ||
				*capturedChat.Conversation.RequestedAgentID != test.requestedTool {
				t.Fatalf("forced conversation=%#v", capturedChat.Conversation)
			}
		})
	}
}

func TestQueryExpertContextAsyncKeepsRunningLifecycleWithoutSettlement(t *testing.T) {
	gdb := setupExpertTestDB(t)
	var settleCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/query/route":
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"id": "run-async-context", "run_id": "run-async-context",
				"object": "agent.run", "agent": "research", "status": "running",
				"task_ids": []string{"task-async-context"}, "result": map[string]interface{}{},
			})
		case "/v1/conversation-context/settle":
			settleCalls++
			http.Error(w, "unexpected", http.StatusInternalServerError)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	previous := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL: server.URL, ProxyEnabled: true, ExpertEnabled: true,
		MultiturnV1Enabled: true, TimeoutSeconds: 2, ResearchEnabled: true,
	}
	t.Cleanup(func() { rxBot.BotConfig = previous })

	out, err := NewService().Query(context.Background(), "alice", QueryInput{
		Query: "long research", Mode: "expert", ClientTurnID: "expert-async-context",
	})
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	if out.Status != "RUNNING" || out.BotRunID != "run-async-context" || settleCalls != 0 {
		t.Fatalf("result=%#v settle calls=%d", out, settleCalls)
	}
	var row model.QuestionAgentLog
	if err := gdb.First(&row, out.Id).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != "RUNNING" || row.BotRunId != "run-async-context" {
		t.Fatalf("async row=%#v", row)
	}
}
