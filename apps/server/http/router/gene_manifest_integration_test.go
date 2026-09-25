package router

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/viper"
	"phytomni-server/common"
	"phytomni-server/middleware"
)

func TestGeneManifestProtectedHTTPTypes(t *testing.T) {
	engine, gdb := buildRealApiEnv(t)
	if err := gdb.Exec(`INSERT INTO users (email, first_login_status) VALUES ('material-reader@example.test', '1')`).Error; err != nil {
		t.Fatal(err)
	}
	token, err := middleware.GenerateToken("material-reader@example.test")
	if err != nil {
		t.Fatal(err)
	}
	mount := t.TempDir()
	write := func(key string, data []byte) {
		file := filepath.Join(mount, key)
		if err := os.MkdirAll(filepath.Dir(file), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	body := []byte("# Curated report\n\n[Protocol](./protocol.md)\n[Model](./model.cif)\n\n--- DOC TITLES ---\n1. Approved reference\n")
	revision := fmt.Sprintf("%x", sha256.Sum256(body))
	write("md/"+geneResourceFixtureName, body)
	resources := []map[string]any{}
	contents := [][]byte{[]byte("# Protocol\r\n\r\nExact original bytes.\r\n"), []byte("# Model\ndata_test\n_cell.length_a 10\n")}
	for i, kind := range []string{"markdown", "cif"} {
		id, name, mediaType := "protocol", "protocol.md", "text/markdown"
		if i == 1 {
			id, name, mediaType = "model", "model.cif", "chemical/x-cif"
		}
		key := "materials/Os01g0107900/" + revision + "/" + name
		write(key, contents[i])
		resources = append(resources, map[string]any{"id": id, "name": name, "kind": kind, "markdown_href": "./" + name, "object_key": "gene-examples/" + key, "media_type": mediaType, "size_bytes": len(contents[i]), "sha256": fmt.Sprintf("%x", sha256.Sum256(contents[i]))})
	}
	manifest := map[string]any{"schema_version": 1, "gene_id": "Os01g0107900", "report_file": geneResourceFixtureName, "report_sha256": revision, "reference_count": 1, "resources": resources, "reference_materials": []any{map[string]any{"reference_index": 1, "excerpt": "Approved excerpt", "resource_ids": []string{"protocol"}}}}
	manifestKey := "manifests/Os01g0107900_result.json"
	manifestBytes, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	write(manifestKey, manifestBytes)
	oldMount := viper.Get("gene_obsfs_path")
	viper.Set("gene_obsfs_path", mount)
	t.Cleanup(func() { viper.Set("gene_obsfs_path", oldMount) })
	reportRoute := "/api/v1/genes/" + geneResourceFixtureName
	report := geneResourceRouteRequest(engine, reportRoute, token)
	if report.Code != http.StatusOK {
		t.Fatalf("report failed %d: %s", report.Code, report.Body.String())
	}
	var envelope struct {
		Data common.GeneDetailResponse `json:"data"`
	}
	if err := json.Unmarshal(report.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if len(envelope.Data.Resources) != 2 || len(envelope.Data.ReferenceMaterials) != 1 {
		t.Fatal("missing manifest projection")
	}
	for i, resource := range envelope.Data.Resources {
		route := reportRoute + "/resources/" + resource.ID
		response := geneResourceRouteRequest(engine, route, token)
		if response.Code != http.StatusOK || !bytes.Equal(response.Body.Bytes(), contents[i]) || response.Header().Get("Content-Type") != resources[i]["media_type"] {
			t.Fatalf("incorrect %s delivery: status=%d mime=%s", resource.Kind, response.Code, response.Header().Get("Content-Type"))
		}
		if response.Header().Get("X-Content-Type-Options") != "nosniff" || !strings.Contains(response.Header().Get("Content-Security-Policy"), "sandbox") {
			t.Fatal("missing resource hardening")
		}
		if unauth := geneResourceRouteRequest(engine, route, ""); unauth.Code != http.StatusUnauthorized {
			t.Fatalf("unauthenticated material returned %d", unauth.Code)
		}
	}
	route := reportRoute + "/resources/" + envelope.Data.Resources[0].ID
	for _, input := range []struct {
		name    string
		content []byte
		want    int
	}{
		{"malformed manifest", []byte(`{"PRIVATE-CANARY":true}`), http.StatusConflict},
		{"oversized manifest", bytes.Repeat([]byte(" "), (6<<20)+1), http.StatusRequestEntityTooLarge},
		{"invalid UTF8 manifest", []byte{0xff, 0xfe}, http.StatusUnprocessableEntity},
	} {
		t.Run(input.name, func(t *testing.T) {
			write(manifestKey, input.content)
			for _, endpoint := range []string{reportRoute, route} {
				response := geneResourceRouteRequest(engine, endpoint, token)
				if response.Code != input.want || strings.Contains(response.Body.String(), "PRIVATE-CANARY") || strings.Contains(response.Body.String(), mount) {
					t.Fatalf("unsafe error: status=%d body=%s", response.Code, response.Body.String())
				}
			}
		})
	}
	write(manifestKey, manifestBytes)
	write("md/"+geneResourceFixtureName, append(body, []byte("2. New source\n")...))
	if stale := geneResourceRouteRequest(engine, route, token); stale.Code != http.StatusConflict {
		t.Fatalf("stale report binding status=%d", stale.Code)
	}
}
