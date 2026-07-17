package api_service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	rxBot "phytomni-server/external/bot"
	"phytomni-server/middleware"
)

func TestParseProjectionArtifactsRejectsPathOutsideOutputDirectory(t *testing.T) {
	for _, raw := range []string{
		`[{"output_dir":"/obs/bucket/run-1","paths":["/obs/bucket/other-run/report.pdf"]}]`,
		`[{"output_dir":"obs://bucket/run-1","paths":["obs://bucket/other-run/report.pdf"]}]`,
	} {
		if _, err := rxBot.ParseRunProjectionArtifacts(json.RawMessage(raw)); err == nil {
			t.Fatalf("expected artifact path containment error for %s", raw)
		}
	}
}

func TestArtifactPathWithinPrefixTightensDirectBucketChildButKeepsDeeperRunSiblings(t *testing.T) {
	tests := []struct {
		name      string
		prefix    string
		candidate string
		want      bool
	}{
		{name: "legacy direct child", prefix: "/obs/bucket/run", candidate: "/obs/bucket/run/report.zip", want: true},
		{name: "legacy direct sibling", prefix: "/obs/bucket/run", candidate: "/obs/bucket/run-2/report.zip", want: false},
		{name: "legacy relative direct child", prefix: "/obs/bucket/run", candidate: "run/report.zip", want: true},
		{name: "legacy relative direct sibling", prefix: "/obs/bucket/run", candidate: "run-2/report.zip", want: false},
		{name: "uri direct child", prefix: "obs://bucket/run", candidate: "obs://bucket/run/report.zip", want: true},
		{name: "uri direct sibling", prefix: "obs://bucket/run", candidate: "obs://bucket/run-2/report.zip", want: false},
		{name: "uri relative direct child", prefix: "obs://bucket/run", candidate: "run/report.zip", want: true},
		{name: "uri relative direct sibling", prefix: "obs://bucket/run", candidate: "run-2/report.zip", want: false},
		{name: "deeper legacy sibling run", prefix: artifactRunRoot("/obs/bucket/user/runs/run-1"), candidate: "/obs/bucket/user/runs/run-2/report.zip", want: true},
		{name: "deeper uri sibling run", prefix: artifactRunRoot("obs://bucket/user/runs/run-1"), candidate: "obs://bucket/user/runs/run-2/report.zip", want: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := artifactPathWithinPrefix(test.prefix, test.candidate); got != test.want {
				t.Fatalf("artifactPathWithinPrefix(%q, %q) = %v, want %v", test.prefix, test.candidate, got, test.want)
			}
		})
	}
}

func TestDownloadAnalystAgentObsFilePreservesRelativeRelayZipKey(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, download_path, status, created_at) VALUES
		(90, 'alice', '/obs/bucket/user/runs/run-1', 'SUCCEEDED', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	const relayKey = "user/runs/run-1/output.zip"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/relay/obs/list" {
			t.Fatalf("unexpected relay path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"keys":["user/runs/run-1/output.zip"]}`))
	}))
	t.Cleanup(srv.Close)
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { rxBot.BotConfig = nil })

	got, err := NewService().DownloadAnalystAgentObsFile(context.Background(), "alice", "/obs/bucket/user/runs/run-1")
	if err != nil {
		t.Fatalf("download: %v", err)
	}
	parsed, err := url.Parse(got)
	if err != nil {
		t.Fatalf("signed URL parse: %v", err)
	}
	token := parsed.Query().Get("t")
	if token == "" {
		t.Fatal("missing signed download token")
	}
	if key, err := middleware.ParseDownloadToken(token); err != nil || key != relayKey {
		t.Fatalf("signed key = %q, err=%v; want unchanged relative relay key %q", key, err, relayKey)
	}
}

func TestDownloadAnalystAgentObsImagesPreservesRelativeRelayImageKey(t *testing.T) {
	gdb := setupTestDB(t)
	const relayKey = "user/runs/run-1/plot.png"
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, download_path, image_paths, created_at) VALUES
		(91, 'alice', '/obs/bucket/user/runs/run-1', '["user/runs/run-1/plot.png"]', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	urls, err := NewService().DownloadAnalystAgentObsImages(context.Background(), "alice", "/obs/bucket/user/runs/run-1")
	if err != nil {
		t.Fatalf("download: %v", err)
	}
	if len(urls) != 1 {
		t.Fatalf("image URLs = %v, want one", urls)
	}
	parsed, err := url.Parse(urls[0])
	if err != nil {
		t.Fatalf("signed URL parse: %v", err)
	}
	key, err := middleware.ParseDownloadToken(parsed.Query().Get("t"))
	if err != nil || key != relayKey {
		t.Fatalf("signed key = %q, err=%v; want unchanged relative relay key %q", key, err, relayKey)
	}

	const uriRelayKey = "user/runs/run-2/plot.png"
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, user_name, download_path, image_paths, created_at) VALUES
		(92, 'alice', 'obs://bucket/user/runs/run-2', '["user/runs/run-2/plot.png"]', '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed URI row: %v", err)
	}
	uriURLs, err := NewService().DownloadAnalystAgentObsImages(context.Background(), "alice", "obs://bucket/user/runs/run-2")
	if err != nil || len(uriURLs) != 1 {
		t.Fatalf("URI image URLs = %v, err=%v; want one URL", uriURLs, err)
	}
	uriParsed, err := url.Parse(uriURLs[0])
	if err != nil {
		t.Fatalf("URI signed URL parse: %v", err)
	}
	uriKey, err := middleware.ParseDownloadToken(uriParsed.Query().Get("t"))
	if err != nil || uriKey != uriRelayKey {
		t.Fatalf("URI signed key = %q, err=%v; want unchanged relative relay key %q", uriKey, err, uriRelayKey)
	}
}

func TestDownloadAnalystAgentObsFileRejectsMalformedPathBeforeLookup(t *testing.T) {
	setupTestDB(t)
	if _, err := NewService().DownloadAnalystAgentObsFile(context.Background(), "alice", "http://private/secret"); err == nil {
		t.Fatal("expected malformed path to be rejected")
	}
}

func TestDownloadAnalystAgentObsImagesRejectsMalformedPathBeforeLookup(t *testing.T) {
	setupTestDB(t)
	if _, err := NewService().DownloadAnalystAgentObsImages(context.Background(), "alice", "../escape"); err == nil {
		t.Fatal("expected malformed path to be rejected")
	}
}
