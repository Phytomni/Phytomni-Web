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

func TestConversationTitleUsesFirstMeaningfulBoundedLine(t *testing.T) {
	t.Run("normalizes first meaningful line", func(t *testing.T) {
		raw := "\n\t  Rice root atlas   reproduction \n" + strings.Repeat("x", 500)
		if got := conversationTitle(raw); got != "Rice root atlas reproduction" {
			t.Fatalf("conversationTitle() = %q", got)
		}
	})

	t.Run("bounds Unicode code points", func(t *testing.T) {
		if got := conversationTitle(strings.Repeat("稻", 161)); got != strings.Repeat("稻", 160) {
			t.Fatalf("conversationTitle() has %d code points, want 160", len([]rune(got)))
		}
	})
}

func TestQueryControlBodyLimitCoversUtf8AndAuxiliaryFields(t *testing.T) {
	if got := QueryControlBodyLimit(131_072); got < 2<<20 {
		t.Fatalf("limit=%d", got)
	}
	if got := QueryControlBodyLimit(1_048_576); got < int64(1_048_576*4+(1<<20)) {
		t.Fatalf("limit=%d", got)
	}
}
