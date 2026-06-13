package api_service

import (
	"context"
	"strings"
	"testing"
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
