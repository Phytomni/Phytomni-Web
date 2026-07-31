package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	rxBot "phytomni-server/external/bot"
)

type uploadCreateCapture struct {
	OwnerSubject   string `json:"owner_subject"`
	Filename       string `json:"filename"`
	SizeBytes      int64  `json:"size_bytes"`
	ContentType    string `json:"content_type_hint"`
	LastModified   int64  `json:"last_modified_ms"`
	Purpose        string `json:"purpose"`
	IdempotencyKey string `json:"idempotency_key"`
}

func uploadAgentManifestJSON(t *testing.T, withProtocol bool) string {
	t.Helper()
	response := rxBot.AgentsListResponse{
		Object: "list",
		Data:   capabilityDescriptors(),
	}
	if withProtocol {
		response.Protocols = map[string][]int{
			rxBot.ResumableUploadProtocol: {rxBot.ResumableUploadProtocolVersion},
		}
	}
	body, err := json.Marshal(response)
	if err != nil {
		t.Fatalf("marshal upload agent manifest: %v", err)
	}
	return string(body)
}

func uploadResponseBody(t *testing.T, baseURL string, size int64, assetID string) string {
	t.Helper()
	const partSize int64 = 128 << 20
	partCount := (size + partSize - 1) / partSize
	if assetID == "" {
		assetID = "file_test"
	}
	future := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	later := time.Now().Add(2 * time.Hour).UTC().Format(time.RFC3339)
	body, err := json.Marshal(rxBot.UploadCreateResponse{
		Protocol:            rxBot.ResumableUploadProtocol,
		AssetID:             assetID,
		Status:              "uploading",
		PartSizeBytes:       partSize,
		PartCount:           int(partCount),
		MaxParallelParts:    4,
		UploadURL:           baseURL + "/v1/files/" + assetID,
		Capability:          "opaque-capability",
		CapabilityExpiresAt: future,
		SessionExpiresAt:    later,
	})
	if err != nil {
		t.Fatalf("marshal upload response: %v", err)
	}
	return string(body)
}

func useUploadBotConfig(t *testing.T, cfg rxBot.Config, baseURL string) {
	t.Helper()
	previous := rxBot.BotConfig
	cfg.BaseURL = baseURL
	if cfg.TimeoutSeconds <= 0 {
		cfg.TimeoutSeconds = 1
	}
	rxBot.BotConfig = &cfg
	t.Cleanup(func() { rxBot.BotConfig = previous })
}

