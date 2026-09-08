package api_service

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/spf13/viper"
	"phytomni-server/common/citation"
	rxBot "phytomni-server/external/bot"
)

const reportTestFile = "Os01g0107900_result.md"

func geneReportPayload(t *testing.T, raw string, relay bool) (map[string]json.RawMessage, error) {
	t.Helper()
	if relay {
		oldMount, oldBot := viper.Get("gene_obsfs_path"), rxBot.BotConfig
		viper.Set("gene_obsfs_path", "")
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/v1/relay/obs/object" && r.URL.Query().Get("path") == "gene-examples/manifests/Os01g0107900_result.json" {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			if r.URL.Path != "/v1/relay/obs/object" || r.URL.Query().Get("path") != "gene-examples/md/"+reportTestFile {
				t.Errorf("unexpected relay request: %s", r.URL.Path)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
			_, _ = w.Write([]byte(raw))
		}))
		rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
		t.Cleanup(func() { srv.Close(); rxBot.BotConfig = oldBot; viper.Set("gene_obsfs_path", oldMount) })
	} else {
		mount := writeGeneObsfs(t, nil)
		writeGeneMd(t, mount, reportTestFile, raw)
	}
	item, err := NewService().GeneDetails(context.Background(), reportTestFile)
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(item)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &payload); err != nil {
		t.Fatal(err)
	}
	return payload, nil
}

func assertGeneReport(t *testing.T, payload map[string]json.RawMessage, source, body string, titles []string) {
	t.Helper()
	var actualBody string
	if err := json.Unmarshal(payload["content"], &actualBody); err != nil || actualBody != body {
		t.Fatalf("body not preserved: got %q, want %q (err %v)", actualBody, body, err)
	}
	var refs []struct {
		Title    string                `json:"title"`
		Citation citation.Presentation `json:"citation"`
	}
	if err := json.Unmarshal(payload["references"], &refs); err != nil || refs == nil {
		t.Fatalf("canonical references must be an array: %s (%v)", payload["references"], err)
	}
	if len(refs) != len(titles) {
		t.Fatalf("source positions shifted: got %d rows, want %d", len(refs), len(titles))
	}
	for i, title := range titles {
		want := citation.Format(citation.Source{Title: title})
		if refs[i].Title != title || !reflect.DeepEqual(refs[i].Citation, want) {
			t.Errorf("row %d = %+v, expected canonical presentation for %q", i+1, refs[i], title)
		}
	}
	for _, key := range []string{"resources", "reference_materials"} {
		if string(payload[key]) != "[]" {
			t.Errorf("unverified %s must be an empty array, got %s", key, payload[key])
		}
	}
	var revision string
	if err := json.Unmarshal(payload["report_revision"], &revision); err != nil || revision != fmt.Sprintf("%x", sha256.Sum256([]byte(source))) {
		t.Errorf("revision must bind to exact original bytes: %q (%v)", revision, err)
	}
	for key, want := range map[string]string{"file_name": reportTestFile, "species_code": "Osa", "gene_id": "Os01g0107900"} {
		var got string
		if err := json.Unmarshal(payload[key], &got); err != nil || got != want {
			t.Errorf("identity %s = %q, want %q", key, got, want)
		}
	}
}

func TestGeneReportCanonicalProjection(t *testing.T) {
	body := "# Gene\r\n\r\nEvidence [document:1,3] and x<sup>2</sup>.\r\n\r\n"
	raw := body + "--- DOC TITLES ---\r\n1. Repeated source\r\n3. Repeated source\r\n4. \r\n5. *OsABC* and H<sub>2</sub>O\r\n"
	for _, relay := range []bool{false, true} {
		t.Run(fmt.Sprintf("relay=%v", relay), func(t *testing.T) {
			payload, err := geneReportPayload(t, raw, relay)
			if err != nil {
				t.Fatal(err)
			}
			assertGeneReport(t, payload, raw, body, []string{"Repeated source", "", "Repeated source", "", "*OsABC* and H<sub>2</sub>O"})
		})
	}
}

func TestGeneReportMarkdownReferences(t *testing.T) {
	for _, newline := range []string{"\n", "\r\n"} {
		body := "# Gene" + newline + newline + "Evidence [document:1,256] and H<sub>2</sub>O." + newline + newline
		var source strings.Builder
		source.WriteString(body + "## Reference:" + newline + newline)
		titles := make([]string, 256)
		for i := range titles {
			titles[i] = fmt.Sprintf("Source position %d", i+1)
		}
		titles[35], titles[39] = "Repeated source", "Repeated source"
		titles[255] = "*OsABC* and H<sub>2</sub>O"
		for i, title := range titles {
			fmt.Fprintf(&source, "[%d] %s%s%s", i+1, title, newline, newline)
		}
		for _, relay := range []bool{false, true} {
			t.Run(fmt.Sprintf("newline=%q/relay=%v", newline, relay), func(t *testing.T) {
				payload, err := geneReportPayload(t, source.String(), relay)
				if err != nil {
					t.Fatal(err)
				}
				assertGeneReport(t, payload, source.String(), body, titles)
			})
		}
	}
}

