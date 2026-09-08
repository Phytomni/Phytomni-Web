package api_service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/spf13/viper"
	rxBot "phytomni-server/external/bot"
)

const manifestTestGene = "Os01g0107900"
const manifestTestKey = "gene-examples/manifests/Os01g0107900_result.json"

func manifestDigest(data []byte) string { return fmt.Sprintf("%x", sha256.Sum256(data)) }

func manifestFixture() (map[string]any, map[string][]byte) {
	report := []byte("# Gene\n\n![tree](/api/v1/gene-images/Os01g0107900/Os01g0107900_tree.png)\n[CIF](./model.cif)\n[Protocol](./protocol.md)\n\n--- DOC TITLES ---\n1. Repeated source\n2. Repeated source\n3.\n")
	revision := manifestDigest(report)
	objects := map[string][]byte{"gene-examples/md/" + reportTestFile: report}
	resources := make([]any, 0, 3)
	for _, resource := range []struct{ id, name, kind, mime, href, content string }{
		{"tree", "tree.png", "image", "image/png", "/api/v1/gene-images/Os01g0107900/Os01g0107900_tree.png", "\x89PNG\r\n\x1a\nIMAGE"},
		{"model", "model.cif", "cif", "chemical/x-cif", "./model.cif", "data_model\n_cell.length_a 10\n"},
		{"protocol", "protocol.md", "markdown", "text/markdown", "./protocol.md", "# Approved protocol\r\n\r\nKeep original bytes.\r\n"},
	} {
		key := "gene-examples/materials/" + manifestTestGene + "/" + revision + "/" + resource.name
		if resource.kind == "image" {
			key = "gene-examples/img/" + manifestTestGene + "/" + manifestTestGene + "_" + resource.name
		}
		body := []byte(resource.content)
		objects[key] = body
		resources = append(resources, map[string]any{"id": resource.id, "name": resource.name, "kind": resource.kind, "markdown_href": resource.href, "object_key": key, "media_type": resource.mime, "size_bytes": len(body), "sha256": manifestDigest(body)})
	}
	manifest := map[string]any{"schema_version": 1, "gene_id": manifestTestGene, "report_file": reportTestFile, "report_sha256": revision, "reference_count": 3, "resources": resources, "reference_materials": []any{
		map[string]any{"reference_index": 1, "excerpt": "First original slot", "resource_ids": []string{"protocol"}},
		map[string]any{"reference_index": 2, "excerpt": "Second slot from the same paper", "resource_ids": []string{"protocol"}},
		map[string]any{"reference_index": 3, "excerpt": "", "resource_ids": []string{}},
	}}
	return manifest, objects
}

func encodeManifest(t *testing.T, manifest map[string]any) []byte {
	t.Helper()
	data, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func serveManifestFixture(t *testing.T, objects map[string][]byte, relay bool) func(string, []byte) {
	t.Helper()
	if !relay {
		mount := writeGeneObsfs(t, nil)
		write := func(key string, data []byte) {
			file := filepath.Join(mount, filepath.FromSlash(strings.TrimPrefix(key, "gene-examples/")))
			if err := os.MkdirAll(filepath.Dir(file), 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(file, data, 0o600); err != nil {
				t.Fatal(err)
			}
		}
		for key, data := range objects {
			write(key, data)
		}
		return write
	}
	oldMount, oldBot := viper.Get("gene_obsfs_path"), rxBot.BotConfig
	viper.Set("gene_obsfs_path", "")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/relay/obs/object" {
			t.Errorf("unexpected relay endpoint: %s", request.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		data, ok := objects[request.URL.Query().Get("path")]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_, _ = w.Write(data)
	}))
	rxBot.BotConfig = &rxBot.Config{BaseURL: server.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { server.Close(); rxBot.BotConfig = oldBot; viper.Set("gene_obsfs_path", oldMount) })
	return func(key string, data []byte) { objects[key] = data }
}