func uploadControlServer(t *testing.T, withProtocol bool, responseBaseURL string, capture *[]uploadCreateCapture, status int) *httptest.Server {
	t.Helper()
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/agents":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(uploadAgentManifestJSON(t, withProtocol)))
		case r.Method == http.MethodPost && r.URL.Path == "/v1/files":
			var request uploadCreateCapture
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				http.Error(w, "invalid json", http.StatusBadRequest)
				return
			}
			if capture != nil {
				*capture = append(*capture, request)
			}
			if status != http.StatusOK {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(status)
				_, _ = w.Write([]byte(`{"error":{"code":"rejected","message":"private upstream detail"}}`))
				return
			}
			w.Header().Set("Content-Type", "application/json")
			responseOrigin := responseBaseURL
			if responseOrigin == "" {
				responseOrigin = server.URL
			}
			_, _ = w.Write([]byte(uploadResponseBody(t, responseOrigin, request.SizeBytes, "file_test")))
		case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/v1/files/") && strings.HasSuffix(r.URL.Path, "/capability"):
			assetID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v1/files/"), "/capability")
			var request rxBot.UploadCapabilityRenewRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				http.Error(w, "invalid json", http.StatusBadRequest)
				return
			}
			future := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
			later := time.Now().Add(2 * time.Hour).UTC().Format(time.RFC3339)
			responseOrigin := responseBaseURL
			if responseOrigin == "" {
				responseOrigin = server.URL
			}
			response := rxBot.UploadCapabilityResponse{
				Protocol:            rxBot.ResumableUploadProtocol,
				AssetID:             assetID,
				Status:              "uploading",
				UploadURL:           responseOrigin + "/v1/files/" + assetID,
				Capability:          "renewed-capability",
				CapabilityExpiresAt: future,
				SessionExpiresAt:    later,
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(response)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func TestCreateUploadDerivesOwnerPurposeAndNormalizesFilename(t *testing.T) {
	var captured []uploadCreateCapture
	server := uploadControlServer(t, true, "", &captured, http.StatusOK)
	useUploadBotConfig(t, rxBot.Config{
		ProxyEnabled:           true,
		ResumableUploadEnabled: true,
		UploadPublicOrigin:     server.URL,
	}, server.URL)

	result, err := NewService().CreateUpload(context.Background(), "alice@example.com", UploadCreateInput{
		Filename:     "e\u0301.fastq.gz",
		SizeBytes:    1,
		ContentType:  "application/octet-stream",
		LastModified: 123,
	}, "550e8400-e29b-41d4-a716-446655440000")
	if err != nil {
		t.Fatalf("CreateUpload error: %v", err)
	}
	if result.AssetID != "file_test" || result.Capability == "" {
		t.Fatalf("unexpected upload result: %#v", result)
	}
	if len(captured) != 1 {
		t.Fatalf("Bot create calls = %d, want 1", len(captured))
	}
	request := captured[0]
	if request.OwnerSubject != "alice@example.com" || request.Purpose != "chat_attachment" {
		t.Fatalf("server-derived authority was not forwarded: %#v", request)
	}
	if request.Filename != "é.fastq.gz" {
		t.Fatalf("filename = %q, want NFC-normalized form", request.Filename)
	}
	if request.IdempotencyKey != "550e8400-e29b-41d4-a716-446655440000" {
		t.Fatalf("idempotency key = %q", request.IdempotencyKey)
	}
}

func TestCreateUploadSizeBoundaries(t *testing.T) {
	for _, size := range []int64{1, resumableUploadMaxFileBytes} {
		t.Run(fmt.Sprintf("%d", size), func(t *testing.T) {
			var captured []uploadCreateCapture
			var server *httptest.Server
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodGet && r.URL.Path == "/v1/agents" {
					w.Header().Set("Content-Type", "application/json")
					_, _ = w.Write([]byte(uploadAgentManifestJSON(t, true)))
					return
				}
				if r.Method == http.MethodPost && r.URL.Path == "/v1/files" {
					var request uploadCreateCapture
					if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
						t.Fatalf("decode request: %v", err)
					}
					captured = append(captured, request)
					w.Header().Set("Content-Type", "application/json")
					_, _ = w.Write([]byte(uploadResponseBody(t, server.URL, request.SizeBytes, "file_test")))
					return
				}
				http.NotFound(w, r)
			}))
			t.Cleanup(server.Close)
			useUploadBotConfig(t, rxBot.Config{ProxyEnabled: true, ResumableUploadEnabled: true, UploadPublicOrigin: server.URL}, server.URL)
			_, err := NewService().CreateUpload(context.Background(), "alice@example.com", UploadCreateInput{Filename: "sample.bin", SizeBytes: size}, "550e8400-e29b-41d4-a716-446655440000")
			if err != nil {
				t.Fatalf("CreateUpload(%d) error: %v", size, err)
			}
			if len(captured) != 1 || captured[0].SizeBytes != size {
				t.Fatalf("captured size = %#v, want %d", captured, size)
			}
		})
	}

	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++ }))
	t.Cleanup(server.Close)
	useUploadBotConfig(t, rxBot.Config{ProxyEnabled: true, ResumableUploadEnabled: true, UploadPublicOrigin: server.URL}, server.URL)
	_, err := NewService().CreateUpload(context.Background(), "alice@example.com", UploadCreateInput{Filename: "sample.bin", SizeBytes: resumableUploadMaxFileBytes + 1}, "550e8400-e29b-41d4-a716-446655440000")
	if !errors.Is(err, ErrUploadMetadataInvalid) {
		t.Fatalf("oversized file error = %v, want metadata error", err)
	}
	if calls != 0 {
		t.Fatalf("oversized file reached Bot %d times", calls)
	}
}

func TestCreateUploadRejectsUnsafeFilenamesAndAcceptsCompoundExtension(t *testing.T) {
	for _, filename := range []string{".", "..", "../sample.fastq", `..\\sample.fastq`, "bad\x00.fastq", strings.Repeat("a", maxUploadFilenameBytes+1)} {
		_, err := NewService().CreateUpload(context.Background(), "alice@example.com", UploadCreateInput{Filename: filename, SizeBytes: 1}, "550e8400-e29b-41d4-a716-446655440000")
		if !errors.Is(err, ErrUploadMetadataInvalid) {
			t.Errorf("filename %q error = %v, want metadata error", filename, err)
		}
	}
}

