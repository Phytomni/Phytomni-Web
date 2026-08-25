package api_service

import (
	"context"
	"strings"
	"testing"
	"unicode/utf8"

	"phytomni-server/db"
	rxBot "phytomni-server/external/bot"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// setupExpertTestDB is the shared persistence fixture for execution-runtime
// tests. It deliberately contains no synchronous Bot dispatch behavior.
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
	for _, email := range []string{
		"alice", "dan", "alice@x.com", "task27-expert@example.com",
		"alice@example.com", "ready@example.com", "broken@example.com",
		"cancel@example.com", "action@example.com", "bob@example.com",
		"eve@example.com", "carol@example.com", "compat@example.com",
		"task27-stream@example.com", "task27-error@example.com",
		"gate@example.com", "network@example.com", "dan@example.com",
		"erin@example.com",
	} {
		if err := gdb.Exec(`INSERT INTO users (email, code) VALUES (?, 'admin')`, email).Error; err != nil {
			t.Fatalf("seed expert user %s: %v", email, err)
		}
	}
	db.Set("phytomni-server", gdb)
	return gdb
}

type staticResearchCatalogReader struct {
	response *rxBot.AgentsListResponse
}

func (reader staticResearchCatalogReader) GetAgents(context.Context) (*rxBot.AgentsListResponse, error) {
	return reader.response, nil
}

func serviceWithValidResearchCatalog() *Service {
	return &Service{
		catalogReader: staticResearchCatalogReader{response: validResearchCapabilityCatalog()},
	}
}

func useConversationV1(t *testing.T) {
	t.Helper()
	rxBot.SetConversationContextV1Advertised(true)
	t.Cleanup(func() { rxBot.SetConversationContextV1Advertised(false) })
}

const (
	longResearchPaperMarker = "Synthetic paper abstract: rice root development evidence."
	longResearchPathMarker  = "scrubbed-bucket/synthetic-study/late/reads.fastq.gz"
)

func syntheticLongResearchQuery(t *testing.T) string {
	t.Helper()
	prefix := "\n\t  " + longResearchPaperMarker + "  \n"
	suffix := "\n" + longResearchPathMarker
	fillerCount := rxBot.DefaultMaxUserQueryChars - utf8.RuneCountInString(prefix) - utf8.RuneCountInString(suffix)
	if fillerCount < 1 {
		t.Fatal("synthetic Research markers exceed the query boundary")
	}
	query := prefix + strings.Repeat("稻", fillerCount) + suffix
	if got := utf8.RuneCountInString(query); got != rxBot.DefaultMaxUserQueryChars {
		t.Fatalf("synthetic query code points = %d, want %d", got, rxBot.DefaultMaxUserQueryChars)
	}
	return query
}
