package api_service

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"mime/multipart"
	"strings"
	"testing"

	rxBot "phytomni-server/external/bot"
)

func TestValidateCurrentQueryCountsUnicodeCodePoints(t *testing.T) {
	if err := ValidateCurrentQuery(strings.Repeat("\u7A3B", 131_072), 131_072); err != nil {
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
		if got := conversationTitle(strings.Repeat("\u7A3B", 161)); got != strings.Repeat("\u7A3B", 160) {
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

func TestQueryControlBodyLimitAcceptsDefaultMaximumControlFields(t *testing.T) {
	const fourByteRune = "\U0001F9EC"
	history := make([]rxBot.ChatMessage, 20)
	for index := range history {
		history[index] = rxBot.ChatMessage{
			Role:    "user",
			Content: strings.Repeat(fourByteRune, 32*1024),
		}
	}
	historyJSON, err := json.Marshal(history)
	if err != nil {
		t.Fatalf("marshal maximum history: %v", err)
	}

	attachments := make([]rxBot.AssetAttachmentRef, rxBot.DefaultMaxAssetAttachmentRefs)
	for index := range attachments {
		attachments[index].AssetID = fmt.Sprintf(
			"file_%02d_%s",
			index,
			strings.Repeat("a", 120),
		)
	}
	attachmentsJSON, err := json.Marshal(attachments)
	if err != nil {
		t.Fatalf("marshal maximum attachment references: %v", err)
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for name, value := range map[string]string{
		"query":       strings.Repeat(fourByteRune, rxBot.DefaultMaxUserQueryChars),
		"history":     string(historyJSON),
		"attachments": string(attachmentsJSON),
	} {
		if err := writer.WriteField(name, value); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close maximum control body: %v", err)
	}

	limit := QueryControlBodyLimit(rxBot.DefaultMaxUserQueryChars)
	if int64(body.Len()) > limit {
		t.Fatalf("maximum legal control body uses %d bytes, limit is %d", body.Len(), limit)
	}
}