func TestGeneReportMarkdownReferenceSlots(t *testing.T) {
	for _, heading := range []string{"## Reference:", "## References", "## References:", "## Reference", "## Reference: ##"} {
		body := "Report [document:1,3].\n"
		raw := body + heading + "\n\n[3] Third\n\n[1] First\n[4]\n"
		payload, err := geneReportPayload(t, raw, false)
		if err != nil {
			t.Fatal(err)
		}
		assertGeneReport(t, payload, raw, body, []string{"First", "", "Third", ""})
	}
	for _, trailer := range []string{"", "\n\n", "\n[999] Last source\n"} {
		raw := "# Gene\n\n## Reference:" + trailer
		payload, err := geneReportPayload(t, raw, false)
		if err != nil {
			t.Fatal(err)
		}
		var titles []string
		if strings.Contains(trailer, "[999]") {
			titles = make([]string, 999)
			titles[998] = "Last source"
		}
		assertGeneReport(t, payload, raw, "# Gene\n\n", titles)
	}
}

func TestGeneReportMarkdownReferenceOwnership(t *testing.T) {
	for name, body := range map[string]string{
		"fence":          "```markdown\n## Reference:\n[1] Code\n```\n",
		"tilde fence":    "~~~\n## Reference:\n[1] Code\n~~~\n",
		"unclosed fence": "```\n## Reference:\n[1] Code\n",
		"indented code":  "    ## Reference:\n    [1] Code\n",
		"quote":          "> ## Reference:\n> [1] Quoted\n",
		"list":           "- Example\n\n  ## Reference:\n  [1] Nested\n",
		"HTML block":     "<div>\n## Reference:\n[1] HTML\n</div>\n",
		"code heading":   "## `Reference:`\n\n[1] Code label\n",
		"link heading":   "## [Reference:](https://example.org)\n\n[1] Link label\n",
		"bold heading":   "## **Reference:**\n\n[1] Styled label\n",
		"other section":  "## Reference materials\n\n[1] Ordinary content\n",
		"nested section": "### Reference:\n\n[1] Ordinary content\n",
		"setext heading": "Reference:\n---\n\n[1] Ordinary content\n",
	} {
		t.Run(name, func(t *testing.T) {
			payload, err := geneReportPayload(t, body, false)
			if err != nil {
				t.Fatal(err)
			}
			assertGeneReport(t, payload, body, body, nil)
		})
	}
	body := "```\n## Reference:\n[1] Literal\n```\n\n"
	raw := body + "## Reference:\n\n[1] Actual source\n"
	payload, err := geneReportPayload(t, raw, false)
	if err != nil {
		t.Fatal(err)
	}
	assertGeneReport(t, payload, raw, body, []string{"Actual source"})
	body = "Reference:\n---\n\n[1] Ordinary content\n\n"
	raw = body + "--- DOC TITLES ---\n1. Actual source\n"
	payload, err = geneReportPayload(t, raw, false)
	if err != nil {
		t.Fatal(err)
	}
	assertGeneReport(t, payload, raw, body, []string{"Actual source"})
}

func TestGeneReportMarkdownReferencesRejectInvalidSlots(t *testing.T) {
	for name, trailer := range map[string]string{
		"zero": "[0] Invalid", "negative": "[-1] Invalid", "outside bound": "[1000] Invalid",
		"overflow": "[" + strings.Repeat("9", 1000) + "] Invalid", "duplicate": "[1] A\n[1] B",
		"duplicate empty": "[1]\n[1] B", "ambiguous duplicate": "[01] A\n[1] B",
		"unnumbered": "[1] A\nUnrelated content must not disappear", "ordinary list": "1. Not a bracketed source",
		"second heading": "[1] A\n## Reference:\n[2] B", "mixed boundary": "[1] A\n--- DOC TITLES ---\n2. B",
		"following section": "[1] A\n## Other section\nBody must not disappear",
		"inline link":       "[1](https://example.org)", "link definition": "[1]: https://example.org",
		"missing separator": "[1]Not a numbered source",
	} {
		t.Run(name, func(t *testing.T) {
			_, err := geneReportPayload(t, "# Gene\n\n## Reference:\n\n"+trailer, false)
			if !errors.Is(err, errGeneReportReferences) || len(err.Error()) > 100 || strings.Contains(err.Error(), "Invalid") {
				t.Fatalf("expected a bounded, source-redacted reference error: %v", err)
			}
		})
	}
}

