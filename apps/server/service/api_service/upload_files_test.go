package api_service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/spf13/viper"

	rxBot "phytomni-server/external/bot"
	rxLog "phytomni-server/log"
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

type uploadRequestTrace struct {
	Method        string
	Path          string
	Authorization string
	Body          string
}

type uploadRequestRecorder struct {
	mu       sync.Mutex
	requests []uploadRequestTrace
}

func (r *uploadRequestRecorder) record(request *http.Request, body string) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.requests = append(r.requests, uploadRequestTrace{
		Method:        request.Method,
		Path:          request.URL.Path,
		Authorization: request.Header.Get("Authorization"),
		Body:          body,
	})
}

func (r *uploadRequestRecorder) snapshot() []uploadRequestTrace {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]uploadRequestTrace(nil), r.requests...)
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

func captureUploadLogs(t *testing.T) string {
	t.Helper()
	var previous rxLog.Config
	if err := viper.UnmarshalKey("log", &previous); err != nil {
		t.Fatalf("read previous log config: %v", err)
	}
	logPath := filepath.Join(t.TempDir(), "upload-control.log")
	viper.Set("log", rxLog.Config{Level: "debug", Outputs: []string{logPath}})
	if err := rxLog.InitFromViper(); err != nil {
		t.Fatalf("initialize upload log capture: %v", err)
	}
	t.Cleanup(func() {
		rxLog.Flush()
		if len(previous.Outputs) == 0 {
			previous = rxLog.Config{Development: true, Level: "debug", Outputs: []string{"stderr"}}
		}
		viper.Set("log", previous)
		if err := rxLog.InitFromViper(); err != nil {
			t.Errorf("restore log config: %v", err)
		}
	})
	return logPath
}

func uploadControlServer(t *testing.T, withProtocol bool, responseBaseURL string, capture *[]uploadCreateCapture, status int) *httptest.Server {
	return uploadControlServerWithTrace(t, withProtocol, responseBaseURL, capture, status, nil, http.StatusOK, nil)
}

func uploadControlServerWithTrace(
	t *testing.T,
	withProtocol bool,
	responseBaseURL string,
	capture *[]uploadCreateCapture,
	status int,
	trace *uploadRequestRecorder,
	abortStatus int,
	abortStarted chan<- time.Time,
) *httptest.Server {
	t.Helper()
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/agents":
			trace.record(r, "")
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(uploadAgentManifestJSON(t, withProtocol)))
		case r.Method == http.MethodPost && r.URL.Path == "/v1/files":
			body, err := io.ReadAll(r.Body)
			if err != nil {
				http.Error(w, "invalid body", http.StatusBadRequest)
				return
			}
			trace.record(r, string(body))
			var request uploadCreateCapture
			if err := json.Unmarshal(body, &request); err != nil {
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
			body, err := io.ReadAll(r.Body)
			if err != nil {
				http.Error(w, "invalid body", http.StatusBadRequest)
				return
			}
			trace.record(r, string(body))
			assetID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v1/files/"), "/capability")
			var request rxBot.UploadCapabilityRenewRequest
			if err := json.Unmarshal(body, &request); err != nil {
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
		case r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, "/v1/files/"):
			body, err := io.ReadAll(r.Body)
			if err != nil {
				http.Error(w, "invalid body", http.StatusBadRequest)
				return
			}
			trace.record(r, string(body))
			if abortStarted != nil {
				abortStarted <- time.Now()
				<-r.Context().Done()
				return
			}
			if abortStatus != http.StatusOK {
				w.WriteHeader(abortStatus)
				_, _ = w.Write([]byte(`{"error":{"message":"private abort detail"}}`))
				return
			}
			assetID := strings.TrimPrefix(r.URL.Path, "/v1/files/")
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(rxBot.UploadAbortResponse{
				Protocol: rxBot.ResumableUploadProtocol,
				AssetID:  assetID,
				Status:   "aborted",
			})
		default:
			trace.record(r, "")
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
	if request.OwnerSubject != "alice@example.com" || request.Purpose != "dataset" {
		t.Fatalf("owner and purpose were not forwarded: %#v", request)
	}
	if request.Filename != "é.fastq.gz" {
		t.Fatalf("filename = %q, want NFC-normalized form", request.Filename)
	}
	if request.IdempotencyKey != "550e8400-e29b-41d4-a716-446655440000" {
		t.Fatalf("idempotency key = %q", request.IdempotencyKey)
	}
}