func TestGeneManifestProjectionAndBoundReads(t *testing.T) {
	for _, relay := range []bool{false, true} {
		t.Run(fmt.Sprintf("relay=%v", relay), func(t *testing.T) {
			manifest, objects := manifestFixture()
			objects[manifestTestKey] = encodeManifest(t, manifest)
			write := serveManifestFixture(t, objects, relay)
			service := NewService()
			report, err := service.GeneDetails(context.Background(), reportTestFile)
			if err != nil {
				t.Fatal(err)
			}
			if len(report.Resources) != 3 || len(report.ReferenceMaterials) != 3 {
				t.Fatalf("manifest projection absent: resources=%d materials=%d", len(report.Resources), len(report.ReferenceMaterials))
			}
			if report.ReportRevision != manifest["report_sha256"] {
				t.Fatal("report SHA semantics changed")
			}
			for i, resource := range report.Resources {
				entry := manifest["resources"].([]any)[i].(map[string]any)
				if resource.Kind != entry["kind"] || resource.MarkdownHref != entry["markdown_href"] {
					t.Fatalf("resource order/association changed: %+v", resource)
				}
				if resource.Kind != "image" && resource.DisplayURL != "" {
					t.Fatal("protected material exposed a display URL")
				}
				file, err := service.GeneResource(context.Background(), reportTestFile, resource.ID)
				if err != nil || file.Name != resource.Name || file.MediaType != entry["media_type"] || !bytes.Equal(file.Data, objects[entry["object_key"].(string)]) {
					t.Fatalf("registered bytes: %s %v", resource.Kind, err)
				}
			}
			if !reflect.DeepEqual(report.ReferenceMaterials[0].ResourceIDs, report.ReferenceMaterials[1].ResourceIDs) || report.ReferenceMaterials[2].ReferenceIndex != 3 || report.ReferenceMaterials[2].Excerpt != "" {
				t.Fatal("ordered repeated or empty slots were lost")
			}
			public, _ := json.Marshal(report)
			for _, private := range []string{"object_key", "gene-examples/", "source_file", "size_bytes"} {
				if bytes.Contains(public, []byte(private)) {
					t.Fatalf("public DTO leaked %s", private)
				}
			}
			oldID := report.Resources[2].ID
			manifest["reference_materials"].([]any)[0].(map[string]any)["excerpt"] = "Revised approved source"
			write(manifestTestKey, encodeManifest(t, manifest))
			if data, err := service.GeneResource(context.Background(), reportTestFile, oldID); err == nil || data != nil {
				t.Fatal("stale manifest resource ID was accepted")
			}
		})
	}
}