func TestGeneReportTrailerOwnership(t *testing.T) {
	for name, body := range map[string]string{
		"no trailer":                "# Gene\n\nEvidence [document:1].\n",
		"inline marker":             "Text --- DOC TITLES --- remains prose.\n",
		"backtick fence":            "```markdown\n--- DOC TITLES ---\n1. Literal code\n```\n",
		"tilde fence":               "~~~~\n--- DOC TITLES ---\n1. Literal code\n~~~~\n",
		"unclosed fence":            "```\n--- DOC TITLES ---\n1. Literal code\n",
		"indented code":             "    --- DOC TITLES ---\n    1. Literal code\n",
		"quote":                     "> --- DOC TITLES ---\n> 1. Quoted source\n",
		"list":                      "- Example\n\n  --- DOC TITLES ---\n  1. Nested example\n",
		"html block":                "<div>\n--- DOC TITLES ---\n1. Literal HTML\n</div>\n",
		"multiline inline code":     "Before `literal\n--- DOC TITLES ---\nNot a source`\n",
		"multiline double backtick": "Before ``literal\n--- DOC TITLES ---\nNot a source``\n",
		"multiline link label":      "Before [literal\n--- DOC TITLES ---\nNot a source](https://example.org)\n",
	} {
		t.Run(name, func(t *testing.T) {
			payload, err := geneReportPayload(t, body, false)
			if err != nil {
				t.Fatal(err)
			}
			assertGeneReport(t, payload, body, body, nil)
		})
	}
	t.Run("real trailer after fenced marker", func(t *testing.T) {
		body := "```\n--- DOC TITLES ---\n1. Literal code\n```\n\n"
		raw := body + "--- DOC TITLES ---\n1. Real source\n"
		payload, err := geneReportPayload(t, raw, false)
		if err != nil {
			t.Fatal(err)
		}
		assertGeneReport(t, payload, raw, body, []string{"Real source"})
	})
	t.Run("real trailer without preceding blank line", func(t *testing.T) {
		body := "Main report [document:1].\n"
		raw := body + "--- DOC TITLES ---\n1. Real source\n"
		payload, err := geneReportPayload(t, raw, false)
		if err != nil {
			t.Fatal(err)
		}
		assertGeneReport(t, payload, raw, body, []string{"Real source"})
	})
}

func TestGeneReportRejectsInvalidDeclaredSlots(t *testing.T) {
	for name, trailer := range map[string]string{
		"zero": "0. Invalid", "negative": "-1. Invalid", "outside bound": "1000. Invalid",
		"overflow": strings.Repeat("9", 1000) + ". Invalid", "duplicate": "1. A\n1. B",
		"duplicate empty": "1.\n1. B", "ambiguous duplicate": "01. A\n1. B",
		"unnumbered malformed": "1. A\nUnrelated content must not disappear",
		"repeated boundary":    "1. A\n--- DOC TITLES ---\n2. B",
	} {
		t.Run(name, func(t *testing.T) {
			_, err := geneReportPayload(t, "# Gene\n\n--- DOC TITLES ---\n"+trailer, false)
			if err == nil {
				t.Fatal("invalid trailer accepted")
			}
			if len(err.Error()) > 100 || strings.Contains(err.Error(), "Invalid") {
				t.Fatalf("error must be bounded and source-redacted: %q", err)
			}
		})
	}
}

func TestGeneReportHighestSlot(t *testing.T) {
	raw := "# Gene\n\n--- DOC TITLES ---\n999. Last source\n"
	payload, err := geneReportPayload(t, raw, false)
	if err != nil {
		t.Fatal(err)
	}
	titles := make([]string, 999)
	titles[998] = "Last source"
	assertGeneReport(t, payload, raw, "# Gene\n\n", titles)
}

func TestGeneReportEmptyAndOutOfOrderTrailers(t *testing.T) {
	for _, tc := range []struct {
		name, trailer string
		titles        []string
	}{
		{name: "empty", trailer: "\r\n\r\n"},
		{name: "out of order", trailer: "3. Third\n1. First\n2.\n", titles: []string{"First", "", "Third"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw := "# Gene\n\n--- DOC TITLES ---\n" + tc.trailer
			payload, err := geneReportPayload(t, raw, false)
			if err != nil {
				t.Fatal(err)
			}
			assertGeneReport(t, payload, raw, "# Gene\n\n", tc.titles)
		})
	}
}

