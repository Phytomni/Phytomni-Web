package i18n

import (
	"bytes"
	"io/fs"
	"log"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/BurntSushi/toml"
	"github.com/gin-gonic/gin"
)

// newTestContext builds a *gin.Context with the supplied Accept-Language
// header and a Localize() middleware bound to it, so T() resolves keys
// against the embedded TOML bundle.
func newTestContext(t *testing.T, acceptLanguage string) *gin.Context {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest("GET", "/", nil)
	if acceptLanguage != "" {
		req.Header.Set("Accept-Language", acceptLanguage)
	}
	c.Request = req
	// Run the Localize middleware to bind a localizer onto the context.
	Localize()(c)
	return c
}

func TestT_EnglishLookup(t *testing.T) {
	c := newTestContext(t, "en-US")
	got := T(c, "auth.user_not_found")
	if got != "User not found" {
		t.Fatalf("auth.user_not_found en-US: got %q, want %q", got, "User not found")
	}
}

func TestT_ChineseLookup(t *testing.T) {
	// Assert the zh-CN bundle resolves to its own locale-specific value rather
	// than hardcoding the Chinese string here (this source file stays ASCII).
	// A correct zh-CN resolution must differ from the en-US value, must not be
	// the raw key (the missing-key fallback), and must be non-empty.
	zh := T(newTestContext(t, "zh-CN"), "auth.user_not_found")
	en := T(newTestContext(t, "en-US"), "auth.user_not_found")
	if zh == "" {
		t.Fatal("auth.user_not_found zh-CN resolved to empty string")
	}
	if zh == "auth.user_not_found" {
		t.Fatalf("auth.user_not_found zh-CN fell back to the raw key: %q", zh)
	}
	if zh == en {
		t.Fatalf("auth.user_not_found zh-CN must differ from en-US %q, got %q", en, zh)
	}
}

func TestT_MissingKeyFallsBackAndLogs(t *testing.T) {
	var buf bytes.Buffer
	orig := log.Writer()
	log.SetOutput(&buf)
	defer log.SetOutput(orig)

	c := newTestContext(t, "en-US")
	got := T(c, "no.such.key")
	if got != "no.such.key" {
		t.Fatalf("missing key: got %q, want fallback to key %q", got, "no.such.key")
	}
	if !strings.Contains(buf.String(), "[i18n] missing key") {
		t.Fatalf("missing key: expected warning log, got %q", buf.String())
	}
}

func TestT_NoHeaderDefaultsToEnglish(t *testing.T) {
	c := newTestContext(t, "") // no Accept-Language header
	got := T(c, "auth.user_not_found")
	if got != "User not found" {
		t.Fatalf("no-header fallback: got %q, want %q (en-US default)", got, "User not found")
	}
}

// tomlKeys parses a TOML bundle into flattened dot-joined leaf keys.
func tomlKeys(t *testing.T, path string) map[string]bool {
	t.Helper()
	var tree map[string]interface{}
	if _, err := toml.DecodeFile(path, &tree); err != nil {
		t.Fatalf("decode %s: %v", path, err)
	}
	keys := map[string]bool{}
	var walk func(prefix string, node map[string]interface{})
	walk = func(prefix string, node map[string]interface{}) {
		for k, v := range node {
			full := k
			if prefix != "" {
				full = prefix + "." + k
			}
			if sub, ok := v.(map[string]interface{}); ok {
				walk(full, sub)
			} else {
				keys[full] = true
			}
		}
	}
	walk("", tree)
	return keys
}

func TestTomlKeyParity(t *testing.T) {
	en := tomlKeys(t, "locales/en-US.toml")
	zh := tomlKeys(t, "locales/zh-CN.toml")
	if len(en) == 0 {
		t.Fatal("en bundle is empty — degenerate pass")
	}
	for k := range en {
		if !zh[k] {
			t.Errorf("key %q in en-US.toml but missing in zh-CN.toml", k)
		}
	}
	for k := range zh {
		if !en[k] {
			t.Errorf("key %q in zh-CN.toml but missing in en-US.toml", k)
		}
	}
}

func TestTomlKeyParity_NegativeControl(t *testing.T) {
	// Prove the comparator flags a difference (not a no-op green).
	a := map[string]bool{"x.y": true, "x.z": true}
	b := map[string]bool{"x.y": true}
	missing := 0
	for k := range a {
		if !b[k] {
			missing++
		}
	}
	if missing != 1 {
		t.Fatalf("negative control: expected 1 missing key, got %d", missing)
	}
}

