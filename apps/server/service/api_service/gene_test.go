package api_service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/viper"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/model"
)

// TestApiDownloadAnalystAgentObsImages_StoredPaths: with image_paths populated,
// the handler signs each .png (skipping non-images) via the offline token
// signer and enforces the (username, download_path) ownership lookup — no
// Bot/OBS call is made.
func TestApiDownloadAnalystAgentObsImages_StoredPaths(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, download_path, image_paths, created_at) VALUES
		(70, 'alice', '/obs/bucket/user/runs/run-1', '["/obs/bucket/user/runs/run-1/a.png","/obs/bucket/user/runs/run-2/b.png","/obs/bucket/user/runs/run-1/t.csv"]', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	ps := NewService()
	urls, err := ps.DownloadAnalystAgentObsImages(context.Background(), "alice", "/obs/bucket/user/runs/run-1")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(urls) != 2 {
		t.Fatalf("expected 2 png urls (csv filtered), got %d: %v", len(urls), urls)
	}
	for _, u := range urls {
		if !strings.Contains(u, "/api/v1/downloads/relay-file?token=") {
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
		(72, 'alice', '/obs/bucket/user/runs/run-1', '["/obs/bucket/user/runs/run-1/a.png","/obs/bucket/user/runs/run-2/b.png","/obs/OTHER/evil.png"]', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	ps := NewService()
	urls, err := ps.DownloadAnalystAgentObsImages(context.Background(), "alice", "/obs/bucket/user/runs/run-1")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	// run-1 + run-2 are under run root /obs/bucket/user/runs → served (2);
	// /obs/OTHER/evil.png escapes the run root → dropped.
	if len(urls) != 2 {
		t.Fatalf("expected 2 in-scope png urls (cross-root dropped), got %d: %v", len(urls), urls)
	}
	for _, u := range urls {
		if !strings.Contains(u, "/api/v1/downloads/relay-file?token=") {
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
		(74, 'alice', '/obs/bucket/user/runs/run-1', '', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	// Reachable fake Bot relay: listing returns in-root pngs (run root /obs/bucket/user/runs),
	// a cross-root png, and a non-image. Only the two in-root pngs may be signed.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"keys":["/obs/bucket/user/runs/run-1/a.png","/obs/bucket/user/runs/run-2/b.png","/obs/OTHER/evil.png","/obs/bucket/user/runs/run-1/t.csv"]}`))
	}))
	defer srv.Close()
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	ps := NewService()
	urls, err := ps.DownloadAnalystAgentObsImages(context.Background(), "alice", "/obs/bucket/user/runs/run-1")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	// run-1 + run-2 under run root /obs/bucket/user/runs → signed (2);
	// /obs/OTHER/evil.png escapes → dropped; t.csv → not a png.
	if len(urls) != 2 {
		t.Fatalf("expected 2 in-scope png urls from fallback listing (cross-root + csv excluded), got %d: %v", len(urls), urls)
	}
	for _, u := range urls {
		if !strings.Contains(u, "/api/v1/downloads/relay-file?token=") {
			t.Errorf("url not a signed relay url: %q", u)
		}
	}
}

// TestApiDownloadAnalystAgentObsImages_LegacyListIsEmptyGallery: chat auto-
// fetches this endpoint for every GeneNetworkAgent row that still has a
// download_path. A Bot 403 (relay prefix miss, including the unallocated
// AnalystConfig.OUTPUT_DIR dump /obs/phytomni/agent_data/test/output/...)
// must not become a 500 "pre-cutover historical data" toast. Gallery is
// best-effort: unservable prefixes return no images.
func TestApiDownloadAnalystAgentObsImages_LegacyListIsEmptyGallery(t *testing.T) {
	gdb := setupTestDB(t)
	const dump = "/obs/phytomni/agent_data/test/output/children/part-001"
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, download_path, image_paths, status, created_at) VALUES
		(75, 'alice', ?, '', 'SUCCEEDED', '2026-08-17 18:45:29')`, dump).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":{"message":"list prefix outside the output root"}}`))
	}))
	defer srv.Close()
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	urls, err := NewService().DownloadAnalystAgentObsImages(context.Background(), "alice", dump)
	if err != nil {
		t.Fatalf("legacy/unservable gallery prefix must not error, got %v", err)
	}
	if len(urls) != 0 {
		t.Fatalf("legacy/unservable gallery prefix must yield no image URLs, got %v", urls)
	}
}

