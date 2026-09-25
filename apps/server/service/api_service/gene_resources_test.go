package api_service

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/spf13/viper"
	rxBot "phytomni-server/external/bot"
)

func TestGeneReportRegistersOnlyCuratedSameGenePNG(t *testing.T) {
	const href = "/api/v1/gene-images/Os01g0107900/Os01g0107900_tree.png"
	raw := "# Gene\n\n![tree](" + href + ")\n[Repeated image](" + href + ")\n" +
		"![other gene](/api/v1/gene-images/AT1G01010/AT1G01010_tree.png)\n" +
		"![wrong basename](/api/v1/gene-images/Os01g0107900/AT1G01010_tree.png)\n" +
		"![remote](https://example.org/image.png)\n" +
		"![traversal](/api/v1/gene-images/Os01g0107900/%2e%2e%2fsecret.png)\n" +
		"![query](" + href + "?path=secret)\n" +
		"![fragment](" + href + "#other)\n" +
		"[Protocol](./Os01g0107900_result-experiments.md)\n" +
		"![CIF](./Os01g0107900_model.cif)\n" +
		"```\n![code](/api/v1/gene-images/Os01g0107900/Os01g0107900_code.png)\n```\n"
	mount := writeGeneObsfs(t, nil)
	writeGeneMd(t, mount, reportTestFile, raw)
	report, err := NewService().GeneDetails(context.Background(), reportTestFile)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Resources) != 1 {
		t.Fatalf("want only one curated resource, got %+v", report.Resources)
	}
	resource := report.Resources[0]
	if resource.Kind != "image" || resource.Name != "Os01g0107900_tree.png" || resource.MarkdownHref != href || resource.DisplayURL != href {
		t.Fatalf("invalid presentation descriptor: %+v", resource)
	}
	if !strings.HasPrefix(resource.ID, "gene-") || len(resource.ID) != len("gene-")+64 || strings.Contains(resource.ID, "Os01") {
		t.Fatalf("resource identity is not opaque: %q", resource.ID)
	}
	// Resource identity binds the exact report bytes, not merely its basename.
	writeGeneMd(t, mount, reportTestFile, raw+"\nUpdated report.\n")
	changed, err := NewService().GeneDetails(context.Background(), reportTestFile)
	if err != nil {
		t.Fatal(err)
	}
	if len(changed.Resources) != 1 || changed.Resources[0].ID == resource.ID {
		t.Fatal("updated report reused stale resource identity")
	}
}

