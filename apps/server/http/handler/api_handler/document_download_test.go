package api_handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"phytomni-server/common/i18n"
	"phytomni-server/db"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupRenderingDownloadDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := gdb.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := gdb.Exec(`CREATE TABLE question_agent_logs (
		id INTEGER PRIMARY KEY,
		dialogue_id TEXT,
		f_id INTEGER DEFAULT 0,
		user_name TEXT,
		answer TEXT,
		tool_name TEXT,
		download_path TEXT,
		image_paths TEXT,
		log_status TEXT,
		delete_at DATETIME
	)`).Error; err != nil {
		t.Fatal(err)
	}
	db.Set("phytomni-server", gdb)
	return gdb
}

func renderingDownloadRequest(username any, id, format, forgedUsername string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	form := url.Values{"id": {id}, "document_format": {format}, "username": {forgedUsername}}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost,
		"/api/v1/downloads/rendering-file?username="+url.QueryEscape(forgedUsername), strings.NewReader(form.Encode()))
	c.Request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	c.Request.Header.Set("Accept-Language", "en-US")
	if username != nil {
		c.Set("username", username)
	}
	i18n.Localize()(c)
	NewHandler().DownloadObsRenderingFile(c)
	return w
}

func assertRenderingDownloadError(t *testing.T, w *httptest.ResponseRecorder, status int, message string) {
	t.Helper()
	if w.Code != status {
		t.Fatalf("status = %d, want %d; body bytes=%d prefix=%q", w.Code, status, w.Body.Len(), w.Body.Bytes()[:min(w.Body.Len(), 160)])
	}
	if w.Header().Get("Content-Disposition") != "" || w.Header().Get("Content-Length") != "" ||
		!strings.HasPrefix(w.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("error response has download headers: %v", w.Header())
	}
	var response struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("error response is not JSON: %v", err)
	}
	if response.Code != status || response.Message != message {
		t.Fatalf("unsafe or inconsistent error response: %+v", response)
	}
}

func TestRenderingDownloadHandlerOwnLiveRows(t *testing.T) {
	gdb := setupRenderingDownloadDB(t)
	const answer = "# Owner report\n\nPrivate fixture body."
	for _, row := range []struct{ id, parent int }{{1, 0}, {2, 1}} {
		if err := gdb.Exec(`INSERT INTO question_agent_logs
			(id, f_id, dialogue_id, user_name, tool_name, answer, image_paths)
			VALUES (?, ?, 'dialogue-owner', 'alice', 'ChatAgent', ?, '[]')`, row.id, row.parent, answer).Error; err != nil {
			t.Fatal(err)
		}
		w := renderingDownloadRequest("alice", strconv.Itoa(row.id), "Markdown", "bob")
		if w.Code != http.StatusOK || w.Body.String() != answer {
			t.Fatalf("own row %d: status=%d body=%q", row.id, w.Code, w.Body.String())
		}
		if !strings.HasPrefix(w.Header().Get("Content-Disposition"), "attachment; filename=chat_") ||
			w.Header().Get("Content-Type") != "application/octet-stream" ||
			w.Header().Get("Content-Length") != strconv.Itoa(len(answer)) {
			t.Fatalf("own row %d download headers: %v", row.id, w.Header())
		}
	}
}

func TestRenderingDownloadHandlerForeignRowsAllAgentsAndFormats(t *testing.T) {
	gdb := setupRenderingDownloadDB(t)
	for index, tool := range []string{"ChatAgent", "DataAgent", "KnowledgeAgent", "ReviewAgent", "BriefGeneAgent", "DeepGenomeAgent"} {
		id := index + 10
		if err := gdb.Exec(`INSERT INTO question_agent_logs
			(id, dialogue_id, user_name, tool_name, answer, image_paths)
			VALUES (?, 'dialogue-owner', 'alice', ?, 'malformed private answer', '[]')`, id, tool).Error; err != nil {
			t.Fatal(err)
		}
		formats := []string{"Markdown", "Word", "PDF"}
		if tool == "DataAgent" {
			formats = []string{"Markdown", "Xlsx", "PDF"}
		}
		for _, format := range formats {
			t.Run(tool+"/"+format, func(t *testing.T) {
				w := renderingDownloadRequest("bob", strconv.Itoa(id), format, "alice")
				assertRenderingDownloadError(t, w, http.StatusNotFound, "artifact not found")
			})
		}
	}
}

