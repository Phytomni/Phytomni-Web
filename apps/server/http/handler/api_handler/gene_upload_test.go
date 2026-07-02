package api_handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"phytomni-server/db"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupGeneUploadHandlerDB(t *testing.T) {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := gdb.Exec(`CREATE TABLE gene_examples (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		file_name TEXT,
		content TEXT,
		species_code TEXT,
		gene_id TEXT,
		created_at DATETIME,
		updated_at DATETIME,
		delete_at DATETIME
	)`).Error; err != nil {
		t.Fatalf("create gene_examples: %v", err)
	}
	db.Set("phytomni-server", gdb)
}

func newGeneExampleUploadRequest(t *testing.T, fieldName, filename string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if err := mw.WriteField("species_code", "Ath"); err != nil {
		t.Fatalf("write species_code: %v", err)
	}
	if err := mw.WriteField("gene_id", "AT1G01010"); err != nil {
		t.Fatalf("write gene_id: %v", err)
	}
	docList, err := mw.CreateFormFile("doc_list", "doc_list.json")
	if err != nil {
		t.Fatalf("create doc_list: %v", err)
	}
	if _, err := docList.Write([]byte(`{"doc_list":[{"title":"A title"}]}`)); err != nil {
		t.Fatalf("write doc_list: %v", err)
	}
	part, err := mw.CreateFormFile(fieldName, filename)
	if err != nil {
		t.Fatalf("create upload part: %v", err)
	}
	if _, err := part.Write([]byte("body")); err != nil {
		t.Fatalf("write upload body: %v", err)
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close multipart: %v", err)
	}

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/gene-examples", &buf)
	c.Request.Header.Set("Content-Type", mw.FormDataContentType())
	return c, w
}

func TestGeneDetailsStorageRejectsUnsafeDocumentFilename(t *testing.T) {
	setupGeneUploadHandlerDB(t)
	ph := NewHandler()
	// Use ".." — survives Gin's multipart parsing (filepath.Base("..") = "..")
	// but is rejected by CleanUploadFilename. Forward-slash paths like
	// "../escape.md" are stripped to their basename by Go's HTTP parser
	// before the handler sees them, so they cannot trigger handler-level
	// rejection. Service-layer tests in gene_test.go cover the full set.
	c, w := newGeneExampleUploadRequest(t, "files", "..")

	ph.GeneDetailsStorage(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", w.Code, w.Body.String())
	}
	var parsed struct {
		Code  int    `json:"code"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if parsed.Code != http.StatusBadRequest || parsed.Error == "" {
		t.Fatalf("unexpected body: %+v", parsed)
	}
}

func TestGeneDetailsStorageRejectsUnsafeImageFilename(t *testing.T) {
	setupGeneUploadHandlerDB(t)
	oldImageDir := geneExampleImageSavePath
	imageDir := t.TempDir()
	geneExampleImageSavePath = imageDir
	t.Cleanup(func() { geneExampleImageSavePath = oldImageDir })

	ph := NewHandler()
	// Use backslash path: survives Gin's multipart parsing on Linux
	// (filepath.Base doesn't split on backslash) but CleanUploadFilename
	// rejects it. Forward-slash paths are stripped by Go's HTTP parser.
	c, w := newGeneExampleUploadRequest(t, "images", `sub\escape.png`)

	ph.GeneDetailsStorage(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", w.Code, w.Body.String())
	}
}
