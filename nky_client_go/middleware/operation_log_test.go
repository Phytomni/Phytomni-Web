package middleware

import (
	"net/url"
	"strings"
	"testing"
)

// TestRedactJSONBodyNested 验证递归遮蔽:嵌套对象内的敏感 key 同样打码。
func TestRedactJSONBodyNested(t *testing.T) {
	out := redactJSONBody([]byte(`{"user":{"password":"x"}}`))
	if strings.Contains(out, `"x"`) || strings.Contains(out, ":\"x\"") {
		t.Fatalf("nested password leaked verbatim: %s", out)
	}
	if !strings.Contains(out, redactedMask) {
		t.Fatalf("nested password not masked: %s", out)
	}
}

// TestRedactBodyURLEncoded 验证 urlencoded body 的敏感参数被打码、明文不落库。
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
