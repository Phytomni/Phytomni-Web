package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

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

func TestConversationArtifactLinksRequireOwnerDialogueAndMessageRow(t *testing.T) {
	gdb := setupTestDB(t)
	raw, err := marshalPersistedProjection(BotRunProjection{
		ReportRevision: 1,
		Artifacts: ProjectionArtifacts{
			Directories: []string{"obs://bucket/alice/run-1"},
			Paths:       []string{"obs://bucket/alice/run-1/report.pdf"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, status, bot_projection_json, bot_report_revision, created_at)
		VALUES (120, 'dlg-artifact', 0, 'alice', 'SUCCEEDED', ?, 1, '2026-01-01 00:00:00')`, raw).Error; err != nil {
		t.Fatal(err)
	}

	service := NewService()
	links, err := service.conversationArtifactLinks(
		context.Background(), "alice", "dlg-artifact", 120,
	)
	if err != nil || len(links) != 1 {
		t.Fatalf("links=%#v err=%v", links, err)
	}
	if links[0].Name != "report.pdf" || links[0].Kind != "report" {
		t.Fatalf("link=%#v", links[0])
	}
	encoded, err := json.Marshal(links)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "download_url") ||
		strings.Contains(string(encoded), "obs://") ||
		strings.Contains(string(encoded), "bucket") {
		t.Fatalf("browser DTO leaked storage path: %s", encoded)
	}
	signedURL, err := service.ConversationArtifactDownloadURL(
		context.Background(), "alice", "dlg-artifact", 120, links[0].ID,
	)
	if err != nil {
		t.Fatalf("click-time signing: %v", err)
	}
	parsed, err := url.Parse(signedURL)
	if err != nil {
		t.Fatal(err)
	}
	token := parsed.Query().Get("token")
	if token == "" || len(parsed.Query()) != 1 || parsed.Query().Has("t") {
		t.Fatalf("download URL does not use the canonical token query: %q", signedURL)
	}
	if key, err := middleware.ParseDownloadToken(token); err != nil ||
		key != "obs://bucket/alice/run-1/report.pdf" {
		t.Fatalf("signed key=%q err=%v", key, err)
	}

	for _, attempt := range []struct {
		user, dialogue string
		row            int64
	}{
		{user: "bob", dialogue: "dlg-artifact", row: 120},
		{user: "alice", dialogue: "dlg-other", row: 120},
		{user: "alice", dialogue: "dlg-artifact", row: 121},
	} {
		if _, err := service.conversationArtifactLinks(
			context.Background(), attempt.user, attempt.dialogue, attempt.row,
		); !errors.Is(err, ErrConversationArtifactOwnership) {
			t.Fatalf("attempt=%#v err=%v", attempt, err)
		}
		if _, err := service.ConversationArtifactDownloadURL(
			context.Background(), attempt.user, attempt.dialogue, attempt.row, links[0].ID,
		); !errors.Is(err, ErrConversationArtifactOwnership) {
			t.Fatalf("click attempt=%#v err=%v", attempt, err)
		}
	}
	if _, err := service.ConversationArtifactDownloadURL(
		context.Background(), "alice", "dlg-artifact", 120, "obs://bucket/alice/run-1/report.pdf",
	); !errors.Is(err, ErrConversationArtifactOwnership) {
		t.Fatalf("raw path artifact id err=%v", err)
	}
}

func TestConversationArtifactLinksRegenerateAndExpiredTokensFail(t *testing.T) {
	gdb := setupTestDB(t)
	raw, err := marshalPersistedProjection(BotRunProjection{
		ReportRevision: 1,
		Artifacts: ProjectionArtifacts{
			Directories: []string{"/obs/bucket/alice/run-2"},
			Paths:       []string{"/obs/bucket/alice/run-2/table.csv"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := gdb.Exec(`INSERT INTO question_agent_logs
		(id, dialogue_id, f_id, user_name, status, bot_projection_json, bot_report_revision, created_at)
		VALUES (121, 'dlg-regenerate', 0, 'alice', 'SUCCEEDED', ?, 1, '2026-01-01 00:00:00')`, raw).Error; err != nil {
		t.Fatal(err)
	}
	service := NewService()
	links, err := service.conversationArtifactLinks(
		context.Background(), "alice", "dlg-regenerate", 121,
	)
	if err != nil {
		t.Fatal(err)
	}
	first, err := service.ConversationArtifactDownloadURL(
		context.Background(), "alice", "dlg-regenerate", 121, links[0].ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(1100 * time.Millisecond)
	second, err := service.ConversationArtifactDownloadURL(
		context.Background(), "alice", "dlg-regenerate", 121,
		links[0].ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if first == second {
		t.Fatalf("click-time URLs were not freshly signed: %q", first)
	}
	var persistedProjection string
	if err := gdb.Raw(
		`SELECT bot_projection_json FROM question_agent_logs WHERE id = ?`,
		121,
	).Scan(&persistedProjection).Error; err != nil {
		t.Fatal(err)
	}
	if strings.Contains(persistedProjection, "relay-file") ||
		strings.Contains(persistedProjection, first) {
		t.Fatalf("signed URL became durable message data: %s", persistedProjection)
	}

	expired, err := middleware.GenerateDownloadToken(
		"/obs/bucket/alice/run-2/table.csv",
		-time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := middleware.ParseDownloadToken(expired); err == nil {
		t.Fatal("expired artifact token must fail")
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
	token := parsed.Query().Get("token")
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
	key, err := middleware.ParseDownloadToken(parsed.Query().Get("token"))
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
	uriKey, err := middleware.ParseDownloadToken(uriParsed.Query().Get("token"))
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
