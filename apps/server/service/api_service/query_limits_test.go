package api_service

import (
	"errors"
	"strings"
	"testing"
)

func TestValidateCurrentQueryCountsUnicodeCodePoints(t *testing.T) {
	if err := ValidateCurrentQuery(strings.Repeat("稻", 131_072), 131_072); err != nil {
		t.Fatal(err)
	}
	if !errors.Is(ValidateCurrentQuery(strings.Repeat("🧬", 131_073), 131_072), ErrQueryLimitExceeded) {
		t.Fatal("131073 code points must fail")
	}
}

func TestQueryControlBodyLimitCoversUtf8AndAuxiliaryFields(t *testing.T) {
	if got := QueryControlBodyLimit(131_072); got < 2<<20 {
		t.Fatalf("limit=%d", got)
	}
	if got := QueryControlBodyLimit(1_048_576); got < int64(1_048_576*4+(1<<20)) {
		t.Fatalf("limit=%d", got)
	}
}