func TestGeneManifestMarkdownReferencesBindPositionsAndRevision(t *testing.T) {
	for _, relay := range []bool{false, true} {
		t.Run(fmt.Sprintf("relay=%v", relay), func(t *testing.T) {
			body := "# Gene\r\n\r\nEvidence [document:1,3].\r\n\r\n"
			source := []byte(body + "## Reference:\r\n\r\n[3] Third source\r\n\r\n[1] First source\r\n")
			manifest, _ := manifestFixture()
			manifest["report_sha256"] = manifestDigest(source)
			manifest["resources"] = []any{}
			materials := []any{
				map[string]any{"reference_index": 1, "excerpt": "First slot excerpt", "resource_ids": []string{}},
				map[string]any{"reference_index": 2, "excerpt": "", "resource_ids": []string{}},
				map[string]any{"reference_index": 3, "excerpt": "Third slot excerpt", "resource_ids": []string{}},
			}
			manifest["reference_materials"] = materials
			reportKey := "gene-examples/md/" + reportTestFile
			write := serveManifestFixture(t, map[string][]byte{
				reportKey: source, manifestTestKey: encodeManifest(t, manifest),
			}, relay)
			service := NewService()
			report, err := service.GeneDetails(context.Background(), reportTestFile)
			if err != nil {
				t.Fatal(err)
			}
			var references []map[string]any
			if err := json.Unmarshal(report.References, &references); err != nil {
				t.Fatal(err)
			}
			if report.Content != body || report.ReportRevision != manifestDigest(source) || len(references) != 3 || len(report.ReferenceMaterials) != 3 {
				t.Fatal("markdown references lost their original body, revision or numbered slots")
			}
			for i, title := range []string{"First source", "", "Third source"} {
				material := report.ReferenceMaterials[i]
				if references[i]["title"] != title || material.ReferenceIndex != i+1 || material.Excerpt != materials[i].(map[string]any)["excerpt"] {
					t.Fatalf("reference and material position %d drifted", i+1)
				}
			}
			manifest["reference_count"], manifest["reference_materials"] = 2, materials[:2]
			write(manifestTestKey, encodeManifest(t, manifest))
			if report, err := service.GeneDetails(context.Background(), reportTestFile); !errors.Is(err, ErrGeneManifestConflict) || report != nil {
				t.Fatalf("counting declared lines instead of numbered positions accepted: %v", err)
			}
			manifest["reference_count"], manifest["reference_materials"] = 3, materials
			write(manifestTestKey, encodeManifest(t, manifest))
			write(reportKey, append(append([]byte{}, source...), '\n'))
			if report, err := service.GeneDetails(context.Background(), reportTestFile); !errors.Is(err, ErrGeneManifestConflict) || report != nil {
				t.Fatalf("stale manifest accepted after original report bytes changed: %v", err)
			}
		})
	}
}

func TestGeneManifestRejectsPresentInvalidData(t *testing.T) {
	tests := map[string]func(map[string]any){
		"unknown field":          func(m map[string]any) { m["source_path"] = "private" },
		"wrong schema":           func(m map[string]any) { m["schema_version"] = 2 },
		"bool schema":            func(m map[string]any) { m["schema_version"] = true },
		"missing count":          func(m map[string]any) { delete(m, "reference_count") },
		"wrong gene":             func(m map[string]any) { m["gene_id"] = "AT1G01010" },
		"wrong report":           func(m map[string]any) { m["report_file"] = "AT1G01010_result.md" },
		"stale report":           func(m map[string]any) { m["report_sha256"] = strings.Repeat("0", 64) },
		"wrong reference count":  func(m map[string]any) { m["reference_count"] = 2 },
		"null resources":         func(m map[string]any) { m["resources"] = nil },
		"unordered source slots": func(m map[string]any) { m["reference_materials"].([]any)[0].(map[string]any)["reference_index"] = 2 },
		"duplicate slot":         func(m map[string]any) { m["reference_materials"].([]any)[1].(map[string]any)["reference_index"] = 1 },
		"unknown resource association": func(m map[string]any) {
			m["reference_materials"].([]any)[0].(map[string]any)["resource_ids"] = []string{"missing"}
		},
		"duplicate resource association": func(m map[string]any) {
			m["reference_materials"].([]any)[0].(map[string]any)["resource_ids"] = []string{"protocol", "protocol"}
		},
		"oversize excerpt": func(m map[string]any) {
			m["reference_materials"].([]any)[0].(map[string]any)["excerpt"] = strings.Repeat("a", (64<<10)+1)
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			manifest, objects := manifestFixture()
			mutate(manifest)
			objects[manifestTestKey] = encodeManifest(t, manifest)
			serveManifestFixture(t, objects, false)
			if report, err := NewService().GeneDetails(context.Background(), reportTestFile); err == nil || report != nil {
				t.Fatal("present invalid manifest was silently ignored")
			}
		})
	}
}

func TestGeneManifestRejectsBadResourceEntries(t *testing.T) {
	for _, field := range []string{"id", "name", "kind", "markdown_href", "object_key", "media_type", "size_bytes", "sha256"} {
		t.Run(field, func(t *testing.T) {
			manifest, objects := manifestFixture()
			entry := manifest["resources"].([]any)[2].(map[string]any)
			entry[field] = "https://PRIVATE-CANARY"
			objects[manifestTestKey] = encodeManifest(t, manifest)
			serveManifestFixture(t, objects, false)
			if report, err := NewService().GeneDetails(context.Background(), reportTestFile); err == nil || report != nil || strings.Contains(err.Error(), "PRIVATE-CANARY") {
				t.Fatalf("bad manifest not rejected/redacted: %v", err)
			}
		})
	}
}