func TestCreateUploadRequiresNegotiatedProtocolAndEnabledGate(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/agents" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(uploadAgentManifestJSON(t, false)))
			return
		}
		w.WriteHeader(http.StatusTeapot)
	}))
	t.Cleanup(server.Close)
	useUploadBotConfig(t, rxBot.Config{ProxyEnabled: true, ResumableUploadEnabled: true, UploadPublicOrigin: server.URL}, server.URL)
	_, err := NewService().CreateUpload(context.Background(), "alice@example.com", UploadCreateInput{Filename: "sample.bin", SizeBytes: 1}, "550e8400-e29b-41d4-a716-446655440000")
	if !errors.Is(err, ErrUploadControlDisabled) {
		t.Fatalf("missing protocol error = %v, want disabled", err)
	}

	rxBot.BotConfig.ResumableUploadEnabled = false
	_, err = NewService().CreateUpload(context.Background(), "alice@example.com", UploadCreateInput{Filename: "sample.bin", SizeBytes: 1}, "550e8400-e29b-41d4-a716-446655440000")
	if !errors.Is(err, ErrUploadControlDisabled) {
		t.Fatalf("disabled switch error = %v, want disabled", err)
	}
}

func TestCreateUploadBotErrorDoesNotExposeUpstreamDetail(t *testing.T) {
	var captured []uploadCreateCapture
	server := uploadControlServer(t, true, "", &captured, http.StatusBadRequest)
	// Replace the fixture with one whose response URL is not needed because the
	// Bot returns an error before the response is validated.
	useUploadBotConfig(t, rxBot.Config{ProxyEnabled: true, ResumableUploadEnabled: true, UploadPublicOrigin: server.URL}, server.URL)
	_, err := NewService().CreateUpload(context.Background(), "alice@example.com", UploadCreateInput{Filename: "sample.bin", SizeBytes: 1}, "550e8400-e29b-41d4-a716-446655440000")
	if !errors.Is(err, ErrUploadControlUnavailable) {
		t.Fatalf("Bot error = %v, want unavailable", err)
	}
	if strings.Contains(err.Error(), "private upstream detail") {
		t.Fatalf("upstream detail leaked through service error: %v", err)
	}
}

func TestRenewUploadCapabilityDerivesOwnerAndRejectsPathTampering(t *testing.T) {
	var renewOwner string
	var renewAsset string
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/agents":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(uploadAgentManifestJSON(t, true)))
		case r.Method == http.MethodPost && r.URL.Path == "/v1/files/file_test/capability":
			var request rxBot.UploadCapabilityRenewRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Fatalf("decode renewal request: %v", err)
			}
			renewOwner, renewAsset = request.OwnerSubject, "file_test"
			future := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
			later := time.Now().Add(2 * time.Hour).UTC().Format(time.RFC3339)
			_ = json.NewEncoder(w).Encode(rxBot.UploadCapabilityResponse{Protocol: rxBot.ResumableUploadProtocol, AssetID: "file_test", Status: "uploading", UploadURL: server.URL + "/v1/files/file_test", Capability: "renewed-capability", CapabilityExpiresAt: future, SessionExpiresAt: later})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	useUploadBotConfig(t, rxBot.Config{ProxyEnabled: true, ResumableUploadEnabled: true, UploadPublicOrigin: server.URL}, server.URL)
	result, err := NewService().RenewUploadCapability(context.Background(), "bob@example.com", "file_test")
	if err != nil || result.AssetID != "file_test" {
		t.Fatalf("renew result=%#v err=%v", result, err)
	}
	if renewOwner != "bob@example.com" || renewAsset != "file_test" {
		t.Fatalf("renewal identity = %q/%q", renewOwner, renewAsset)
	}
	_, err = NewService().RenewUploadCapability(context.Background(), "bob@example.com", "file_test/../../alice")
	if !errors.Is(err, ErrUploadMetadataInvalid) {
		t.Fatalf("tampered asset error = %v, want metadata error", err)
	}
}

func TestCreateUploadRejectsResponseFromUnexpectedOrigin(t *testing.T) {
	server := uploadControlServer(t, true, "http://evil.example", nil, http.StatusOK)
	useUploadBotConfig(t, rxBot.Config{ProxyEnabled: true, ResumableUploadEnabled: true, UploadPublicOrigin: server.URL}, server.URL)
	_, err := NewService().CreateUpload(context.Background(), "alice@example.com", UploadCreateInput{Filename: "sample.bin", SizeBytes: 1}, "550e8400-e29b-41d4-a716-446655440000")
	if !errors.Is(err, ErrUploadControlUnavailable) {
		t.Fatalf("unexpected-origin error = %v, want unavailable", err)
	}
}
