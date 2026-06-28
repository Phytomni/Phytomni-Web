package i18n

import (
	"bytes"
	"log"
	"net/http/httptest"
	"strings"
	"testing"

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
	log.SetOutput(&buf)
	defer log.SetOutput(nil)

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