// TestApiDownloadAnalystAgentObsImages_NoPngIsEmptyGallery: a listed prefix
// with no .png objects is an empty gallery, not a 500. Chat prefetch would
// otherwise toast "no png image file found" on every finished network row
// that only has reports/archives.
func TestApiDownloadAnalystAgentObsImages_NoPngIsEmptyGallery(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, download_path, image_paths, status, created_at) VALUES
		(76, 'alice', '/obs/bucket/user/runs/run-1', '', 'SUCCEEDED', '2026-08-17 18:45:29')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"keys":["/obs/bucket/user/runs/run-1/report.md","/obs/bucket/user/runs/run-1/t.csv"]}`))
	}))
	defer srv.Close()
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	urls, err := NewService().DownloadAnalystAgentObsImages(context.Background(), "alice", "/obs/bucket/user/runs/run-1")
	if err != nil {
		t.Fatalf("no-png listing must not error, got %v", err)
	}
	if len(urls) != 0 {
		t.Fatalf("no-png listing must yield no image URLs, got %v", urls)
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

// writeGeneMd writes one md file into the mount's md/ dir (mount already set by
// writeGeneObsfs) — used to assert body passthrough.
func writeGeneMd(t *testing.T, mount, name, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(mount, "md", name), []byte(body), 0o644); err != nil {
		t.Fatalf("write md %s: %v", name, err)
	}
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

func TestGeneMatchesQuery_CaseInsensitive(t *testing.T) {
	rice := &model.GeneExample{SpeciesCode: "Osa", GeneId: "Os01g0107900"}
	wheat := &model.GeneExample{SpeciesCode: "tae", GeneId: "TraesCS1A02G000100"}

	cases := []struct {
		name  string
		item  *model.GeneExample
		query string
		want  bool
	}{
		{name: "empty query matches", item: rice, query: "", want: true},
		{name: "exact gene id", item: rice, query: "Os01g0107900", want: true},
		{name: "lower gene id", item: rice, query: "os01g0107900", want: true},
		{name: "upper gene substring", item: rice, query: "OS01G", want: true},
		{name: "lower species", item: rice, query: "osa", want: true},
		{name: "upper species", item: rice, query: "OSA", want: true},
		{name: "canonical species", item: rice, query: "Osa", want: true},
		{name: "stored-lower species upper query", item: wheat, query: "TAE", want: true},
		{name: "other species", item: rice, query: "Ath", want: false},
		{name: "other gene prefix", item: rice, query: "AT1G", want: false},
		{name: "unrelated", item: rice, query: "nogene", want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := geneMatchesQuery(tc.item, tc.query); got != tc.want {
				t.Fatalf("geneMatchesQuery(%q) = %v, want %v", tc.query, got, tc.want)
			}
		})
	}
}

// TestGeneSearch_CaseInsensitiveTitle: the list filter lowercases both the
// query and the derived species/gene fields. Delete the ToLower in
// geneMatchesQuery and os01g / OSA stop matching the rice row.
func TestGeneSearch_CaseInsensitiveTitle(t *testing.T) {
	writeGeneObsfs(t, []string{"Os01g0107900_result.md", "AT1G01010_result.md"})
	ps := NewService()

	list, total, _, err := ps.GeneSearch(context.Background(), 1, 10, "os01g0107900")
	if err != nil {
		t.Fatalf("lower gene id: %v", err)
	}
	if total != 1 || len(list) != 1 || list[0].GeneId != "Os01g0107900" {
		t.Fatalf("os01g0107900 should hit rice, got total=%d list=%+v", total, list)
	}

	list, total, _, err = ps.GeneSearch(context.Background(), 1, 10, "OSA")
	if err != nil {
		t.Fatalf("upper species: %v", err)
	}
	if total != 1 || len(list) != 1 || list[0].SpeciesCode != "Osa" {
		t.Fatalf("OSA should hit rice species, got total=%d list=%+v", total, list)
	}

	list, total, _, err = ps.GeneSearch(context.Background(), 1, 10, "AT1G")
	if err != nil {
		t.Fatalf("canonical arabidopsis substring: %v", err)
	}
	if total != 1 || len(list) != 1 || list[0].GeneId != "AT1G01010" {
		t.Fatalf("AT1G should hit arabidopsis, got total=%d list=%+v", total, list)
	}

	list, total, _, err = ps.GeneSearch(context.Background(), 1, 10, "nogene")
	if err != nil {
		t.Fatalf("unrelated query: %v", err)
	}
	if total != 0 || len(list) != 0 {
		t.Fatalf("nogene should miss, got total=%d list=%+v", total, list)
	}
}

// TestGeneDetails_ObsfsRead: with the mount set, GeneDetails returns the md body
// verbatim; image URLs already in /api/v1/gene-images/ form are left untouched
// (no backend rewrite).
func TestGeneDetails_ObsfsRead(t *testing.T) {
	mount := writeGeneObsfs(t, nil)
	body := "# Os01g0107900\n\n![tree](/api/v1/gene-images/Os01g0107900/Os01g0107900_tree.png)\n"
	writeGeneMd(t, mount, "Os01g0107900_result.md", body)
	ps := NewService()
	item, err := ps.GeneDetails(context.Background(), "Os01g0107900_result.md")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if item.Content != body {
		t.Fatalf("content mismatch:\n got: %q\nwant: %q", item.Content, body)
	}
	if item.SpeciesCode != "Osa" || item.GeneId != "Os01g0107900" {
		t.Fatalf("derived metadata wrong: %+v", item)
	}
}

// TestGeneDetails_TraversalReject: an unsafe fileName is rejected before any
// read (CleanUploadFilename gate), for the whole set. The name
// "Os01g0107900/../escape_result.md" passes parseGeneFile (Os prefix +
// _result.md suffix) and filepath.Join collapses the traversal to the planted
// escape_result.md — so it is the CleanUploadFilename guard alone that blocks
// the read. Delete the guard and this case returns the planted content with no
// error, turning the test red (a true mutation-proof, not a benign miss).
func TestGeneDetails_TraversalReject(t *testing.T) {
	// Plant escape_result.md so a traversal-resolved read returns content
	// (not a missing-file error) when the guard is deleted — the mutation
	// must surface as a true positive, not a benign error.
	writeGeneObsfs(t, []string{"escape_result.md"})
	ps := NewService()
	for _, name := range []string{
		"../escape.md",
		"sub/escape.md",
		`sub\escape.md`,
		"",
		"..",
		"Os01g0107900/../escape_result.md",
	} {
		if _, err := ps.GeneDetails(context.Background(), name); err == nil {
			t.Fatalf("GeneDetails(%q) = nil err, want rejection", name)
		}
	}
}

// TestGeneDetails_MissingGene: a fileName with no backing md object → clean
// error, no panic.
func TestGeneDetails_MissingGene(t *testing.T) {
	writeGeneObsfs(t, nil) // empty mount
	ps := NewService()
	if _, err := ps.GeneDetails(context.Background(), "Os01g0107900_result.md"); err == nil {
		t.Fatal("expected error for missing md object")
	}
}

func TestGeneDownloadPathValidationRejectsUnsafePaths(t *testing.T) {
	for _, raw := range []string{"", "../escape", "http://private/secret", "obs://bucket/../escape"} {
		t.Run(raw, func(t *testing.T) {
			if err := validateDownloadArtifactPath(raw); err == nil {
				t.Fatalf("validateDownloadArtifactPath(%q) returned nil", raw)
			}
		})
	}
}
