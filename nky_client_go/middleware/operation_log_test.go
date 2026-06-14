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

// TestRedactBodyURLEncodedMalformed 锁死 body 脱敏不变量:一个含无效百分号编码的
// urlencoded body(例如密码里有裸 '%')会让 url.ParseQuery 报错;此时绝不能回落原文,
// 否则 /login、/modify/password 的明文凭据会直接落进 s_user_operation_logs。
// 这正是 query-string 路径(redactQueryParams)有意保留原文、而 body 路径必须打码的分叉点。
func TestRedactBodyURLEncodedMalformed(t *testing.T) {
	// "100%pass" 里的 "%pa" 不是合法十六进制 → ParseQuery 失败。
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
