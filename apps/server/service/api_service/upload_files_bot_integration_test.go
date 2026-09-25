package api_service

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	rxBot "phytomni-server/external/bot"
)

const (
	botUploadIntegrationEnabledEnv      = "PHYTOMNI_RUN_BOT_UPLOAD_INTEGRATION"
	botUploadIntegrationBaseURLEnv      = "PHYTOMNI_TEST_BOT_BASE_URL"
	botUploadIntegrationPublicOriginEnv = "PHYTOMNI_TEST_BOT_UPLOAD_PUBLIC_ORIGIN"
	botUploadIntegrationAPIKeyEnv       = "PHYTOMNI_TEST_BOT_USER_API_KEY"
)

// TestBotUploadReclamationContract exercises the Web upload control client
// against a running Bot. The supplied test key must allow both /v1/agents
// discovery and files:delegate; this test intentionally sends no file bytes.
func TestBotUploadReclamationContract(t *testing.T) {
	if os.Getenv(botUploadIntegrationEnabledEnv) != "1" {
		t.Skip("Bot upload integration is disabled")
	}

	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv(botUploadIntegrationBaseURLEnv)), "/")
	publicOrigin := strings.TrimRight(strings.TrimSpace(os.Getenv(botUploadIntegrationPublicOriginEnv)), "/")
	userAPIKey := strings.TrimSpace(os.Getenv(botUploadIntegrationAPIKeyEnv))
	if baseURL == "" || publicOrigin == "" || userAPIKey == "" {
		t.Fatal("Bot upload integration requires configured base URL, public origin, and test API key")
	}

	previousConfig := rxBot.BotConfig
	rxBot.BotConfig = &rxBot.Config{
		BaseURL:            baseURL,
		UserAPIKey:         userAPIKey,
		TimeoutSeconds:     15,
		ProxyEnabled:       true,
		UploadPublicOrigin: publicOrigin,
	}
	t.Cleanup(func() { rxBot.BotConfig = previousConfig })

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	result, err := NewService().CreateUpload(ctx, "web-paired-upload-smoke-owner", UploadCreateInput{
		Filename:    "paired-smoke.fastq.gz",
		SizeBytes:   1,
		ContentType: "application/octet-stream",
	}, uuid.NewString())
	if err != nil {
		t.Fatal("Bot upload create failed; verify the test key allows agents discovery and files:delegate")
	}
	if result == nil || result.Protocol != rxBot.ResumableUploadProtocol || result.AssetID == "" ||
		result.Status != "uploading" || result.PartSizeBytes < 1 || result.PartCount != 1 ||
		result.MaxParallelParts < 1 || result.UploadURL == "" || result.Capability == "" ||
		result.CapabilityExpiresAt == "" || result.SessionExpiresAt == "" {
		t.Fatal("Bot upload create returned an invalid session")
	}

	abortPending := true
	t.Cleanup(func() {
		if !abortPending {
			return
		}
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cleanupCancel()
		if _, _, cleanupErr := rxBot.NewClient().AbortUpload(cleanupCtx, result.AssetID, result.Capability); cleanupErr != nil {
			t.Error("best-effort Bot upload abort failed")
		}
	})

	aborted, _, err := rxBot.NewClient().AbortUpload(ctx, result.AssetID, result.Capability)
	if err != nil {
		t.Fatal("Bot upload abort failed")
	}
	if aborted == nil || aborted.Protocol != rxBot.ResumableUploadProtocol ||
		aborted.AssetID != result.AssetID || aborted.Status != "aborted" {
		t.Fatal("Bot upload abort returned an invalid result")
	}
	abortPending = false
}