func TestRenderingDownloadHandlerConversationBoundary(t *testing.T) {
	for _, tc := range []struct {
		name          string
		owner         string
		parent        int
		deleted       any
		rootOwner     string
		rootDialogue  string
		rootParent    int
		rootDeleted   any
		rootLogStatus string
	}{
		{name: "deleted root", owner: "alice", deleted: "2026-09-01"},
		{name: "deleted child", owner: "alice", parent: 1, deleted: "2026-09-01", rootOwner: "alice", rootDialogue: "dialogue-owner"},
		{name: "missing parent", owner: "alice", parent: 1},
		{name: "foreign parent", owner: "alice", parent: 1, rootOwner: "bob", rootDialogue: "dialogue-owner"},
		{name: "parent is not root", owner: "alice", parent: 1, rootOwner: "alice", rootDialogue: "dialogue-owner", rootParent: 99},
		{name: "mismatched dialogue", owner: "alice", parent: 1, rootOwner: "alice", rootDialogue: "another-dialogue"},
		{name: "deleted parent pending", owner: "alice", parent: 1, rootOwner: "alice", rootDialogue: "dialogue-owner", rootDeleted: "2026-09-01", rootLogStatus: "CONTEXT_DELETE_PENDING"},
		{name: "deleted parent acked", owner: "alice", parent: 1, rootOwner: "alice", rootDialogue: "dialogue-owner", rootDeleted: "2026-09-01", rootLogStatus: "CONTEXT_DELETE_ACKED"},
		{name: "foreign child with owned parent", owner: "bob", parent: 1, rootOwner: "alice", rootDialogue: "dialogue-owner"},
		{name: "self parent is not root", owner: "alice", parent: 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupRenderingDownloadDB(t)
			if tc.rootOwner != "" {
				if err := gdb.Exec(`INSERT INTO question_agent_logs
					(id, user_name, dialogue_id, f_id, delete_at, log_status)
					VALUES (1, ?, ?, ?, ?, ?)`, tc.rootOwner, tc.rootDialogue, tc.rootParent, tc.rootDeleted, tc.rootLogStatus).Error; err != nil {
					t.Fatal(err)
				}
			}
			// An inaccessible unknown tool must never reach formatter or image setup.
			if err := gdb.Exec(`INSERT INTO question_agent_logs
				(id, user_name, dialogue_id, f_id, delete_at, tool_name, answer, image_paths)
				VALUES (2, ?, 'dialogue-owner', ?, ?, 'PrivateUnknownTool', 'private answer', 'invalid image JSON')`,
				tc.owner, tc.parent, tc.deleted).Error; err != nil {
				t.Fatal(err)
			}
			assertRenderingDownloadError(t, renderingDownloadRequest("alice", "2", "Word", "bob"),
				http.StatusNotFound, "artifact not found")
			assertRenderingDownloadError(t, renderingDownloadRequest("alice", "999", "Word", "bob"),
				http.StatusNotFound, "artifact not found")
		})
	}
}

func TestRenderingDownloadHandlerRejectsUntrustedIdentityBeforeQuery(t *testing.T) {
	for _, tc := range []struct {
		name     string
		username any
	}{
		{"missing", nil}, {"empty", ""}, {"whitespace", " \t\n"},
		{"integer", 42}, {"slice", []string{"alice"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gdb := setupRenderingDownloadDB(t)
			queries := 0
			if err := gdb.Callback().Query().Before("gorm:query").Register("rendering_identity_query", func(tx *gorm.DB) {
				queries++
				tx.AddError(errors.New("private database failure"))
			}); err != nil {
				t.Fatal(err)
			}
			assertRenderingDownloadError(t, renderingDownloadRequest(tc.username, "1", "Word", "alice"),
				http.StatusUnauthorized, "unauthorized")
			if queries != 0 {
				t.Fatalf("untrusted identity queried database %d times", queries)
			}
		})
	}
}

func TestRenderingDownloadHandlerRejectsInvalidParameters(t *testing.T) {
	for _, tc := range []struct{ id, format string }{
		{"", "Word"}, {"0", "Word"}, {"-1", "Word"}, {"not-an-id", "Word"},
		{"9999999999999999999999999", "Word"}, {"1", ""},
	} {
		t.Run(tc.id+"/"+tc.format, func(t *testing.T) {
			gdb := setupRenderingDownloadDB(t)
			queries := 0
			if err := gdb.Callback().Query().Before("gorm:query").Register("rendering_parameter_query", func(tx *gorm.DB) {
				queries++
				tx.AddError(errors.New("private database failure"))
			}); err != nil {
				t.Fatal(err)
			}
			assertRenderingDownloadError(t, renderingDownloadRequest("alice", tc.id, tc.format, ""),
				http.StatusBadRequest, "missing parameter")
			if queries != 0 {
				t.Fatalf("invalid parameters queried database %d times", queries)
			}
		})
	}
}

func TestRenderingDownloadHandlerInternalFailureIsSafe500(t *testing.T) {
	gdb := setupRenderingDownloadDB(t)
	if err := gdb.Callback().Query().Before("gorm:query").Register("rendering_database_failure", func(tx *gorm.DB) {
		tx.AddError(errors.New("private database failure: question_agent_logs at /internal/path"))
	}); err != nil {
		t.Fatal(err)
	}
	assertRenderingDownloadError(t, renderingDownloadRequest("alice", "1", "Word", ""),
		http.StatusInternalServerError, "artifact download unavailable")
}

func TestRenderingDownloadHandlerClosedDatabaseIsSafe500(t *testing.T) {
	gdb := setupRenderingDownloadDB(t)
	sqlDB, err := gdb.DB()
	if err != nil {
		t.Fatal(err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatal(err)
	}
	assertRenderingDownloadError(t, renderingDownloadRequest("alice", "1", "Word", ""),
		http.StatusInternalServerError, "artifact download unavailable")
}

func TestRenderingDownloadHandlerFormatterFailureIsSafe500(t *testing.T) {
	for _, tool := range []string{"DataAgent", "PrivateUnknownTool"} {
		t.Run(tool, func(t *testing.T) {
			gdb := setupRenderingDownloadDB(t)
			if err := gdb.Exec(`INSERT INTO question_agent_logs
				(id, user_name, tool_name, answer, image_paths)
				VALUES (1, 'alice', ?, 'invalid private JSON', '[]')`, tool).Error; err != nil {
				t.Fatal(err)
			}
			assertRenderingDownloadError(t, renderingDownloadRequest("alice", "1", "Markdown", ""),
				http.StatusInternalServerError, "artifact download unavailable")
		})
	}
}
