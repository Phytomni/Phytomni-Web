package citation

import "testing"

func TestAuthors(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{name: "none", raw: "", want: ""},
		{name: "one", raw: "Doe, JA", want: "Doe, J. A."},
		{name: "two including family prefix", raw: "Doe, JA; van Test, B", want: "Doe, J. A. & van Test, B."},
		{name: "five", raw: "One, A; Two, B; Three, C; Four, D; Five, E", want: "One, A., Two, B., Three, C., Four, D. & Five, E."},
		{name: "six", raw: "One, A; Two, B; Three, C; Four, D; Five, E; Six, F", want: "One, A. et al."},
		{name: "accented surname and initials", raw: "García, ÁB", want: "García, Á. B."},
		{name: "punctuated hyphenated initials", raw: "Doe, J.-P.", want: "Doe, J.-P."},
		{name: "organization remains opaque", raw: "International Rice Research Institute", want: "International Rice Research Institute"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := formatAuthors(tt.raw); got != tt.want {
				t.Fatalf("formatAuthors(%q) = %q, want %q", tt.raw, got, tt.want)
			}
		})
	}
}
