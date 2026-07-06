package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/viper"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
	"phytomni-server/utils"

	"gorm.io/gorm"
)

// TestApiDownloadAnalystAgentObsImages_StoredPaths: with image_paths populated,
// the handler signs each .png (skipping non-images) via the offline token
// signer and enforces the (username, download_path) ownership lookup — no
// Bot/OBS call is made.
func TestApiDownloadAnalystAgentObsImages_StoredPaths(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, download_path, image_paths, created_at) VALUES
		(70, 'alice', '/obs/p/r1', '["/obs/p/r1/a.png","/obs/p/r2/b.png","/obs/p/r1/t.csv"]', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	ps := NewService()
	urls, err := ps.DownloadAnalystAgentObsImages(context.Background(), "alice", "/obs/p/r1")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(urls) != 2 {
		t.Fatalf("expected 2 png urls (csv filtered), got %d: %v", len(urls), urls)
	}
	for _, u := range urls {
		if !strings.Contains(u, "/api/v1/downloads/relay-file?t=") {
			t.Errorf("url not a signed relay url: %q", u)
		}
	}
}

// TestApiDownloadAnalystAgentObsImages_OwnershipMiss: a path not owned by the
// requesting user (no matching row) is rejected before any OBS/Bot call.
func TestApiDownloadAnalystAgentObsImages_OwnershipMiss(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, download_path, image_paths, created_at) VALUES
		(71, 'bob', '/obs/p/r9', '["/obs/p/r9/a.png"]', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	ps := NewService()
	if _, err := ps.DownloadAnalystAgentObsImages(context.Background(), "alice", "/obs/p/r9"); err == nil {
		t.Fatal("expected error when alice requests bob's path")
	}
}

// TestApiDownloadAnalystAgentObsImages_ContainmentBypass: a stored path that
// escapes the run root (path.Dir(download_path)) must NOT be signed, even though
// the row is owned by the caller. The download token signs any key with no
// prefix binding, so the signing loop is the only authorization gate — an
// out-of-scope OBS path injected into image_paths (e.g. via Bot drift) must be
// dropped. Sibling dirs under the same run root (r1/r2) stay servable; only the
// cross-root path is rejected. Delete the containment check and this goes red.
func TestApiDownloadAnalystAgentObsImages_ContainmentBypass(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, download_path, image_paths, created_at) VALUES
		(72, 'alice', '/obs/p/r1', '["/obs/p/r1/a.png","/obs/p/r2/b.png","/obs/OTHER/evil.png"]', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	ps := NewService()
	urls, err := ps.DownloadAnalystAgentObsImages(context.Background(), "alice", "/obs/p/r1")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	// /obs/p/r1 + /obs/p/r2 are under run root /obs/p → served (2);
	// /obs/OTHER/evil.png escapes the run root → dropped.
	if len(urls) != 2 {
		t.Fatalf("expected 2 in-scope png urls (cross-root dropped), got %d: %v", len(urls), urls)
	}
	for _, u := range urls {
		if !strings.Contains(u, "/api/v1/downloads/relay-file?t=") {
			t.Errorf("url not a signed relay url: %q", u)
		}
	}
}