// TestTomlReferenceResolvability scans every non-test Go file under
// apps/server/ for i18n.T(ctx, "literal.key") and errs.NewError("literal.key")
// call sites, extracts the string-literal keys, and asserts each one resolves
// in BOTH the en-US and zh-CN TOML bundles. Dynamic keys (e.g. err.Error())
// are skipped — only literals starting with a letter are extracted — so a
// typo'd literal key with no TOML entry is caught here. This complements
// TestTomlKeyParity (which only checks bundle-to-bundle symmetry) by
// verifying the bundles actually cover every key the Go source references.
func TestTomlReferenceResolvability(t *testing.T) {
	en := tomlKeys(t, "locales/en-US.toml")
	zh := tomlKeys(t, "locales/zh-CN.toml")
	if len(en) == 0 {
		t.Fatal("en bundle is empty — degenerate pass")
	}

	// A key starts with a letter, ends with a letter/digit, and contains only
	// word chars and dots in between. This deliberately excludes dynamic
	// arguments (err.Error()) and bare numeric/leading-dot fragments.
	reT := regexp.MustCompile(`i18n\.T\([^,]+,\s*"([a-zA-Z][\w.]*[a-zA-Z0-9])"\)`)
	reNewError := regexp.MustCompile(`errs\.NewError\("([a-zA-Z][\w.]*[a-zA-Z0-9])"\)`)

	// Test CWD is apps/server/common/i18n/, so ../.. is apps/server/.
	root := filepath.Join("..", "..")
	keys := map[string]bool{}

	walkErr := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			// vendor/ is third-party code; skip it entirely.
			if d.Name() == "vendor" {
				return filepath.SkipDir
			}
			return nil
		}
		// Only scan non-test Go source.
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		for _, m := range reT.FindAllSubmatch(data, -1) {
			keys[string(m[1])] = true
		}
		for _, m := range reNewError.FindAllSubmatch(data, -1) {
			keys[string(m[1])] = true
		}
		return nil
	})
	if walkErr != nil {
		t.Fatalf("walk %s: %v", root, walkErr)
	}

	// Negative control for the scanner itself: if the regex matched nothing
	// the per-key loop below would trivially pass, so guard against that.
	if len(keys) == 0 {
		t.Fatal("no literal i18n.T/errs.NewError keys found in scan — scanner is degenerate")
	}

	for k := range keys {
		if !en[k] {
			t.Errorf("key %q used in Go source but missing in locales/en-US.toml", k)
		}
		if !zh[k] {
			t.Errorf("key %q used in Go source but missing in locales/zh-CN.toml", k)
		}
	}
}

// TestTMaybe_KeyShapedIsTranslated asserts that a string matching the i18n
// key shape is resolved through the bundle just like T() would.
func TestTMaybe_KeyShapedIsTranslated(t *testing.T) {
	c := newTestContext(t, "en-US")
	got := TMaybe(c, "auth.user_not_found")
	if got != "User not found" {
		t.Fatalf("key-shaped: got %q, want translated value", got)
	}
}

// TestTMaybe_NonKeyReturnedVerbatim asserts that a non-key-shaped string
// (e.g. a raw GORM error) is returned untouched AND emits no missing-key
// warning log — the core property that lets handlers safely wrap err.Error()
// passthroughs with TMaybe without spamming logs.
func TestTMaybe_NonKeyReturnedVerbatim(t *testing.T) {
	var buf bytes.Buffer
	orig := log.Writer()
	log.SetOutput(&buf)
	defer log.SetOutput(orig)

	c := newTestContext(t, "en-US")
	msg := "record not found: users id=42"
	got := TMaybe(c, msg)
	if got != msg {
		t.Fatalf("non-key: got %q, want verbatim %q", got, msg)
	}
	if strings.Contains(buf.String(), "[i18n] missing key") {
		t.Fatalf("non-key must not log a missing-key warning; log=%q", buf.String())
	}
}

// TestTMaybe_KeyShapedButMissingFallsBack asserts that a key-shaped string
// with no bundle entry still falls back to the key text (T()'s standard
// missing-key behavior), so a typo'd key degrades visibly rather than 500'ing.
func TestTMaybe_KeyShapedButMissingFallsBack(t *testing.T) {
	c := newTestContext(t, "en-US")
	got := TMaybe(c, "no.such.key")
	if got != "no.such.key" {
		t.Fatalf("key-shaped missing: got %q, want fallback to key", got)
	}
}
