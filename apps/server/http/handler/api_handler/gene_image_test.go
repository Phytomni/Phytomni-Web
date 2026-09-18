package api_handler

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"phytomni-server/common/i18n"
	rxBot "phytomni-server/external/bot"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
)

// newGeneImageCtx builds a gin test context with :gene and :file params and a
// recorder, pointing gene_obsfs_path at a temp mount seeded with one image.
func newGeneImageCtx(t *testing.T, gene, file string) (*gin.Context, *httptest.ResponseRecorder, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	root := t.TempDir()
	imgDir := filepath.Join(root, "img", "Os01g0107900")
	if err := os.MkdirAll(imgDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(imgDir, "Os01g0107900_tree.png"), []byte("\x89PNG\r\n\x1a\nDATA"), 0o644); err != nil {
		t.Fatalf("write png: %v", err)
	}
	// Canary file placed OUTSIDE the gene's img subtree. If the path-traversal
	// gate (CleanUploadFilename + SafeJoinUploadPath) is bypassed, a traversal
	// in :file resolves to this file and the handler returns 200 — the
	// mutation test goes RED. With the gate in place, the traversal is rejected
	// before os.ReadFile, so the canary is never touched.
	if err := os.WriteFile(filepath.Join(root, "secret.png"), []byte("CANARY"), 0o644); err != nil {
		t.Fatalf("write canary: %v", err)
	}
	viper.Set("gene_obsfs_path", root)
	t.Cleanup(func() { viper.Set("gene_obsfs_path", "") })

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/gene-images/"+gene+"/"+file, nil)
	c.Params = gin.Params{{Key: "gene", Value: gene}, {Key: "file", Value: file}}
	i18n.Localize()(c)
	return c, rec, root
}

// TestGeneImage_Serves: a valid gene/file returns the bytes inline with the
// hardening headers.
func TestGeneImage_Serves(t *testing.T) {
	c, rec, _ := newGeneImageCtx(t, "Os01g0107900", "Os01g0107900_tree.png")
	ph := &Handler{}
	ph.GeneImage(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("missing nosniff header")
	}
	if got := rec.Header().Get("Content-Type"); got != "image/png" {
		t.Errorf("Content-Type = %q, want image/png", got)
	}
	if rec.Body.Len() == 0 {
		t.Errorf("empty body")
	}
}

// TestGeneImage_TraversalReject (mutation-tested): a traversal segment in
// either :gene or :file must be rejected (400) and never read outside the
// gene's img subtree. Deleting the CleanUploadFilename/SafeJoinUploadPath gate
// makes this go red.
func TestGeneImage_TraversalReject(t *testing.T) {
	cases := []struct{ gene, file string }{
		{"..", "Os01g0107900_tree.png"},
		{"Os01g0107900", "../../secret.png"},
		{"Os01g0107900", "..%2f..%2fsecret.png"}, // literal, params are pre-decoded by gin in real reqs
		{"", "x.png"},
		{"Os01g0107900", ""},
	}
	for _, tc := range cases {
		c, rec, _ := newGeneImageCtx(t, tc.gene, tc.file)
		ph := &Handler{}
		ph.GeneImage(c)
		if rec.Code == http.StatusOK {
			t.Fatalf("GeneImage(gene=%q file=%q) = 200, want rejection", tc.gene, tc.file)
		}
	}
}

func TestGeneImageCuratedRelay(t *testing.T) {
	gene, file := "Os01g0107900", "Os01g0107900_tree.png"
	c, rec, _ := newGeneImageCtx(t, gene, file)
	viper.Set("gene_obsfs_path", "")
	oldBot := rxBot.BotConfig
	want := []byte("\x89PNG\r\n\x1a\nIMAGE")
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/v1/relay/obs/object" || r.URL.Query().Get("path") != "gene-examples/img/"+gene+"/"+file {
			t.Errorf("unexpected relay object request: %s", r.URL.Path)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		_, _ = w.Write(want)
	}))
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { srv.Close(); rxBot.BotConfig = oldBot })
	(&Handler{}).GeneImage(c)
	if rec.Code != http.StatusOK || !bytes.Equal(rec.Body.Bytes(), want) || calls != 1 {
		t.Fatalf("curated PNG relay: status=%d calls=%d body=%q", rec.Code, calls, rec.Body.String())
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" || rec.Header().Get("Content-Type") != "image/png" {
		t.Fatal("PNG relay lost response hardening")
	}
}

func TestGeneImageRejectsSymlinkEscape(t *testing.T) {
	c, rec, root := newGeneImageCtx(t, "Os01g0107900", "Os01g0107900_escape.png")
	canary := filepath.Join(t.TempDir(), "canary.png")
	if err := os.WriteFile(canary, []byte("\x89PNG\r\n\x1a\nCANARY"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(canary, filepath.Join(root, "img", "Os01g0107900", "Os01g0107900_escape.png")); err != nil {
		t.Fatal(err)
	}
	(&Handler{}).GeneImage(c)
	if rec.Code == http.StatusOK || bytes.Contains(rec.Body.Bytes(), []byte("CANARY")) {
		t.Fatalf("symlink escape exposed a file: status=%d body=%q", rec.Code, rec.Body.String())
	}
}

func TestGeneImageRejectsNonImageAndDisguisedContent(t *testing.T) {
	for _, file := range []string{"protocol.md", "original.pdf", "page.html", "figure.svg", "Os01g0107900_disguised.png"} {
		t.Run(file, func(t *testing.T) {
			c, rec, root := newGeneImageCtx(t, "Os01g0107900", file)
			if err := os.WriteFile(filepath.Join(root, "img", "Os01g0107900", file), []byte("<html>PRIVATE-CONTENT</html>"), 0o600); err != nil {
				t.Fatal(err)
			}
			(&Handler{}).GeneImage(c)
			if rec.Code == http.StatusOK || bytes.Contains(rec.Body.Bytes(), []byte("PRIVATE-CONTENT")) {
				t.Fatalf("non-image exposed through public image endpoint: status=%d", rec.Code)
			}
		})
	}
}