func TestGeneManifestRejectsDuplicateJSONAndDepth(t *testing.T) {
	for _, mutate := range []func([]byte) []byte{
		func(data []byte) []byte {
			return bytes.Replace(data, []byte(`"schema_version":1`), []byte(`"schema_version":1,"schema_version":1`), 1)
		},
		func(data []byte) []byte {
			return bytes.Replace(data, []byte(`"id":"protocol"`), []byte(`"id":"protocol","id":"protocol"`), 1)
		},
		func(data []byte) []byte { return append(data, []byte(`{}`)...) },
		func([]byte) []byte { return []byte(strings.Repeat("[", 20) + "0" + strings.Repeat("]", 20)) },
	} {
		t.Run("strict JSON", func(t *testing.T) {
			manifest, objects := manifestFixture()
			objects[manifestTestKey] = mutate(encodeManifest(t, manifest))
			serveManifestFixture(t, objects, false)
			if report, err := NewService().GeneDetails(context.Background(), reportTestFile); err == nil || report != nil {
				t.Fatal("malformed manifest JSON accepted")
			}
		})
	}
}

func TestGeneManifestRejectsTamperedResourceBytes(t *testing.T) {
	for _, relay := range []bool{false, true} {
		for _, kindIndex := range []int{0, 1, 2} {
			t.Run(fmt.Sprintf("relay=%v/kind=%d", relay, kindIndex), func(t *testing.T) {
				manifest, objects := manifestFixture()
				entry := manifest["resources"].([]any)[kindIndex].(map[string]any)
				objects[manifestTestKey] = encodeManifest(t, manifest)
				write := serveManifestFixture(t, objects, relay)
				report, err := NewService().GeneDetails(context.Background(), reportTestFile)
				if err != nil {
					t.Fatal(err)
				}
				key := entry["object_key"].(string)
				original := objects[key]
				for _, tampered := range [][]byte{append([]byte("X"), original[1:]...), append(append([]byte{}, original...), 'X'), {}} {
					write(key, tampered)
					file, err := NewService().GeneResource(context.Background(), reportTestFile, report.Resources[kindIndex].ID)
					if !errors.Is(err, ErrGeneManifestConflict) || file != nil {
						t.Fatalf("tampered bytes returned: %v", err)
					}
				}
			})
		}
	}
}

func TestGeneManifestRejectsMalformedRegisteredContent(t *testing.T) {
	for name, invalid := range map[string]struct {
		index int
		data  []byte
	}{
		"png":             {0, []byte("not a PNG")},
		"cif header":      {1, []byte("not a CIF")},
		"cif empty block": {1, []byte("# Comment\ndata_\n")},
		"cif HTML":        {1, []byte("\xef\xbb\xbf\n<html>private error</html>")},
		"markdown HTML":   {2, []byte(" \n<!doctype html><html>private error</html>")},
		"markdown UTF8":   {2, []byte{0xff, 0xfe}},
		"markdown NUL":    {2, []byte("# Heading\x00")},
	} {
		t.Run(name, func(t *testing.T) {
			manifest, objects := manifestFixture()
			entry := manifest["resources"].([]any)[invalid.index].(map[string]any)
			entry["size_bytes"], entry["sha256"] = len(invalid.data), manifestDigest(invalid.data)
			objects[entry["object_key"].(string)] = invalid.data
			objects[manifestTestKey] = encodeManifest(t, manifest)
			serveManifestFixture(t, objects, false)
			report, err := NewService().GeneDetails(context.Background(), reportTestFile)
			if err != nil {
				t.Fatal(err)
			}
			file, err := NewService().GeneResource(context.Background(), reportTestFile, report.Resources[invalid.index].ID)
			if !errors.Is(err, ErrGeneMaterialContent) || file != nil {
				t.Fatalf("invalid content accepted: %v", err)
			}
		})
	}
}

