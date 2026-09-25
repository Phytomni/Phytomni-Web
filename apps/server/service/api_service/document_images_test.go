package api_service

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"phytomni-server/model"

	"github.com/spf13/viper"
)

func TestResolveDocumentImageHrefRejectsRemoteAndUnsafe(t *testing.T) {
	allow := []string{"/obs/bucket/user/run/plot.png"}
	root := "/obs/bucket/user/run"
	cases := []string{
		"http://evil.example/a.png",
		"https://evil.example/a.png",
		"data:image/png;base64,aaaa",
		"javascript:alert(1)",
		"file:///etc/passwd",
		"//evil.example/a.png",
		"/obs/other/secret.png",
		"obs://other/secret.png",
		"/api/v1/gene-images/../secret/x.png",
		"/api/v1/gene-images/Os01/tree.svg",
	}
	for _, href := range cases {
		if _, ok := resolveDocumentImageHref(href, allow, root); ok {
			t.Errorf("href %q should be rejected", href)
		}
	}
}

func TestResolveDocumentImageHrefAllowsOwnedAndGeneImages(t *testing.T) {
	allow := []string{"/obs/bucket/user/run/plot.png", "obs://bucket/user/run/fig.jpg"}
	root := "/obs/bucket/user/run"

	got, ok := resolveDocumentImageHref("/api/v1/gene-images/Os01g0107900/Os01g0107900_tree.png", nil, "")
	if !ok || got.kind != documentImageGene || got.gene != "Os01g0107900" || got.file != "Os01g0107900_tree.png" {
		t.Fatalf("gene image: %+v ok=%v", got, ok)
	}

	got, ok = resolveDocumentImageHref("/obs/bucket/user/run/plot.png", allow, root)
	if !ok || got.kind != documentImageOBS || got.obs != "/obs/bucket/user/run/plot.png" {
		t.Fatalf("exact obs: %+v ok=%v", got, ok)
	}

	got, ok = resolveDocumentImageHref("obs://bucket/user/run/fig.jpg", allow, root)
	if !ok || got.kind != documentImageOBS {
		t.Fatalf("uri obs: %+v ok=%v", got, ok)
	}

	got, ok = resolveDocumentImageHref("./plot.png", allow, root)
	if !ok || got.obs != "/obs/bucket/user/run/plot.png" {
		t.Fatalf("relative basename: %+v ok=%v", got, ok)
	}

	got, ok = resolveDocumentImageHref("/obs/bucket/user/run/extra.png", nil, root)
	if !ok || got.obs != "/obs/bucket/user/run/extra.png" {
		t.Fatalf("run-root extra: %+v ok=%v", got, ok)
	}
}

func TestDocumentImageFetcherUsesReaderOnlyForResolvedHrefs(t *testing.T) {
	reader := &stubDocumentReader{
		obs: map[string][]byte{
			"/obs/bucket/user/run/plot.png": pngDot(),
		},
		gene: map[string][]byte{
			"Os01g0107900/tree.png": pngDot(),
		},
	}
	row := &model.QuestionAgentLog{
		DownloadPath: "/obs/bucket/user/run/out",
		ImagePaths:   `["/obs/bucket/user/run/plot.png"]`,
	}
	fetch := newDocumentImageFetcherWithReader(context.Background(), row, reader)

	if img, err := fetch("/obs/bucket/user/run/plot.png"); err != nil || img == nil {
		t.Fatalf("owned obs: img=%v err=%v", img, err)
	}
	if img, err := fetch("/api/v1/gene-images/Os01g0107900/tree.png"); err != nil || img == nil {
		t.Fatalf("gene: img=%v err=%v", img, err)
	}
	if img, err := fetch("https://evil.example/a.png"); err != nil || img != nil {
		t.Fatalf("remote must not fetch: img=%v err=%v", img, err)
	}
	if img, err := fetch("/obs/other/secret.png"); err != nil || img != nil {
		t.Fatalf("foreign obs must not fetch: img=%v err=%v", img, err)
	}
	if reader.sawRemote {
		t.Fatal("reader was asked for a rejected href")
	}
	if containsString(reader.obsSeen, "/obs/other/secret.png") {
		t.Fatal("foreign OBS path was requested")
	}
}

func TestDocumentImageFetcherReadsGeneImageFromObsfs(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "img", "Os01g0107900")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "tree.png"), pngDot(), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "secret.png"), []byte("CANARY"), 0o644); err != nil {
		t.Fatal(err)
	}
	viper.Set("gene_obsfs_path", root)
	t.Cleanup(func() { viper.Set("gene_obsfs_path", "") })

	fetch := newDocumentImageFetcherWithReader(context.Background(), &model.QuestionAgentLog{}, liveDocumentObjectReader{})
	img, err := fetch("/api/v1/gene-images/Os01g0107900/tree.png")
	if err != nil || img == nil || !bytes.HasPrefix(img.Bytes, []byte("\x89PNG")) {
		t.Fatalf("obsfs gene image: img=%v err=%v", img, err)
	}
	img, err = fetch("/api/v1/gene-images/Os01g0107900/../secret.png")
	if err != nil || img != nil {
		t.Fatalf("traversal must not resolve: img=%v err=%v", img, err)
	}
}

type stubDocumentReader struct {
	obs       map[string][]byte
	gene      map[string][]byte
	obsSeen   []string
	sawRemote bool
}

func (s *stubDocumentReader) ReadOBS(_ context.Context, path string) ([]byte, error) {
	s.obsSeen = append(s.obsSeen, path)
	if data, ok := s.obs[path]; ok {
		return data, nil
	}
	s.sawRemote = true
	return nil, errors.New("missing")
}

func (s *stubDocumentReader) ReadGeneImage(_ context.Context, gene, file string) ([]byte, error) {
	if data, ok := s.gene[gene+"/"+file]; ok {
		return data, nil
	}
	return nil, errors.New("missing")
}

func pngDot() []byte {
	return []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
		0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
		0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
		0x00, 0x03, 0x01, 0x01, 0x00, 0xc9, 0xfe, 0x92,
		0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
		0x44, 0xae, 0x42, 0x60, 0x82,
	}
}

func containsString(items []string, want string) bool {
	for _, item := range items {
		if item == want {
			return true
		}
	}
	return false
}