func TestCreateUploadDerivesPurposeFromFilename(t *testing.T) {
	for filename, purpose := range map[string]string{
		"counts.csv":    "dataset",
		"paper.pdf":     "document",
		"paper.pdf.zip": "dataset",
	} {
		t.Run(filename, func(t *testing.T) {
			var captured []uploadCreateCapture
			server := uploadControlServer(t, true, "", &captured, http.StatusOK)
			useUploadBotConfig(t, rxBot.Config{ProxyEnabled: true, ResumableUploadEnabled: true, UploadPublicOrigin: server.URL}, server.URL)
			_, err := NewService().CreateUpload(context.Background(), "alice@example.com", UploadCreateInput{Filename: filename, SizeBytes: 1}, "550e8400-e29b-41d4-a716-446655440000")
			if err != nil {
				t.Fatalf("CreateUpload error: %v", err)
			}
			if len(captured) != 1 || captured[0].OwnerSubject != "alice@example.com" || captured[0].Purpose != purpose {
				t.Fatalf("Bot request=%#v", captured)
			}
		})
	}
}

func TestCreateUploadRejectsUnsupportedOrAmbiguousFilenameBeforeBot(t *testing.T) {
	for _, filename := range []string{"sample.bin", "counts-paper.txt"} {
		t.Run(filename, func(t *testing.T) {
			var calls int
			server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls++ }))
			t.Cleanup(server.Close)
			useUploadBotConfig(t, rxBot.Config{ProxyEnabled: true, ResumableUploadEnabled: true, UploadPublicOrigin: server.URL}, server.URL)
			_, err := NewService().CreateUpload(context.Background(), "alice@example.com", UploadCreateInput{Filename: filename, SizeBytes: 1}, "550e8400-e29b-41d4-a716-446655440000")
			if !errors.Is(err, ErrUploadMetadataInvalid) {
				t.Fatalf("filename %q error=%v, want invalid metadata", filename, err)
			}
			if calls != 0 {
				t.Fatalf("invalid filename reached Bot %d times", calls)
			}
		})
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
			_, err := NewService().CreateUpload(context.Background(), "alice@example.com", UploadCreateInput{Filename: "paper.pdf", SizeBytes: size}, "550e8400-e29b-41d4-a716-446655440000")
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
	_, err := NewService().CreateUpload(context.Background(), "alice@example.com", UploadCreateInput{Filename: "paper.pdf", SizeBytes: resumableUploadMaxFileBytes + 1}, "550e8400-e29b-41d4-a716-446655440000")
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
	_, err := NewService().CreateUpload(context.Background(), "alice@example.com", UploadCreateInput{Filename: "paper.pdf", SizeBytes: 1}, "550e8400-e29b-41d4-a716-446655440000")
	if !errors.Is(err, ErrUploadControlDisabled) {
		t.Fatalf("missing protocol error = %v, want disabled", err)
	}

	rxBot.BotConfig.ResumableUploadEnabled = false
	_, err = NewService().CreateUpload(context.Background(), "alice@example.com", UploadCreateInput{Filename: "paper.pdf", SizeBytes: 1}, "550e8400-e29b-41d4-a716-446655440000")
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
	_, err := NewService().CreateUpload(context.Background(), "alice@example.com", UploadCreateInput{Filename: "paper.pdf", SizeBytes: 1}, "550e8400-e29b-41d4-a716-446655440000")
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