func TestGeneManifestPresentUnsafeFileIsNotMissing(t *testing.T) {
	for _, form := range []string{"symlink", "dangling symlink", "directory", "directory alias"} {
		t.Run(form, func(t *testing.T) {
			manifest, objects := manifestFixture()
			serveManifestFixture(t, objects, false)
			mount := viper.GetString("gene_obsfs_path")
			directory := filepath.Join(mount, "manifests")
			target := filepath.Join(t.TempDir(), "private.json")
			if form != "dangling symlink" {
				if err := os.WriteFile(target, encodeManifest(t, manifest), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			if form == "directory alias" {
				if err := os.Symlink(filepath.Dir(target), directory); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := os.Mkdir(directory, 0o700); err != nil {
					t.Fatal(err)
				}
				file := filepath.Join(directory, manifestTestGene+"_result.json")
				if form == "directory" {
					if err := os.Mkdir(file, 0o700); err != nil {
						t.Fatal(err)
					}
				} else if err := os.Symlink(target, file); err != nil {
					t.Fatal(err)
				}
			}
			if report, err := NewService().GeneDetails(context.Background(), reportTestFile); err == nil || report != nil {
				t.Fatal("present unsafe manifest was silently treated as missing")
			}
		})
	}
}

func TestGeneManifestReadLimits(t *testing.T) {
	for _, relay := range []bool{false, true} {
		t.Run(fmt.Sprintf("relay=%v", relay), func(t *testing.T) {
			_, objects := manifestFixture()
			objects[manifestTestKey] = bytes.Repeat([]byte(" "), maxGeneManifestBytes+1)
			serveManifestFixture(t, objects, relay)
			if report, err := NewService().GeneDetails(context.Background(), reportTestFile); !errors.Is(err, ErrGeneResourceTooLarge) || report != nil {
				t.Fatalf("oversize manifest: %v", err)
			}
		})
	}
	for _, size := range []int64{-1, maxGeneReportTextBytes + 1} {
		data, err := readGeneResourceBytes(context.Background(), strings.NewReader(strings.Repeat("a", maxGeneReportTextBytes+1)), size, maxGeneReportTextBytes)
		if !errors.Is(err, ErrGeneResourceTooLarge) || data != nil {
			t.Fatalf("oversize unknown/known material: %v", err)
		}
	}
}

func TestGeneManifestCancellationAndSameLane(t *testing.T) {
	manifest, objects := manifestFixture()
	objects[manifestTestKey] = encodeManifest(t, manifest)
	var reads atomic.Int64
	started, stopped := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		reads.Add(1)
		if request.URL.Query().Get("path") == manifestTestKey {
			close(started)
			<-request.Context().Done()
			close(stopped)
			return
		}
		_, _ = w.Write(objects[request.URL.Query().Get("path")])
	}))
	oldMount, oldBot := viper.Get("gene_obsfs_path"), rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{BaseURL: server.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	viper.Set("gene_obsfs_path", "")
	t.Cleanup(func() { server.Close(); rxBot.BotConfig = oldBot; viper.Set("gene_obsfs_path", oldMount) })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() { _, err := NewService().GeneDetails(ctx, reportTestFile); result <- err }()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("manifest read not started")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancel error: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("request did not cancel")
	}
	select {
	case <-stopped:
	case <-time.After(3 * time.Second):
		t.Fatal("relay reader still held")
	}
	if _, err := NewService().GeneDetails(ctx, reportTestFile); !errors.Is(err, context.Canceled) {
		t.Fatal("pre-cancel ignored")
	}
	before := reads.Load()
	delete(objects, manifestTestKey)
	serveManifestFixture(t, objects, false)
	report, err := NewService().GeneDetails(context.Background(), reportTestFile)
	if err != nil || len(report.ReferenceMaterials) != 0 || reads.Load() != before {
		t.Fatalf("missing mount manifest crossed lane: %v", err)
	}
}

