package api_service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	rxBot "phytomni-server/external/bot"
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