// TestApiDownloadAnalystAgentObsImages_FallbackListingContainment: when
// image_paths is empty the handler falls back to OBS prefix listing, and the
// keys that listing returns flow through the SAME containment loop as stored
// keys — there is no source-specific bypass. A reachable fake relay returns a
// mix of in-root and cross-root .png keys (plus a non-image); the in-root pngs
// are signed and the cross-root one is dropped. This is the success-path twin
// of the dead-Bot MalformedJSON case: it proves the fallback branch both
// returns keys AND that containment still applies to them. Delete the
// containment check and the cross-root key leaks → red.
func TestApiDownloadAnalystAgentObsImages_FallbackListingContainment(t *testing.T) {
	gdb := setupTestDB(t)
	// image_paths left empty → handler must fall back to ListObsKeys.
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, download_path, image_paths, created_at) VALUES
		(74, 'alice', '/obs/p/r1', '', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	// Reachable fake Bot relay: listing returns in-root pngs (run root /obs/p),
	// a cross-root png, and a non-image. Only the two in-root pngs may be signed.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"keys":["/obs/p/r1/a.png","/obs/p/r2/b.png","/obs/OTHER/evil.png","/obs/p/r1/t.csv"]}`))
	}))
	defer srv.Close()
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	ps := NewService()
	urls, err := ps.DownloadAnalystAgentObsImages(context.Background(), "alice", "/obs/p/r1")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	// /obs/p/r1 + /obs/p/r2 under run root /obs/p → signed (2);
	// /obs/OTHER/evil.png escapes → dropped; t.csv → not a png.
	if len(urls) != 2 {
		t.Fatalf("expected 2 in-scope png urls from fallback listing (cross-root + csv excluded), got %d: %v", len(urls), urls)
	}
	for _, u := range urls {
		if !strings.Contains(u, "/api/v1/downloads/relay-file?t=") {
			t.Errorf("url not a signed relay url: %q", u)
		}
	}
}

// TestApiDownloadAnalystAgentObsImages_MalformedJSON: a non-empty but invalid
// image_paths must NOT be silently signed as keys. The handler discards the
// parse (warns) and falls back to OBS prefix listing — which, with no Bot
// reachable in the test env, errors out. The safety property locked here is
// "malformed stored state never yields a signed URL"; the warn itself is
// observability-only and behavior (fallback) is intentionally preserved for
// availability, so it is not separately asserted.
func TestApiDownloadAnalystAgentObsImages_MalformedJSON(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, download_path, image_paths, created_at) VALUES
		(73, 'alice', '/obs/p/r1', '{bad-json', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	// Malformed image_paths must fall through to OBS listing, not sign garbage.
	// Point the Bot client at a dead address so ListObsKeys errors cleanly
	// (mirrors query_updatelog_test) rather than nil-derefing on NewClient.
	rxBot.BotConfig = &rxBot.Config{BaseURL: "http://127.0.0.1:0", ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })
	ps := NewService()
	urls, err := ps.DownloadAnalystAgentObsImages(context.Background(), "alice", "/obs/p/r1")
	if err == nil {
		t.Fatalf("expected fallback-to-listing error (dead Bot addr), got urls=%v", urls)
	}
	if len(urls) != 0 {
		t.Fatalf("malformed image_paths must not yield signed urls, got %v", urls)
	}
}

// writeGeneObsfs seeds a temp obsfs-like mount with md/ files and points
// gene_obsfs_path at it. Returns the mount root.
func writeGeneObsfs(t *testing.T, mdNames []string) string {
	t.Helper()
	root := t.TempDir()
	mdDir := filepath.Join(root, "md")
	if err := os.MkdirAll(mdDir, 0o755); err != nil {
		t.Fatalf("mkdir md: %v", err)
	}
	for _, n := range mdNames {
		if err := os.WriteFile(filepath.Join(mdDir, n), []byte("# "+n), 0o644); err != nil {
			t.Fatalf("write %s: %v", n, err)
		}
	}
	viper.Set("gene_obsfs_path", root)
	t.Cleanup(func() { viper.Set("gene_obsfs_path", "") })
	return root
}