func TestGeneManifestSchemaBoundaries(t *testing.T) {
	for name, mutate := range map[string]func(map[string]any){
		"null excerpt":         func(m map[string]any) { m["reference_materials"].([]any)[0].(map[string]any)["excerpt"] = nil },
		"missing nested field": func(m map[string]any) { delete(m["resources"].([]any)[0].(map[string]any), "size_bytes") },
		"case-folded nested field": func(m map[string]any) {
			r := m["resources"].([]any)[0].(map[string]any)
			r["ID"] = r["id"]
			delete(r, "id")
		},
		"unknown nested field": func(m map[string]any) { m["resources"].([]any)[0].(map[string]any)["extra"] = true },
		"duplicate id":         func(m map[string]any) { m["resources"].([]any)[1].(map[string]any)["id"] = "tree" },
		"duplicate href": func(m map[string]any) {
			m["resources"].([]any)[1].(map[string]any)["markdown_href"] = m["resources"].([]any)[0].(map[string]any)["markdown_href"]
		},
		"resource limit": func(m map[string]any) { m["resources"] = make([]map[string]any, 1000) },
		"empty resource": func(m map[string]any) { m["resources"].([]any)[2].(map[string]any)["size_bytes"] = 0 },
		"oversized resource": func(m map[string]any) {
			m["resources"].([]any)[2].(map[string]any)["size_bytes"] = maxGeneReportTextBytes + 1
		},
		"wrong revision locator": func(m map[string]any) {
			r := m["resources"].([]any)[1].(map[string]any)
			r["object_key"] = strings.Replace(r["object_key"].(string), m["report_sha256"].(string), strings.Repeat("0", 64), 1)
		},
		"wrong gene locator": func(m map[string]any) {
			r := m["resources"].([]any)[1].(map[string]any)
			r["object_key"] = strings.Replace(r["object_key"].(string), manifestTestGene, "AT1G01010", 1)
		},
		"wrong-case digest": func(m map[string]any) {
			r := m["resources"].([]any)[1].(map[string]any)
			r["sha256"] = strings.ToUpper(r["sha256"].(string))
		},
	} {
		t.Run(name, func(t *testing.T) {
			manifest, objects := manifestFixture()
			report, err := buildGeneReport(parseGeneFile(reportTestFile), objects[geneRelayRoot+"md/"+reportTestFile])
			if err != nil {
				t.Fatal(err)
			}
			mutate(manifest)
			if parsed, err := parseGeneManifest(encodeManifest(t, manifest), report); err == nil || parsed != nil {
				t.Fatal("invalid strict manifest accepted")
			}
		})
	}
	for _, href := range []string{" ./protocol.md", "./protocol.md ", "https://example.org/x", "//example.org/x", "/etc/private", "./a%20b.md", "./x.md?query=1", "./x.md#section", `..\x.md`, "./x\n.md", "./<x>.md", "./x\".md", strings.Repeat("a", 2049)} {
		if validGeneMaterialHref(href) {
			t.Errorf("unsafe association accepted %q", href)
		}
	}
	for _, href := range []string{"../../protocol.md", "./实验方案.md", "/api/v1/genes/approved.md"} {
		if !validGeneMaterialHref(href) {
			t.Errorf("authored association rejected %q", href)
		}
	}
}

