package api_handler

import "testing"

// SVG / *+xml must NEVER be inline-able — they can carry scripts, so same-origin inline serving is stored XSS.
func TestInlineSafeExcludesSVGAndXML(t *testing.T) {
	for _, ct := range []string{"image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"} {
		if !inlineSafeImageTypes[ct] {
			t.Errorf("%s should be inline-safe (raster)", ct)
		}
	}
	for _, ct := range []string{"image/svg+xml", "image/svg", "application/xml", "text/html", "application/octet-stream", ""} {
		if inlineSafeImageTypes[ct] {
			t.Errorf("%s must NOT be inline-safe (script-bearing / unsafe)", ct)
		}
	}
}

func TestSanitizeFilename(t *testing.T) {
	cases := map[string]string{
		"a.zip":         "a.zip",
		"a\"b.zip":      "ab.zip",
		"a\r\nb.zip":    "ab.zip",
		"x\"; evil=\"y": "x; evil=y",
	}
	for in, want := range cases {
		if got := sanitizeFilename(in); got != want {
			t.Errorf("sanitizeFilename(%q) = %q, want %q", in, got, want)
		}
	}
}