func TestGeneReportRejectsMountedSourceSymlink(t *testing.T) {
	mount := writeGeneObsfs(t, nil)
	canary := filepath.Join(t.TempDir(), "source.md")
	if err := os.WriteFile(canary, []byte("# PRIVATE-REPORT-CANARY"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(canary, filepath.Join(mount, "md", reportTestFile)); err != nil {
		t.Fatal(err)
	}
	if report, err := NewService().GeneDetails(context.Background(), reportTestFile); err == nil || report != nil {
		t.Fatal("mounted report followed a symlink outside the selected root")
	}
}

func seedGeneResource(t *testing.T) (string, string, []byte) {
	t.Helper()
	mount := writeGeneObsfs(t, nil)
	directory := filepath.Join(mount, "img", "Os01g0107900")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	data := []byte("\x89PNG\r\n\x1a\nIMAGE")
	if err := os.WriteFile(filepath.Join(directory, "Os01g0107900_tree.png"), data, 0o600); err != nil {
		t.Fatal(err)
	}
	writeGeneMd(t, mount, reportTestFile, "# Gene\n\n![tree](/api/v1/gene-images/Os01g0107900/Os01g0107900_tree.png)\n")
	report, err := NewService().GeneDetails(context.Background(), reportTestFile)
	if err != nil || len(report.Resources) != 1 {
		t.Fatalf("resource fixture: %v", err)
	}
	return mount, report.Resources[0].ID, data
}

func TestGeneResourceCurrentReportIdentity(t *testing.T) {
	mount, resourceID, want := seedGeneResource(t)
	service := NewService()
	got, err := service.GeneResource(context.Background(), reportTestFile, resourceID)
	if err != nil || !bytes.Equal(got.Data, want) || got.Name != "Os01g0107900_tree.png" || got.MediaType != "image/png" {
		t.Fatalf("registered resource failed: %+v %v", got, err)
	}
	if _, err := service.GeneResource(context.Background(), "Os00g0000000_result.md", resourceID); !errors.Is(err, ErrGeneResourceNotFound) {
		t.Fatalf("missing owning report must be not found: %v", err)
	}
	for _, id := range []string{"../secret", "%2e%2e%2fsecret", "https://example.org/x", "gene-" + strings.Repeat("0", 64)} {
		if _, err := service.GeneResource(context.Background(), reportTestFile, id); !errors.Is(err, ErrGeneResourceNotFound) {
			t.Fatalf("unregistered identity accepted: %v", err)
		}
	}
	writeGeneMd(t, mount, "AT1G01010_result.md", "# Different report\n\n![tree](/api/v1/gene-images/AT1G01010/AT1G01010_tree.png)\n")
	if _, err := service.GeneResource(context.Background(), "AT1G01010_result.md", resourceID); !errors.Is(err, ErrGeneResourceNotFound) {
		t.Fatalf("cross-report identity accepted: %v", err)
	}
	writeGeneMd(t, mount, reportTestFile, "# Revised\n\n![tree](/api/v1/gene-images/Os01g0107900/Os01g0107900_tree.png)\n")
	if _, err := service.GeneResource(context.Background(), reportTestFile, resourceID); !errors.Is(err, ErrGeneResourceNotFound) {
		t.Fatalf("stale identity accepted: %v", err)
	}
}

func TestGeneImageMissingMountFileNeverUsesRelay(t *testing.T) {
	mount := writeGeneObsfs(t, nil)
	if err := os.MkdirAll(filepath.Join(mount, "img", "Os01g0107900"), 0o700); err != nil {
		t.Fatal(err)
	}
	var reads atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reads.Add(1)
		_, _ = w.Write([]byte("\x89PNG\r\n\x1a\nWRONG SOURCE"))
	}))
	oldBot := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { srv.Close(); rxBot.BotConfig = oldBot })
	if _, _, err := NewService().GeneImage(context.Background(), "Os01g0107900", "Os01g0107900_missing.png"); !errors.Is(err, ErrGeneResourceNotFound) || reads.Load() != 0 {
		t.Fatalf("missing mounted file changed storage lane: err=%v reads=%d", err, reads.Load())
	}
}

func TestGeneImageRejectsDirectoryAliasAndNonRegularFile(t *testing.T) {
	for _, directoryAlias := range []bool{false, true} {
		t.Run(strconv.FormatBool(directoryAlias), func(t *testing.T) {
			mount := writeGeneObsfs(t, nil)
			img := filepath.Join(mount, "img")
			if err := os.MkdirAll(img, 0o700); err != nil {
				t.Fatal(err)
			}
			if directoryAlias {
				other := filepath.Join(img, "AT1G01010")
				if err := os.MkdirAll(other, 0o700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(other, "Os01g0107900_tree.png"), []byte("\x89PNG\r\n\x1a\nCROSS-GENE"), 0o600); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(other, filepath.Join(img, "Os01g0107900")); err != nil {
					t.Fatal(err)
				}
			} else if err := os.MkdirAll(filepath.Join(img, "Os01g0107900", "Os01g0107900_tree.png"), 0o700); err != nil {
				t.Fatal(err)
			}
			if data, _, err := NewService().GeneImage(context.Background(), "Os01g0107900", "Os01g0107900_tree.png"); err == nil || data != nil {
				t.Fatal("directory alias or non-regular source was read")
			}
		})
	}
}

func TestGeneImageRelayBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name, file, content string
		knownOversize       bool
		status              int
		want                error
	}{
		{name: "valid", file: "Os01g0107900_tree.png", content: "\x89PNG\r\n\x1a\nIMAGE"},
		{name: "disguised HTML", file: "Os01g0107900_tree.png", content: "<html>upstream failure</html>", want: ErrGeneResourceContent},
		{name: "known oversize", file: "Os01g0107900_tree.png", knownOversize: true, want: ErrGeneResourceTooLarge},
		{name: "unknown oversize", file: "Os01g0107900_tree.png", content: strings.Repeat("a", documentImageMaxBytes+1), want: ErrGeneResourceTooLarge},
		{name: "missing", file: "Os01g0107900_tree.png", status: 404, want: ErrGeneResourceNotFound},
		{name: "upstream failure", file: "Os01g0107900_tree.png", status: 502, want: ErrGeneResourceUnavailable},
		{name: "cross gene file", file: "AT1G01010_tree.png", want: ErrGeneResourceNotFound},
		{name: "unsupported relay format", file: "Os01g0107900_tree.jpg", want: ErrGeneResourceNotFound},
		{name: "encoded traversal", file: "%2e%2e%2fsecret.png", want: ErrGeneResourceInvalid},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var reads atomic.Int64
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				reads.Add(1)
				if r.URL.Path != "/v1/relay/obs/object" || r.URL.Query().Get("path") != "gene-examples/img/Os01g0107900/Os01g0107900_tree.png" {
					t.Error("unapproved relay grammar reached the network")
					w.WriteHeader(400)
					return
				}
				if tc.knownOversize {
					w.Header().Set("Content-Length", strconv.Itoa(documentImageMaxBytes+1))
					w.WriteHeader(200)
					return
				}
				if tc.status != 0 {
					http.Error(w, "/private/source failed", tc.status)
					return
				}
				w.(http.Flusher).Flush()
				_, _ = w.Write([]byte(tc.content))
			}))
			oldBot, oldMount := rxBot.BotConfig, viper.Get("gene_obsfs_path")
			rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
			viper.Set("gene_obsfs_path", "")
			t.Cleanup(func() { srv.Close(); rxBot.BotConfig = oldBot; viper.Set("gene_obsfs_path", oldMount) })
			data, _, err := NewService().GeneImage(context.Background(), "Os01g0107900", tc.file)
			if !errors.Is(err, tc.want) {
				t.Fatalf("error=%v, want %v", err, tc.want)
			}
			if tc.want == nil && string(data) != tc.content {
				t.Fatal("relay bytes changed")
			}
			if tc.want != nil && data != nil {
				t.Fatal("failed image published partial bytes")
			}
			if !isCuratedGenePNG("Os01g0107900", tc.file) && reads.Load() != 0 {
				t.Fatal("unsupported file was sent to relay")
			}
			if err != nil && (strings.Contains(err.Error(), "private") || strings.Contains(err.Error(), srv.URL)) {
				t.Fatal("error leaked source path")
			}
		})
	}
}

func TestGeneImageRelayCancellation(t *testing.T) {
	started := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(started); <-r.Context().Done() }))
	oldBot, oldMount := rxBot.BotConfig, viper.Get("gene_obsfs_path")
	rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	viper.Set("gene_obsfs_path", "")
	t.Cleanup(func() { srv.Close(); rxBot.BotConfig = oldBot; viper.Set("gene_obsfs_path", oldMount) })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		select {
		case <-started:
			cancel()
		case <-ctx.Done():
		}
	}()
	data, _, err := NewService().GeneImage(ctx, "Os01g0107900", "Os01g0107900_tree.png")
	if !errors.Is(err, context.Canceled) || data != nil {
		t.Fatalf("cancellation was not preserved: %v", err)
	}
}