func TestGeneManifestEmptyAndRepeatedSlotsAtLimits(t *testing.T) {
	for _, count := range []int{0, 999} {
		manifest, _ := manifestFixture()
		raw := "# Report\n"
		if count > 0 {
			raw += fmt.Sprintf("\n--- DOC TITLES ---\n%d. Repeated source\n", count)
		}
		report, err := buildGeneReport(parseGeneFile(reportTestFile), []byte(raw))
		if err != nil {
			t.Fatal(err)
		}
		manifest["report_sha256"], manifest["reference_count"] = report.ReportRevision, count
		manifest["resources"] = []any{}
		materials := make([]any, count)
		for i := range materials {
			materials[i] = map[string]any{"reference_index": i + 1, "excerpt": "", "resource_ids": []string{}}
		}
		manifest["reference_materials"] = materials
		if _, err := parseGeneManifest(encodeManifest(t, manifest), report); err != nil {
			t.Fatalf("legal %d slots rejected: %v", count, err)
		}
		if count == 999 {
			for i := 0; i < 65; i++ {
				materials[i].(map[string]any)["excerpt"] = strings.Repeat("a", 64<<10)
			}
			if _, err := parseGeneManifest(encodeManifest(t, manifest), report); !errors.Is(err, ErrGeneManifestConflict) {
				t.Fatalf("total excerpt bound not enforced: %v", err)
			}
		}
	}
}

func TestGeneManifestMaterialAliasAndMissing(t *testing.T) {
	for _, mode := range []string{"missing", "file alias", "directory alias"} {
		t.Run(mode, func(t *testing.T) {
			manifest, objects := manifestFixture()
			objects[manifestTestKey] = encodeManifest(t, manifest)
			entry := manifest["resources"].([]any)[2].(map[string]any)
			key := entry["object_key"].(string)
			contents := objects[key]
			delete(objects, key)
			serveManifestFixture(t, objects, false)
			mount := viper.GetString("gene_obsfs_path")
			file := filepath.Join(mount, strings.TrimPrefix(key, geneRelayRoot))
			if mode == "file alias" {
				target := filepath.Join(filepath.Dir(file), "unregistered.md")
				if err := os.WriteFile(target, contents, 0o600); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(target, file); err != nil {
					t.Fatal(err)
				}
			} else if mode == "directory alias" {
				directory := filepath.Dir(file)
				target := directory + "-alias"
				if err := os.Rename(directory, target); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(target, "protocol.md"), contents, 0o600); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(target, directory); err != nil {
					t.Fatal(err)
				}
			}
			report, err := NewService().GeneDetails(context.Background(), reportTestFile)
			if err != nil {
				t.Fatal(err)
			}
			if result, err := NewService().GeneResource(context.Background(), reportTestFile, report.Resources[2].ID); !errors.Is(err, ErrGeneResourceNotFound) || result != nil {
				t.Fatalf("unsafe/missing resource served: %v", err)
			}
		})
	}
}

func TestGeneManifestResourceStreamCancellation(t *testing.T) {
	manifest, objects := manifestFixture()
	objects[manifestTestKey] = encodeManifest(t, manifest)
	entry := manifest["resources"].([]any)[2].(map[string]any)
	key := entry["object_key"].(string)
	started, stopped := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("path") == key {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("# "))
			w.(http.Flusher).Flush()
			close(started)
			<-r.Context().Done()
			close(stopped)
			return
		}
		_, _ = w.Write(objects[r.URL.Query().Get("path")])
	}))
	oldMount, oldBot := viper.Get("gene_obsfs_path"), rxBot.BotConfig
	viper.Set("gene_obsfs_path", "")
	rxBot.BotConfig = &rxBot.Config{BaseURL: server.URL, ProxyEnabled: true, TimeoutSeconds: 5}
	t.Cleanup(func() { server.Close(); viper.Set("gene_obsfs_path", oldMount); rxBot.BotConfig = oldBot })
	report, err := NewService().GeneDetails(context.Background(), reportTestFile)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() {
		file, err := NewService().GeneResource(ctx, reportTestFile, report.Resources[2].ID)
		if file != nil {
			result <- errors.New("partial material exposed")
			return
		}
		result <- err
	}()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("resource stream not started")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("stream cancel=%v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("resource did not cancel")
	}
	select {
	case <-stopped:
	case <-time.After(3 * time.Second):
		t.Fatal("resource relay reader not released")
	}
}

