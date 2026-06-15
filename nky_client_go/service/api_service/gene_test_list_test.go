package api_service

import (
	"context"
	"strings"
	"testing"

	rxBot "nky_client_go/external/bot"
)

// TestApiDownloadAnalystAgentObsImages_StoredPaths: with image_paths populated,
// the handler signs each .png (skipping non-images) via the offline token
// signer and enforces the (username, download_path) ownership lookup — no
// Bot/OBS call is made.
func TestApiDownloadAnalystAgentObsImages_StoredPaths(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO s_question_agent_logs
		(id, user_name, download_path, image_paths, created_at) VALUES
		(70, 'alice', '/obs/p/r1', '["/obs/p/r1/a.png","/obs/p/r2/b.png","/obs/p/r1/t.csv"]', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	ps := NewApiService()
	urls, err := ps.ApiDownloadAnalystAgentObsImages(context.Background(), "alice", "/obs/p/r1")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(urls) != 2 {
		t.Fatalf("expected 2 png urls (csv filtered), got %d: %v", len(urls), urls)
	}
	for _, u := range urls {
		if !strings.Contains(u, "/v1/download/relay_file?t=") {
			t.Errorf("url not a signed relay url: %q", u)
		}
	}
}

// TestApiDownloadAnalystAgentObsImages_OwnershipMiss: a path not owned by the
// requesting user (no matching row) is rejected before any OBS/Bot call.
func TestApiDownloadAnalystAgentObsImages_OwnershipMiss(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO s_question_agent_logs
		(id, user_name, download_path, image_paths, created_at) VALUES
		(71, 'bob', '/obs/p/r9', '["/obs/p/r9/a.png"]', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	ps := NewApiService()
	if _, err := ps.ApiDownloadAnalystAgentObsImages(context.Background(), "alice", "/obs/p/r9"); err == nil {
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
	if err := gdb.Exec(`INSERT INTO s_question_agent_logs
		(id, user_name, download_path, image_paths, created_at) VALUES
		(72, 'alice', '/obs/p/r1', '["/obs/p/r1/a.png","/obs/p/r2/b.png","/obs/OTHER/evil.png"]', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	ps := NewApiService()
	urls, err := ps.ApiDownloadAnalystAgentObsImages(context.Background(), "alice", "/obs/p/r1")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	// /obs/p/r1 + /obs/p/r2 are under run root /obs/p → served (2);
	// /obs/OTHER/evil.png escapes the run root → dropped.
	if len(urls) != 2 {
		t.Fatalf("expected 2 in-scope png urls (cross-root dropped), got %d: %v", len(urls), urls)
	}
	for _, u := range urls {
		if !strings.Contains(u, "/v1/download/relay_file?t=") {
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
	if err := gdb.Exec(`INSERT INTO s_question_agent_logs
		(id, user_name, download_path, image_paths, created_at) VALUES
		(73, 'alice', '/obs/p/r1', '{bad-json', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	// Malformed image_paths must fall through to OBS listing, not sign garbage.
	// Point the Bot client at a dead address so ListObsKeys errors cleanly
	// (mirrors query_updatelog_test) rather than nil-derefing on NewClient.
	rxBot.BotConfig = &rxBot.Config{BaseURL: "http://127.0.0.1:0", ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })
	ps := NewApiService()
	urls, err := ps.ApiDownloadAnalystAgentObsImages(context.Background(), "alice", "/obs/p/r1")
	if err == nil {
		t.Fatalf("expected fallback-to-listing error (dead Bot addr), got urls=%v", urls)
	}
	if len(urls) != 0 {
		t.Fatalf("malformed image_paths must not yield signed urls, got %v", urls)
	}
}
