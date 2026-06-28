package middleware

import (
	"net/url"
	"strings"
	"testing"
)

// TestRedactJSONBodyNested verifies recursive redaction: sensitive keys inside nested objects are masked too.
func TestRedactJSONBodyNested(t *testing.T) {
	out := redactJSONBody([]byte(`{"user":{"password":"x"}}`))
	if strings.Contains(out, `"x"`) || strings.Contains(out, ":\"x\"") {
		t.Fatalf("nested password leaked verbatim: %s", out)
	}
	if !strings.Contains(out, redactedMask) {
		t.Fatalf("nested password not masked: %s", out)
	}
}

// TestRedactBodyURLEncoded verifies that sensitive params in a urlencoded body are masked and plaintext never lands in the DB.
func TestRedactBodyURLEncoded(t *testing.T) {
	out := redactBodyByContentType(
		"application/x-www-form-urlencoded",
		[]byte("email=a@b.com&password=secret"),
	)
	if strings.Contains(out, "secret") {
		t.Fatalf("urlencoded password leaked verbatim: %s", out)
	}
	vals, err := url.ParseQuery(out)
	if err != nil {
		t.Fatalf("masked body not parseable: %v (%s)", err, out)
	}
	if vals.Get("password") != redactedMask {
		t.Fatalf("password not masked, got %q", vals.Get("password"))
	}
	if vals.Get("email") != "a@b.com" {
		t.Fatalf("non-sensitive email mangled, got %q", vals.Get("email"))
	}
}

// TestRedactBodyURLEncodedMalformed pins the body-redaction invariant: a urlencoded
// body with invalid percent-encoding (e.g. a bare '%' in the password) makes
// url.ParseQuery fail; in that case we must NOT fall back to the raw body, or the
// plaintext credentials of /login, /modify/password would land directly in
// user_operation_logs. This is exactly the fork point where the query-string path
// (redactQueryParams) intentionally keeps the raw text while the body path must mask it.
func TestRedactBodyURLEncodedMalformed(t *testing.T) {
	// "%pa" in "100%pass" is not valid hex → ParseQuery fails.
	out := redactBodyByContentType(
		"application/x-www-form-urlencoded",
		[]byte("email=a@b.com&new_password=100%pass"),
	)
	if strings.Contains(out, "100%pass") {
		t.Fatalf("malformed body leaked plaintext credential verbatim: %s", out)
	}
	if out != "[redacted: unparseable body]" {
		t.Fatalf("malformed body should collapse to the redaction placeholder, got %q", out)
	}
}