func TestGeneReportBoundedTextLanes(t *testing.T) {
	for _, relay := range []bool{false, true} {
		for name, raw := range map[string]string{
			"oversize":     strings.Repeat("a", (8<<20)+1),
			"invalid UTF8": string([]byte{'#', ' ', 0xff}),
		} {
			t.Run(fmt.Sprintf("%s/relay=%v", name, relay), func(t *testing.T) {
				_, err := geneReportPayload(t, raw, relay)
				if err == nil {
					t.Fatal("invalid report text accepted")
				}
				if len(err.Error()) > 100 {
					t.Fatalf("unbounded error: %q", err)
				}
			})
		}
	}
}

type geneReportReadFunc func([]byte) (int, error)

func (read geneReportReadFunc) Read(p []byte) (int, error) { return read(p) }

func TestGeneReportReaderBoundsAndCancellation(t *testing.T) {
	t.Run("known oversize is rejected before reading", func(t *testing.T) {
		reader := geneReportReadFunc(func([]byte) (int, error) {
			t.Fatal("oversize source was read")
			return 0, io.EOF
		})
		if _, err := readGeneReportText(context.Background(), reader, maxGeneReportTextBytes+1); !errors.Is(err, errGeneReportTooLarge) {
			t.Fatalf("expected size rejection: %v", err)
		}
	})
	t.Run("unknown size reads at most the limit plus one", func(t *testing.T) {
		readBytes := 0
		reader := geneReportReadFunc(func(p []byte) (int, error) {
			for i := range p {
				p[i] = 'a'
			}
			readBytes += len(p)
			return len(p), nil
		})
		if _, err := readGeneReportText(context.Background(), reader, -1); !errors.Is(err, errGeneReportTooLarge) || readBytes != maxGeneReportTextBytes+1 {
			t.Fatalf("unbounded unknown-size read: bytes=%d err=%v", readBytes, err)
		}
	})
	t.Run("exact byte limit is valid", func(t *testing.T) {
		source := strings.Repeat("a", maxGeneReportTextBytes)
		content, err := readGeneReportText(context.Background(), strings.NewReader(source), int64(len(source)))
		if err != nil || string(content) != source {
			t.Fatalf("exact-limit read failed: %v", err)
		}
	})
	t.Run("reader errors never publish partial text or paths", func(t *testing.T) {
		reader := geneReportReadFunc(func(p []byte) (int, error) {
			return copy(p, "partial"), errors.New("read /private/source/file.md: internal failure")
		})
		content, err := readGeneReportText(context.Background(), reader, -1)
		if content != nil || !errors.Is(err, errGeneReportUnavailable) || strings.Contains(err.Error(), "private") {
			t.Fatalf("partial or private error escaped: bytes=%d err=%v", len(content), err)
		}
	})
	t.Run("canceled before read", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		reader := geneReportReadFunc(func([]byte) (int, error) { t.Fatal("canceled source read"); return 0, io.EOF })
		if _, err := readGeneReportText(ctx, reader, -1); !errors.Is(err, context.Canceled) {
			t.Fatalf("cancellation lost: %v", err)
		}
	})
	t.Run("canceled during read", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		reader := geneReportReadFunc(func(p []byte) (int, error) { cancel(); return copy(p, "obsolete"), io.EOF })
		content, err := readGeneReportText(ctx, reader, -1)
		if content != nil || !errors.Is(err, context.Canceled) {
			t.Fatalf("canceled bytes published: %v", err)
		}
	})
}

func TestGeneReportReadErrorsAreRedacted(t *testing.T) {
	t.Run("missing local report", func(t *testing.T) {
		mount := writeGeneObsfs(t, nil)
		_, err := NewService().GeneDetails(context.Background(), reportTestFile)
		if err == nil || strings.Contains(err.Error(), mount) || strings.Contains(err.Error(), reportTestFile) {
			t.Fatalf("mounted error leaked source path: %v", err)
		}
	})
	t.Run("upstream error", func(t *testing.T) {
		oldMount, oldBot := viper.Get("gene_obsfs_path"), rxBot.BotConfig
		viper.Set("gene_obsfs_path", "")
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "/private/bucket/source.md failed", http.StatusBadGateway)
		}))
		rxBot.BotConfig = &rxBot.Config{BaseURL: srv.URL, ProxyEnabled: true, TimeoutSeconds: 5}
		t.Cleanup(func() { srv.Close(); rxBot.BotConfig = oldBot; viper.Set("gene_obsfs_path", oldMount) })
		_, err := NewService().GeneDetails(context.Background(), reportTestFile)
		if !errors.Is(err, errGeneReportUnavailable) || strings.Contains(err.Error(), "private") || strings.Contains(err.Error(), srv.URL) {
			t.Fatalf("relay error leaked source or origin: %v", err)
		}
	})
}