// geneRelayServer points the Bot client at an httptest relay whose obs/list
// answers with the given keys; used for the relay-fallback branch.
func geneRelayServer(t *testing.T, keys []string) {
	t.Helper()
	body, err := json.Marshal(struct {
		Keys []string `json:"keys"`
	}{Keys: keys})
	if err != nil {
		t.Fatalf("marshal keys: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}))
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { srv.Close(); rxBot.BotConfig = nil })
}

// TestGeneList_ObsfsListing: with gene_obsfs_path set, the list derives rows
// from md/ files in the mount (parseGeneFile on the entry name).
func TestGeneList_ObsfsListing(t *testing.T) {
	writeGeneObsfs(t, []string{"Os01g0107900_result.md", "AT1G01010_result.md"})
	ps := NewService()
	list, total, _, err := ps.GeneList(context.Background(), 1, 10)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if total != 2 || len(list) != 2 {
		t.Fatalf("expected 2 rows, got total=%d len=%d", total, len(list))
	}
	byGene := map[string]*model.GeneExample{}
	for _, g := range list {
		byGene[g.GeneId] = g
	}
	if g := byGene["Os01g0107900"]; g == nil || g.SpeciesCode != "Osa" || g.FileName != "Os01g0107900_result.md" {
		t.Fatalf("Os01g0107900 derived wrong: %+v", g)
	}
	if g := byGene["AT1G01010"]; g == nil || g.SpeciesCode != "Ath" {
		t.Fatalf("AT1G01010 derived wrong: %+v", g)
	}
}

// TestGeneList_NonResultKeysSkipped: files without the _result.md suffix or an
// unrecognized species prefix are filtered (parseGeneFile → nil).
func TestGeneList_NonResultKeysSkipped(t *testing.T) {
	writeGeneObsfs(t, []string{"Os01g0107900_result.md", "README.txt", "ZZZ_unknown_result.md"})
	ps := NewService()
	list, total, _, err := ps.GeneList(context.Background(), 1, 10)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if total != 1 || len(list) != 1 || list[0].GeneId != "Os01g0107900" {
		t.Fatalf("expected only the valid gene, got total=%d list=%+v", total, list)
	}
}

// TestGeneList_RelayFallback: with gene_obsfs_path unset, the list falls back to
// the Bot relay listing.
func TestGeneList_RelayFallback(t *testing.T) {
	viper.Set("gene_obsfs_path", "")
	geneRelayServer(t, []string{
		"gene-examples/md/Os01g0107900_result.md",
		"gene-examples/md/AT1G01010_result.md",
	})
	ps := NewService()
	_, total, _, err := ps.GeneList(context.Background(), 1, 10)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if total != 2 {
		t.Fatalf("expected 2 rows from relay fallback, got %d", total)
	}
}

// TestGeneSearch_ZeroPageSizeNoPanic: size=0 used to divide-by-zero in the
// totalPages expression. The guard must normalize and return. One md file in
// the mount → total>0 → the totalPages line is reached.
func TestGeneSearch_ZeroPageSizeNoPanic(t *testing.T) {
	writeGeneObsfs(t, []string{"Os01g0107900_result.md"})
	ps := NewService()
	list, total, totalPages, err := ps.GeneSearch(context.Background(), 0, 0, "")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if total != 1 || totalPages != 1 || len(list) != 1 {
		t.Fatalf("expected total=1 totalPages=1 len=1, got %d/%d/%d", total, totalPages, len(list))
	}
}

func setupGeneExampleDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb := setupTestDB(t)
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
	return gdb
}

func TestGeneDetailsStorageRejectsUnsafeFilename(t *testing.T) {
	setupGeneExampleDB(t)
	ps := NewService()
	for _, name := range []string{"../escape.md", "sub/escape.md", `sub\escape.md`, "", ".."} {
		t.Run(name, func(t *testing.T) {
			err := ps.GeneDetailsStorage(context.Background(), name, "content", "Ath", "AT1G01010")
			if !errors.Is(err, utils.ErrInvalidUploadFilename) {
				t.Fatalf("GeneDetailsStorage(%q) err = %v, want ErrInvalidUploadFilename", name, err)
			}
		})
	}
}

func TestGeneDetailsStorageStoresCleanFilename(t *testing.T) {
	gdb := setupGeneExampleDB(t)
	ps := NewService()

	if err := ps.GeneDetailsStorage(context.Background(), "safe_result.md", "content", "Ath", "AT1G01010"); err != nil {
		t.Fatalf("GeneDetailsStorage unexpected err: %v", err)
	}
	var fileName string
	if err := gdb.Raw(`SELECT file_name FROM gene_examples WHERE gene_id = ?`, "AT1G01010").Scan(&fileName).Error; err != nil {
		t.Fatalf("read stored filename: %v", err)
	}
	if fileName != "safe_result.md" {
		t.Fatalf("stored filename = %q, want safe_result.md", fileName)
	}
}