func TestCreateUploadCompensatesUnexpectedOrigin(t *testing.T) {
	var hostile uploadRequestRecorder
	hostileServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hostile.record(r, "")
		http.Error(w, "hostile target reached", http.StatusInternalServerError)
	}))
	t.Cleanup(hostileServer.Close)

	var trace uploadRequestRecorder
	server := uploadControlServerWithTrace(t, true, hostileServer.URL, nil, http.StatusOK, &trace, http.StatusOK, nil)
	useUploadBotConfig(t, rxBot.Config{
		ProxyEnabled:           true,
		ResumableUploadEnabled: true,
		UploadPublicOrigin:     server.URL,
		UserAPIKey:             "private-service-key-marker",
	}, server.URL)

	_, err := NewService().CreateUpload(context.Background(), "alice@example.com", UploadCreateInput{Filename: "paper.pdf", SizeBytes: 1}, "550e8400-e29b-41d4-a716-446655440000")
	if !errors.Is(err, ErrUploadControlUnavailable) {
		t.Fatalf("unexpected-origin error = %v, want unavailable", err)
	}
	if got := hostile.snapshot(); len(got) != 0 {
		t.Fatalf("hostile upload origin received requests: %#v", got)
	}
	got := trace.snapshot()
	if len(got) != 3 {
		t.Fatalf("trusted Bot request trace = %#v, want GET, POST, DELETE", got)
	}
	if got[1].Method != http.MethodPost || got[1].Path != "/v1/files" {
		t.Fatalf("create trace entry = %#v, want POST /v1/files", got[1])
	}
	if got[2].Method != http.MethodDelete || got[2].Path != "/v1/files/file_test" {
		t.Fatalf("compensation trace entry = %#v, want trusted DELETE path", got[2])
	}
	if got[2].Authorization != "Bearer opaque-capability" {
		t.Fatalf("compensation authorization = %q, want capability only", got[2].Authorization)
	}
	if got[2].Body != "" {
		t.Fatalf("compensation body = %q, want empty", got[2].Body)
	}
	if strings.Contains(got[2].Authorization, "private-service-key-marker") {
		t.Fatalf("compensation exposed the service key: %#v", got[2])
	}
}

func TestCreateUploadCompensationOutlivesCanceledContextAndIsBounded(t *testing.T) {
	abortStarted := make(chan time.Time, 1)
	var trace uploadRequestRecorder
	server := uploadControlServerWithTrace(t, true, "http://unexpected.example", nil, http.StatusOK, &trace, http.StatusOK, abortStarted)
	useUploadBotConfig(t, rxBot.Config{
		ProxyEnabled:           true,
		ResumableUploadEnabled: true,
		UploadPublicOrigin:     server.URL,
		TimeoutSeconds:         30,
	}, server.URL)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() {
		_, err := NewService().CreateUpload(ctx, "alice@example.com", UploadCreateInput{Filename: "paper.pdf", SizeBytes: 1}, "550e8400-e29b-41d4-a716-446655440000")
		result <- err
	}()

	started := <-abortStarted
	cancel()
	err := <-result
	elapsed := time.Since(started)
	if !errors.Is(err, ErrUploadControlUnavailable) {
		t.Fatalf("canceled create error = %v, want unavailable", err)
	}
	if elapsed < 4*time.Second || elapsed > 5500*time.Millisecond {
		t.Fatalf("detached compensation duration = %s, want cancellation-independent bound near five seconds", elapsed)
	}
	got := trace.snapshot()
	if len(got) != 3 || got[2].Method != http.MethodDelete {
		t.Fatalf("detached compensation trace = %#v, want one DELETE", got)
	}
}

func TestCreateUploadCompensationFailureKeepsGenericError(t *testing.T) {
	server := uploadControlServerWithTrace(t, true, "http://unexpected.example", nil, http.StatusOK, nil, http.StatusInternalServerError, nil)
	useUploadBotConfig(t, rxBot.Config{ProxyEnabled: true, ResumableUploadEnabled: true, UploadPublicOrigin: server.URL}, server.URL)
	_, err := NewService().CreateUpload(context.Background(), "alice@example.com", UploadCreateInput{Filename: "paper.pdf", SizeBytes: 1}, "550e8400-e29b-41d4-a716-446655440000")
	if !errors.Is(err, ErrUploadControlUnavailable) {
		t.Fatalf("failed-compensation error = %v, want unavailable", err)
	}
	for _, marker := range []string{"private abort detail", "unexpected.example", "opaque-capability"} {
		if strings.Contains(err.Error(), marker) {
			t.Fatalf("failed-compensation error leaked %q: %v", marker, err)
		}
	}
}

