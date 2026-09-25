package middleware

import (
	"fmt"
	"net/url"
	"strings"
	"testing"
	"unicode/utf8"
)

const wantA2uiAuditBody = `{"surface_id":"sfc-1","widget":"form","action_id":"act-1","run_id":"run-1","payload":"[REDACTED]"}`

func TestA2uiRedactMasksCompletePayload(t *testing.T) {
	body := []byte(`{"surface_id":"sfc-1","widget":"form","action_id":"act-1","run_id":"run-1","payload":{"email":"researcher@example.com","biological_input":"BRCA1 c.68_69del","nested":{"token":"secret-token"},"items":[{"secret":"secret-value"}],"ordinary":"retain only inside payload"},"unknown":"drop-me"}`)

	if got := redactA2uiActionBody(body); got != wantA2uiAuditBody {
		t.Fatalf("A2UI audit body = %q, want %q", got, wantA2uiAuditBody)
	}
}

func TestA2uiRedactMasksAllWidgetPayloads(t *testing.T) {
	for _, widget := range []string{"confirm", "form", "choice"} {
		t.Run(widget, func(t *testing.T) {
			body := []byte(fmt.Sprintf(`{"surface_id":"sfc-1","widget":%q,"action_id":"act-1","run_id":"run-1","payload":{"selected":["gene-a","gene-b"]}}`, widget))
			got := redactA2uiActionBody(body)
			if !strings.Contains(got, `"payload":"[REDACTED]"`) {
				t.Fatalf("%s payload not masked: %s", widget, got)
			}
			if strings.Contains(got, "gene-a") || strings.Contains(got, "gene-b") {
				t.Fatalf("%s payload leaked: %s", widget, got)
			}
		})
	}
}

func TestA2uiRedactRejectsMalformedEnvelope(t *testing.T) {
	for _, body := range [][]byte{
		[]byte(`{"surface_id":"sfc-1","widget":"form","action_id":"act-1","run_id":"run-1","payload":`),
		[]byte(`{"surface_id":"sfc-1","widget":"form","action_id":"act-1","run_id":"run-1"}`),
	} {
		if got := redactA2uiActionBody(body); got != "[redacted: invalid a2ui action]" {
			t.Fatalf("malformed A2UI body = %q, want fixed placeholder", got)
		}
	}
}

func TestA2uiRedactRejectsInvalidIdentifiers(t *testing.T) {
	for _, body := range [][]byte{
		[]byte(`{"surface_id":7,"widget":"form","action_id":"act-1","run_id":"run-1","payload":{}}`),
		[]byte(fmt.Sprintf(`{"surface_id":"sfc-1","widget":"form","action_id":%q,"run_id":"run-1","payload":{}}`, strings.Repeat("\u754C", 257))),
	} {
		if got := redactA2uiActionBody(body); got != "[redacted: invalid a2ui action]" {
			t.Fatalf("invalid A2UI identifier = %q, want fixed placeholder", got)
		}
	}
}

func TestGenericJSONRedactionKeepsRecursiveCredentialMasking(t *testing.T) {
	body := []byte(`{"surface_id":"sfc-1","widget":"form","action_id":"act-1","run_id":"run-1","payload":{"nested_token":"secret-token"},"email":"researcher@example.com"}`)
	out := redactBodyByContentType("application/json", body)
	if !strings.Contains(out, `"surface_id":"sfc-1"`) {
		t.Fatalf("generic JSON redaction removed ordinary A2UI field: %s", out)
	}
	if strings.Contains(out, "secret-token") || !strings.Contains(out, `"nested_token":"`+redactedMask+`"`) {
		t.Fatalf("generic JSON credential masking changed: %s", out)
	}
	if !strings.Contains(out, `"email":"researcher@example.com"`) {
		t.Fatalf("generic JSON redaction changed ordinary email: %s", out)
	}
}

func TestUploadCreateAuditMarkerDropsMetadata(t *testing.T) {
	body := []byte(`{"filename":"patient-cohort.fastq.gz","size_bytes":42,"content_type_hint":"application/octet-stream"}`)
	out := redactOperationLogBody("POST", "/api/v1/files", "/api/v1/files", "application/json", body)
	if out != uploadCreateAuditMarker {
		t.Fatalf("upload audit body = %q, want fixed marker", out)
	}
	if strings.Contains(out, "patient-cohort.fastq.gz") || strings.Contains(out, "application/octet-stream") {
		t.Fatalf("upload metadata leaked into audit body: %q", out)
	}
}

// TestLongResearchMultipartRedactionDropsBody catches any change that buffers
// or serializes multipart query text into user_operation_logs.
func TestLongResearchMultipartRedactionDropsBody(t *testing.T) {
	const (
		maxCodePoints = 131_072
		paperMarker   = "Synthetic paper abstract: rice root development evidence."
		pathMarker    = "scrubbed-bucket/synthetic-study/late/reads.fastq.gz"
	)
	prefix := paperMarker + "\n"
	suffix := "\n" + pathMarker
	fillerCount := maxCodePoints - utf8.RuneCountInString(prefix) - utf8.RuneCountInString(suffix)
	query := prefix + strings.Repeat("\u7A3B", fillerCount) + suffix
	if got := utf8.RuneCountInString(query); got != maxCodePoints {
		t.Fatalf("synthetic query code points = %d, want %d", got, maxCodePoints)
	}

	got := redactOperationLogBody(
		"POST",
		"/api/v1/conversations/0/messages",
		"/api/v1/conversations/:id/messages",
		"multipart/form-data; boundary=synthetic-boundary",
		[]byte(query),
	)
	if got != "[Multipart Content - Body Ignored]" {
		t.Fatalf("multipart audit body used an unexpected finite marker")
	}
	if strings.Contains(got, paperMarker) || strings.Contains(got, pathMarker) {
		t.Fatal("multipart audit body retained a synthetic Research marker")
	}
}

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
// user_operation_logs. The query-string path follows the same no-raw-fallback
// rule as the body path.
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

// TestRedactQueryParamsMalformed pins the query-redaction invariant: malformed
// percent-encoding must not fall back to raw query text that can contain a
// credential.
func TestRedactQueryParamsMalformed(t *testing.T) {
	out := redactQueryParams("email=a@b.com&new_password=100%pass")
	if strings.Contains(out, "100%pass") {
		t.Fatalf("malformed query leaked plaintext credential verbatim: %s", out)
	}
	if out != "[redacted: unparseable query]" {
		t.Fatalf("malformed query should collapse to the redaction placeholder, got %q", out)
	}
}