func TestGeneManifestPreservesUnicodeWithoutSurrogateReplacement(t *testing.T) {
	for _, escaped := range []string{`\ud800`, `\udfff`, `\ud800\u0041`, `\ud800\ud800`} {
		t.Run(escaped, func(t *testing.T) {
			manifest, objects := manifestFixture()
			report, err := buildGeneReport(parseGeneFile(reportTestFile), objects[geneRelayRoot+"md/"+reportTestFile])
			if err != nil {
				t.Fatal(err)
			}
			raw := bytes.Replace(encodeManifest(t, manifest), []byte(`"First original slot"`), []byte(`"`+escaped+`"`), 1)
			if parsed, err := parseGeneManifest(raw, report); !errors.Is(err, ErrGeneManifestConflict) || parsed != nil {
				t.Fatalf("unpaired surrogate silently rewritten: %v", err)
			}
		})
	}
	for escaped, want := range map[string]string{`\ud83c\udf31`: "🌱", `\\ud800`: `\ud800`, `\ufffd`: "�", `正常摘录`: "正常摘录"} {
		manifest, objects := manifestFixture()
		report, err := buildGeneReport(parseGeneFile(reportTestFile), objects[geneRelayRoot+"md/"+reportTestFile])
		if err != nil {
			t.Fatal(err)
		}
		raw := bytes.Replace(encodeManifest(t, manifest), []byte(`"First original slot"`), []byte(`"`+escaped+`"`), 1)
		parsed, err := parseGeneManifest(raw, report)
		if err != nil || parsed.ReferenceMaterials[0].Excerpt != want {
			t.Fatalf("legal unicode changed: %q %v", escaped, err)
		}
	}
}

func TestGeneManifestMergedPublicResourceBudget(t *testing.T) {
	for _, declared := range []int{998, 999} {
		t.Run(fmt.Sprintf("declared=%d", declared), func(t *testing.T) {
			manifest, objects := manifestFixture()
			resources := make([]any, declared)
			for i := range resources {
				id := fmt.Sprintf("protocol-%d", i)
				resources[i] = map[string]any{"id": id, "name": id + ".md", "kind": "markdown", "markdown_href": "./" + id + ".md", "object_key": geneRelayRoot + "materials/" + manifestTestGene + "/" + manifest["report_sha256"].(string) + "/" + id + ".md", "media_type": "text/markdown", "size_bytes": 1, "sha256": manifestDigest([]byte("x"))}
			}
			manifest["resources"] = resources
			for _, slot := range manifest["reference_materials"].([]any) {
				slot.(map[string]any)["resource_ids"] = []string{}
			}
			objects[manifestTestKey] = encodeManifest(t, manifest)
			serveManifestFixture(t, objects, false)
			report, err := NewService().GeneDetails(context.Background(), reportTestFile)
			if declared == 998 {
				if err != nil || len(report.Resources) != 999 {
					t.Fatalf("legal combined budget rejected: %v", err)
				}
			} else if !errors.Is(err, ErrGeneManifestConflict) || report != nil {
				t.Fatalf("oversized combined DTO accepted: %v", err)
			}
		})
	}
	t.Run("missing manifest report only budget", func(t *testing.T) {
		_, objects := manifestFixture()
		var report strings.Builder
		report.WriteString("# Gene\n\n")
		for i := 0; i < 1000; i++ {
			fmt.Fprintf(&report, "![image](/api/v1/gene-images/%s/%s_%d.png)\n", manifestTestGene, manifestTestGene, i)
		}
		objects[geneRelayRoot+"md/"+reportTestFile] = []byte(report.String())
		serveManifestFixture(t, objects, false)
		if report, err := NewService().GeneDetails(context.Background(), reportTestFile); !errors.Is(err, ErrGeneManifestConflict) || report != nil {
			t.Fatalf("report-only oversized DTO accepted: %v", err)
		}
	})
}