func TestCreateUploadDoesNotCompensateUnsafeResponse(t *testing.T) {
	var trace uploadRequestRecorder
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		trace.record(r, string(body))
		if r.Method == http.MethodGet && r.URL.Path == "/v1/agents" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(uploadAgentManifestJSON(t, true)))
			return
		}
		if r.Method == http.MethodPost && r.URL.Path == "/v1/files" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"protocol":"obs-multipart-v2","asset_id":"unsafe/identity","status":"uploading"}`))
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(server.Close)
	useUploadBotConfig(t, rxBot.Config{ProxyEnabled: true, ResumableUploadEnabled: true, UploadPublicOrigin: server.URL}, server.URL)

	_, err := NewService().CreateUpload(context.Background(), "alice@example.com", UploadCreateInput{Filename: "paper.pdf", SizeBytes: 1}, "550e8400-e29b-41d4-a716-446655440000")
	if !errors.Is(err, ErrUploadControlUnavailable) {
		t.Fatalf("unsafe-response error = %v, want unavailable", err)
	}
	got := trace.snapshot()
	if len(got) != 2 || got[0].Method != http.MethodGet || got[1].Method != http.MethodPost {
		t.Fatalf("unsafe response trace = %#v, want GET then POST without DELETE", got)
	}
}

func TestUploadControlErrorClassifierMatrix(t *testing.T) {
	type errorPair struct {
		status int
		code   string
	}
	exact := map[errorPair]error{
		{status: http.StatusConflict, code: "upload_state_conflict"}:              ErrUploadStateConflict,
		{status: http.StatusGone, code: "upload_session_expired"}:                 ErrUploadSessionExpired,
		{status: http.StatusRequestEntityTooLarge, code: "upload_limit_exceeded"}: ErrUploadLimitExceeded,
	}

	tests := make([]struct {
		name string
		err  error
		want error
	}, 0, 20)
	for _, status := range []int{http.StatusConflict, http.StatusGone, http.StatusRequestEntityTooLarge} {
		for _, code := range []string{"upload_state_conflict", "upload_session_expired", "upload_limit_exceeded"} {
			pair := errorPair{status: status, code: code}
			want := ErrUploadControlUnavailable
			if sentinel, ok := exact[pair]; ok {
				want = sentinel
			}
			tests = append(tests, struct {
				name string
				err  error
				want error
			}{
				name: fmt.Sprintf("status_%d_code_%s", status, code),
				err:  fmt.Errorf("wrapped: %w", &rxBot.APIError{Status: status, Code: code, Message: "private-provider-message-marker"}),
				want: want,
			})
		}
	}
	tests = append(tests,
		struct {
			name string
			err  error
			want error
		}{"unknown_4xx", &rxBot.APIError{Status: http.StatusUnprocessableEntity, Code: "unknown", Message: "private-provider-message-marker"}, ErrUploadControlUnavailable},
		struct {
			name string
			err  error
			want error
		}{"unauthorized", &rxBot.APIError{Status: http.StatusUnauthorized, Code: "upload_state_conflict", Message: "private-provider-message-marker"}, ErrUploadControlUnavailable},
		struct {
			name string
			err  error
			want error
		}{"forbidden", &rxBot.APIError{Status: http.StatusForbidden, Code: "upload_session_expired", Message: "private-provider-message-marker"}, ErrUploadControlUnavailable},
		struct {
			name string
			err  error
			want error
		}{"malformed_body", &rxBot.APIError{Status: http.StatusConflict, Message: "private-provider-message-marker"}, ErrUploadControlUnavailable},
		struct {
			name string
			err  error
			want error
		}{"server_error", &rxBot.APIError{Status: http.StatusInternalServerError, Code: "upload_state_conflict", Message: "private-provider-message-marker"}, ErrUploadControlUnavailable},
		struct {
			name string
			err  error
			want error
		}{"transport", errors.New("private-transport-message-marker"), ErrUploadControlUnavailable},
	)

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := classifyUploadControlError(test.err, "create")
			if !errors.Is(got, test.want) {
				t.Fatalf("classified error = %v, want %v", got, test.want)
			}
			for pair, sentinel := range exact {
				if sentinel != test.want && errors.Is(got, sentinel) {
					t.Fatalf("status/code mismatch %#v also matched %v", pair, sentinel)
				}
			}
			for _, marker := range []string{"private-provider-message-marker", "private-transport-message-marker"} {
				if strings.Contains(got.Error(), marker) {
					t.Fatalf("classified error leaked %q: %v", marker, got)
				}
			}
		})
	}
}

func TestUploadControlErrorClassifierIsUsedByCreateAndRenew(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/v1/agents" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(uploadAgentManifestJSON(t, true)))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/files":
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"error":{"code":"upload_state_conflict","message":"private create detail"}}`))
		case r.Method == http.MethodPost && r.URL.Path == "/v1/files/file_test/capability":
			w.WriteHeader(http.StatusGone)
			_, _ = w.Write([]byte(`{"error":{"code":"upload_session_expired","message":"private renew detail"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	useUploadBotConfig(t, rxBot.Config{ProxyEnabled: true, ResumableUploadEnabled: true, UploadPublicOrigin: server.URL}, server.URL)

	_, createErr := NewService().CreateUpload(context.Background(), "alice@example.com", UploadCreateInput{Filename: "paper.pdf", SizeBytes: 1}, "550e8400-e29b-41d4-a716-446655440000")
	if !errors.Is(createErr, ErrUploadStateConflict) || strings.Contains(createErr.Error(), "private create detail") {
		t.Fatalf("create classified error = %v", createErr)
	}
	_, renewErr := NewService().RenewUploadCapability(context.Background(), "alice@example.com", "file_test")
	if !errors.Is(renewErr, ErrUploadSessionExpired) || strings.Contains(renewErr.Error(), "private renew detail") {
		t.Fatalf("renew classified error = %v", renewErr)
	}
}

func TestCreateUploadLogsCategoriesWithoutSensitiveMarkers(t *testing.T) {
	logPath := captureUploadLogs(t)
	_ = classifyUploadControlError(&rxBot.APIError{
		Status:  http.StatusConflict,
		Code:    "upload_state_conflict",
		Message: "private-provider-message-marker",
	}, "create")

	for _, test := range []struct {
		name        string
		abortStatus int
	}{
		{name: "succeeded", abortStatus: http.StatusOK},
		{name: "failed", abortStatus: http.StatusInternalServerError},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := uploadControlServerWithTrace(t, true, "http://private-url-marker.invalid", nil, http.StatusOK, nil, test.abortStatus, nil)
			useUploadBotConfig(t, rxBot.Config{ProxyEnabled: true, ResumableUploadEnabled: true, UploadPublicOrigin: server.URL}, server.URL)
			_, _ = NewService().CreateUpload(context.Background(), "private-owner-marker", UploadCreateInput{Filename: "private-body-marker.pdf", SizeBytes: 1}, "550e8400-e29b-41d4-a716-446655440000")
		})
	}

	rxLog.Flush()
	raw, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("read upload control logs: %v", err)
	}
	logs := string(raw)
	for _, category := range []string{"upload_state_conflict", "upload compensation attempted", "upload compensation succeeded", "upload compensation failed"} {
		if !strings.Contains(logs, category) {
			t.Errorf("logs missing category %q: %s", category, logs)
		}
	}
	for _, marker := range []string{
		"private-provider-message-marker",
		"private-owner-marker",
		"private-body-marker.pdf",
		"private-url-marker.invalid",
		"opaque-capability",
		"file_test",
		"private abort detail",
	} {
		if strings.Contains(logs, marker) {
			t.Errorf("logs leaked marker %q: %s", marker, logs)
		}
	}
}
